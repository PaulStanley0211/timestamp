# Hook, body, ending: every generated tape has a shape

**Date:** 2026-09-15 · **Status:** approved in conversation, awaiting the owner's read of this document · **Owner:** Paul

## 1. The problem

The backend generates every tape from one prompt, built by `composeReferencePrompt` in
`scripts/compose/prompt.mjs`. Its default shot list (`three`) was designed as a keepsake:
walk in, do something, turn to the lens, with the best moment last and three equal
five-second shots. A feed works the other way round. People decide in the first second, and
the post log already measures what that costs: TikTok average watch 1.79 s, then 2.47 s once
the face moved to the first frame, with watched-to-the-end stuck at about 1%.

Reading a real tape on 2026-09-15 (`20260915-174157-9a4311`, the kitchen, 9:16, 720p)
against the exact prompt it was sent found three more things the same prompt causes:

- **A hand holding a modern camera at 10-11 s.** The camera clause says "Somebody came
  along with a camera and is walking with them", and the kitchen's moment says "by whoever
  picked the camera up". The prompt writes a second person with a camera into the scene
  twice, and Wan has no negative channel to take it back out.
- **The head out of frame at 12 s**, from "camera lifting to meet them".
- **All seven place moments, and the shared default moment every typed or uploaded place
  gets, say "half turned" or name whoever holds the camera.**

The owner's direction: the generation workflow itself, for every order and whatever place
is chosen, typed or uploaded, should produce a tape that opens on a hook, carries a body,
and ends well. The change lives in how the backend instructs the model. The customer still
receives one tape and nothing else.

## 2. The `story` arc

`ARCS` becomes `['six', 'three', 'story']`. `DEFAULT_ARC` stays `'three'` until the owner
approves the test tapes (section 6); the flip is a one-line commit of its own. `--arc=story`
on the render CLI, `input.arc` on the job, frozen at compose as the other arcs are.

### 2.1 Windows

Hook 3 s, body 8 s, ending 4 s at 15 s. For a shorter runtime the hook takes 20% and the
ending 27%, each at least 2 s, and the body the rest. They always sum to the runtime.

### 2.2 The shots

```
Shot 1: 0-3s.  Medium close. They are {moment}, {hook}, their whole head in frame.
Shot 2: 3-11s. Wide. They carry on with the whole place around them -- {motionHint} --
               still turned toward the lens, picking up exactly where the shot before left them.
Shot 3: 11-15s. Medium close. They are {ending}, head and shoulders in frame, and the take ends on them.
```

### 2.3 The camera clause

Describes filming, not a person:

```
Filmed hand-held at 63°, chest height, 3 shots cut in camera, real speed throughout.
{SNAPSHOT_RULE}. The camera stays in front of them throughout, with them turned toward the lens.
```

### 2.4 The closing line

Ends "at the real pace of somebody recording an ordinary day". No "afternoon".

### 2.5 Unchanged

Shared with the other arcs and not touched: the identity sentence first, `Place:`, `Lens:`,
`Light:`, the period line, the passers-by or one-person line, the screen clause, and the
motion line.

## 3. Hooks and endings, picked per order

So that the many orders sharing the default moment (every typed and uploaded place) do not
all open and close the same way:

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
they're holding toward the lens". On a typed or uploaded place nobody is holding anything
and the model would invent an object, so it is "stepping toward the lens" instead.

## 4. Moments: every one a "They are..." sentence

Every place's `moment` and `DEFAULT_MOMENT` must begin with a verb ending in "-ing", and must
not mention a camera, whoever holds it, or anyone half turned. Proposed rewrites, for the
owner's read:

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
second shot. That is deliberate: every removed phrase is one that produced a visible defect or
invites one, so it is a fix and not an experiment. The camera clause and shot lines of `three`
and `six` are not touched.

## 5. Tests

Written first, watched failing, each guard sabotage-verified and restored from a copy.

1. `story` windows are 3/8/4 at 15 s and sum to the runtime at every length the composer accepts.
2. Every `story` shot names the person ("They").
3. No composed `story` prompt contains "somebody", "whoever", "lifting to meet", or "afternoon".
4. The hook and ending are frozen into `resolved`; the same job id composes the same pair;
   across a spread of ids all three of each are reachable.
5. Every shipped place's moment and `DEFAULT_MOMENT` begin with an "-ing" verb and contain none
   of: camera, whoever, somebody, "half turn".
6. The composed `story` prompt passes `COMPOSED_BAN_GROUPS`.
7. `--arc=story` reaches the frozen manifest (the `entriesOf` class of bug, §60H).

## 6. Proving it on the model

A prompt change is only proved by generated tapes. Claude cannot run paid commands; the owner
runs them. 720p, 9:16, about $1.50 each.

**Before any code (a throwaway check):** the `story` prompt written out by hand for two places
and pasted into fal's Wan 3.0 reference-to-video playground with the owner's photo, audio off,
prompt expansion off:

1. **A menu place:** Tokyo.
2. **An uploaded place:** a photograph of a real place the owner took.

**After the code:** the same two through the render CLI with `--arc=story`. Placeholders are
written as words, because a `<` in a pasted Windows command is read as a redirect (§55F).

Each tape is read one frame per second off the delivered file, as the kitchen tape was: face in
the first second, the hook action in 0-3 s, the person present in every second, no camera or
second person, the whole head in frame in the ending, the tape ends on them. The owner decides.
**Only after his yes does `DEFAULT_ARC` become `'story'`.**

## 7. Deployment

Two deploys, each three separate remote commands (§70F), each proved by the bytes inside the
running worker (§83D):

1. The `story` arc and the moment rewrites, with `DEFAULT_ARC` still `'three'`.
2. After the owner's yes on the test tapes, the one-line flip to `'story'`.

## 8. Out of scope, on purpose

- **A separate "version for posting"** wrapping the tape in a photo hook and a split ending.
  Built by hand on 2026-09-15 as a test and rejected by the owner: the shape belongs inside the
  generation, not in an edit around it.
- The jeans detail the expander appends to any typed outfit containing "t-shirt"
  (`GARMENT_CLASSES.casual`). Its own small fix, kept apart so it doesn't confound the test tapes.
- A different ending per place. Revisit if the wave repeats across a shelf of tapes.
- A post-render picture check (sampled frames through the face detector).
- The inert negative list composed for Wan.
