/* =================================================================
   VERIFY-STAGE5B — exit-criterion check for texture choreography, the first LLM
   stage (buildplan Session 8). RUNS FULLY OFFLINE — no live API calls. Stage 5b
   is exercised through its `__mockResponse` deterministic-fallback path.

   It confirms:
     a. validateTexturePlan — a valid wrapped TexturePlan returns { ok:true,
        errors:[] }, and EACH documented defect (unknown texture, unknown bass
        pattern, out-of-range bars, missing section, extra section, coverage gap,
        coverage overlap, non-object params) returns { ok:false } with a clear
        message.
     b. generateTexturePlan(__mockResponse) — a VALID mock parses + validates and,
        threaded through runPipelineGenerating, runs end-to-end (Stage 6 → 7 → 8 →
        toSynthString) to a FinalJingle whose every pitch parses through the real
        synth.js noteToFreq. A MALFORMED mock (bad JSON) throws. A semantically
        invalid mock (unknown texture name) throws on validation. The returned
        plan is the FLAT §3 shape (keys = section labels, no `sections` wrapper).
     c. buildTexturePlanPrompt is a pure { system, user } builder naming the
        section labels and the strict vocabularies.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts
   (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage5b.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import {
  validateTexturePlan,
  generateTexturePlan,
  buildTexturePlanPrompt,
} from '../pipeline/stage-5b-texture.js';
import { runPipelineGenerating } from '../pipeline/pipeline-runner.js';
import { computeSectionPlan } from '../pipeline/stage-6-voice.js';
import { noteToFreq } from '../synth.js';
import { CASES, GENERATED_CASES } from '../debug/pipeline-inspector-cases.js';

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);
const clone = (value) => JSON.parse(JSON.stringify(value));

const expectOk = (scope, result) => {
  if (!result.ok) fail(scope, `expected ok:true, got errors: ${JSON.stringify(result.errors)}`);
  if (result.errors.length !== 0) fail(scope, `expected empty errors, got ${JSON.stringify(result.errors)}`);
};
// An invalid plan: ok must be false AND at least one error message must mention
// `keyword` (so we know the RIGHT defect was caught, not some incidental one).
const expectInvalid = (scope, result, keyword) => {
  if (result.ok) {
    fail(scope, 'expected ok:false, got ok:true');
    return;
  }
  if (result.errors.length === 0) fail(scope, 'expected at least one error message, got none');
  if (keyword && !result.errors.some((e) => e.toLowerCase().includes(keyword.toLowerCase()))) {
    fail(scope, `no error mentioned "${keyword}". Errors: ${JSON.stringify(result.errors)}`);
  }
};
const expectThrows = async (scope, thunk) => {
  try {
    await thunk();
    fail(scope, 'expected a throw/rejection, but it resolved');
  } catch {
    /* expected */
  }
};

// =================================================================
// a. validateTexturePlan — valid plan + each documented defect
// =================================================================

const MACRO = {
  tempo: 120,
  meter: { numerator: 4, denominator: 4, grouping: [4] },
  tonic: 'C',
  mode: 'major',
  form: 'binary',
  total_bars: 4,
  register_center: 'C5',
  sections: [
    { label: 'A', bars: 2 },
    { label: 'B', bars: 2 },
  ],
};

const VALID = {
  sections: {
    A: {
      harmony: [{ mode: 'parallel_thirds_below', bars: [1, 2] }],
      bass: [{ pattern: 'root_fifth', bars: [1, 2] }],
    },
    B: {
      harmony: [
        { mode: 'oblique_held', bars: [1, 1], params: { degree: 5 } },
        { mode: 'drone_on_5', bars: [2, 2] },
      ],
      bass: [{ pattern: 'pedal', bars: [1, 2], params: { degree: 1 } }],
    },
  },
};

expectOk('a:valid', validateTexturePlan(VALID, MACRO));

// unknown harmony texture
const badTexture = clone(VALID);
badTexture.sections.A.harmony[0].mode = 'nope_texture';
expectInvalid('a:unknown-texture', validateTexturePlan(badTexture, MACRO), 'unknown harmony texture');

// unknown bass pattern
const badBass = clone(VALID);
badBass.sections.A.bass[0].pattern = 'nope_bass';
expectInvalid('a:unknown-bass', validateTexturePlan(badBass, MACRO), 'unknown bass pattern');

// out-of-range bars (section A has 2 bars; [1,5] exceeds it)
const badRange = clone(VALID);
badRange.sections.A.harmony[0].bars = [1, 5];
expectInvalid('a:out-of-range', validateTexturePlan(badRange, MACRO), 'out of range');

// missing section
const missing = clone(VALID);
delete missing.sections.B;
expectInvalid('a:missing-section', validateTexturePlan(missing, MACRO), 'missing section');

// extra section
const extra = clone(VALID);
extra.sections.C = { harmony: [{ mode: 'dropout', bars: [1, 2] }], bass: [{ pattern: 'pedal', bars: [1, 2] }] };
expectInvalid('a:extra-section', validateTexturePlan(extra, MACRO), 'unexpected section');

// coverage gap (A covers only bar 1, leaving bar 2 uncovered)
const gap = clone(VALID);
gap.sections.A.harmony = [{ mode: 'parallel_thirds_below', bars: [1, 1] }];
expectInvalid('a:gap', validateTexturePlan(gap, MACRO), 'gap');

// coverage overlap (B's two harmony ranges both cover bar 2... make them overlap)
const overlap = clone(VALID);
overlap.sections.B.harmony = [
  { mode: 'oblique_held', bars: [1, 2] },
  { mode: 'drone_on_5', bars: [2, 2] },
];
expectInvalid('a:overlap', validateTexturePlan(overlap, MACRO), 'overlap');

