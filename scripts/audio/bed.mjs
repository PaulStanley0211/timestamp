/**
 * The quiet. This module builds an audio filtergraph string and nothing else --
 * it does not spawn, read, or write, for exactly the reason tapedeck/look.mjs
 * does not. Purity buys two things here. First, the whole bed becomes assertable
 * with golden strings in milliseconds, with no ffmpeg and no temp wav on disk.
 * Second, and more important, a graph that is just a string can be pasted into
 * the SAME `-filter_complex` as the video graph, so the tape renders in ONE
 * invocation. Building the bed separately and muxing it afterwards would mean a
 * second encode of a picture whose entire subject is generation loss -- paying
 * real degradation for a filing-cabinet convenience.
 *
 * THE BED IS SYNTHESISED, AND THAT IS THE ARGUMENT, NOT THE COMPROMISE.
 *
 * A sampled ambience would need a file in the repo, a licence to reason about,
 * and -- because a sample's loudness is a property of the recording rather than
 * of anything we chose -- a normalisation pass to hit a target. Synthesis makes
 * the level known a priori: three generators whose amplitudes we set, summed
 * with weights we set, through a fixed makeup gain. There is nothing to measure
 * at render time because there is nothing we did not decide in advance.
 *
 * Which is why THERE IS NO `loudnorm` ANYWHERE IN THIS FILE and there must never
 * be one. Single-pass loudnorm applies dynamic, content-dependent gain: it
 * listens to the signal and moves. Against a bed that is 99% steady-state hiss
 * that means it pumps -- the noise floor breathes, which is the one thing tape
 * hiss never does -- and it makes the output a function of the analysis window
 * rather than of the seed, so two runs of the same command stop matching. The
 * correct use of a loudness meter here is to ASSERT the target, never to reach
 * it. See test/audio-output.test.js: `ebur128` runs in the tests and nowhere in
 * the render path.
 *
 * THE THREE LAYERS ARE THE THREE THINGS A 2003 CAMCORDER ACTUALLY RECORDED when
 * nobody was talking:
 *
 *   Pink hiss. The sum of the electret mic's self-noise, the preamp, and the
 *   tape's own noise floor. Pink rather than white because every one of those
 *   sources rolls off with frequency and white noise reads as a broken digital
 *   thing -- a dropout, not a room. Band-limited 200 Hz - 8 kHz because a
 *   camcorder's built-in mic had neither the diaphragm for real low end nor the
 *   bandwidth above it; the 8 kHz ceiling is the single cue that dates the sound
 *   more than any other. Measured alone at masterGain 3.0: -27.1 LUFS, which is
 *   to say the hiss IS the bed and the rest is seasoning.
 *
 *   Capstan whir. Two sines an octave apart -- 118 Hz and its near-second
 *   harmonic 237 Hz -- because a small DC transport motor conducts a fundamental
 *   plus an untidy harmonic through the chassis into the mic that is bolted to
 *   the same chassis. `tremolo` at 7.3 Hz is the flutter: the tape does not move
 *   past the head at a perfectly constant speed, and that periodic speed error
 *   is what separates "tape" from "a sine wave someone added". `lowpass=f=900`
 *   kills the buzzy harmonics the tremolo sidebands create and leaves a hum you
 *   feel rather than hear. Measured alone at masterGain 3.0: -43.8 LUFS -- about
 *   17 dB under the hiss, and quieter still to the ear than that number suggests
 *   because K-weighting deliberately de-emphasises everything below 200 Hz.
 *
 *   The mix bus. Band-limits the sum a second time, applies the one fixed makeup
 *   gain, and ends in a ceiling.
 *
 * A NUMBER IN THIS FILE DOES NOT MEAN WHAT IT LOOKS LIKE. ffmpeg's `sine` source
 * has no amplitude option and does not emit full scale: it writes s16 at a fixed
 * 4096/32768, so its intrinsic peak is 0.125, or -18.1 dBFS. Measured, and the
 * reason it matters is that `volume=0.05` on a tone is really amplitude 0.00625
 * and not 0.05 -- a factor of eight between what the profile reads like and what
 * the tone is. Nothing needs correcting for it, because the tone volumes were
 * calibrated by ear and by meter against this behaviour, but anyone comparing a
 * capstan volume against `hiss.amplitude` (which anoisesrc DOES take literally)
 * is comparing two different units.
 *
 * TWO DEFAULTS IN THIS CHAIN ARE ACTIVE TRAPS.
 *
 *   `amix` defaults to `normalize=1`, which divides the sum by the input count.
 *   Every amplitude chosen above would be silently halved, and the failure is
 *   invisible: the bed still plays, it is just wrong, and the only symptom is a
 *   loudness number nobody looks at. Measured: the same graph with the default
 *   lands at -33.0 LUFS instead of -27.0. `normalize=0` is mandatory on EVERY
 *   amix here, including the two-tone capstan sub-mix.
 *
 *   `anoisesrc` defaults to `seed=-1`, which means "seed from entropy". A bed
 *   built with that default is different noise on every run, so framemd5 purity
 *   dies and the reproducibility guarantee the whole repo is built on becomes a
 *   claim rather than a property. The seed is always written explicitly, from
 *   `look.audioSeed`.
 *
 * AND ONE MEASURED SURPRISE ABOUT `alimiter`, which the name hides.
 *
 *   Its `level` option ("auto level") defaults to TRUE, which scales the output
 *   by 1/limit. At `limit=0.7` that is a flat +3.1 dB on everything, applied
 *   whether or not a single sample was ever limited -- and none ever is, because
 *   the bed's true peak is -15.5 dBFS, a full 12 dB under the 0.7 ceiling.
 *   Measured: the identical graph reads -30.1 LUFS with the limiter removed and
 *   -27.0 with it in place. So `bus.limit` is, in this build, a GAIN CONTROL
 *   that happens to also be a ceiling, and lowering it to "leave more headroom"
 *   makes the bed LOUDER. The gain is a constant and content-independent, so
 *   reproducibility is untouched -- but the calibration table in base.json is
 *   only valid for limit=0.7, and the loudness test is what catches a change.
 *
 * -27 LUFS is a literal spec, not a rounding of "quiet". Platforms normalise to
 * about -14; sitting thirteen decibels under that means the bed reads as room
 * tone under whatever else is happening rather than as a soundtrack. A found
 * tape does not have a soundtrack.
 */

