# Interfaces — the contract every module is built against

Written 2026-08-20, before the end-to-end build, so that eight parallel
workstreams meet at seams that were specified rather than negotiated after the
fact. **If your module's shape disagrees with this file, this file wins.**
Changing a signature here is a conversation, not an edit.

Everything below is additive. `scripts/tapedeck/`, `scripts/audio/`,
`scripts/compose/`, `scripts/catalog/`, `scripts/ffmpeg/`, `scripts/preflight/`
are DONE and MUST NOT be modified.

---

## 0. House rules that apply to every new module

- Node 22+, ESM, `.mjs` in `scripts/`, tests are flat `.js` in `test/`.
- **Zero npm dependencies.** Node stdlib only. No `sharp`, no `express`, no
  face detector, no `multer`. `node:test`, `node:assert/strict`, `node:http`.
- **`scripts/ffmpeg/run.mjs` is the only module permitted to spawn a process.**
  Need ffmpeg? Import `runFfmpeg` / `runFfprobe` / `probe` from it.
- **Nothing new may read the wall clock inside a render path.** Timestamps in a
  manifest are fine (they are metadata). Anything that reaches a filtergraph is
  derived from the seed. See `compose/seed.mjs`.
- **Injected impls, always.** Every function that does I/O or network takes its
  dependency as a named option with a real default, EXCEPT `fetchImpl` on a
  paid provider, which has **no default** — a test that forgets it must get a
  `TypeError`, not a bill.
- `npm test` must stay unable to spend money. Only `*-smoke.test.js` may spend,
  and it self-skips unless `TIMESTAMP_LIVE=1`.
- Comments explain *why*, in the register of the existing code. Match it.

---

## 1. Job model — `scripts/render/job.mjs`

The manifest is the single source of truth. The queue holds pointers; if the
queue is deleted the jobs are still recoverable by reading their manifests.

**Layout**

```
out/jobs/<jobId>/
  manifest.json          durable state, atomically written
  intent/<step>.json     written BEFORE any provider request (idempotency)
  input/photo.jpg        EXIF-stripped copy of the upload
  input/place.jpg        optional second reference
  stills/still-01.png    provider output
  segments/seg-01.mp4    provider output
  source.mp4             segments concatenated, pre-look
  timestamp.mp4          THE DELIVERABLE
  poster.jpg
  review/stills.html
  review/summary.md
  logs/<step>.log
```

`jobId` = `<YYYYMMDD>-<HHMMSS>-<6 hex>`, lowercase, filesystem-safe, sorts
chronologically. Wall clock is fine here — a job id is an identity, not a
render input — but note `deriveSeed(jobId, kind, i)` means **two jobs never
produce identical bytes**, which is correct: they are different renders.

**Manifest**

```jsonc
{
  "schemaVersion": 1,
  "jobId": "20260820-144501-a3f19c",
  "createdAt": "ISO-8601", "updatedAt": "ISO-8601",
  "status": "queued|running|awaiting-selection|done|failed|cancelled",
  "provider": "fixture",
  "input": {
    "photo":  { "path": "input/photo.jpg", "sha256": "...", "width": 0, "height": 0 },
    "place":  { "kind": "preset|text|photo", "value": "schrebergarten-august",
                "photoPath": null, "photoSha256": null },
    "outfit": { "kind": "preset|text",       "value": "trainingsjacke" },
    "stillCount": 3,
    "consent": { "granted": true, "at": "ISO-8601", "text": "<the exact wording shown>" }
  },
  "resolved": {                 // FROZEN at compose. NEVER re-derived on resume.
    "catalogHash": "...", "lookHash": "...",
    "place": { /* full validated place object */ },
    "outfit": { /* full validated outfit object */ },
    "look": { /* merged LookProfile */ },
    "cfg": { /* config/render.json as loaded */ },
    "stillPrompt": { "prompt": "", "negativePrompt": "", "fragments": {} },
    "motionPrompts": [ { "prompt": "", "negativePrompt": "" } ],
    "segments": [ { "index": 1, "seconds": 8, "seed": 0 } ],
    "seeds": { "still": 0, "audio": 0, "stamp": 0 }
  },
  "steps": [
    { "name": "intake", "status": "pending|running|done|failed|skipped",
      "startedAt": null, "endedAt": null, "attempts": 0,
      "output": {}, "error": null,
      "cost": { "estimated": 0, "actual": null, "currency": "USD" } }
  ],
  "selection": { "stillIndex": null, "chosenBy": null },
  "cost": { "estimated": 0, "actual": null, "currency": "USD" },
  "result": { "videoPath": null, "posterPath": null, "durationSeconds": null,
              "frames": null, "lufs": null },
  "error": null
}
```

