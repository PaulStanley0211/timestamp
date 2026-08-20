# Running the app

Two processes and a directory between them. That shape is not tidiness — it is
the constraint the whole build is arranged around, and it is worth understanding
before you run anything.

## Why two processes

**ffmpeg needs a real machine.** The entire look of this product lives in
ffmpeg, and a serverless runtime has no ffmpeg binary. So the thing that serves
HTTP and the thing that renders cannot be the same deployment, ever. They are
split from day one specifically so that discovering it later is not a rewrite.

**Nothing is request/response.** A 15-second render is roughly 30 seconds of
ffmpeg *after* generation calls that take minutes. `POST /api/jobs` writes a
manifest, drops a pointer in the queue, and returns `201` immediately. If you
ever find a render being awaited inside a request handler, that is the single
mistake this architecture exists to prevent.

```
  browser ──HTTP──▶  web process  ──writes──▶  out/jobs/<id>/manifest.json
                          │                              ▲
                          └──enqueue──▶ out/queue/ ──claim──┐
                                                            │
                                       worker process ──────┘
                                       (has ffmpeg, holds the lease,
                                        is the ONLY manifest writer)
```

## Start it

Two terminals. There is no launcher script, because `scripts/ffmpeg/run.mjs` is
the only module in this repo permitted to spawn a process and that rule is worth
more than the convenience.

```bash
npm run doctor
```

```bash
npm run web
```

```bash
npm run worker -- --provider=fixture
```

Then open the address the web process prints.

For local poking there is `npm run web -- --with-worker`, which runs the worker
loop inside the web process. It is a convenience and it is deliberately not the
default: running them together hides exactly the failure modes the split exists
to expose.

## What `--provider=fixture` means

The fixture provider is a real implementation, not a stub. It renders actual
stills and actual clips through ffmpeg, deterministically from the seed, and
costs nothing. Everything downstream of it — the queue, the manifest, resume,
the look, the contract assertions, the web app — is exercised for real.

What it does **not** tell you is whether a generative model can put a specific
person in a specific place recognisably from one photograph. That is Phase 0,
it is still unanswered, and it is the only question that decides whether this is
a product. Running the app end to end proves the *plumbing*. Keep the two claims
apart.

## Watching it work

```bash
npm run queue -- stats          # depth, and any stale lease
npm run queue -- peek           # what is waiting, in claim order
npm run jobs                    # every job and its status
npm run jobs -- show <jobId>    # the manifest, readably
```

A job that has stalled is not a mystery: `out/jobs/<jobId>/manifest.json` says
which step it is on, how many attempts it has had, and what the last error was.
A CLI's dead-letter queue is a directory you can open.

## When something goes wrong

**A job is stuck in `claimed/`.** Its worker died. `npm run queue -- reap`
returns any lease past its deadline to `pending`. The worker also does this on
startup, so restarting it is usually enough.

**A job failed halfway.** Resume it. Steps already `done` are skipped, and
anything already paid for is not paid for twice — that property is tested by a
matrix that crashes before each of the eleven steps and asserts the paid steps
submitted exactly once.

```bash
npm run render -- --resume=<jobId>
```

**The date stamp is missing from the render.** `fontfile` failed to resolve and
`drawtext` silently rendered nothing. `npm run doctor` checks the font, and the
`burn-in` contract assertion catches it after the fact — that assertion exists
because a silent `drawtext` failure is invisible until someone looks at a frame.

**Two workers appear to be fighting over one job.** They cannot be, and if the
symptoms say otherwise the lease logic is what to suspect. Exactly one process —
whoever holds the queue lease — writes a manifest. The web process never writes
one for a job that a worker may be holding; a cancel arrives as a
`cancel.requested` sentinel file that the worker acts on between steps.

## Retention

This system stores photographs of people's faces.

```bash
npm run purge -- --older-than=7d --photos-only    # dry run by default
npm run purge -- --older-than=7d --photos-only --execute
```

`retention.photoDays` is 7 and `retention.jobDays` is 30, in
`config/render.json`. Purge defaults to a dry run because deleting faces is not
something that should ever happen by accident.