/** Clamp ranges for the audio block. The video clamps live in tapedeck/look.mjs
 *  and this table deliberately does not move there: the audio profile is loaded
 *  by the same `loadLookProfile` call, but keeping its ranges next to the code
 *  that emits the filters is what makes a range readable -- `bus.limit` bottoms
 *  out at 0.0625 because that is where alimiter itself refuses, not because
 *  anyone chose it aesthetically. Same philosophy as the video side: pull to the
 *  edge and report, never throw. A bed is a creative document too. */
export const AUDIO_CLAMPS = {
  'audio.masterGain': [0, 8],
  'audio.hiss.amplitude': [0, 1],
  'audio.hiss.volume': [0, 4],
  'audio.hiss.highpass': [20, 4000],
  'audio.hiss.lowpass': [1000, 20000],
  'audio.capstan.flutterHz': [0.1, 30],
  'audio.capstan.flutterDepth': [0, 1],
  'audio.capstan.lowpass': [100, 20000],
  'audio.ambience.amplitude': [0, 1],
  'audio.ambience.volume': [0, 4],
  'audio.ambience.highpass': [20, 4000],
  'audio.ambience.lowpass': [200, 20000],
  // tremolo REFUSES f below 0.1 with an ffmpeg error rather than a warning, and
  // the graph omits the filter entirely at 0 -- so this range is "off, or legal".
  'audio.ambience.swellHz': [0, 20],
  'audio.ambience.swellDepth': [0, 1],
  'audio.ambience.echoDelayMs': [0, 2000],
  'audio.ambience.echoDecay': [0, 0.9],
  'audio.ambience.tone.lowpass': [100, 20000],
  // tickHz shares tremolo's floor for the same reason swellHz does: below it
  // the period is longer than the tape is, so "off" and "very slow" are
  // indistinguishable and the graph should just say off (tickHz: 0).
  'audio.ambience.tone.tickHz': [0, 20],
  'audio.ambience.tone.tickDuration': [0, 1],
  'audio.bus.highpass': [20, 4000],
  'audio.bus.lowpass': [1000, 20000],
  // alimiter rejects anything outside this range outright, with an ffmpeg error
  // rather than a warning. Clamping is the difference between a nudged bed and
  // a failed render.
  'audio.bus.limit': [0.0625, 1],
};