**The frozen `resolved` block is why "reproducible" is a property and not a
word.** An edited preset must not silently redefine a past render. Nothing
downstream of `compose` may read `presets/` or `config/` again — it reads
`manifest.resolved`.

**API**

```js
export const STEPS;              // ordered step names, frozen array
export const STATUSES;           // frozen
export class JobError extends Error {}          // .code, .jobId

export function newJobId({ now = () => new Date(), rand = crypto } = {}): string
export function createJob({ root, jobId?, input, provider, cfg, nowImpl? }): Job
export function loadJob({ root, jobId }): Job
export function listJobs({ root }): Array<{jobId, status, createdAt, updatedAt}>
export function saveJob(job): void          // atomic: tmp file + rename
export function jobPaths(root, jobId): { dir, manifest, intent, input, stills,
                                          segments, review, logs, video, poster }

export function beginStep(job, name): void   // running, attempts++, startedAt
export function finishStep(job, name, { output, cost }): void
export function failStep(job, name, error): void       // sets job.status='failed'
export function skipStep(job, name, reason): void
export function meterStep(job, name, actual): Step   // price a step that ALREADY ran
export function stepStatus(job, name): string
export function nextStep(job): string|null   // first step not done/skipped
export function isResumable(job): boolean

// Idempotency. Written BEFORE the request, read on resume.
export function recordIntent(job, step, payload): { key, existing: boolean }
export function readIntent(job, step): object|null
export function completeIntent(job, step, result): void
```

`meterStep` is the only way to write `cost.actual` after the fact and it does
NOT move the step: `finishStep` is a `running -> done` transition and metering
happens days later against an invoice. It refuses a `pending` or `skipped` step
-- a skipped step produced nothing and cost nothing -- and allows a `failed` one,
because a request that went out and never came back is still billable.
`npm run ledger -- record <jobId> --actual=<usd>` is the caller.

`recordIntent` returns `existing: true` when an intent file is already present
with no recorded result — that is the "we may have submitted and crashed"
case, and the pipeline must surface it rather than blindly resubmit.

Atomic write: write `manifest.json.tmp`, `fs.renameSync` over the target.

---

## 2. Provider contract — `scripts/providers/`

`contract.mjs` holds the typedefs, the shape assertions and `assertProvider()`.
`fixture.mjs` and (later) `fal.mjs` are two genuinely different implementations
that pass the same conformance test.

```js
/**
 * @typedef {Object} Reference
 * @property {'face'|'place'} role
 * @property {string} path            absolute
 *
 * @typedef {Object} StillRequest
 * @property {string} prompt
 * @property {string} negativePrompt
 * @property {Reference[]} references     >=1, exactly one with role 'face'
 * @property {number} seed                0..2147483647
 * @property {number} count               1..8
 * @property {{width:number,height:number}} size    4:3, e.g. 1024x768
 * @property {string} idempotencyKey
 *
 * @typedef {Object} StillResult
 * @property {Array<{path:string,index:number,seed:number}>} stills
 * @property {{estimated:number,actual:number|null,currency:'USD'}} cost
 * @property {{model:string,requestId:string,latencyMs:number}} meta
 *
 * @typedef {Object} VideoRequest
 * @property {string} prompt
 * @property {string} negativePrompt
 * @property {string} imagePath           the approved still, or prev last frame
 * @property {number} seed
 * @property {number} seconds
 * @property {false} nativeAudio          REQUIRED and REQUIRED to be false
 * @property {string} idempotencyKey
 *
 * @typedef {Object} VideoResult
 * @property {{path:string,seconds:number}} clip
 * @property {{estimated:number,actual:number|null,currency:'USD'}} cost
 * @property {{model:string,requestId:string,latencyMs:number}} meta
 *
 * @typedef {Object} ProviderCtx
 * @property {string} outDir
 * @property {function} [fetchImpl]       NO DEFAULT on a paid provider
 * @property {function} [sleepImpl]
 * @property {AbortSignal} [signal]
 * @property {(e:{phase:string,pct?:number,message?:string})=>void} [onProgress]
 */

export function assertStillRequest(req): void
export function assertVideoRequest(req): void      // throws if nativeAudio !== false
export function assertStillResult(res): void
export function assertVideoResult(res): void
export function assertProvider(p): void            // shape of the object itself
```

