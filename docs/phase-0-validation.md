# Phase 0 — the manual gate

**Do this before any pipeline code that spends money exists.** It is an afternoon in fal's web UI plus a couple of hand-written ffmpeg commands, and it is the cheapest opportunity to kill six assumptions that would otherwise be discovered in week nine.

This is the gate the Ad-Regenerator kill gate never got. Every verdict there so far was scored against self-generated data; the same trap is available here, and the way out of it is to run this before building the thing it validates.

**Nothing here needs the repository.** `npm run look` already works and cost nothing, so the aesthetic half is answered. What is unanswered is whether a model will put *you* in a place and an outfit convincingly, for a price that works.

---

## What you need

- One photo of yourself. A clear, front-ish portrait, one face, good light, at least 1024px on the short edge.
- A fal account with a little credit on it, and the balance **written down before you start**.
- One place and one outfit chosen in advance, described in a couple of sentences.

## The run

1. Note the **balance before**. A screenshot is fine.
2. Generate **5 stills** from one identity-preserving image model: your photo as the reference, one prompt describing place + outfit + light + lens + era. **Do not describe your face** — see the prompt rules in `CLAUDE.md`.
3. Pick the best still.
4. Generate **one animation** from it, as long as the model allows in a single call. **Find and set the audio-off parameter.**
5. Download the clip and `ffprobe` it.
6. Note the **balance after** and the wall-clock time end to end.
7. Grade it: `npm run look -- --in=<clip> --name=phase0`

---

## The gate

All eight are recorded. **Failing 1, 3, 4 or 5 stops the build** — change the model, or change the product. Do not proceed on a "close enough".

| # | Criterion | Pass condition | Result |
|---|---|---|---|
| 1 | **Identity** | Show the 5 stills to 2 people who know you, without saying what you are testing. At least 3 of 5 called "you" by both. | |
| 2 | **Adherence** | At least 4 of 5 show the requested place *and* outfit, with no text, no extra people, no modern objects. | |
| 3 | **Identity holds under motion** | The face is still recognisably you at the clip's **final** frame. Hands may fail — hands are not the product. | |
| 4 | **Native audio off** | The model exposes an audio-off parameter **and** `ffprobe` shows zero audio streams. No parameter → **model disqualified**, no discussion. | |
| 5 | **Clip length + continuation** | Record `maxClipSeconds`. Then feed the clip's last frame back in as the start image and inspect the join. | |
| 6 | **Cost** | Real dollars for 3 stills + 15s of animation, measured as balance-before minus balance-after. | |
| 7 | **Wall time** | Minutes, end to end. | |
| 8 | **The look is reachable** | The graded clip makes you feel something. | |

### Why 4 and 5 are the sharp ones

**Criterion 4** looks like a checkbox and is not. Modern video models generate their own audio by default, and it will fight the designed room-tone bed. Verify it twice — once that the parameter exists, once that `ffprobe` reports no audio stream on the file that actually came back:

```bash
ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 clip.mp4
```

Empty output, or the model is disqualified.

**Criterion 5 can change the product.** Image-to-video models cap out somewhere around 5–10 seconds per call, so "one continuous take" almost certainly means N calls, each seeded from the previous clip's last frame. If that join is visibly discontinuous, then one continuous take is **not achievable** and v1 becomes a designed two-shot — a decision that costs nothing now and costs a rewrite at M5.

```bash
ffmpeg -sseof -0.1 -i clip.mp4 -vframes 1 -update 1 lastframe.png
```

Feed `lastframe.png` back as the start image, generate again, and look at the seam.

### Why 6 and 7 are inputs to a later decision

They are not pass/fail here — they are the measurements the web app spec is built on. Wall time over roughly five minutes means the app needs a queue and an email, not a spinner, and that changes its architecture. Record them even if everything else passes.

---

---

## Amendments, 2026-08-20

Three changes since this document was first written. They are here rather than edited in above, so the reasoning stays visible.

### The product now ships with TWO reference images

Paul decided that users may **upload a photo of the place** alongside their face, not merely type a location. That changes what this gate has to measure. A model juggling two references decides how much of each to honour, and identity is usually what gives — so testing with one reference and shipping with two measures a condition the product never operates in. That is the character-sheet mistake inverted.

**Sequence:** run the five one-reference stills as the baseline first, then two or three more with face **plus a real place photo**.

| One-ref | Two-ref | Reading |
|---|---|---|
| fail | fail | The premise is wrong. **Stop.** |
| pass | fail | Premise fine, the place-photo feature is the problem. Ship typed-text first, add place photos later. |
| pass | pass | Build the product Paul described. |

### A three-rung ladder, so a failure says where it broke

A plain-background test is a good **diagnostic** and a bad **gate**: it is the easiest possible case for identity, so failing it kills the project, but passing it proves nothing about a garden with a tracksuit. Its value is bisection — it separates "the model cannot hold a face" from "our scene is drowning it".

1. **Identity alone** — plain mid-grey background, no wardrobe change, nothing in frame.
2. **Identity under a wardrobe change** — same, plus the jacket.
3. **The product** — the full composed preset. *This is the one that supplies the hit rate.*

Two or three rolls at rungs 1 and 2 is plenty; you are asking "does it break here", not measuring frequency. Add `beauty retouching, smoothed skin` to the negatives while measuring likeness — models flatter a face on a plain background, and a smoothed, symmetrical version of someone is exactly the "looks like my cousin" failure.

### Criterion 4 is probably too strict — UNRESOLVED

It says a model with no audio-off parameter is disqualified outright. That was inherited from RELIO, where generated ambience would fight a scripted voiceover. **Timestamp has no voiceover**: `tapedeck` builds its own bed and the render never maps the model's audio stream, so a model that emits audio cannot hurt us — it only wastes a little generation cost.

It should probably be demoted from disqualifier to preference, leaving 1, 3 and 5 as the hard stops. **Paul has not ruled on this and it has deliberately not been changed** — quietly loosening a gate is exactly the kind of thing that should not happen unattended.

### Result so far

One still generated (rung 3, `schrebergarten-august` + `trainingsjacke`, catalog `3047fddc750de92f`). **Scene adherence: strong pass** — 15 of 17 elements present. Two misses: the model gave *three* white stripes where the prompt asked for two (an Adidas trademark, worth tightening in the preset), and framing came out wider than the requested waist-up. Generate at **4:3** from here so the 4:3 crop does not discard composition. **Identity: unmeasured** — needs the two-person blind check.

---

## Recording the result

Fill in the Result column, paste the eight numbers, and note the model IDs and exact prompts used. Then commit this file. When a render six months from now looks wrong, this is the document that says what "right" was measured to be.

**If the gate passes:** the next milestone is M3 (the preset catalog), because M1 and M2 are already done and cost nothing.

**If the gate fails:** stop. The look works — that has been demonstrated — but the look is not the product on its own. A tape aesthetic applied to someone who does not look like the person who uploaded the photo is not worth building an app around.
