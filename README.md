# Timestamp

One photo, one place, one outfit — fifteen seconds that look like a camcorder tape from 2003. Warm, grainy, quiet.

**Be precise about what this is.** Right now it is a look, not a product. The tape aesthetic works and is fully built; the generation half — putting *you* in a chosen place and outfit — has not been validated against a real model yet. That validation is `docs/phase-0-validation.md` and it is deliberately the next thing, not something to discover in week nine.

---

## The quickstart that costs nothing

```bash
npm run doctor
npm run look
```

With no arguments `npm run look` synthesises its own source from ffmpeg's `testsrc2`, so it works on a fresh clone with an empty `assets/`. Point it at anything to see the real thing:

```bash
npm run look -- --in=assets/stock/porch.mp4 --name=porch
```

Then open `review/look/porch/before-after.mp4`. Judging a grade in isolation is nearly impossible — the eye adapts within seconds and everything starts to look normal. Against the original it does not.

To tune, change a number in `config/look/base.json` and run it again. To compare rather than guess:

```bash
npm run look -- --in=assets/stock/porch.mp4 --name=grain --sweep=tape.grainStrength=8,14,20,28
```

**No command on this page can spend money.** Neither can `npm test`.

---

## How it is put together

| Stage | Where | What it does |
|---|---|---|
| preflight | `scripts/preflight/` | Verifies ffmpeg, its filters, the font, the render contract and disk before anything expensive runs |
| tapedeck | `scripts/tapedeck/` | Builds the filtergraph for the entire look. Pure — returns strings, never spawns |
| ffmpeg | `scripts/ffmpeg/` | The only module in the repo that spawns a process, plus the output assertions |
| audio | `scripts/audio/` | The synthesised tape bed *(M2)* |
| catalog, compose | `scripts/catalog/`, `scripts/compose/` | The curated preset menu and prompt assembly *(M3)* |
| providers | `scripts/providers/` | The generation adapter, fal and fixture behind one interface *(M4–M5)* |
| render | `scripts/render/` | Orchestration, job directories, manifests, cost ledger *(M4)* |

**The architecture is one idea:** the model does *content*, ffmpeg does *texture*. Ask a video model for "VHS 2003" and you get clean footage with a nostalgic mood, not tape artifacts. Keeping the look in ffmpeg makes it deterministic, tunable, and — the part that matters most early — free to iterate before a single paid call. It is also cost-aligned: the look destroys fine detail by design, so generation can run at modest resolution and nobody can tell.

## The output contract

PAL, 720×576 at SAR 16/15, 25fps — what a camcorder tape in Europe actually was, and the arithmetic is honest: 25 × 15 is **exactly 375 frames**, so "15.000 seconds" is a number a test asserts rather than a rounding argument. Delivered as the 4:3 tape image centred in a 1080×1920 frame on `#0B0A09`.

## Status

| Milestone | State |
|---|---|
| **M1 — the tape look** | **Done.** PAL chain, 4:3 in 9:16, five-run bit-identical purity check |
| **M2 — audio bed, single-pass mux** | **Done.** Synthesised bed at −27.2 LUFS, joined in one ffmpeg invocation |
| **M3 — preset catalog + prompts** | **Done.** 8 places, 6 outfits, three prompt rules enforced at load |
| M0 — the validation gate | **Not run — the only real blocker.** One still generated so far. `docs/phase-0-validation.md` |
| **Next — the app, end to end** | Next.js locally + a render worker with ffmpeg + a job queue, generation stubbed by the fixture provider |
| Then | Real uploads · real video APIs (model chosen at that point) · moderation · billing |

**131 tests, 0 failures.** Nothing in the suite can spend money.

## Honest limits

- **The aesthetic values are tuned against two clips**, not a corpus. They will need another pass once real generated footage exists.
- **No bundled font yet.** The date stamp falls back to a system font, which works but means a render will not reproduce byte-for-byte on another machine. `npm run doctor` says so every time. An OFL camcorder face at `assets/fonts/tape-osd.ttf` fixes it.
- **No face detection at intake, and it is now required.** It was deferred for a CLI run on your own photos. The product takes uploads from strangers, so it is mandatory along with a consent gate, retention limits and a takedown path.
- **No moderation layer yet, and free-text input needs one.** The menu became recommendations rather than a gate, so arbitrary text now reaches the prompt — including text engineered to hijack it.
- **The identity premise is untested.** Everything here assumes a model can put a specific person in a place and an outfit, recognisably, from one ordinary photo. Nobody has measured that yet. That is what the gate is for.
- **Higgsfield cannot serve a public version of this.** Its access is a consumer creator subscription; reselling that output through a paid app is outside consumer terms and its concurrency caps are per-account. That is why the provider is fal.ai.

## Not in scope

The web app — accounts, credits, queueing, UI, gallery, sharing, rate limits, storage lifecycle. It is a separate spec, written after M7, using the cost and wall-time numbers M0 measures rather than guesses.