A provider object:

```js
{
  id: 'fixture',
  capabilities: {
    maxClipSeconds: 8,
    stillSizes: [{width:1024,height:768}],
    maxReferences: 2,
    supportsNativeAudioOff: true,
    supportsPlaceReference: true,
  },
  async generateStill(req, ctx): Promise<StillResult>,
  async generateVideo(req, ctx): Promise<VideoResult>,
}
```

**Errors — `scripts/providers/errors.mjs`**

```js
export class ProviderError extends Error {}     // .provider .code .retriable .detail
export class CredentialError extends ProviderError {}     // retriable = false
export class TerminalError extends ProviderError {}       // retriable = false
export class RetriableError extends ProviderError {}      // retriable = true
export class TimeoutError extends RetriableError {}
export class CapabilityError extends TerminalError {}     // asked for what it cannot do
export class ModerationRefusedError extends TerminalError {}
export function classifyHttp(status, body): ProviderError
export function isRetriable(err): boolean
```

`classifyHttp`: 401/403 → Credential, 400/422 → Terminal, 429 + 5xx → Retriable,
anything else → Terminal. Retry ladder is 1/2/4/8 s × `cfg.provider.backoffBaseMs`,
`maxAttempts` from config, `sleepImpl` injected.

**The fixture provider must be a real implementation, not a stub.** It writes
actual PNG stills and actual mp4 clips by calling `runFfmpeg` — deterministic
from the seed, visually distinguishable from each other, correctly sized, and
with **zero audio streams**. That is what makes the whole pipeline runnable and
assertable for $0. It also honours a configurable simulated latency so the queue
and the polling UI are exercised against something that takes time.

---

## 3. Intake — `scripts/intake/photo.mjs`

```js
export class IntakeError extends Error {}    // .code, .userMessage (safe to show)

export const LIMITS = { maxBytes: 12_000_000, minEdge: 256, maxEdge: 8000,
                        accept: ['image/jpeg','image/png','image/webp'] };

export async function inspectPhoto(srcPath, opts?):
  Promise<{ width, height, format, bytes, sha256, hasExif, orientation }>

export async function ingestPhoto(srcPath, destPath, opts?):
  Promise<{ path, sha256, width, height, stripped: true, rotated: boolean }>
```

`ingestPhoto` re-encodes through ffmpeg. That autorotates from EXIF and drops
every metadata block in one step — `-map_metadata -1`. **EXIF/GPS stripping is
load-bearing, not hygiene**: a photo of a place carries its coordinates, and
someone uploading their childhood garden is handing over its location.

Also exported: `faceGate(path, opts)` → `{ ok, reason, confidence }`. There is
no face detector in this repo and one is not being added. Ship the **seam** with
a permissive default implementation that checks only what is cheaply checkable
(aspect, size, that it decoded at all) and records `confidence: 'unverified'`.
The manifest records which implementation ran, so the day a real gate exists it
is one injection, and every historic job says honestly that it was unverified.

---

## 4. Safety — `scripts/safety/moderate.mjs`

Free user text lands inside our prompt, and the output contains a real person's
face. This is the product's highest-risk surface.

```js
export class ModerationError extends Error {}   // .code, .userMessage, .categories

export function moderateText(text, { kind: 'place'|'outfit' }):
  { ok, cleaned, flags: string[], reason: string|null }

export function stripInjection(text): { cleaned, removed: string[] }

export async function moderateJob(input, opts?):
  Promise<{ ok, refusals: [], warnings: [] }>
```

Rules, in order:
1. **Length + shape.** Free text is 2..200 chars, single line, no URLs, no
   code fences, no markup.
2. **Injection stripping.** Anything that reads as an instruction to a model
   rather than a description of a place — "ignore previous", "system:",
   "you are", "instead", "disregard", bracketed role tags, "prompt:". Removed
   and recorded, not silently kept.
3. **Named-person refusal.** A place or outfit naming a real, identifiable
   person is refused. The face in the output is the *uploader's*, and it stays
   that way.
