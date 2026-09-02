/**
 * Resuming a job uses what the job froze, not what the command line defaults to.
 *
 * THE THREE FAILURES THIS FILE EXISTS FOR, all found on 2026-08-25 within an
 * hour, all the same shape:
 *
 *   1. `--resume` rebuilt the provider from the CLI default, so a job whose
 *      manifest said `provider: fal` was resumed against `fixture`. It failed
 *      on a capability check -- fixture cannot do 15-second clips -- and the
 *      failure was recorded on the job, which is how a job parked for a metered
 *      run ended up marked `failed` by a command that was supposed to be free.
 *   2. The same for the video model. The manifest froze
 *      `seedance-2.0/reference-to-video`; the CLI default is
 *      `seedance-2.0/image-to-video`. The pipeline built a reference-to-video
 *      BODY (image_urls, plural, from the frozen references) and posted it to
 *      the image-to-video ENDPOINT, which requires image_url, singular. fal
 *      answered 422. Nothing was charged, by luck: the two shapes happened to
 *      be incompatible. Had they agreed, the resume would have silently
 *      rendered with a model the manifest does not name, billed for it, and
 *      left a manifest claiming a model that was never called -- which breaks
 *      the reproducibility the frozen block exists to guarantee.
 *   3. `--dry-run` was ignored entirely on a resume: the branch returns before
 *      the dry-run branch is reached, so the flag whose entire promise is
 *      "charges nothing" ran the job for real. With `--provider=fal` that is a
 *      paid call made by somebody who believed they were pricing it.
 *
 * THE RULE: the manifest wins by default, and a command line that CONTRADICTS
 * it is refused by name rather than silently obeyed. Agreeing is fine --
 * naming the model a job already froze is how the successful run on 2026-08-25
 * was finally made, and it must stay legal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resumeSettings, ResumeConflictError } from '../scripts/render/resume.mjs';

/** A manifest fragment shaped like the parked 720p job. */
const job = ({ provider = 'fal', video = 'bytedance/seedance-2.0/reference-to-video', still = 'fal/UNVERIFIED-identity-still' } = {}) => ({
  jobId: '20260824-225641-f34b4f',
  provider,
  resolved: { models: { video, still } },
});

const conflict = (fn) => {
  let err = null;
  try { fn(); } catch (caught) { err = caught; }
  assert.ok(err, 'expected a refusal and nothing was thrown');
  assert.ok(err instanceof ResumeConflictError, `expected a ResumeConflictError, got ${err?.name}: ${err?.message}`);
  return err;
};

// ---------------------------------------------------------------------------
// restoring
// ---------------------------------------------------------------------------

test('a resume with no flags uses the provider and models the job froze', () => {
  const s = resumeSettings(job(), {});
  assert.equal(s.providerId, 'fal');
  assert.equal(s.videoModel, 'bytedance/seedance-2.0/reference-to-video');
  assert.equal(s.stillModel, 'fal/UNVERIFIED-identity-still');
  // Said out loud, because an operator who typed nothing should be told what
  // they got rather than left to infer it from a 422 twenty seconds later.
  assert.deepEqual(s.restored.sort(), ['provider', 'still model', 'video model']);
});

test('a flag that agrees with the manifest is accepted and is not reported as restored', () => {
  const s = resumeSettings(job(), {
    provider: 'fal',
    videoModel: 'bytedance/seedance-2.0/reference-to-video',
  });
  assert.equal(s.providerId, 'fal');
  assert.equal(s.videoModel, 'bytedance/seedance-2.0/reference-to-video');
  assert.ok(!s.restored.includes('provider'));
  assert.ok(!s.restored.includes('video model'));
});

// ---------------------------------------------------------------------------
// refusing
// ---------------------------------------------------------------------------

test('a provider that contradicts the manifest is refused, naming both', () => {
  const err = conflict(() => resumeSettings(job({ provider: 'fal' }), { provider: 'fixture' }));
  assert.match(err.message, /fal/);
  assert.match(err.message, /fixture/);
  assert.equal(err.field, 'provider');
});

/** THE 422. The frozen block and the endpoint have to be the same model, or
 *  the body is built for one and posted to the other. */
test('a video model that contradicts the manifest is refused', () => {
  const err = conflict(() => resumeSettings(job(), {
    videoModel: 'bytedance/seedance-2.0/image-to-video',
  }));
  assert.match(err.message, /reference-to-video/);
  assert.match(err.message, /image-to-video/);
  assert.equal(err.field, 'video model');
});

test('a still model that contradicts the manifest is refused', () => {
  const err = conflict(() => resumeSettings(job(), { stillModel: 'someone/else' }));
  assert.equal(err.field, 'still model');
});

/** A refusal has to say what to do about it. The two ways out are dropping the
 *  flag and starting a new job, and the message names both -- an operator who
 *  is mid-incident should not have to guess which. */
test('a refusal says how to get out of it', () => {
  const err = conflict(() => resumeSettings(job(), { provider: 'fixture' }));
  assert.match(err.message, /without the flag/i);
  assert.match(err.message, /new job|fresh render/i);
});

// ---------------------------------------------------------------------------
// jobs from before any of this was frozen
// ---------------------------------------------------------------------------

/** Jobs made before the frozen block carried models must still be resumable,
 *  and the CLI is the only source of truth for them. Refusing those would make
 *  every old job permanently unresumable. */
test('a job that froze no model falls back to the command line', () => {
  const old = { jobId: 'x', provider: 'fal', resolved: {} };
  const s = resumeSettings(old, { videoModel: 'bytedance/seedance-2.0/image-to-video' });
  assert.equal(s.videoModel, 'bytedance/seedance-2.0/image-to-video');
  assert.equal(s.providerId, 'fal');
});

test('a job that froze no provider falls back to the command line and then to fixture', () => {
  assert.equal(resumeSettings({ jobId: 'x', resolved: {} }, { provider: 'fal' }).providerId, 'fal');
  assert.equal(resumeSettings({ jobId: 'x', resolved: {} }, {}).providerId, 'fixture');
});

/** The safe direction: a job with nothing frozen and nothing asked for must not
 *  quietly become a paid render. */
test('nothing frozen and nothing asked for is the free provider, never a paid one', () => {
  assert.equal(resumeSettings({ jobId: 'x' }, {}).providerId, 'fixture');
});
