/* =================================================================
   VERIFY-DIAGNOSTICS — exit-criterion check for the Session-14 diagnostic capture
   + export feature. RUNS FULLY OFFLINE — no live API calls (the one pipeline run is
   driven through the stage __mockResponse fallbacks, like verify-stage5b).

   It confirms:
     a. SCHEMA FIXTURES — a hand-built "good" pipeline bundle and a "good" v1 bundle
        each validate OK; deliberate corruptions (missing required field, bad
        version, bad enum value, malformed stage entry) each fail with a SPECIFIC
        error.
     b. STABLE SERIALIZE — serializeDiagnostic is byte-deterministic: the same bundle
        in gives the same string out, and a key-shuffled clone serializes identically
        (key order is normalized, not load-bearing). 2-space indent, trailing newline.
     c. RECONSTRUCT (v1) — a synthetic guest + v1 jingle reconstructs to a bundle that
        validates clean, has system_prompt + user_prompt populated, parsed_jingle
        equal to the stored jingle, raw_response_text === null, provenance ===
        "reconstructed".
     d. RECONSTRUCT (pipeline) — a synthetic guest + pipeline jingle reconstructs to a
        bundle that validates clean, has all six stage entries + the realization,
        each stage's prompt populated (via re-running build*Prompt), stage_2's
        deterministic_trace populated, stages_6_through_8 populated (via re-running
        the sync core), provenance "reconstructed".
     e. ROUND-TRIP — a LIVE bundle built from a __mockResponse pipeline run +
        serialize + parse + validate round-trips losslessly (byte-for-byte).

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts (the
   repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-diagnostics.mjs
     rm js/jingle/package.json
   ================================================================= */
import {
  DIAGNOSTIC_SCHEMA_VERSION,
  buildLiveDiagnostic,
  reconstructDiagnostic,
  validateDiagnostic,
  serializeDiagnostic,
} from '../diagnostics.js';
import { generateJingle } from '../engines.js';
import { runPipeline } from '../pipeline/pipeline-runner.js';
import { computeSectionPlan } from '../pipeline/stage-6-voice.js';
import { CASES } from '../debug/pipeline-inspector-cases.js';

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);
const clone = (value) => JSON.parse(JSON.stringify(value));

const expectOk = (scope, result) => {
  if (!result.ok) fail(scope, `expected ok:true, got errors: ${JSON.stringify(result.errors)}`);
};
// ok must be false AND some error message must mention `keyword` (so the RIGHT
// defect was caught, not an incidental one).
const expectInvalid = (scope, result, keyword) => {
  if (result.ok) {
    fail(scope, 'expected ok:false, got ok:true');
    return;
  }
  if (keyword && !result.errors.some((e) => e.toLowerCase().includes(keyword.toLowerCase()))) {
    fail(scope, `no error mentioned "${keyword}". Errors: ${JSON.stringify(result.errors)}`);
  }
};

// A valid Aesthetic dict matching CASES[0] (triumphant Sunrise) — for the pipeline
// reconstruct fixture's stored pipelineMetadata.
const SUNRISE_AESTHETIC = {
  title: 'Sunrise Fanfare',
  mood_label: 'triumphant',
  tonic_hint: 'C',
  mode_hint: 'major',
  tempo_hint: 'auto',
  register_hint: 'mid',
  form_hint: 'AABA',
  intensity: 0.85,
  notes: 'A bold major fanfare.',
};

// A synthetic stored PIPELINE jingle from CASES[0]: the realized tracks from
// runPipeline, plus the full pipelineMetadata a real pipeline jingle carries.
function makePipelineJingle() {
  const base = CASES[0];
  const macroParams = { ...base.macroParams, mood: base.mood };
  const final = runPipeline({ ...base, macroParams });
  return {
    engine: 'pipeline',
    ...final,
    createdAt: Date.UTC(2026, 4, 22),
    pipelineMetadata: {
      aesthetic: SUNRISE_AESTHETIC,
      macroParams,
      harmonicPlan: base.harmonicPlan,
      motifs: base.motifs,
      phrasePlan: base.phrasePlan,
      texturePlan: base.texturePlan,
    },
  };
}