4. **The look vocabulary is still banned.** `catalog/schema.mjs` already exports
   `BANNED` and `scanText`. **Reuse them** — free text must clear the same bar a
   shipped preset does. Do not write a second word list.
5. **Refusals are rare and specific.** The vision is that anyone types anything
   and gets a video. Refuse a category, never a vibe, and always say which rule.

### AMENDED — rule 4 is a WARNING on user text, not a refusal

Rule 4 above originally read as a hard bar and that was wrong. `look`, `person`,
`wardrobe` and `scene` govern **what the prompt says to the model**, not what a
user typed. A shipped preset *is* prompt text, so a hit there is an authoring bug
and refusing is right. Raw user text is an *input to expansion* and never reaches
the model verbatim, so a hit there means nothing yet — and refusing it rejects
"my old school playground" and "jumpers for goalposts", which are the memories
people come here for. Measured: 3% of a realistic corpus, concentrated on exactly
the sentences the product exists to serve.

So `moderateText` returns `warnings: [{code, message, detail}]` alongside
`refusals`, and the four ban categories are **warnings**. The guarantee did not
weaken — it moved to where the string actually is a prompt: §5 requires every
expander output to pass `validatePlace`/`validateOutfit`, which run the identical
check against the identical `BANNED` object. `expand` additionally *strips* look
and person terms rather than refusing, so "grainy VHS beach footage" becomes "a
beach".

**Refusals stay absolute for:** `shape`, `named-person`, `sexual-explicit`,
`minor-safety`, `no-consent`, and injection that leaves nothing describable.
Callers must fail on `refusals` and record `warnings`. Do not turn the ban
categories back into refusals.

### `scripts/safety/consent.mjs`

Undocumented in the first draft and depended on by `render.mjs`:

```js
export const CONSENT_TEXT; export const RETENTION_DEFAULTS;
export function consentText({ photoDays, jobDays }): string
export function recordConsent({ granted, text, nowImpl }): { granted, at, text }
export function assertConsent(block): void
export function consentIsCurrent(block, { text }): boolean
```

The manifest stores **the exact text that was shown**. Consent to wording that
has since been edited is not consent, which is why the string is recorded rather
than a boolean.

### The staged-upload filename is a cross-module contract

This was not written down and it cost a real bug — every browser upload failed
at intake with `NO_PHOTO` while the file sat in the directory.

Anything that enqueues a job **without** running the pipeline inline must stage
the upload itself, at `<jobdir>/input/upload-<kind>`, where `kind` is `photo` or
`place`. Two spellings are legal and `findStaged` accepts both:

- `upload-photo.jpg` — the CLI, which keeps the extension off a path the
  operator typed.
- `upload-photo` — the web app, **extension-less on purpose**. A client filename
  is attacker-controlled text and no path should be built from it.

Dropping the extension costs nothing: ffmpeg probes content rather than trusting
a suffix. `intake` deletes the staged original once the EXIF-stripped copy is
committed.

---

## 5. Expand — `scripts/expand/expand.mjs`

Turns `"a beach"` into the same eight-line shape a hand-written place has.

```js
export function expandPlace(text, { catalog, seed, expandImpl? }):
  Promise<PlaceObject>       // validates through catalog/schema.validatePlace
export function expandOutfit(text, { catalog, seed, expandImpl? }):
  Promise<OutfitObject>      // validates through catalog/schema.validateOutfit
export function placeFromPhoto(photoPath, { catalog, seed, expandImpl? }):
  Promise<PlaceObject>       // reference-image path: minimal prose, photo carries it
export const localExpander;  // the default. Deterministic. No network.
```

**`expandImpl` is the seam for a Claude call and it is NOT wired up in this
build.** The default `localExpander` is deterministic and offline: it picks the
nearest shipped preset by keyword overlap, uses it as the few-shot skeleton,
substitutes the user's subject into `scene` and `framing`, and keeps the
preset's `light`/`lens`/`eraProps` unless the text clearly overrides them. It is
not as good as a model. It is good enough to run the app end to end today, it
costs nothing, and it makes the LLM version a one-line injection later.

**Whatever comes out MUST pass `validatePlace`/`validateOutfit` unchanged.**
That is the entire safety property: expanded free text is held to the same
schema, the same banned vocabulary and the same place/outfit split as a preset
that shipped. If expansion produces something the schema rejects, that is a
refusal with a useful message, not a bypass.

The three prompt rules survive intact: never describe the person, outfits
describe only what is on the body, places describe everything else.

