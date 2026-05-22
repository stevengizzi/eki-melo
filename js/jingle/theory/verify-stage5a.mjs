/* =================================================================
   VERIFY-STAGE5A — exit-criterion check for phrase structure + motif placement,
   the second LLM stage (buildplan Session 9). RUNS FULLY OFFLINE — no live API
   calls. Stage 5a is exercised through its `__mockResponse` deterministic-
   fallback path; the end-to-end run drives Stage 5b through ITS mock too.

   It confirms:
     a. validatePhrasePlan — a valid wrapped PhrasePlan returns { ok:true,
        errors:[] }, and EACH documented defect returns { ok:false } with a clear,
        retry-actionable message: unknown motif, unknown transform, a B (contrast)
        section with no non-literal development, a reprise that drops its source
        motif, adjacent-identical assignments, an overlap, plus the schema rules
        (missing section, extra section, bad phrase_structure, out-of-range
        start_bar, bad length_bars, envelope shape). A motif leading INTO a
        cadenced final bar is now VALID (Stage 8 enforces only the final two
        beats), not a defect.
     b. generatePhrasePlan(__mockResponse) — a VALID mock parses + validates and
        returns the FLAT §3 plan (keys = section labels, no `sections` wrapper).
        Threaded through runPipelineGenerating (with Stage 5b ALSO mocked) it runs
        end-to-end (Stage 5a → 5b → 6 → 7 → 8 → toSynthString) to a FinalJingle
        whose every pitch parses through the real synth.js noteToFreq. A malformed
        mock (bad JSON) throws; a semantically-invalid mock throws on validation.
     c. buildPhrasePlanPrompt is a pure { system, user } builder naming the section
        labels, the phrase-structure + transform vocabularies, and the active
        adventurousness directive.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts
   (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage5a.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import {
  validatePhrasePlan,
  generatePhrasePlan,
  buildPhrasePlanPrompt,
} from '../pipeline/stage-5a-phrase.js';
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
// a. validatePhrasePlan — valid plan + each documented defect
//    (D dorian ternary: A = exposition, B = contrast, A' = reprise of A)
// =================================================================

const MACRO = {
  tempo: 120,
  meter: { numerator: 4, denominator: 4, grouping: [4] },
  tonic: 'D',
  mode: 'dorian',
  form: 'ternary',
  total_bars: 12,
  register_center: 'D5',
  harmonic_rhythm: [1, 1, 1, 1],
  sections: [
    { label: 'A', bars: 4 },
    { label: 'B', bars: 4 },
    { label: "A'", bars: 4 },
  ],
};

const MOTIFS = {
  a: { degrees: [1, 2, 3, 5, 3, 2], rhythm: [0.5, 0.5, 0.5, 1, 0.5, 1], contour: 'rising_arc', register: 'mid', anomaly: null },
  b: { degrees: [5, 7, 8, 7, 5], rhythm: [0.5, 0.5, 1, 0.5, 1.5], contour: 'peak_descend', register: 'high', anomaly: null },
};

const HARMONIC = {
  sections: [
    { label: 'A', progression: ['i', 'VII', 'IV', 'i'], cadence: 'modal_iv_i', anomaly: null },
    { label: 'B', progression: ['v', 'IV', 'VII', 'IV'], cadence: 'plagal', anomaly: null },
    { label: "A'", progression: ['i', 'IV', 'VII', 'i'], cadence: 'modal_iv_i', anomaly: null },
  ],
};

// A valid wrapped PhrasePlan: A states + sequences motif a (cadential final bar);
// B develops motif b with invert + retrograde (the contrast rule); A' brings back
// motif a (the reprise rule); no adjacent identicals; no overlaps.
const VALID = {
  sections: {
    A: {
      phrase_structure: 'period',
      lead: [
        { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
        { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
        { motif: 'a', transform: 'fragment_tail', start_bar: 3, length_bars: 1 },
        { motif: null, transform: 'cadential_gesture', start_bar: 4, length_bars: 1 },
      ],
    },
    B: {
      phrase_structure: 'sentence',
      lead: [
        { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
        { motif: 'b', transform: 'invert', start_bar: 2, length_bars: 1 },
        { motif: 'b', transform: 'retrograde', start_bar: 3, length_bars: 1 },
        { motif: null, transform: 'cadential_gesture', start_bar: 4, length_bars: 1 },
      ],
    },
    "A'": {
      phrase_structure: 'period',
      lead: [
        { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
        { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
        { motif: 'a', transform: { name: 'ornament_lower_neighbor', params: {} }, start_bar: 3, length_bars: 1 },
        { motif: null, transform: 'cadential_gesture', start_bar: 4, length_bars: 1 },
      ],
    },
  },
};

expectOk('a:valid', validatePhrasePlan(VALID, MACRO, MOTIFS));

// unknown motif
const badMotif = clone(VALID);
badMotif.sections.A.lead[0].motif = 'z';
expectInvalid('a:unknown-motif', validatePhrasePlan(badMotif, MACRO, MOTIFS), 'known motif');

// unknown transform
const badTransform = clone(VALID);
badTransform.sections.A.lead[1].transform = 'nope_transform';
expectInvalid('a:unknown-transform', validatePhrasePlan(badTransform, MACRO, MOTIFS), 'unknown transform');

// B (contrast) section with no non-literal development (all literal, no adjacency)
const noDev = clone(VALID);
noDev.sections.B.lead = [
  { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
  { motif: 'b', transform: 'literal', start_bar: 2, length_bars: 1 },
  { motif: 'a', transform: 'literal', start_bar: 3, length_bars: 1 },
  { motif: null, transform: 'cadential_gesture', start_bar: 4, length_bars: 1 },
];
expectInvalid('a:b-no-development', validatePhrasePlan(noDev, MACRO, MOTIFS), 'non-literal motivic development');

// reprise (A') that drops its source motif (uses only b, never a)
const lostMotif = clone(VALID);
lostMotif.sections["A'"].lead = [
  { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
  { motif: 'b', transform: 'invert', start_bar: 2, length_bars: 1 },
  { motif: 'b', transform: 'retrograde', start_bar: 3, length_bars: 1 },
  { motif: null, transform: 'cadential_gesture', start_bar: 4, length_bars: 1 },
];
expectInvalid('a:reprise-lost-motif', validatePhrasePlan(lostMotif, MACRO, MOTIFS), 'reprise');

// adjacent identical { motif, transform } pair
const adjacent = clone(VALID);
adjacent.sections.A.lead = [
  { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
  { motif: 'a', transform: 'literal', start_bar: 2, length_bars: 1 },
  { motif: 'a', transform: 'fragment_tail', start_bar: 3, length_bars: 1 },
  { motif: null, transform: 'cadential_gesture', start_bar: 4, length_bars: 1 },
];
expectInvalid('a:adjacent-identical', validatePhrasePlan(adjacent, MACRO, MOTIFS), 'adjacent identical');

// overlap (bar 1 spans 2 bars, bar 2 assignment starts inside it)
const overlap = clone(VALID);
overlap.sections.A.lead[0] = { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 2 };
overlap.sections.A.lead[1] = { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 };
expectInvalid('a:overlap', validatePhrasePlan(overlap, MACRO, MOTIFS), 'overlap');

// a motif leading INTO the cadence on a cadenced final bar is now VALID (Stage 8
// enforces only the final two beats, so the motif's lead-in survives) — not a
// defect. (Before the cadence-manifestation revision this was rejected.)
const leadIntoCadence = clone(VALID);
leadIntoCadence.sections.A.lead[3] = { motif: 'a', transform: 'ornament_upper_neighbor', start_bar: 4, length_bars: 1 };
expectOk('a:motif-leads-into-cadence', validatePhrasePlan(leadIntoCadence, MACRO, MOTIFS));

// schema: missing section
const missing = clone(VALID);
delete missing.sections["A'"];
expectInvalid('a:missing-section', validatePhrasePlan(missing, MACRO, MOTIFS), 'missing section');

// schema: extra section
const extra = clone(VALID);
extra.sections.C = { phrase_structure: 'period', lead: [{ motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 }] };
expectInvalid('a:extra-section', validatePhrasePlan(extra, MACRO, MOTIFS), 'unexpected section');

// schema: bad phrase_structure
const badStructure = clone(VALID);
badStructure.sections.A.phrase_structure = 'verse';
expectInvalid('a:bad-structure', validatePhrasePlan(badStructure, MACRO, MOTIFS), 'phrase_structure');

// schema: start_bar out of range
const badStart = clone(VALID);
badStart.sections.A.lead[0].start_bar = 9;
expectInvalid('a:bad-start', validatePhrasePlan(badStart, MACRO, MOTIFS), 'out of range');

// schema: length_bars invalid
const badLength = clone(VALID);
badLength.sections.A.lead[0].length_bars = 0;
expectInvalid('a:bad-length', validatePhrasePlan(badLength, MACRO, MOTIFS), 'length_bars');

// envelope shape errors
expectInvalid('a:not-object', validatePhrasePlan(null, MACRO, MOTIFS), 'object');
expectInvalid('a:no-sections', validatePhrasePlan({ A: {} }, MACRO, MOTIFS), 'sections');

// =================================================================
// c. buildPhrasePlanPrompt — pure { system, user }, names labels + vocab
// =================================================================

const prompt = buildPhrasePlanPrompt({
  macroParams: MACRO,
  motifs: MOTIFS,
  harmonicPlan: HARMONIC,
  config: { knobs: { phrase_adventurousness: 'wild' } },
});
if (typeof prompt.system !== 'string' || prompt.system.length === 0) fail('c:system', 'system prompt missing');
for (const needle of ['"A"', '"B"', "\"A'\"", 'period', 'sentence', 'retrograde', 'cadential_gesture', 'wild', 'sections']) {
  if (!prompt.user.includes(needle)) fail('c:user', `user prompt does not mention ${needle}`);
}

// =================================================================
// b. generatePhrasePlan(__mockResponse) — offline parse/validate + e2e
// =================================================================

// A valid WRAPPED TexturePlan that tiles every section (so Stage 5b's mock path
// is satisfied for the end-to-end run).
function buildValidWrappedTexture(macroParams) {
  const sections = {};
  for (const s of computeSectionPlan(macroParams)) {
    sections[s.label] = {
      harmony: [{ mode: 'parallel_thirds_below', bars: [1, s.bars] }],
      bass: [{ pattern: 'root_fifth', bars: [1, s.bars] }],
    };
  }
  return { sections };
}

const wanderer = GENERATED_CASES.find((c) => c.id === 'wanderer-fully-generated');
if (!wanderer) {
  fail('b:setup', 'GENERATED_CASES is missing wanderer-fully-generated');
} else {
  if (wanderer.phrasePlan !== undefined) fail('b:setup', 'wanderer-fully-generated should OMIT phrasePlan');
  if (wanderer.texturePlan !== undefined) fail('b:setup', 'wanderer-fully-generated should OMIT texturePlan');

  const expectedLabels = computeSectionPlan(wanderer.macroParams).map((s) => s.label);
  const validPhraseMock = JSON.stringify(VALID);
  const validTextureMock = JSON.stringify(buildValidWrappedTexture(wanderer.macroParams));

  // (b1) valid phrase mock → flat plan (keys = labels, no `sections` wrapper).
  const flat = await generatePhrasePlan({ ...wanderer, __mockResponse: validPhraseMock });
  if (flat.sections !== undefined) fail('b1:flat', 'returned plan still has a `sections` wrapper — should be flat');
  if (JSON.stringify(Object.keys(flat).sort()) !== JSON.stringify([...expectedLabels].sort())) {
    fail('b1:keys', `flat plan keys ${JSON.stringify(Object.keys(flat))} != section labels ${JSON.stringify(expectedLabels)}`);
  }

  // (b2) valid phrase + texture mocks threaded through the runner → end-to-end
  //      FinalJingle. Both LLM stages run via their offline mock; no network.
  let jingle;
  try {
    jingle = await runPipelineGenerating({
      ...wanderer,
      __mockPhraseResponse: validPhraseMock,
      __mockResponse: validTextureMock,
    });
  } catch (error) {
    fail('b2:e2e', `runPipelineGenerating threw on valid mocks: ${error.message}`);
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

  // (b3) malformed phrase mock (not JSON) → throws.
  await expectThrows('b3:bad-json', () => generatePhrasePlan({ ...wanderer, __mockResponse: 'this is not json {{{' }));

  // (b4) semantically invalid phrase mock (B contrast with no development) → throws.
  const semNoDev = clone(VALID);
  semNoDev.sections.B.lead = [
    { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
    { motif: 'a', transform: 'literal', start_bar: 2, length_bars: 1 },
    { motif: 'b', transform: 'literal', start_bar: 3, length_bars: 1 },
    { motif: null, transform: 'cadential_gesture', start_bar: 4, length_bars: 1 },
  ];
  await expectThrows('b4:no-dev', () => generatePhrasePlan({ ...wanderer, __mockResponse: JSON.stringify(semNoDev) }));

  // (b5) semantically invalid phrase mock (unknown transform) → throws.
  const semBadTransform = clone(VALID);
  semBadTransform.sections.A.lead[1].transform = 'no_such_transform';
  await expectThrows('b5:bad-transform', () => generatePhrasePlan({ ...wanderer, __mockResponse: JSON.stringify(semBadTransform) }));
}

// Sanity: hand-supplied CASES still carry BOTH a phrasePlan and a texturePlan
// (the prior verifiers depend on this; a stray edit to the data module surfaces here).
for (const c of CASES) {
  if (!c.phrasePlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its phrasePlan`);
  if (!c.texturePlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its texturePlan`);
}

// =================================================================
// report
// =================================================================
if (failures.length > 0) {
  console.error(`verify-stage5a FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  'verify-stage5a PASSED — validatePhrasePlan catches every documented defect '
    + '(unknown motif/transform, B-section development, reprise motif, adjacency, overlap, cadence-bar, schema); '
    + 'generatePhrasePlan(__mockResponse) parses/validates offline, returns the flat plan, '
    + 'runs end-to-end through the pipeline (Stage 5b also mocked), and throws on malformed/invalid mocks.'
);