/** Same rounding as tapedeck/look.mjs, and deliberately a copy rather than an
 *  import: look.mjs keeps it module-private, and a shared numeric-formatting
 *  utility is not worth a new module or a widened export surface for six lines.
 *  Trailing float noise in a filtergraph makes golden strings fragile for no
 *  benefit at all. */
const n = (v, digits = 4) => {
  const num = Number(v);
  if (!Number.isFinite(num)) throw new Error(`expected a finite number, got ${JSON.stringify(v)}`);
  return String(Number(num.toFixed(digits)));
};

const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function set(obj, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  const parent = keys.reduce((o, k) => (o[k] ??= {}), obj);
  parent[last] = value;
}

/**
 * Pull the audio block into range, reporting what moved.
 *
 * Mirrors `loadLookProfile`'s return shape so the CLI can print video and audio
 * clamps through one code path. Mutates the profile it is given, because that
 * profile is already a merged clone by the time it gets here.
 *
 * @param {object} look a loaded LookProfile
 * @returns {{ clamped: Array<{path:string,from:number,to:number,min:number,max:number}> }}
 */
export function clampAudio(look) {
  const clamped = [];
  for (const [dotted, [min, max]] of Object.entries(AUDIO_CLAMPS)) {
    const value = get(look, dotted);
    if (typeof value !== 'number' || Number.isNaN(value)) continue;
    const next = Math.min(max, Math.max(min, value));
    if (next !== value) {
      clamped.push({ path: dotted, from: value, to: next, min, max });
      set(look, dotted, next);
    }
  }
  return { clamped };
}

/**
 * Build the complete audio filtergraph.
 *
 * Every source in the returned graph is a generator. NOTHING here references an
 * input stream, and that is load-bearing rather than incidental: it is the
 * structural reason the generation provider's own audio can never leak into the
 * output. There is no `[0:a]` to leak through. The second half of that guarantee
 * is the explicit `-map` pair in audio/mix.mjs -- `-an` is not used and must not
 * be, because `-an` is a thing you can forget, whereas a graph with no input
 * pads is a thing you would have to deliberately rewrite.
 *
 * @param {object} look       a loaded LookProfile; uses `look.audio` and `look.audioSeed`
 * @param {object} cfg        config/render.json
 * @param {object} [opts]
 * @param {string} [opts.outLabel]  defaults to 'aout'
 * @returns {string} a filter_complex fragment ending in [outLabel]
 */