---

## 6. Queue — `scripts/queue/queue.mjs`

Durable, file-backed, single-machine, crash-safe. No Redis, no dependency.

```
out/queue/pending/<seq>-<jobId>.json
out/queue/claimed/<jobId>.lock       exclusive-create; holds workerId+deadline
out/queue/done/<jobId>.json
out/queue/failed/<jobId>.json
```

```js
export function createQueue({ root, nowImpl?, leaseMs = 900000 }): Queue

Queue = {
  enqueue(jobId, { priority = 0 }): entry
  claim({ workerId }): { jobId, token } | null    // atomic
  heartbeat(jobId, token): void                   // extends the lease
  complete(jobId, token): void
  fail(jobId, token, { error, retriable }): void  // retriable -> back to pending
  release(jobId, token): void
  reapExpired(): string[]                         // dead leases -> pending
  stats(): { pending, claimed, done, failed }
  peek(): entry[]
}
```

**Atomicity on Windows**: claim with `fs.openSync(lockPath, 'wx')`. Exclusive
create is atomic on both NTFS and POSIX; `rename` is not reliably a claim
primitive here because it silently overwrites. Two workers racing must produce
exactly one winner and one `null`, and there is a test that runs that race.

A crashed worker must not strand a job forever: `reapExpired()` returns any
lease past its deadline to `pending`, and the worker calls it on startup.

---

## 7. Pipeline — `scripts/render/pipeline.mjs`

```js
export async function runPipeline(job, { provider, root, cfg, signal,
                                          onProgress, stopAfter = null,
                                          providerCtx = {} }): Promise<Job>
```

`providerCtx` is merged into the ctx each provider call receives, and on a paid
provider it is the ONLY source of `fetchImpl` -- there is no default, by design.
Both callers that may spend (`render.mjs` and `worker-cli.mjs`) fill it from
`paidTransport(provider)` in `scripts/providers/transport.mjs`; a new caller
that forgets gets a `TypeError` rather than a bill.

Executes `STEPS` in order, skipping any already `done` — that is the whole of
resume. Every step is wrapped: `beginStep`, do the work, `finishStep` or
`failStep`, `saveJob` after **every** transition. A crash between two steps must
leave a manifest that `loadJob` can read and continue from with **zero**
re-submissions.

Steps, in order:

| # | step | does | free? |
|---|---|---|---|
| 1 | `intake` | `ingestPhoto` both photos, hash, face gate | yes |
| 2 | `moderate` | `moderateJob` on text + photos | yes |
| 3 | `expand` | free text/photo → validated place & outfit objects; `skipStep` when both are presets | yes |
| 4 | `compose` | prompts, seeds, segment plan, **freeze `resolved`** | yes |
| 5 | `still` | `provider.generateStill` | PAID |
| 6 | `select` | contact sheet; auto-pick 0, or set `awaiting-selection` and stop when `--stop-after=select` | yes |
| 7 | `animate` | `provider.generateVideo` per segment, last-frame chained | PAID |
| 8 | `assemble` | concat segments → `source.mp4`; **ffprobe-assert zero audio streams** | yes |
| 9 | `tape` | the look. ONE ffmpeg call, video + bed together | yes |
| 10 | `verify` | delivery contract, grade, composite, burn-in, LUFS | yes |
| 11 | `publish` | `timestamp.mp4`, poster frame, `review/summary.md` | yes |

Step 9 builds its command exactly the way `tapedeck/look-cli.mjs:renderOne`
already does — `burnInFilters` → `buildVideoFilter` → `buildAudioFilter` →
`joinGraphs` → `muxedArgs` → `runFfmpeg`. **Do not invent a second path to the
look.** Read that function and follow it.

`animate/plan.mjs`:
```js
export function planSegments({ cfg, capabilities }):
  Array<{index, seconds, seed}>       // sums to EXACTLY cfg.durationSeconds
export function lastFrameArgs({ input, output, cfg })   // pure argv builder
```
One continuous take is the v1 intent; `mode:'cut'` is one field and one branch
and stays unused.

`select/`:
```js
export function firstScorer(stills): number     // 1. the only shipped scorer.
export function contactSheetHtml(job, stills): string   // self-contained, no assets
export function writeContactSheet(job, paths): string
```

### Indices are 1-BASED everywhere. This is not a preference.

