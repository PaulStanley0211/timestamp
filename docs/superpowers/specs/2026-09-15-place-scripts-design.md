# Place scripts: what happens in a tape comes from where it is

**Date:** 2026-09-15 · **Status:** approved in conversation, awaiting the owner's read of this document · **Owner:** Paul
**Supersedes:** `2026-09-15-hook-body-ending-design.md` (parked the same day)

## 1. The problem

Every direct tape follows one script whatever the place. The default arc (`three`) opens
"Walking in at the near edge and looking around the whole place", tells the camera to keep
"leading them through the place", and fills the middle shot with the place's `moment`. That is
right for a Tokyo crossing. In a kitchen it produced tape `20260915-174157-9a4311`: fifteen
seconds of wandering round a small room without ever sitting at the table.

The owner's direction: the tape should be engaging, and what the person does should come from
the location. A street can be walked; a kitchen, a living room, a garden or a photograph somebody
uploads should each play out as a real moment in that place.

The wording fixes committed as `ab670d0` (no camera operator, no lifted camera, no half turn,
no "nothing else happens", no afternoon) are a separate change and are assumed here.

## 2. The decisions

| Question | Decision |
|---|---|
| Menu places | **Three written scripts each**, one picked per order |
| Typed places | **The video model chooses**, from the customer's own words |
| Uploaded place photos | **The video model chooses**, from the photograph |
| Shots and timing | **Unchanged**: three shots, 0-5 / 5-10 / 10-15 s |
| Rollout | Behind its own name; the default only after the owner approves real tapes |

## 3. The `scripted` arc

`ARCS` becomes `['six', 'three', 'scripted']`. `DEFAULT_ARC` stays `'three'` until section 8's
approval; the flip is a one-line commit of its own. `--arc=scripted` on the render CLI,
`input.arc` on the job, frozen at compose as the other arcs are.

### 3.1 What the prompt looks like

Everything above and below the shot list is the `three` arc's, with two lines changed:

```
The person in @Image1, wearing {wardrobe}.
Place: {scene | the place in @Image2, unchanged...}.
Filmed hand-held on a camera moving with them, at 63°, chest height, 3 shots cut in camera,
real speed throughout. {SNAPSHOT_RULE}. The camera stays in front of them throughout, keeping
them turned toward the lens.                                            <- was "leading them through the place"
Lens: ... / Light: ...

Shot 1: 0-5s. {script shot 1}
Shot 2: 5-10s. {script shot 2}
Shot 3: 10-15s. {script shot 3}

Period ... / one-person or passers-by line / screen clause / motion line
One continuous moment: the same place, the same wardrobe and the same light carried across every
cut, each shot picking up where the last one left off, at the unhurried pace of an ordinary day
being recorded.                                                         <- "same spot" and "same posture" gone
```