export function buildAudioFilter(look, cfg, { outLabel = 'aout' } = {}) {
  const audio = look?.audio;
  if (!audio) throw new Error('look.audio is missing -- config/look/base.json needs an "audio" block');
  if (!Number.isFinite(Number(look.audioSeed))) {
    throw new Error(
      `look.audioSeed must be a number, got ${JSON.stringify(look.audioSeed)} -- ` +
      'anoisesrc defaults to seed=-1, which is random, and an unseeded bed is a different bed every run',
    );
  }

  const rate = cfg.encode.audioSampleRate;
  const seconds = cfg.durationSeconds;
  const chains = [];
  const busInputs = [];

  // ---- tape and preamp noise floor -----------------------------------------
  // The seed is written unconditionally. See the header: -1 is the default and
  // -1 is random.
  const { hiss } = audio;
  chains.push(
    `anoisesrc=c=pink:a=${n(hiss.amplitude)}:r=${rate}:d=${n(seconds)}:seed=${Number(look.audioSeed)},` +
    `highpass=f=${n(hiss.highpass)},lowpass=f=${n(hiss.lowpass)},volume=${n(hiss.volume)}[hiss]`,
  );
  busInputs.push('hiss');

  // ---- transport motor ------------------------------------------------------
  // Tones first, then flutter over the SUM. Applying tremolo per-tone would give
  // each partial its own independent wobble, which is two motors, not one -- the
  // beat between them is immediately audible as an effect rather than a machine.
  const tones = Array.isArray(audio.capstan?.tones) ? audio.capstan.tones : [];
  if (tones.length) {
    const { capstan } = audio;
    const labels = tones.map((tone, i) => {
      const label = `cap${i}`;
      chains.push(`sine=f=${n(tone.hz)}:r=${rate}:d=${n(seconds)},volume=${n(tone.volume)}[${label}]`);
      return label;
    });
    chains.push(
      `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0,` +
      `tremolo=f=${n(capstan.flutterHz)}:d=${n(capstan.flutterDepth)},` +
      `lowpass=f=${n(capstan.lowpass)}[capstan]`,
    );
    busInputs.push('capstan');
  }

  // ---- the place ------------------------------------------------------------
  // Filtered noise, optionally swelling, optionally in a room. That vocabulary
  // covers every shipped place: surf and wind are a slow swell over brown
  // noise, traffic is the same without the swell, and a swimming hall or a
  // stairwell is the same again with an echo on it.
  //
  // THE SEED IS NOT audioSeed. Two anoisesrc on one seed emit identical noise,
  // and summing identical noise is not two layers -- it is one layer 6 dB
  // louder and perfectly correlated, which sounds precisely like the hiss
  // turned up. Nothing in the graph would look wrong.
  const amb = audio.ambience;
  if (amb && Number(amb.amplitude) > 0) {
    const parts = [
      `anoisesrc=c=${amb.color ?? 'brown'}:a=${n(amb.amplitude)}:r=${rate}:d=${n(seconds)}:seed=${Number(look.audioSeed) + 1}`,
      `highpass=f=${n(amb.highpass)}`,
      `lowpass=f=${n(amb.lowpass)}`,
    ];
    // Omitted rather than zeroed: tremolo=f=0 is a failed render, not a still
    // bed, and aecho with no delay is a filter doing nothing at a cost.
    if (Number(amb.swellHz) > 0) parts.push(`tremolo=f=${n(amb.swellHz)}:d=${n(amb.swellDepth)}`);
    if (Number(amb.echoDelayMs) > 0) parts.push(`aecho=0.8:0.85:${n(amb.echoDelayMs)}:${n(amb.echoDecay)}`);
    parts.push(`volume=${n(amb.volume)}`);
    chains.push(`${parts.join(',')}[amb]`);
    busInputs.push('amb');
  }

  // ---- the place's own TONE --------------------------------------------------
  // The ambience block above is NOISE only, and two shipped places want more
  // than that: a stairwell's flickering fluorescent tube and a kitchen's wall
  // clock are both TONES, not filtered noise, and the capstan two sections up
  // already proves a tone belongs in this file. This is that same mechanism --
  // sine sources, summed with normalize=0, band-limited -- applied to a place
  // instead of to the machine.
  //
  // `tones` is the switch, exactly like `capstan.tones`: nothing here runs
  // unless a place names at least one partial, so a place with no tone
  // configured is bit-identical to the bed before this feature existed.
  //
  // NO SEED. Unlike hiss and ambience, a tone sine is not stochastic --
  // ffmpeg's `sine` source is a pure function of frequency and time, so there
  // is nothing here for audioSeed to seed. That is the same fact the capstan
  // section already rests on, restated for a second place.
  //
  // TICKING IS THE ONE NEW TRICK. A mains hum and a capstan whir are both
  // continuous, so both are shaped with `tremolo` -- a smooth sinusoidal
  // swell. A clock does not swell, it clicks: silence for most of a second,
  // then a brief burst. Gating a continuous sine to that shape needs a hard
  // edge tremolo cannot produce (its floor is a raised sine, never true
  // silence), so `tickHz` reaches for ffmpeg's per-frame `volume` expression
  // instead: `if(lt(mod(t,PERIOD),DURATION),1,0)` is 1 for the first
  // `tickDuration` seconds of every `1/tickHz`-second period and 0 the rest of
  // it, evaluated fresh every frame (`eval=frame`) rather than once at graph
  // build time. The expression is a pure function of `t`, so it is exactly as
  // deterministic as every fixed number elsewhere in this file -- there is no
  // clock read here, only the word "PERIOD" for one computed from a config
  // value. `tickHz: 0` (or absent) skips this stage entirely and the tone
  // plays as a continuous hum, which is what the fluorescent buzz wants.
  const tone = audio.ambience?.tone;
  const toneTones = Array.isArray(tone?.tones) ? tone.tones : [];
  if (toneTones.length) {
    const labels = toneTones.map((t, i) => {
      const label = `tone${i}`;
      chains.push(`sine=f=${n(t.hz)}:r=${rate}:d=${n(seconds)},volume=${n(t.volume)}[${label}]`);
      return label;
    });
    const tickHz = Number(tone.tickHz) || 0;
    const gate = tickHz > 0
      ? `,volume=volume='if(lt(mod(t,${n(1 / tickHz)}),${n(tone.tickDuration)}),1,0)':eval=frame`
      : '';
    chains.push(
      `${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0,` +
      `lowpass=f=${n(tone.lowpass)}${gate}[tone]`,
    );
    busInputs.push('tone');
  }

  // ---- mix bus --------------------------------------------------------------
  // aformat pins mono at 48k rather than trusting negotiation. Every source
  // above is already mono and already 48k, so this changes nothing today -- and
  // that is the point: the day someone adds a stereo layer, this line is what
  // decides the answer instead of whatever the encoder happened to accept.
  const { bus } = audio;
  chains.push(
    `${busInputs.map((l) => `[${l}]`).join('')}amix=inputs=${busInputs.length}:normalize=0,` +
    `aformat=channel_layouts=mono:sample_rates=${rate},` +
    `highpass=f=${n(bus.highpass)},lowpass=f=${n(bus.lowpass)},` +
    `volume=${n(audio.masterGain)},` +
    // Not really a limiter at this level -- see the header. It is a fixed
    // +3.1 dB of makeup gain plus a ceiling the bed never reaches.
    // level=disabled is NOT optional. alimiter's `level` option defaults to
    // true, which scales the output by 1/limit -- so `limit` silently doubles as
    // a gain control, and lowering it to "leave more headroom" makes the bed
    // LOUDER. Measured: the identical graph reads -29.6 LUFS with the limiter
    // removed, -26.5 with it, and -29.6 again with level=disabled, which is
    // exactly 20*log10(1/0.7) = 3.1 dB of auto-level and not one sample of
    // limiting. Disabling it leaves `limit` meaning the one thing its name says
    // -- a ceiling -- and leaves masterGain as the single control of loudness,
    // which is what the "level is known a priori" design requires. The ceiling
    // is inert in normal operation (the bed's true peak sits ~12 dB under it)
    // and exists as a safety net for a hand-edited profile, not as a stage.
    `alimiter=limit=${n(bus.limit)}:level=disabled[${outLabel}]`,
  );

  return chains.join(';');
}
