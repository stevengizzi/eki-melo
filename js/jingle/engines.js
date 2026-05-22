/* =================================================================
   ENGINES — the dual-engine dispatcher (buildplan Session 13, the wire-up).

   Two composition engines now ship side by side, and the USER picks one per
   generation (Steven's product decision — no auto-fallback, no "both" mode):

     - 'v1'       — the original loose generator: one big LLM prompt
                    (composition.js's brief) → a jingle JSON, parsed by api.js.
                    Untouched, bit-identical to its pre-Session-13 behaviour. It
                    is the deliberate FALLBACK when the pipeline misbehaves.
     - 'pipeline' — the Session 1–12 ten-stage composer: aesthetic → macro →
                    harmony → melody → arrangement → texture → voice realization
                    → voice-leading → cadence. Driven by runPipelineGenerating.

   generateJingle({ guestName, mood, engine, options? }) is the ONE entry the
   front-end calls. It returns a playback-shaped jingle tagged with the engine
   that produced it (and, for the pipeline, the full intermediate metadata):

     engine='v1':       { engine:'v1', title, tempo, key, mood, form, sections,
                          lead, harmony, bass, createdAt }
     engine='pipeline': { engine:'pipeline', …same playback fields…, createdAt,
                          pipelineMetadata: { aesthetic, macroParams, harmonicPlan,
                                              motifs, phrasePlan, texturePlan } }

   Both shapes carry the SAME playback fields (lead/harmony/bass as
   [pitchString, duration] tuples, plus tempo/title/key/mood/form/sections), so
   the read-only synth.js + render.js play and draw either one identically. The
   pipeline's FinalJingle was designed to emit synth-ready tracks (Stage 6 renders
   pitches to the synth alphabet at its output boundary), so the "conversion" here
   is a field-pick + normalization, not a re-channelization — see
   pipelineToPlayback.

   ERROR HANDLING. Each engine runs under a 60s timeout (the pipeline chains five
   LLM calls + transport retries; 60s leaves headroom). A failure throws an
   EngineError carrying { engine, stage?, message, cause } so the caller in
   handlers.js can offer "Retry with the other engine". There is NO auto-fallback:
   the user's engine choice is deliberate and is preserved across the failure.

   LOGGING. One structured console line per generation
   ("[jingle-engine] engine=pipeline status=success duration=23.4s" /
   "[jingle-engine] engine=pipeline stage=4 status=failed message=…") — the data
   source for future analysis; no external service.

   PORTABILITY. jingle/ code: imports api.js (read-only) + the pipeline runner +
   the default config. Works in both runtime contexts (the LLM calls go through
   the same env.js endpoint adapter the rest of the app uses).
   ================================================================= */
import { generateJingle as generateV1Jingle } from './api.js';
import { runPipelineGenerating } from './pipeline/pipeline-runner.js';
import { DEFAULT_CONFIG } from './pipeline/pipeline-config.js';

export const ENGINES = ['v1', 'pipeline'];
export const DEFAULT_ENGINE = 'pipeline'; // Session-12 confirmed default.
const ENGINE_TIMEOUT_MS = 60000;

/** The OTHER engine — for the retry-with-the-other-engine affordance. */
export function otherEngine(engine) {
  return engine === 'v1' ? 'pipeline' : 'v1';
}

/** Human-facing label for a badge / button ("PIPELINE", "v1"). */
export function engineLabel(engine) {
  return engine === 'pipeline' ? 'PIPELINE' : 'v1';
}

// =================================================================
// STRUCTURED ERROR — what a failed generation throws.
// =================================================================

export class EngineError extends Error {
  constructor({ engine, stage = null, message, cause = null }) {
    super(message);
    this.name = 'EngineError';
    this.engine = engine;
    this.stage = stage;
    this.cause = cause;
  }
}

// Wrap any thrown value as an EngineError, salvaging a "Stage N" tag from the
// message when one is present (the stage modules prefix their errors that way).
function asEngineError(error, engine) {
  if (error instanceof EngineError) return error;
  const message = error && error.message ? error.message : String(error);
  const stageMatch = message.match(/Stage (\d+[a-z]?)/i);
  return new EngineError({ engine, stage: stageMatch ? stageMatch[1] : null, message, cause: error });
}

// =================================================================
// TIMEOUT — reject if an engine runs longer than ENGINE_TIMEOUT_MS.
// =================================================================

