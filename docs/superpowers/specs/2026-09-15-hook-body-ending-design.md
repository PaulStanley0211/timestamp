# Hook, body, ending: every tape built to be posted

**Date:** 2026-09-15 · **Status:** approved in conversation, awaiting the owner's read of this document · **Owner:** Paul

## 1. The problem

A finished order today is a fifteen-second tape and nothing else. The tape's three
shots were designed as a keepsake: walk in, do something, turn to the lens, with the
best moment last. A feed works the other way round. People decide in the first second,
and the post log already measures what that costs: TikTok average watch 1.79 s, then
2.47 s once the face moved to the first frame, with watched-to-the-end stuck at about 1%.

Two more things came out of reading a real tape on 2026-09-15
(`20260915-174157-9a4311`, the kitchen, 9:16, 720p) against the exact prompt it was sent:

- **A hand holding a modern camera at 10-11 s.** The camera clause says "Somebody came
  along with a camera and is walking with them", and the kitchen's moment says "by
  whoever picked the camera up". The prompt writes a second person with a camera into
  the scene twice, and Wan has no negative channel to take it back out.
- **The head out of frame at 12 s**, from "camera lifting to meet them".
- **All seven place moments, and the shared default moment every typed or uploaded
  place gets, say "half turned" or name whoever holds the camera.**

The owner's direction: every tape, whatever place is chosen, typed or uploaded, should
open on a hook, carry a body, and end well. Nobody should get a plain video with no
shape.

## 2. What ships, in two pieces

**Piece 1: the version for posting.** Every finished order also produces a second file
built around the tape: the customer's photo as the hook, the whole tape as the body, and
a before-and-after split with the site name as the ending. The keepsake tape is untouched.

**Piece 2: the tape's own shape.** A new shot list, `story`: a hook action in the first
three seconds, the place in the middle, a payoff aimed at the lens at the end. Three hooks
and three endings, one pair picked per order. Shipped behind its name, judged on two paid
test tapes, then made the default.

The pieces are independent. Piece 1 needs no paid test and deploys first.

## 3. Piece 1: the version for posting

### 3.1 The file

`share.mp4` at the job root, beside `timestamp.mp4`. Same raster as the delivered tape
(1080x1920 for 9:16 and matted 4:3, 1920x1080 for 16:9), 25 fps, the same encode settings
(`cfg.encode.crf`).

| Segment | Frames | Seconds | Picture | Sound |
|---|---|---|---|---|
| Hook | 40 | 0.0-1.6 | The stored intake copy of the customer's photograph. Cover-cropped on a portrait file; contained on the `#0B0A09` surround on a wide file. "One photo." centred, drawn by ffmpeg | Silence |
| Body | 375 | 1.6-16.6 | The delivered tape, every frame, unaltered | The tape's own track, raised by a fixed gain (11 dB) |
| Ending | 50 | 16.6-18.6 | Split along the long edge: photo and a frame of the tape at 14.0 s. Top and bottom on a portrait file, left and right on a wide one. "timestamptapes.com" small along the bottom | Silence |

**465 frames, 18.6 s exactly.** 40 frames rather than 37.5 because a 1.5 s hook is not a
whole number of frames at 25 fps.

**Text** is drawn with the bundled `assets/fonts/tape-osd.ttf` in the stamp's own colour
(`0xF6EAC8`) and border, so it reads as part of the tape rather than as a caption on top.
English, for every customer.

**The gain is a fixed `volume`, never `loudnorm`**, for the reason `bed.mjs` bans it. A
delivered tape sits at -27 LUFS by spec and is inaudible in a feed; the posting version
lands around -16 LUFS. The keepsake keeps its spec.

**The frame at 14.0 s** is inside the last shot on both the current shape and `story`, and
both end on the person.

### 3.2 Where it is built

**Inside `stepPublish`, after the tape's poster is written.** Not a new pipeline step: in
this pipeline a failed step fails the job, and the tape must never be lost because the
extra file could not be made. Publish records one more output field:

```js
share: { ok: true, path: 'share.mp4' }
share: { ok: false, reason: '<one sentence>' }
```

The filtergraph and argv are built by a pure module, `scripts/tapedeck/share.mjs`, beside
the other builders, and run through `scripts/ffmpeg/run.mjs` exactly as they are. No
filesystem and no spawn in the builder.

### 3.3 Checked before it is kept

After the encode, before the output is recorded as `ok`:

- frame count 465, duration 18.6 s, dimensions equal to `timestamp.mp4`
- the Art. 50 `comment` and `description` tags present and equal to the tape's
- average bitrate under the 20 Mbit/s ceiling the delivery contract already enforces

