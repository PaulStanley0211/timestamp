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

## Recording the result

Fill in the Result column, paste the eight numbers, and note the model IDs and exact prompts used. Then commit this file. When a render six months from now looks wrong, this is the document that says what "right" was measured to be.

**If the gate passes:** the next milestone is M3 (the preset catalog), because M1 and M2 are already done and cost nothing.

**If the gate fails:** stop. The look works — that has been demonstrated — but the look is not the product on its own. A tape aesthetic applied to someone who does not look like the person who uploaded the photo is not worth building an app around.