function withTimeout(promise, ms, engine) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new EngineError({ engine, message: `${engine} engine timed out after ${Math.round(ms / 1000)}s` })),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// =================================================================
// LOGGING — one structured line per generation.
// =================================================================

function logResult({ engine, status, durationMs, stage, message }) {
  const parts = [`engine=${engine}`];
  if (stage) parts.push(`stage=${stage}`);
  parts.push(`status=${status}`, `duration=${(durationMs / 1000).toFixed(1)}s`);
  if (message && status !== 'success') parts.push(`message=${JSON.stringify(message)}`);
  console.log('[jingle-engine] ' + parts.join(' '));
}

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// =================================================================
// PIPELINE → PLAYBACK CONVERSION. The FinalJingle already carries synth-ready
// tracks + metadata; this pins the playback contract (the fields synth.js +
// render.js read) and defends the boundaries the way api.js does for v1.
// =================================================================

function asTrack(track) {
  return Array.isArray(track) ? track : [];
}

function pipelineToPlayback(finalJingle) {
  return {
    title: String(finalJingle.title || 'untitled theme'),
    tempo: Number(finalJingle.tempo) || 140,
    key: String(finalJingle.key || ''),
    mood: String(finalJingle.mood || ''),
    form: String(finalJingle.form || ''),
    sections: Array.isArray(finalJingle.sections) ? finalJingle.sections : [],
    lead: asTrack(finalJingle.lead),
    harmony: asTrack(finalJingle.harmony),
    bass: asTrack(finalJingle.bass),
  };
}

// =================================================================
// THE TWO ENGINE RUNNERS
// =================================================================

// v1: reuse api.js's generateJingle verbatim (do NOT reimplement) and tag it.
async function runV1Engine({ guestName, mood }) {
  const jingle = await withTimeout(generateV1Jingle(guestName, mood), ENGINE_TIMEOUT_MS, 'v1');
  return { ...jingle, engine: 'v1', createdAt: jingle.createdAt ?? Date.now() };
}

// pipeline: drive runPipelineGenerating from the bare { guestName, mood }; capture
// the resolved upstream artifacts via onArtifacts for pipelineMetadata. `options`
// may carry config / lengthBudget / the offline __mock*/on* hooks (passed through
// for the inspector + tests); `config` is the runner's second argument.
async function runPipelineEngine({ guestName, mood, options }) {
  const { config = DEFAULT_CONFIG, ...inputOptions } = options;
  let artifacts = {};
  const finalJingle = await withTimeout(
    runPipelineGenerating(
      { guestName, mood, ...inputOptions, onArtifacts: (a) => { artifacts = a; } },
      config
    ),
    ENGINE_TIMEOUT_MS,
    'pipeline'
  );
  return {
    ...pipelineToPlayback(finalJingle),
    engine: 'pipeline',
    createdAt: Date.now(),
    pipelineMetadata: artifacts,
  };
}

// =================================================================
// THE DISPATCHER
// =================================================================

/**
 * Generate a jingle with the chosen engine. Returns a playback-shaped jingle
 * tagged with `engine` (and `pipelineMetadata` for the pipeline). Throws an
 * EngineError ({ engine, stage?, message, cause }) on failure or timeout — the
 * caller decides whether to offer a retry with the other engine.
 *
 * @param {Object} args
 * @param {string} args.guestName   the guest's name (prompt flavour for Stage 1 / v1)
 * @param {string} args.mood        the free-text PERSONALITY / VIBE
 * @param {'v1'|'pipeline'} args.engine
 * @param {Object} [args.options]   { config?, lengthBudget?, …offline hooks }
 */
export async function generateJingle({ guestName, mood, engine, options = {} } = {}) {
  if (!ENGINES.includes(engine)) {
    throw new EngineError({ engine, message: `Unknown engine ${JSON.stringify(engine)} — use 'v1' or 'pipeline'.` });
  }
  const start = now();
  try {
    const result = engine === 'v1'
      ? await runV1Engine({ guestName, mood })
      : await runPipelineEngine({ guestName, mood, options });
    logResult({ engine, status: 'success', durationMs: now() - start });
    return result;
  } catch (error) {
    const engineError = asEngineError(error, engine);
    logResult({
      engine,
      status: 'failed',
      durationMs: now() - start,
      stage: engineError.stage,
      message: engineError.message,
    });
    throw engineError;
  }
}