Any failure deletes `share.mp4` and records `ok: false` with the reason.

### 3.4 When it cannot be made

| Cause | Result |
|---|---|
| The stored photo is missing or unreadable (e.g. a job resumed after the 7-day purge) | No file; `ok: false`; the tape delivered |
| ffmpeg exits non-zero | No file; `ok: false`; the tape delivered |
| A check in 3.3 fails | File deleted; `ok: false`; the tape delivered |

Every case prints one worker line, `SHARE SKIPPED <jobId>: <reason>`. **No refund in any
case**: the customer paid for the tape and received it. The job's status is `done`.

### 3.5 Serving it

- **Route:** `GET /api/jobs/:id/share`, named `getShare`, gated and ownership-checked
  exactly as `getVideo`. `Content-Disposition: attachment; filename="timestamp-<id>-for-posting.mp4"`,
  `Cache-Control: no-store`, range requests honoured through the existing `sendFile`.
- **`jobView`** projects `result.shareUrl` only when publish recorded `ok: true` AND the
  file is on disk. After the purge the field is absent.
- **Result page:** "Download tape" and "Download for posting" side by side. With no
  `shareUrl`, only "Download tape". No inline script changes, so no CSP hash moves.

### 3.6 Deletion

The posting version contains the uploaded photograph, so it is deleted on the **photo's**
clock (`retention.photoDays`, 7), not the tape's.

- `planPurge({ photosOnly: true })` removes `share.mp4` along with `input/`.
- `purgeJobMedia` adds `paths.share` to its list, so `DELETE /api/jobs/:id`, account
  deletion and the job-level sweep all remove it. Refused deletes are reported through
  the path that already reports them.
- **`/privacy`** gains one sentence, with the number read from the config the purge
  enforces, never typed: *"The version for posting includes your photo, so it's deleted
  with the photo after 7 days."*
- The result page says the same in its file notes.

**No backfill.** Tapes finished before this ships have no posting version and show one
button.

### 3.7 Piece 1 tests

Written first, watched failing, each guard sabotage-verified and restored from a copy.

1. `share.mjs` builder: the graph names the photo as the first segment, the tape unaltered
   as the second, a 14.0 s frame in the third; the split direction follows the raster.
2. A real ffmpeg render against a synthetic photo and a fixture tape: 465 frames, 18.6 s,
   dimensions, both disclosure tags, gain applied, bitrate ceiling, and the source tape's
   bytes unchanged.
3. `stepPublish` with an injected failing runner: job `done`, tape published, `share.ok`
   false with a reason, no file left behind.
4. Purge: `share.mp4` removed at `photoDays`, `timestamp.mp4` kept until `jobDays`;
   `purgeJobMedia` removes it.
5. Browser: both buttons when the file exists, one when it does not; a second account's
   `share` route refused.
6. `/privacy` quotes `photoDays` for the posting version, pinned to the config.

## 4. Piece 2: the tape's own shape

### 4.1 The `story` arc

`ARCS` becomes `['six', 'three', 'story']`. `DEFAULT_ARC` stays `'three'` until the owner
approves the two test tapes; the flip is a one-line commit of its own. `--arc=story` on the
render CLI, `input.arc` on the job, frozen at compose as the other arcs are.

**Windows are uneven:** hook 3 s, body 8 s, ending 4 s at 15 s. For a shorter runtime the
hook takes 20% and the ending 27%, each at least 2 s, and the body the rest. They always
sum to the runtime; a test holds it.

**The shots:**

```
Shot 1: 0-3s.  Medium close. They are {moment}, {hook}, their whole head in frame.
Shot 2: 3-11s. Wide. They carry on with the whole place around them -- {motionHint} --
               still turned toward the lens, picking up exactly where the shot before left them.
Shot 3: 11-15s. Medium close. They are {ending}, head and shoulders in frame, and the take ends on them.
```

**The camera clause for `story`** describes filming, not a person:

```
Filmed hand-held at 63°, chest height, 3 shots cut in camera, real speed throughout.
{SNAPSHOT_RULE}. The camera stays in front of them throughout, with them turned toward the lens.
```

**The closing line for `story`** ends "at the real pace of somebody recording an ordinary
day". No "afternoon".

Unchanged and shared with the other arcs: the identity sentence first, `Place:`, `Lens:`,
`Light:`, the period line, the passers-by or one-person line, the screen clause, and the
motion line.

### 4.2 Hooks and endings, picked per order

```js
STORY_HOOKS = [
  'turning to the lens at once, as if their name had just been called',
  'looking up from it straight into the lens and reacting to it',
  'laughing at something just out of shot, then turning to the lens',
];
STORY_ENDINGS = [
  'looking straight down the lens and giving a small wave',
  'stepping toward the lens until their head and shoulders fill the frame',
  'pointing at the lens and laughing',
];
```