A script that walks (the Tokyo crossing) says so in its own shot ("camera moving backwards ahead
of them"). A script that sits does not have to fight a camera clause telling it to travel, and
"the same spot" and "the same posture" would contradict a script that crosses a square or sits
down.

**A shorter runtime** keeps the first and last shots of the script and drops the middle, as
`three` does. The product always orders 15 s.

### 3.2 Which script

- **Menu place, no uploaded photo:** `place.scripts[i]`.
- **Uploaded photo, or a typed place:** `GENERAL_SCRIPTS[i]`, with `{motionHint}` filled from the
  place the expander produced.
- `i` is `deriveSeed(jobId, 'script') % 3`, computed in the pipeline and passed to the composer,
  because `prompt.mjs` imports nothing (a test holds that). The composer returns
  `script: { source: 'place' | 'general', index, name }`, and the pipeline freezes it into
  `resolved.script` beside the prompt, and writes it into the job summary.

## 4. The scripts are data

### 4.1 In each place file

```json
"_scripts": "Three fifteen-second scripts, one picked per order. Each is three shots ...",
"scripts": [
  { "name": "The light changes", "shots": ["Medium. They are ...", "Wide. ...", "Medium close. ..."] },
  { "name": "...", "shots": ["...", "...", "..."] },
  { "name": "...", "shots": ["...", "...", "..."] }
]
```

`validatePlace` returns a fixed shape, so `scripts` must be carried through it explicitly
(section 88E's trap: a field the validator does not name reads back `undefined` for ever). It is
**optional in the schema** (the template, test fixtures and expanded places have none) and
**required of every shipped place** by a catalog test. The shot text is held to the place bans
already enforced on every other place fragment: no look, person or wardrobe vocabulary.

### 4.2 Typed and uploaded places carry no scripts

A typed place is built by the expander from the nearest menu place's skeleton. **It must not
inherit that place's scripts**, or "my office" is quietly handed the kitchen's. The expander and
`placeFromPhoto` drop `scripts`, and a test composes a typed place and an uploaded one and asserts
`script.source === 'general'`.

### 4.3 The rules every shot list obeys

1. Exactly three shots.
2. Every shot names the person ("they", "them", "their").
3. The first shot has them turned toward the lens.
4. The last shot keeps their whole head in frame and ends on them.
5. Every shot names a camera move.
6. No camera operator ("somebody", "someone", "whoever"), no half turn, no "lifting to meet", and
   no construction that puts the lens behind them (the section 88H regex, reused).
7. No disposable camera and no close-up of a screen: a second camera in shot, or the person on a
   television, is the defect this whole change started from.

## 5. The scripts, for the owner's read

### Tokyo, at night

| Script | 0-5 s | 5-10 s | 10-15 s |
|---|---|---|---|
| **The light changes** | Medium. They are waiting at the crossing, turned toward the lens, then stepping out onto the white stripes as the lights change, camera moving backwards ahead of them. | Wide. They cross the wet asphalt with strangers further back, looking up at the big glowing screen, camera moving backwards ahead of them. | Medium close. Reaching the far kerb, they turn to the lens and laugh, their whole head in frame, camera settling on them. |
| **The vending machine** | Medium. They are pressing a button on the lit drinks vending machine, turned toward the lens as the can drops, camera holding on them. | Medium. They crack the can open and drink, the signboards flickering on and off in the background, camera easing round to stay in front of them. | Medium close. They raise the can to the lens, their whole head in frame, camera settling on them. |
| **The bicycle** | Medium. They are unhooking the clear plastic umbrella from the bicycle leaning on the pole, turned toward the lens, camera holding on them. | Wide. They wheel the bicycle out and ride a slow loop across the crossing, the lights sliding over the wet asphalt, camera turning with them. | Medium close. They stop beside the lens and ring the bell at it, their whole head in frame, camera settling on them. |

### Times Square, at night

| Script | 0-5 s | 5-10 s | 10-15 s |
|---|---|---|---|
| **The hot-dog cart** | Medium. They are at the hot-dog cart under the striped umbrella, taking a hot dog, turned toward the lens, camera holding on them. | Wide. They take a big bite as the screens flicker through their loops and cabs cross the far side of the square, camera easing round to stay in front of them. | Medium close. They hold the hot dog up to the lens and laugh, their whole head in frame, camera settling on them. |
| **The cab** | Medium. They are at the kerb with one arm up, hailing a yellow cab, turned toward the lens, camera holding on them. | Wide. A cab pulls in and they open the back door, the wet ground holding every light, camera holding its place. | Medium close. They lean out of the open door toward the lens and wave, their whole head in frame, camera settling on them. |
| **The lights** | Medium. They are stepping onto the crosswalk stripes as the lights change, turned toward the lens, camera moving backwards ahead of them. | Wide. They stop in the middle of the square and turn slowly with their arms out, the billboards and screens blazing above, camera holding in front of them. | Medium close. They turn back to the lens, laughing at the size of it, their whole head in frame, camera settling on them. |

### The Amalfi coast, afternoon

| Script | 0-5 s | 5-10 s | 10-15 s |
|---|---|---|---|
| **The gelato** | Medium. They are walking along the terrace wall under the lemon trees with a paper cup of gelato, turned toward the lens, camera moving backwards ahead of them. | Wide. They sit on the edge of a fishing boat pulled up on the stones and dig in with the flat wooden spoon, the umbrellas lifting in the breeze, camera holding on them. | Medium close. They hold out a spoonful to the lens and laugh, their whole head in frame, camera settling on them. |
| **The water** | Medium. They are picking their way down the pebbles to the water's edge, turned toward the lens, camera moving backwards ahead of them. | Wide. They wade in up to the knees and splash water toward the lens, the boats rocking against the stones, camera holding its place. | Medium close. They turn back to the lens, dripping and laughing, their whole head in frame, camera settling on them. |
| **The scooter** | Medium. They are sitting on the scooter by the harbour, turned toward the lens, tilting its chrome mirror, camera holding on them. | Wide. They ride a slow loop along the harbour past the striped umbrellas and pull up again, camera turning with them. | Medium close. They lean off the scooter toward the lens and wave, their whole head in frame, camera settling on them. |

### The space centre

| Script | 0-5 s | 5-10 s | 10-15 s |
|---|---|---|---|
| **The rocket** | Medium. They are at the rope barrier, pointing up at the white rocket, turned toward the lens, camera holding on them. | Wide. They step back across the lawn with one hand up against the sun to take the whole rocket in, camera tilting up the rocket and back down to them. | Medium close. They turn to the lens with a thumbs up, their whole head in frame, camera settling on them. |
| **The souvenir** | Medium. They are coming away from the souvenir kiosk with a model rocket in a cardboard box, turned toward the lens, camera moving backwards ahead of them. | Medium. They tear the box open on the concrete path and hold the model rocket up against the real one across the lawn, camera holding on them. | Medium close. They fly the model rocket up past the lens, laughing, their whole head in frame, camera settling on them. |
| **The map** | Medium. They are turning a folded visitor map the right way up, turned toward the lens, camera holding on them. | Wide. They give up on the map and set off along the path toward the rocket, pointing at it, camera moving backwards ahead of them. | Medium close. They stop at the rope barrier, turn to the lens and shrug with a laugh, their whole head in frame, camera settling on them. |

### The kitchen table

| Script | 0-5 s | 5-10 s | 10-15 s |
|---|---|---|---|
| **The coffee** | Medium. They are pouring coffee from the glass jug of the filter machine, turned toward the lens, camera holding on them. | Medium. They sit down at the wooden table with the cup and blow on it, steam lifting off it, camera easing round to stay in front of them. | Medium close. They raise the cup to the lens as if in a toast, their whole head in frame, camera settling on them. |
| **The radio** | Medium. They are turning the dial on the radio on the counter, turned toward the lens, camera holding on them. | Wide. A song catches and they dance a few steps across the patterned lino, the net curtain breathing at the window, camera moving with them. | Medium close. They point at the lens and laugh, their whole head in frame, camera settling on them. |
| **The telephone** | Medium. They are at the wooden table with a folded newspaper as the wired telephone on the wall starts to ring, turned toward the lens, camera holding on them. | Medium. They pick up the receiver and talk, laughing, the second hand moving on the clock, camera easing round to stay in front of them. | Medium close. They cover the receiver and mouth something to the lens, their whole head in frame, camera settling on them. |

### The living room, evening

| Script | 0-5 s | 5-10 s | 10-15 s |
|---|---|---|---|
| **The sofa** | Medium. They are dropping onto the sofa and pulling the crocheted blanket over their knees, turned toward the lens, camera holding on them. | Medium. They flick through the channels and react to what comes on, the light from the television shifting across the room, camera easing round to stay in front of them. | Medium close. They turn to the lens and laugh, their whole head in frame, camera settling on them. |
| **The tape** | Medium. They are pulling a black cassette box from the row on the wall unit, turned toward the lens, camera holding on them. | Medium. They crouch by the television and slide the cassette into the machine beneath it, the light from the screen shifting over them, camera holding in front of them. | Medium close. They sit back on the rug and turn to the lens, pleased with themselves, their whole head in frame, camera settling on them. |
| **The phone** | Medium. They are curled up on the sofa with the wired telephone from the side table, talking, turned toward the lens, camera holding on them. | Medium. They laugh into the receiver and wind the cord round a finger, the leaves of the rubber plant stirring by the lamp, camera easing round to stay in front of them. | Medium close. They hold the receiver out to the lens as if the call is for the viewer, their whole head in frame, camera settling on them. |

### The garden, in summer

| Script | 0-5 s | 5-10 s | 10-15 s |
|---|---|---|---|
| **The hose** | Medium. They are watering along the hedge with the green hose, turned toward the lens, camera holding on them. | Wide. They swing the hose round and flick a spray of water toward the lens, the tablecloth moving in the breeze, camera stepping back. | Medium close. They laugh and shake the water off their hands, their whole head in frame, camera settling on them. |
| **The table** | Medium. They are dropping into one of the white plastic chairs at the folding table, turned toward the lens, camera holding on them. | Medium. They pour a glass from the bottle of mineral water and swat at the wasp turning round it, camera easing round to stay in front of them. | Medium close. They raise the glass to the lens, their whole head in frame, camera settling on them. |
| **The bicycle** | Medium. They are wheeling the bicycle off the fence, turned toward the lens, camera holding on them. | Wide. They ride a wobbly loop round the garden past the shed and the watering can, camera turning with them. | Medium close. They brake beside the lens and ring the bell at it, their whole head in frame, camera settling on them. |

### Typed and uploaded places (`GENERAL_SCRIPTS`)

"This place" is the `Place:` line above the shots: the customer's words, or the uploaded photograph.

| Script | 0-5 s | 5-10 s | 10-15 s |
|---|---|---|---|
| **Doing what the place is for** | Medium. They are in the middle of whatever a person would naturally be doing in this place, turned toward the lens, camera holding on them. | Wide. They carry on with it -- {motionHint} -- camera easing round to stay in front of them. | Medium close. They turn to the lens with a laugh, their whole head in frame, camera settling on them. |
| **Showing it off** | Medium. They are turned toward the lens, gesturing at the place around them as if showing it to a friend, camera holding on them. | Wide. They pick up something that belongs in this place and use it the way it is meant to be used -- {motionHint} -- camera holding in front of them. | Medium close. They hold it up to the lens, their whole head in frame, camera settling on them. |
| **Caught mid-moment** | Medium close. They are caught laughing mid-conversation, turned toward the lens, their whole head in frame, camera holding on them. | Wide. They go back to whatever a person would naturally be doing in this place -- {motionHint} -- camera easing round to stay in front of them. | Medium close. They look straight down the lens and give a small wave, their whole head in frame, camera settling on them. |

## 6. What does not change

- The three-shot structure and the 5/5/5 timing.
- The `three` and `six` arcs, and the still and motion prompts.
- Each place's `moment`, which `three`, `six` and the still prompt still use.
- The identity sentence, `Place:`, `Lens:`, `Light:`, the period line, the passers-by or one-person
  line, the screen clause and the motion line.
- No new service, no new processor, no change to `/privacy`.

## 7. Tests

Written first, watched failing, each guard sabotage-verified and restored from a copy.

1. Every shipped place has exactly three scripts, each of three shots, and they survive
   `validatePlace` (the fixed-shape trap).
2. Every shot of every script, place and general, obeys section 4.3, rules 2 to 7.
3. The composed `scripted` prompt for every place, with and without an uploaded photo, passes
   `COMPOSED_BAN_GROUPS` and the operator, lift, half-turn and lens-behind sweeps.
4. A menu place with no photo composes a place script; the same place with a photo, a typed place,
   and `NEUTRAL_PLACE` compose a general script.
5. An expanded place and a place from a photo carry no `scripts`.
6. The same job id picks the same script; across a spread of ids all three are reached; the pick is
   frozen in `resolved.script`.
7. The `scripted` camera clause says "in front of them" and not "leading them through the place";
   the continuity line says neither "same spot" nor "same posture".
8. `--arc=scripted` reaches the frozen manifest.

## 8. Proving it on the model

Claude cannot run paid commands; the owner runs them. 720p, 9:16, about $1.50 each.

1. **Before any code:** two prompts written out in full by hand and pasted into fal's Wan 3.0
   reference-to-video playground with the owner's photo, audio off, prompt expansion off:
   **Tokyo, "The vending machine"**, and **a photograph of a real place the owner took, "Doing what
   the place is for"**. Read one frame per second, as the kitchen tape was: turned to the lens in
   the first second, the script's action actually happening in each shot, the person present every
   second, no camera or second person, whole head in frame at the end, ending on them.
2. **After the code:** the same two, plus the kitchen, through the site's own render with
   `--arc=scripted`.
3. **Only after the owner's yes** does `DEFAULT_ARC` become `'scripted'`.

## 9. Deployment

Each is three separate remote commands (section 70F), proved by the bytes in the running worker
(section 83D):

1. `ab670d0`, the wording fixes, whenever the owner says go. Independent of everything here.
2. The `scripted` arc and the 21 scripts, with `DEFAULT_ARC` still `'three'`.
3. The one-line flip, after section 8.

## 10. Out of scope

- The jeans detail the expander appends to typed outfits containing "t-shirt".
- A vision model describing uploaded photos (considered; the video model reads the photo instead).
- An optional "what is this place?" box beside the upload.
- Changing the shot timing (the parked hook, body and ending idea).
- A post-render picture check.