// non-object params
const badParams = clone(VALID);
badParams.sections.A.harmony[0].params = 'not-an-object';
expectInvalid('a:bad-params', validateTexturePlan(badParams, MACRO), 'params');

// envelope shape errors
expectInvalid('a:not-object', validateTexturePlan(null, MACRO), 'object');
expectInvalid('a:no-sections', validateTexturePlan({ A: {} }, MACRO), 'sections');

// =================================================================
// c. buildTexturePlanPrompt — pure { system, user }, names labels + vocab
// =================================================================

const prompt = buildTexturePlanPrompt({
  macroParams: MACRO,
  motifs: { a: { degrees: [1, 3, 5], rhythm: [1, 1, 1], contour: 'rising_arc', register: 'mid', anomaly: null } },
  harmonicPlan: { sections: [{ label: 'A', progression: ['I', 'V'], cadence: 'half' }, { label: 'B', progression: ['IV', 'I'], cadence: 'PAC' }] },
  phrasePlan: { A: { phrase_structure: 'period', lead: [{ motif: 'a', transform: 'literal', start_bar: 1, length_bars: 2 }] } },
  config: { knobs: { texture_adventurousness: 'wild' } },
});
if (typeof prompt.system !== 'string' || prompt.system.length === 0) fail('c:system', 'system prompt missing');
for (const needle of ['"A"', '"B"', 'parallel_thirds_below', 'root_fifth', 'wild', 'sections']) {
  if (!prompt.user.includes(needle)) fail('c:user', `user prompt does not mention ${needle}`);
}

// =================================================================
// b. generateTexturePlan(__mockResponse) — offline parse/validate + e2e
// =================================================================

// Build a valid WRAPPED plan that tiles every section of `macroParams`.
function buildValidWrapped(macroParams) {
  const sections = {};
  for (const s of computeSectionPlan(macroParams)) {
    sections[s.label] = {
      harmony: [{ mode: 'parallel_thirds_below', bars: [1, s.bars] }],
      bass: [{ pattern: 'root_fifth', bars: [1, s.bars] }],
    };
  }
  return { sections };
}

const sunrise = GENERATED_CASES.find((c) => c.id === 'sunrise-generated');
if (!sunrise) {
  fail('b:setup', 'GENERATED_CASES is missing sunrise-generated');
} else {
  const expectedLabels = computeSectionPlan(sunrise.macroParams).map((s) => s.label);
  const validMock = JSON.stringify(buildValidWrapped(sunrise.macroParams));

  // (b1) valid mock → flat plan (keys = labels, no `sections` wrapper).
  const flat = await generateTexturePlan({ ...sunrise, __mockResponse: validMock });
  if (flat.sections !== undefined) fail('b1:flat', 'returned plan still has a `sections` wrapper — should be flat');
  if (JSON.stringify(Object.keys(flat).sort()) !== JSON.stringify([...expectedLabels].sort())) {
    fail('b1:keys', `flat plan keys ${JSON.stringify(Object.keys(flat))} != section labels ${JSON.stringify(expectedLabels)}`);
  }

  // (b2) valid mock threaded through the runner → end-to-end FinalJingle.
  let jingle;
  try {
    jingle = await runPipelineGenerating({ ...sunrise, __mockResponse: validMock });
  } catch (error) {
    fail('b2:e2e', `runPipelineGenerating threw on a valid mock: ${error.message}`);
  }
  if (jingle) {
    const lengths = ['lead', 'harmony', 'bass'].map((voice) => {
      let length = 0;
      jingle[voice].forEach(([note, duration], i) => {
        length += duration;
        if (!(typeof duration === 'number' && duration > 0)) {
          fail(`b2:${voice}`, `event ${i} duration not positive: ${duration}`);
        }
        if (note !== 'rest') {
          const freq = noteToFreq(note);
          if (!Number.isFinite(freq) || freq <= 0) fail(`b2:${voice}`, `event ${i} "${note}" → bad freq ${freq}`);
        }
      });
      return length;
    });
    if (Math.max(...lengths) - Math.min(...lengths) > 1e-6) {
      fail('b2:align', `track beat-lengths disagree: ${JSON.stringify(lengths)}`);
    }
  }

  // (b3) malformed mock (not JSON) → throws.
  await expectThrows('b3:bad-json', () => generateTexturePlan({ ...sunrise, __mockResponse: 'this is not json {{{' }));

  // (b4) semantically invalid mock (unknown texture name) → throws on validation.
  const semInvalid = buildValidWrapped(sunrise.macroParams);
  semInvalid.sections[expectedLabels[0]].harmony[0].mode = 'no_such_texture';
  await expectThrows('b4:bad-texture', () => generateTexturePlan({ ...sunrise, __mockResponse: JSON.stringify(semInvalid) }));

  // (b5) a missing-section mock → throws on validation too.
  const semMissing = buildValidWrapped(sunrise.macroParams);
  delete semMissing.sections[expectedLabels[expectedLabels.length - 1]];
  await expectThrows('b5:missing-section', () => generateTexturePlan({ ...sunrise, __mockResponse: JSON.stringify(semMissing) }));
}

// Sanity: hand-supplied CASES still carry a texturePlan (the prior verifiers
// depend on this; a stray edit to the data module would surface here).
for (const c of CASES) {
  if (!c.texturePlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its texturePlan`);
}

// =================================================================
// report
// =================================================================
if (failures.length > 0) {
  console.error(`verify-stage5b FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  'verify-stage5b PASSED — validateTexturePlan catches every documented defect; '
    + 'generateTexturePlan(__mockResponse) parses/validates offline, returns the flat plan, '
    + 'runs end-to-end through the pipeline, and throws on malformed/invalid mocks.'
);