The pair is chosen with `deriveSeed(jobId, 'story')`, the same mechanism as the stamp, and
frozen into `resolved` as `story: { hook, ending }` so a resume composes the same tape.

**One change from the conversation:** the second ending was described as "lifts whatever
they're holding toward the lens". For a typed or uploaded place nobody is holding anything,
and the model would invent an object, so it is "stepping toward the lens" instead.

### 4.3 Moments: every one a "They are..." sentence

Every place's `moment` and `DEFAULT_MOMENT` must begin with a verb ending in "-ing", and
must not mention a camera, whoever holds it, or anyone half turned. Proposed rewrites, for
the owner's read:

| Place | Now | Becomes |
|---|---|---|
| Amalfi | leaning back against the warm harbour wall, one hand up against the glare, just turning at the sound of the camera | leaning back against the warm harbour wall with one hand up against the glare |
| Kitchen | a cup halfway up and stopped there, mid-sentence, by whoever picked the camera up | lifting a cup and stopping halfway through a sentence |
| Times Square | turning on the spot to take it all in, one arm half raised towards the tallest screen, half turned back to the camera | turning on the spot to take it all in, one arm half raised towards the tallest screen |
| Garden | reaching across to move the bottle out of the sun, half turned back at being called | reaching across to move the bottle out of the sun |
| Space centre | pointing back up at the rocket with one arm, half turned to the camera and mid-sentence | pointing back up at the rocket with one arm, mid-sentence |
| Tokyo | waiting at the light with one hand resting on the bicycle's handlebar, half turned back at being called | waiting at the light with one hand resting on the bicycle's handlebar |
| Living room | sunk back into the sofa and only half turning round, one arm along the back of it | sitting back in the sofa with one arm along the back of it |
| Default (typed and uploaded places) | halfway through something ordinary, only half turned towards whoever is holding the camera, and not waiting for the picture to be taken | getting on with something ordinary, not waiting for the picture to be taken |

**These rewrites reach the current default arc too**, since `three` uses the moment in its
second shot. That is deliberate: every removed phrase is one that produced a visible defect
or invites one, so it is a fix and not an experiment. The camera clause and shot lines of
`three` and `six` are not touched.

### 4.4 Piece 2 tests

1. `story` windows are 3/8/4 at 15 s and sum to the runtime at every length the composer accepts.
2. Every `story` shot names the person ("They").
3. No composed `story` prompt contains "somebody", "whoever", "lifting to meet", or "afternoon".
4. The hook and ending are frozen into `resolved`; the same job id composes the same pair;
   across a spread of ids all three of each are reachable.
5. Every shipped place's moment and `DEFAULT_MOMENT` begin with an "-ing" verb and contain
   none of: camera, whoever, somebody, "half turn".
6. The composed `story` prompt passes `COMPOSED_BAN_GROUPS`.
7. `--arc=story` reaches the frozen manifest (the `entriesOf` class of bug, §60H).

### 4.5 The two paid test tapes

Claude cannot run paid commands; the owner pastes them. 720p, 9:16, about $3 in total.

1. **A menu place:** `--place=tokyo-night --arc=story`.
2. **An uploaded place:** `--place-photo=PLACE_PHOTO.jpg --place="a short description of it" --arc=story`,
   with a photograph of a real place the owner took. (Placeholders are written as words: a `<`
   in a pasted Windows command is read as a redirect, §55F.)

Each is read one frame per second off the delivered file, as the kitchen tape was: face in
the first second, the hook action in 0-3 s, the person present in every second, no camera or
second person, the whole head in frame in the ending, the tape ends on them. The owner decides.
**Only after his yes does `DEFAULT_ARC` become `'story'`.**

## 5. Deployment

Each piece is its own push and deploy, three separate remote commands (§70F).

- **Piece 1** is proved by the bytes inside the running worker and web containers, and by
  one real 480p order (21 credits) that shows both buttons and downloads a 465-frame file.
- **Piece 2** is proved first by the tests and the two paid tapes, then by the flip commit's
  bytes in the running worker.

## 6. Out of scope, on purpose

- The jeans detail the expander appends to any typed outfit containing "t-shirt"
  (`GARMENT_CLASSES.casual`). Its own small fix, kept apart so it doesn't confound the test tapes.
- A different ending per place. Revisit if the wave repeats across a shelf of tapes.
- A post-render picture check (sampled frames through the face detector). Recorded as the
  next most valuable pipeline change; not part of this.
- Backfilling posting versions for existing tapes.
- The inert negative list composed for Wan.