// A synthetic stored V1 jingle (the shape api.js emits + the engine tag).
function makeV1Jingle() {
  return {
    engine: 'v1',
    title: 'Brave Heart',
    tempo: 140,
    key: 'C major',
    mood: 'triumphant',
    form: 'AABA',
    sections: [
      { label: 'A', start: 0, length: 8 },
      { label: 'B', start: 8, length: 8 },
    ],
    lead: [['C5', 1], ['E5', 1], ['G5', 2]],
    harmony: [],
    bass: [['C3', 2], ['G2', 2]],
    createdAt: Date.UTC(2026, 4, 22),
  };
}

const GUEST = { id: 'g1', name: 'Test Guest', description: 'a triumphant hero who loves an entrance' };

// Rebuild every object with its keys in REVERSED order (recursively) — to prove the
// serializer normalizes key order rather than relying on it.
function shuffleKeys(value) {
  if (Array.isArray(value)) return value.map(shuffleKeys);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).reverse()) out[key] = shuffleKeys(value[key]);
    return out;
  }
  return value;
}

await (async () => {
  // ===============================================================
  // c. RECONSTRUCT (v1)
  // ===============================================================
  const v1Jingle = makeV1Jingle();
  const v1Bundle = await reconstructDiagnostic({ guest: GUEST, jingle: v1Jingle });
  expectOk('c:validates', validateDiagnostic(v1Bundle));
  if (v1Bundle.engine !== 'v1') fail('c:engine', `expected engine v1, got ${v1Bundle.engine}`);
  if (typeof v1Bundle.v1?.system_prompt !== 'string' || v1Bundle.v1.system_prompt.length === 0) {
    fail('c:system_prompt', 'system_prompt missing/empty');
  }
  if (typeof v1Bundle.v1?.user_prompt !== 'string' || !v1Bundle.v1.user_prompt.includes(GUEST.description)) {
    fail('c:user_prompt', 'user_prompt missing or does not embed the guest description');
  }
  if (JSON.stringify(v1Bundle.v1?.parsed_jingle) !== JSON.stringify(v1Jingle)) {
    fail('c:parsed_jingle', 'parsed_jingle does not equal the stored jingle');
  }
  if (v1Bundle.v1?.raw_response_text !== null) fail('c:raw', `expected raw_response_text null, got ${JSON.stringify(v1Bundle.v1?.raw_response_text)}`);
  if (v1Bundle.v1?.provenance !== 'reconstructed') fail('c:provenance', `expected provenance reconstructed, got ${v1Bundle.v1?.provenance}`);
  if (v1Bundle.diagnostic_type !== 'reconstructed') fail('c:type', `expected diagnostic_type reconstructed, got ${v1Bundle.diagnostic_type}`);

  // ===============================================================
  // d. RECONSTRUCT (pipeline)
  // ===============================================================
  const pJingle = makePipelineJingle();
  const pBundle = await reconstructDiagnostic({ guest: GUEST, jingle: pJingle });
  expectOk('d:validates', validateDiagnostic(pBundle));
  const stages = pBundle.pipeline?.stages ?? {};
  for (const key of ['stage_1_aesthetic', 'stage_2_macro', 'stage_3_harmony', 'stage_4_motifs', 'stage_5a_arrangement', 'stage_5b_texture', 'stages_6_through_8_realization']) {
    if (!stages[key]) fail('d:stages', `missing stage entry ${key}`);
  }
  for (const key of ['stage_1_aesthetic', 'stage_3_harmony', 'stage_4_motifs', 'stage_5a_arrangement', 'stage_5b_texture']) {
    const prompt = stages[key]?.prompt;
    if (!prompt || typeof prompt.system !== 'string' || typeof prompt.user !== 'string' || prompt.user.length === 0) {
      fail('d:prompt', `${key} prompt not populated`);
    }
    if (stages[key]?.raw_response_text !== null) fail('d:raw', `${key} raw_response_text should be null (irrecoverable), got ${JSON.stringify(stages[key]?.raw_response_text)}`);
    if (stages[key]?.provenance !== 'reconstructed') fail('d:provenance', `${key} provenance should be reconstructed`);
    if (!Array.isArray(stages[key]?.soft_warnings)) fail('d:soft', `${key} soft_warnings not an array`);
    if (stages[key]?.artifact == null) fail('d:artifact', `${key} artifact is null`);
  }
  if (!Array.isArray(stages.stage_2_macro?.deterministic_trace) || stages.stage_2_macro.deterministic_trace.length === 0) {
    fail('d:trace', 'stage_2 deterministic_trace not populated');
  } else {
    const decisions = stages.stage_2_macro.deterministic_trace.map((t) => t.decision);
    for (const d of ['tonic', 'mode', 'tempo', 'form', 'knobs']) {
      if (!decisions.includes(d)) fail('d:trace-decisions', `deterministic_trace missing the "${d}" decision`);
    }
  }
  const realization = stages.stages_6_through_8_realization;
  if (realization?.provenance === 'unknown') fail('d:realization', 'stages_6_through_8 came back unknown (re-realization failed)');
  for (const voice of ['lead', 'harmony', 'bass']) {
    if (!Array.isArray(realization?.[voice]) || realization[voice].length === 0) fail('d:realization', `stages_6_through_8 ${voice} empty`);
  }
  // C-replay: the reconstructed final tracks match the stored jingle's tracks.
  for (const voice of ['lead', 'harmony', 'bass']) {
    if (JSON.stringify(pBundle.final?.[voice]) !== JSON.stringify(pJingle[voice])) {
      fail('d:c-replay', `final.${voice} does not match the stored jingle's ${voice} track`);
    }
  }
  // config_snapshot is the fixture-replay knob set.
  if (typeof pBundle.pipeline?.config_snapshot?.harmonic_adventurousness !== 'string') {
    fail('d:config', 'config_snapshot.harmonic_adventurousness not populated');
  }

  // ===============================================================
  // a. SCHEMA FIXTURES — good bundles validate; corruptions fail specifically.
  // ===============================================================
  expectOk('a:good-pipeline', validateDiagnostic(pBundle));
  expectOk('a:good-v1', validateDiagnostic(v1Bundle));

  // missing required field (engine)
  const noEngine = clone(pBundle);
  delete noEngine.engine;
  expectInvalid('a:missing-engine', validateDiagnostic(noEngine), 'engine');

  // bad version (different MAJOR)
  const badVersion = clone(pBundle);
  badVersion.diagnostic_version = '9.0.0';
  expectInvalid('a:bad-version', validateDiagnostic(badVersion), 'major');

  // not-semver version
  const notSemver = clone(v1Bundle);
  notSemver.diagnostic_version = 'one';
  expectInvalid('a:not-semver', validateDiagnostic(notSemver), 'semver');

  // bad enum value (diagnostic_type)
  const badType = clone(pBundle);
  badType.diagnostic_type = 'partial';
  expectInvalid('a:bad-type', validateDiagnostic(badType), 'diagnostic_type');

  // bad enum value (engine)
  const badEngine = clone(v1Bundle);
  badEngine.engine = 'v3';
  expectInvalid('a:bad-engine', validateDiagnostic(badEngine), 'engine');

  // malformed stage entry (stage_3 missing)
  const malformedStage = clone(pBundle);
  delete malformedStage.pipeline.stages.stage_3_harmony;
  expectInvalid('a:malformed-stage', validateDiagnostic(malformedStage), 'stage_3_harmony');

  // malformed stage entry (realization not arrays)
  const badRealization = clone(pBundle);
  badRealization.pipeline.stages.stages_6_through_8_realization.lead = 'nope';
  expectInvalid('a:bad-realization', validateDiagnostic(badRealization), 'realization');

  // v1 bundle missing its v1 block
  const noV1 = clone(v1Bundle);
  delete noV1.v1;
  expectInvalid('a:missing-v1', validateDiagnostic(noV1), 'v1');

  // not an object
  expectInvalid('a:not-object', validateDiagnostic(null), 'object');

  // ===============================================================
  // b. STABLE SERIALIZE
  // ===============================================================
  const s1 = serializeDiagnostic(pBundle);
  const s2 = serializeDiagnostic(pBundle);
  if (s1 !== s2) fail('b:idempotent', 'serializing the same bundle twice gave different strings');
  const sShuffled = serializeDiagnostic(shuffleKeys(pBundle));
  if (s1 !== sShuffled) fail('b:key-order', 'a key-shuffled clone serialized differently — key order is leaking');
  if (!s1.endsWith('\n')) fail('b:newline', 'serialized output does not end with a trailing newline');
  if (!s1.includes('\n  "')) fail('b:indent', 'serialized output is not 2-space indented');
  // top-level key order: diagnostic_version must come before engine.
  if (s1.indexOf('"diagnostic_version"') > s1.indexOf('"engine"')) fail('b:priority', 'diagnostic_version should sort before engine');

  // ===============================================================
  // e. ROUND-TRIP — live bundle from a __mockResponse pipeline run, losslessly.
  // ===============================================================
  const base = CASES[0];
  // A valid wrapped texture plan tiling each section (Stage 5b mock); every other
  // upstream artifact is hand-supplied, so only Stage 5b "generates" (from the mock).
  const textureSections = {};
  for (const s of computeSectionPlan(base.macroParams)) {
    textureSections[s.label] = {
      harmony: [{ mode: 'parallel_thirds_below', bars: [1, s.bars] }],
      bass: [{ pattern: 'root_fifth', bars: [1, s.bars] }],
    };
  }
  let liveCapture = null;
  const liveJingle = await generateJingle({
    guestName: 'Live Guest',
    mood: base.mood,
    engine: 'pipeline',
    options: {
      macroParams: { ...base.macroParams, mood: base.mood },
      harmonicPlan: base.harmonicPlan,
      motifs: base.motifs,
      phrasePlan: base.phrasePlan,
      __mockResponse: JSON.stringify({ sections: textureSections }),
      onDiagnostic: (c) => { liveCapture = c; },
    },
  });
  if (!liveCapture) fail('e:capture', 'onDiagnostic never fired for the pipeline run');
  if (liveCapture && liveCapture.engine !== 'pipeline') fail('e:capture-engine', `live capture engine ${liveCapture.engine}`);
  const liveBundle = buildLiveDiagnostic({
    engine: 'pipeline',
    input: { guestName: 'Live Guest', mood: base.mood },
    output: liveJingle,
    captures: liveCapture ?? {},
  });
  if (liveBundle.diagnostic_type !== 'live') fail('e:type', `expected diagnostic_type live, got ${liveBundle.diagnostic_type}`);
  expectOk('e:validates', validateDiagnostic(liveBundle));
  // the Stage 5b raw response (the one stage that generated) is captured live.
  if (typeof liveBundle.pipeline?.stages?.stage_5b_texture?.raw_response_text !== 'string') {
    fail('e:live-raw', 'stage_5b raw_response_text should be the captured live mock response');
  }
  const serialized = serializeDiagnostic(liveBundle);
  const reparsed = JSON.parse(serialized);
  expectOk('e:reparsed-validates', validateDiagnostic(reparsed));
  if (serializeDiagnostic(reparsed) !== serialized) fail('e:round-trip', 'serialize → parse → serialize is not byte-identical');
})();

// =================================================================
// report
// =================================================================
if (failures.length > 0) {
  console.error(`verify-diagnostics FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  `verify-diagnostics PASSED — schema v${DIAGNOSTIC_SCHEMA_VERSION}: good pipeline + v1 bundles validate and every `
    + 'corruption is caught; serialize is byte-deterministic + key-order-stable; reconstruct (v1 + pipeline) produces '
    + 'clean bundles with prompts/trace/realization populated and C-replay tracks matching; a live mock run round-trips losslessly.'
);