An earlier draft of this file wrote `firstScorer` as returning `0`, which read as
an array position, while the provider contract returns `stills[].index` starting
at `1` to match `still-01.png`. Two modules, two conventions, and the failure
mode is that **the wrong still gets animated with no error at all** — you pay
video prices for image 2 while the contact sheet says you picked image 1, and
nothing anywhere reports a fault. Silent and wrong is the worst quadrant.

So, everywhere: `stills[].index`, `segments[].index`, `selection.stillIndex`,
`--still=N`, and the numbers shown in the UI are all **1-based**, and they agree
with the filename. `still-01.png` is index `1`. `firstScorer` returns `1`.
Array positions stay a local implementation detail and never enter a manifest,
a CLI flag, or a URL.
**Do not add a still scorer beyond `firstScorer`.** Ranking without a
face-similarity metric optimises for the wrong thing: a sharp, well-lit stranger
beats a soft likeness on every heuristic computable locally.

---

## 8. Worker — `scripts/worker/worker.mjs`

A long-lived process. The app never renders; the worker never serves HTTP.
This split is not tidiness — Vercel's serverless runtime has no ffmpeg binary
and the entire look lives in ffmpeg.

```js
export function createWorker({ root, cfg, provider, queue, pollMs = 1000,
                               workerId?, onEvent? }): Worker
Worker = { start(): Promise<void>, stop(): Promise<void>, once(): Promise<boolean> }
```

`once()` claims at most one job and runs it — that is what the tests drive.
`start()` is `once()` in a loop with `reapExpired()` on startup, a heartbeat
during long steps, and SIGINT/SIGTERM finishing the current step before exiting.

CLI: `npm run worker -- --provider=fixture [--once] [--concurrency=1]`.

---

## 9. Web app — `scripts/web/`

**Decision, and it is a deviation worth stating:** this ships as a
**zero-dependency `node:http` server rendering server-side HTML**, not Next.js.
The app is three pages — upload, status, result. Next.js buys nothing for that
and costs an install, a build step, a second test runner and the repo's
zero-dependency property. **The HTTP layer is deliberately thin and the JSON API
below is the real contract, so a Next.js front end remains a swap, not a
rewrite.** Flagged to Paul; if he wants Next.js, the API does not change.

```
scripts/web/server.mjs     createServer({ root, cfg, queue, port })
scripts/web/router.mjs     method+path table -> handler. pure, testable.
scripts/web/multipart.mjs  RFC 7578 parser. streaming, capped at LIMITS.maxBytes.
scripts/web/views.mjs      HTML. Pure string functions, escaped.
scripts/web/static.mjs     the one CSS file, the video, the poster
```

**JSON API**

| method | path | body / returns |
|---|---|---|
| `POST` | `/api/jobs` | multipart: `photo`, `placePhoto?`, `place`, `outfit`, `stillCount?`, `consent` → `201 {jobId, statusUrl}` |
| `GET` | `/api/jobs/:id` | `{jobId,status,step,pct,steps[],cost,result,error}` |
| `GET` | `/api/jobs/:id/stills` | `{stills:[{index,url}],selected}` |
| `POST` | `/api/jobs/:id/select` | `{stillIndex}` → re-enqueues |
| `GET` | `/api/jobs/:id/video` | the mp4, range-request capable |
| `GET` | `/api/jobs/:id/poster` | jpg |
| `DELETE` | `/api/jobs/:id` | cancel + purge |
| `GET` | `/api/health` | `{ok, ffmpeg, queue:{...}, worker:{lastSeen}}` |

**Pages**: `/` upload form · `/j/:id` status, polls every 2 s · `/j/:id/select`
contact sheet · `/j/:id/result` the video, download, "make another".

**Nothing is request/response.** `POST /api/jobs` writes a manifest, enqueues,
and returns `201` immediately. It must never wait for a render. A 15 s render is
~30 s of ffmpeg after generation calls of several minutes, and building this as
request/response is, per RELIO §11.3, the single most likely reason a 6-week
build becomes 14.

**Security, because this takes uploads from strangers:** every `:id` is
validated against `/^[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/` before touching the
filesystem — no path traversal. Every interpolated string is HTML-escaped. The
upload is capped and streamed, never buffered whole. Consent must be present or
the post is a `400`.

---

## 10. Ledger + purge

