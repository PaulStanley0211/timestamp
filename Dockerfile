# Timestamp, as one image that can run either process.
#
# HOST-AGNOSTIC ON PURPOSE. Nothing here names a provider. What it does encode
# is the one constraint that rules most providers out: `scripts/queue/queue.mjs`
# claims a job with `linkSync`, which is a filesystem primitive and not a
# network one, so the web process and the worker process must see ONE block
# filesystem. That is why `/data` is a VOLUME and why the two commands below
# are the same image with different arguments -- they are meant to be two
# processes over one disk, not two services with a disk each.
#
# WHAT IS PINNED, AND WHY EACH.
#
#   * The base image is pinned BY DIGEST. A tag moves; `node:22-bookworm-slim`
#     was a different image last month and will be again. A digest is the only
#     reference that makes "rebuild it" mean the same thing twice.
#
#   * ffmpeg is gated on its MAJOR version rather than pinned to an exact apt
#     version, and that is a deliberate trade rather than laziness. Pinning
#     `7:5.1.9-0+deb12u1` exactly would break the build the day Debian ships a
#     security patch -- and refusing security patches to ffmpeg, which is the
#     thing that parses strangers' uploads, is the wrong direction. What a
#     major bump WOULD change is filter behaviour, and this product's entire
#     look is calibrated against measured filter behaviour, so that is the
#     change worth failing loudly on.
#
#   * The preflight runs AT BUILD TIME. `doctor` checks all thirty-four
#     filters the look compiles to plus the bundled font, and exits non-zero on
#     any fatal. Without it, an ffmpeg missing `chromashift` produces an image
#     that builds, boots, serves, takes a customer's money and only then fails
#     -- after the provider has been paid. This turns that into a build that
#     does not produce an image.

ARG NODE_MAJOR=22
# TRIXIE (Debian 13) RATHER THAN BOOKWORM, AND THE REASON IS THE FFMPEG BELOW.
# Bookworm ships ffmpeg 5.1, and on 2026-09-02 the first tape ever rendered
# inside this image came out ENTIRELY GREEN -- correct luma structure, correct
# frame count, correct duration, correct loudness, and the colour of a fault.
# The same commit on the same source clip rendered correctly against 8.1.1
# outside the container. Trixie ships 7.1.
FROM node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284

# THE MAJOR VERSION THE LOOK IS CALIBRATED AGAINST, and this line was WRONG
# from the day it was written until 2026-09-02. It said 5, with a comment
# claiming 5 was what the look had been calibrated against; it never was. 5 is
# what Debian 12 happened to ship. The look was tuned on this project's own
# machine against 8.x, and nothing noticed for four days because the box had
# never rendered a tape -- the queue read `done 0` until the supplier change.
#
# WHAT THE BUILD-TIME PREFLIGHT BELOW CANNOT SEE, and this is the lesson: it
# checks that all 36 filters EXIST. They exist in 5.1. They behave differently,
# and the grade/tape boundary is negotiated rather than pinned (see CLAUDE.md,
# "The grade runs in RGB and the tape stage runs in YUV"). Presence is not
# behaviour, and a green tape satisfies every assertion this project makes.
#
# Bump this deliberately, after re-rendering a real tape and LOOKING AT IT.
ARG FFMPEG_MAJOR=7

# ffmpeg is the whole texture half of this product; `tini` is here because node
# as PID 1 does not reap children, and every render spawns one.
#
# The version gate is the point of this layer. `apt-get install ffmpeg` is
# resilient to patch updates and blind to a major bump, so the bump is checked
# explicitly and the build stops on it.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ffmpeg tini; \
    rm -rf /var/lib/apt/lists/*; \
    installed="$(ffmpeg -version | head -1 | sed -E 's/^ffmpeg version ([0-9]+).*/\1/')"; \
    echo "ffmpeg major ${installed} (expected ${FFMPEG_MAJOR})"; \
    if [ "${installed}" != "${FFMPEG_MAJOR}" ]; then \
      echo "REFUSING: ffmpeg major ${installed} != ${FFMPEG_MAJOR}." >&2; \
      echo "The look is calibrated against measured filter behaviour. Re-run 'npm run look'," >&2; \
      echo "compare the output, then raise FFMPEG_MAJOR in this file." >&2; \
      exit 1; \
    fi

WORKDIR /app

# Zero npm dependencies, therefore no install step, no lockfile and no
# node_modules layer. That is not an omission -- it is the property
# `guards.yml` protects, and it is why this image has no build stage.
# NO --chown HERE, DELIBERATELY. /app stays root-owned and is read-only to the
# user the app runs as.
#
# Nothing in the running container writes to /app: state is on /data, which is
# chowned separately below for exactly that reason. Handing /app to `node` cost
# nothing visible and removed the last containment layer between a file-write
# bug and code execution -- this service accepts multipart uploads of arbitrary
# files from strangers through a hand-written parser, and if the writing process
# owns every .mjs the worker imports, an arbitrary-write becomes RCE with
# FAL_KEY, SUPABASE_SECRET_KEY and STRIPE_SECRET_KEY in the environment.
#
# The preflight below still runs as `node` and only READS, so the gate is
# unaffected.
COPY . .

# Where the queue, the jobs, the accounts and the sessions live.
#
# OUTSIDE /app DELIBERATELY. A redeploy replaces the code directory; state
# under it would be replaced with it. Keeping it separate is also what lets one
# volume be mounted into two containers, which is the `linkSync` constraint
# above.
#
# THE chown IS LOAD-BEARING AND MUST RUN HERE, WHILE THIS IS STILL root. A
# fresh named volume takes its ownership from whatever the image has at that
# path; an image that never creates it hands Docker a root-owned default, and
# the container then starts, fails its first mkdir, prints nothing but
# `EACCES` and refuses every connection. Found by running it, not by reading
# it.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
ENV TIMESTAMP_DATA_ROOT=/data

# The gate. Runs as the user that will run the app, so a permission problem
# surfaces here rather than at the first render.
USER node
RUN node scripts/preflight/doctor.mjs

# `--host=0.0.0.0` is not optional in a container. `server-cli.mjs` defaults to
# `127.0.0.1`, which here is the container's own loopback: the process boots,
# prints its banner and answers nothing, from outside or from a health check.
#
# `--root` is a FLAG with no environment fallback, so TIMESTAMP_DATA_ROOT alone
# would be ignored and every account would land in the image layer.
#
# The worker is THIS IMAGE with the command replaced:
#   node scripts/worker/worker-cli.mjs --root=/data --provider=fal
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/web/server-cli.mjs", "--host=0.0.0.0", "--port=3000", "--root=/data"]