```js
// scripts/render/ledger.mjs
export function collectLedger({ root, since?, until? }): { jobs, totals, divergences }
export function formatLedger(ledger): string
// scripts/render/purge.mjs                                    BUILT 2026-08-21
export function planPurge({ root, olderThan, photosOnly, nowImpl? }): PurgePlan
export function executePurge(plan, { dryRun = true, fsImpl? }): PurgeResult
export function purgeJobMedia(paths, { dryRun = false, fsImpl? }): { filesDeleted, photosDeleted, removed, errors }
export function sweepRetention({ root, retention, nowImpl?, dryRun = true, skip?, fsImpl? }): SweepResult
export function ageInDays(createdAt, now): number | null
```

**`sweepRetention` is the canonical entry point** and the only place the ordering
rule lives: whole jobs first, then photos minus whatever just went. It was
written out twice — once in `purge-cli.mjs`, once in the worker — which is two
places for one correctness rule to drift, and only one of them knew about
leases. `npm run purge` and `worker.sweepRetention()` both call it now; the
worker passes `skip` (its leased job ids), the CLI passes none and therefore
cannot defer a job somebody is rendering.

**Every function that deletes reports what it could not delete.** `purgeJobMedia`
and `executePurge` both return `errors`. A refused unlink — `EBUSY` on Windows
while `getVideo` streams the same file — must never be swallowed: answering a
flat `200` to that tells a person their face is gone when it is still on disk,
which is the finding this module exists to close, recurring inside the fix for
it. `DELETE /api/jobs/:id` carries `mediaDeleted` and `errors` for exactly this.

`scripts/render/ledger.mjs` is **NOT built.** `npm run ledger` therefore fails.
It is cost reconciliation — manifest actuals against `config/pricing.json`
estimates — and it is waiting on real provider spend, since today every price in
the repo is an estimate. It is unrelated to the credit ledger, which is built and
lives on the account record (`npm run accounts -- ledger`).

`purgeJobMedia` is the **on-request** half of the consent sentence ("and that I
can ask for either to be deleted sooner"): everything that can hold a face —
`input/`, `stills/`, `segments/`, `review/`, `source.mp4`, the video, the
poster — with `manifest.json`, `logs/`, `intent/` and the cancel sentinel kept.
It is called by `DELETE /api/jobs/:id` on the unclaimed path and by the pipeline
when it observes the cancel sentinel at a step boundary, which is what makes that
endpoint's `202` mean "will be deleted" rather than "was written down".

Age is measured from **`createdAt`, never `updatedAt`** — `updatedAt` is
restamped by every `saveJob`, so a retried job would push its own deletion date
forward indefinitely.

The scheduled half runs in the worker: `worker.sweepRetention()` at startup and
every `DEFAULT_RETENTION_SWEEP_MS` (1 h), beside `reapExpired()`. Pass
`retention: null` to disable it and drive `npm run purge` from a scheduler
instead. A worker with no retention configured anywhere sweeps nothing — it was
never asked to. But a retention block that is *present and malformed* is refused
at construction with `BAD_RETENTION`, exactly as `cfg.provider.maxInflight` is:
a typo that silently disables the deletion this system promises every user is
the promise going quietly unkept. `null` is the one way to say "not here", and
it has to be said out loud.

A queue that cannot answer `peek` stops that pass and **emits `purged` carrying
the error**. Returning silently would mean retention stopping forever with
nothing anywhere saying so.

**A live lease beats age.** The sweep skips any job in `queue.peek({state:
'claimed'})` that has not expired, plus its own in-flight job. The case is a job
old enough to be due that is claimed for the first time today: without the guard
the directory vanishes mid-render and the customer loses a tape they paid for.
It is deferred, not spared — the next sweep after the lease is gone takes it. If
the queue cannot answer, "unknown" is read as "somebody might" and nothing is
swept. `npm run purge` has no queue and therefore no such guard, which is one
more reason the worker is the scheduled path and the CLI is the manual one.

`config/pricing.json` entries are **ESTIMATES** until a `--meter` run proves
them. Divergence over 15% is named by job in `npm run ledger`.

Purge is the retention path: `retention.photoDays = 7`, `jobDays = 30`. This
system stores photographs of people's faces; deletion designed in now costs an
afternoon, and retrofitted onto a live app that has been accumulating strangers'
faces it is a rewrite plus a disclosure. **`executePurge` defaults to
`dryRun: true`** — deleting faces is not a thing that happens by accident.
