/* =================================================================
   VERIFY-STAGE4 — exit-criterion check for motivic material, the THIRD LLM
   stage (buildplan Session 10). RUNS FULLY OFFLINE — no live API calls. Stage 4
   is exercised through its `__mockResponse` deterministic-fallback path; the
   end-to-end run drives Stages 5a + 5b through THEIR mocks too.

   It confirms:
     a. validateMotifs — a valid wrapped motifs object returns { ok:true,
        errors:[] }, and EACH documented defect returns { ok:false } with a
        clear, retry-actionable message: wrong key set (missing / extra motif),
        out-of-range degree, non-integer degree, too few / too many degrees,
        rhythm length mismatch, rhythm sum out of range (both ends), non-positive
        rhythm, bad contour value, contour inconsistent with the trajectory, bad
        register, anomaly type/at_position out of range, missing anomaly field,
        distinctness violation (two identical motifs), and the envelope shape.
     b. generateMotifs(__mockResponse) — a VALID mock parses + validates and
        returns the FLAT §3 map (keys = motif letters, no `motifs` wrapper).
        Threaded through runPipelineGenerating (Stages 5a + 5b ALSO mocked) it
        runs end-to-end (Stage 4 → 5a → 5b → 6 → 7 → 8 → toSynthString) to a
        FinalJingle whose every pitch parses through the real synth.js noteToFreq.
        A malformed mock (bad JSON) throws; a semantically-invalid mock throws on
        validation. The soft end-on-chord-tone check emits a warning (via onTrace)
        WITHOUT failing.
     c. buildMotifsPrompt is a pure { system, user } builder naming the required
        motif keys, the shape + anomaly vocabularies, the seed exemplars, the
        compositional guidance, and the active adventurousness directive.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts
   (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage4.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import {
  validateMotifs,
  generateMotifs,
  buildMotifsPrompt,
} from '../pipeline/stage-4-motifs.js';
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
// An invalid object: ok must be false AND at least one error message must mention
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
// Fixtures — a self-contained C major AABA piece (requires motifs a + b),
// independent of the inspector cases' lengths.
// =================================================================

const MACRO = {
  tempo: 132,
  meter: { numerator: 4, denominator: 4, grouping: [4] },
  tonic: 'C',
  mode: 'major',
  form: 'AABA',
  total_bars: 8,
  register_center: 'C5',
  harmonic_rhythm: [1, 1, 1, 1],
  mood: 'triumphant',
  sections: [
    { label: 'A1', bars: 2 },
    { label: 'A2', bars: 2 },
    { label: 'B', bars: 2 },
    { label: 'A3', bars: 2 },
  ],
};

const HARMONIC = {
  sections: [
    { label: 'A1', progression: ['I', 'V', 'vi', 'IV'], cadence: 'IAC', anomaly: null },
    { label: 'A2', progression: ['I', 'V', 'vi', 'IV'], cadence: 'deceptive', anomaly: null },
    { label: 'B', progression: ['IV', 'I', 'ii', 'V'], cadence: 'half', anomaly: null },
    { label: 'A3', progression: ['I', 'IV', 'V', 'I'], cadence: 'PAC', anomaly: null },
  ],
};

// A valid wrapped motifs object: a peak_descend ending on degree 1 (chord tone of
// A1's I); b a falling_arc ending on degree 1 (chord tone of B's IV). Both sums
// are within [1.5, 3.5], degrees in [1,7], contours consistent, distinct.
const VALID = {
  motifs: {
    a: { degrees: [1, 3, 5, 4, 3, 1], rhythm: [0.5, 0.5, 1, 0.5, 0.5, 0.5], contour: 'peak_descend', register: 'mid', anomaly: null },
    b: { degrees: [5, 4, 3, 1], rhythm: [0.5, 0.5, 1, 0.5], contour: 'falling_arc', register: 'mid', anomaly: null },
  },
};

// --- valid ---
expectOk('a:valid', validateMotifs(VALID, MACRO));

// A valid motif WITH an anomaly (chromatic_neighbor) also passes.
const withAnomaly = clone(VALID);
withAnomaly.motifs.a.anomaly = { type: 'chromatic_neighbor', at_position: 2 };
expectOk('a:valid-anomaly', validateMotifs(withAnomaly, MACRO));

// --- key set ---
const missing = clone(VALID);
delete missing.motifs.b;
expectInvalid('a:missing-motif', validateMotifs(missing, MACRO), 'missing motif');

const extra = clone(VALID);
extra.motifs.c = clone(VALID.motifs.b);
extra.motifs.c.degrees = [1, 2, 3, 4]; // distinct, so only the extra-key rule fires
expectInvalid('a:extra-motif', validateMotifs(extra, MACRO), 'unexpected motif');

// --- degrees ---
const outOfRange = clone(VALID);
outOfRange.motifs.a.degrees = [1, 3, 9, 4, 3, 1];
expectInvalid('a:degree-out-of-range', validateMotifs(outOfRange, MACRO), '[1, 7]');

const nonInteger = clone(VALID);
nonInteger.motifs.a.degrees = [1, 3, 2.5, 4, 3, 1];
expectInvalid('a:degree-non-integer', validateMotifs(nonInteger, MACRO), '[1, 7]');

const tooFew = clone(VALID);
tooFew.motifs.a.degrees = [1, 3, 5];
tooFew.motifs.a.rhythm = [1, 1, 1];
expectInvalid('a:too-few-degrees', validateMotifs(tooFew, MACRO), '4');

const tooMany = clone(VALID);
tooMany.motifs.a.degrees = [1, 2, 3, 4, 5, 6, 7, 6, 5];
tooMany.motifs.a.rhythm = [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25];
expectInvalid('a:too-many-degrees', validateMotifs(tooMany, MACRO), '8');

// --- rhythm ---
const rhythmLenMismatch = clone(VALID);
rhythmLenMismatch.motifs.a.rhythm = [0.5, 0.5];
expectInvalid('a:rhythm-length', validateMotifs(rhythmLenMismatch, MACRO), 'length');

const rhythmTooLong = clone(VALID);
rhythmTooLong.motifs.a.rhythm = [1, 1, 1, 0.5, 0.5, 0.5]; // sum 4.5
expectInvalid('a:rhythm-sum-high', validateMotifs(rhythmTooLong, MACRO), 'between 1.5 and 3.5');

const rhythmTooShort = clone(VALID);
rhythmTooShort.motifs.a.rhythm = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2]; // sum 1.2
expectInvalid('a:rhythm-sum-low', validateMotifs(rhythmTooShort, MACRO), 'between 1.5 and 3.5');

const rhythmNonPositive = clone(VALID);
rhythmNonPositive.motifs.a.rhythm = [0.5, 0, 1, 0.5, 0.5, 0.5];
expectInvalid('a:rhythm-non-positive', validateMotifs(rhythmNonPositive, MACRO), 'positive');

// --- contour ---
const badContourValue = clone(VALID);
badContourValue.motifs.a.contour = 'zigzag';
expectInvalid('a:bad-contour-value', validateMotifs(badContourValue, MACRO), 'not one of');

// a = [1,3,5,4,3,1] ends equal to its start → cannot be rising_arc (must net-rise)
const contourMismatch = clone(VALID);
contourMismatch.motifs.a.contour = 'rising_arc';
expectInvalid('a:contour-mismatch', validateMotifs(contourMismatch, MACRO), 'rising_arc');

// b = [5,4,3,1] labeled peak_descend → its max (5) is at index 0, not interior
const contourPeakMismatch = clone(VALID);
contourPeakMismatch.motifs.b.contour = 'peak_descend';
expectInvalid('a:contour-peak-mismatch', validateMotifs(contourPeakMismatch, MACRO), 'peak_descend');

// --- register ---
const badRegister = clone(VALID);
badRegister.motifs.a.register = 'middle';
expectInvalid('a:bad-register', validateMotifs(badRegister, MACRO), 'register');

// --- anomaly ---
const anomalyPosOOR = clone(VALID);
anomalyPosOOR.motifs.a.anomaly = { type: 'chromatic_neighbor', at_position: 99 };
expectInvalid('a:anomaly-pos-out-of-range', validateMotifs(anomalyPosOOR, MACRO), 'at_position');

const anomalyBadType = clone(VALID);
anomalyBadType.motifs.a.anomaly = { type: 'wrong_kind', at_position: 1 };
expectInvalid('a:anomaly-bad-type', validateMotifs(anomalyBadType, MACRO), 'anomaly.type');

const anomalyMissing = clone(VALID);
delete anomalyMissing.motifs.a.anomaly;
expectInvalid('a:anomaly-missing', validateMotifs(anomalyMissing, MACRO), 'anomaly');

// --- anomaly honesty: a declared anomaly must be a REAL event ---
// a = [1,3,5,4,3]; position 2 (degree 5) sits between 3 and 4 — no real leap.
const fakeLeap = clone(VALID);
fakeLeap.motifs.a.anomaly = { type: 'large_leap', at_position: 2 };
expectInvalid('a:fake-large-leap', validateMotifs(fakeLeap, MACRO), 'large_leap');

// A genuine seventh (1 -> 7) at position 1 IS a large_leap.
const realLeap = clone(VALID);
realLeap.motifs.a.degrees = [1, 7, 5, 3, 1];
realLeap.motifs.a.rhythm = [0.5, 0.5, 1, 0.5, 0.5];
realLeap.motifs.a.contour = 'peak_descend';
realLeap.motifs.a.anomaly = { type: 'large_leap', at_position: 1 };
expectOk('a:real-large-leap', validateMotifs(realLeap, MACRO));

// a's rhythm [0.5,0.5,1,0.5,0.5]: position 2 starts at beat 1.0 (on the beat) — not displaced.
const fakeDisplacement = clone(VALID);
fakeDisplacement.motifs.a.anomaly = { type: 'rhythmic_displacement', at_position: 2 };
expectInvalid('a:fake-rhythmic-displacement', validateMotifs(fakeDisplacement, MACRO), 'rhythmic_displacement');

// position 1 starts at beat 0.5 (off the beat) — a real displacement.
const realDisplacement = clone(VALID);
realDisplacement.motifs.a.anomaly = { type: 'rhythmic_displacement', at_position: 1 };
expectOk('a:real-rhythmic-displacement', validateMotifs(realDisplacement, MACRO));

// --- distinctness (2+ motifs identical in degrees/rhythm/contour) ---
const dup = clone(VALID);
dup.motifs.b = clone(VALID.motifs.a);
expectInvalid('a:distinctness', validateMotifs(dup, MACRO), 'identical');

// --- envelope shape ---
expectInvalid('a:not-object', validateMotifs(null, MACRO), 'object');
expectInvalid('a:no-motifs', validateMotifs({ a: {} }, MACRO), 'motifs');

// =================================================================
// c. buildMotifsPrompt — pure { system, user }, names keys + vocab + exemplars
// =================================================================

const prompt = buildMotifsPrompt({
  macroParams: MACRO,
  harmonicPlan: HARMONIC,
  config: { knobs: { motif_adventurousness: 'wild' } },
});
if (typeof prompt.system !== 'string' || prompt.system.length === 0) fail('c:system', 'system prompt missing');
for (const needle of [
  '"a"', '"b"',                                  // required keys
  'rising_arc', 'peak_descend', 'wandering',     // shape vocabulary
  'chromatic_neighbor', 'rhythmic_displacement', // anomaly vocabulary
  'bright_arpeggio', 'byzantine_flourish',       // seed exemplars
  'at_position',                                 // the anomaly key the realizer reads
  'COMPOSITIONAL GUIDANCE',                       // the explicit coaching block
  'wild',                                        // active adventurousness directive
  '1.5', '3.5',                                  // the rhythm-sum window
  'triumphant',                                  // the mood signal
]) {
  if (!prompt.user.includes(needle)) fail('c:user', `user prompt does not mention ${needle}`);
}

// =================================================================
// b. generateMotifs(__mockResponse) — offline parse/validate + e2e
// =================================================================

// Valid WRAPPED phrase + texture mocks so Stages 5a/5b satisfy their mock path
// for the end-to-end run. The phrase mock honors the AABA development rules:
// B (contrast) develops via invert; A3 (reprise of A1) brings back motif a.
const validPhraseMock = JSON.stringify({
  sections: {
    A1: {
      phrase_structure: 'period',
      lead: [
        { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
        { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
      ],
    },
    A2: {
      phrase_structure: 'period',
      lead: [
        { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
        { motif: 'a', transform: { name: 'transpose_third', params: { direction: 'up' } }, start_bar: 2, length_bars: 1 },
      ],
    },
    B: {
      phrase_structure: 'period',
      lead: [
        { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
        { motif: 'b', transform: 'invert', start_bar: 2, length_bars: 1 },
      ],
    },
    A3: {
      phrase_structure: 'period',
      lead: [
        { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
        { motif: 'a', transform: 'retrograde', start_bar: 2, length_bars: 1 },
      ],
    },
  },
});

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
const validTextureMock = JSON.stringify(buildValidWrappedTexture(MACRO));
const validMotifMock = JSON.stringify(VALID);
const expectedLetters = ['a', 'b'];

// The fully-LLM case must exist and omit motifs + phrasePlan + texturePlan.
const sunriseFullyLLM = GENERATED_CASES.find((c) => c.id === 'sunrise-fully-llm');
if (!sunriseFullyLLM) {
  fail('b:setup', 'GENERATED_CASES is missing sunrise-fully-llm');
} else {
  if (sunriseFullyLLM.motifs !== undefined) fail('b:setup', 'sunrise-fully-llm should OMIT motifs');
  if (sunriseFullyLLM.phrasePlan !== undefined) fail('b:setup', 'sunrise-fully-llm should OMIT phrasePlan');
  if (sunriseFullyLLM.texturePlan !== undefined) fail('b:setup', 'sunrise-fully-llm should OMIT texturePlan');
  if (sunriseFullyLLM.macroParams.mood === undefined) fail('b:setup', 'sunrise-fully-llm macroParams should carry a mood (Stage 4 reads it)');
}

// (b1) valid motif mock → flat map (keys = letters, no `motifs` wrapper).
const flat = await generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: validMotifMock });
if (flat.motifs !== undefined) fail('b1:flat', 'returned map still has a `motifs` wrapper — should be flat');
if (JSON.stringify(Object.keys(flat).sort()) !== JSON.stringify([...expectedLetters].sort())) {
  fail('b1:keys', `flat map keys ${JSON.stringify(Object.keys(flat))} != required letters ${JSON.stringify(expectedLetters)}`);
}

// (b2) the three mocks threaded through the runner → end-to-end FinalJingle.
// Stage 4 + 5a + 5b all run via their offline mock; no network.
let jingle;
try {
  jingle = await runPipelineGenerating({
    macroParams: MACRO,
    harmonicPlan: HARMONIC,
    title: 'verify-4',
    mood: 'triumphant',
    __mockMotifResponse: validMotifMock,
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

// (b3) malformed motif mock (not JSON) → throws.
await expectThrows('b3:bad-json', () => generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: 'this is not json {{{' }));

// (b4) semantically invalid motif mock (out-of-range degree) → throws.
const semOOR = clone(VALID);
semOOR.motifs.a.degrees = [1, 3, 9, 4, 3, 1];
await expectThrows('b4:out-of-range', () => generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: JSON.stringify(semOOR) }));

// (b5) semantically invalid motif mock (contour inconsistent) → throws.
const semContour = clone(VALID);
semContour.motifs.a.contour = 'rising_arc';
await expectThrows('b5:contour', () => generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: JSON.stringify(semContour) }));

// (b6) soft end-on-chord-tone check: a valid motif that ends OFF a chord tone
// does NOT fail — it returns and emits a warning via onTrace.
const offToneMotifs = clone(VALID);
offToneMotifs.motifs.b.degrees = [5, 4, 3, 2]; // ends on degree 2; B's IV chord tones are 4/6/1
offToneMotifs.motifs.b.contour = 'falling_arc'; // 2 < 5, still falling_arc
const softTraces = [];
let offToneResult;
try {
  offToneResult = await generateMotifs({
    macroParams: MACRO,
    harmonicPlan: HARMONIC,
    __mockResponse: JSON.stringify(offToneMotifs),
    onTrace: (t) => softTraces.push(t),
  });
} catch (error) {
  fail('b6:soft-warning', `off-chord-tone motif should NOT throw, but did: ${error.message}`);
}
if (offToneResult) {
  const warnings = softTraces.flatMap((t) => t.warnings ?? []);
  if (warnings.length === 0) fail('b6:soft-warning', 'expected a soft chord-tone warning, got none');
  if (!warnings.some((w) => w.includes('"b"'))) fail('b6:soft-warning', `expected the warning to name motif "b": ${JSON.stringify(warnings)}`);
}

// (b7) soft rhythm-sameness check: two motifs sharing the identical rhythm array
// pass validation (the spec allows shared rhythm) but emit a soft warning.
const sameRhythm = clone(VALID);
sameRhythm.motifs.b.degrees = [4, 6, 5, 4, 3, 1];          // distinct shape, falling_arc
sameRhythm.motifs.b.rhythm = [0.5, 0.5, 1, 0.5, 0.5, 0.5]; // identical to motif a's rhythm
expectOk('b7:same-rhythm-valid', validateMotifs(sameRhythm, MACRO));
const rhythmTraces = [];
const sameRhythmResult = await generateMotifs({
  macroParams: MACRO,
  harmonicPlan: HARMONIC,
  __mockResponse: JSON.stringify(sameRhythm),
  onTrace: (t) => rhythmTraces.push(t),
});
if (sameRhythmResult) {
  const warnings = rhythmTraces.flatMap((t) => t.warnings ?? []);
  if (!warnings.some((w) => w.toLowerCase().includes('rhythm'))) {
    fail('b7:rhythm-warning', `expected a rhythm-sameness warning, got ${JSON.stringify(warnings)}`);
  }
}

// Sanity: hand-supplied CASES still carry motifs + phrasePlan + texturePlan
// (the prior verifiers depend on this; a stray edit to the data module surfaces here).
for (const c of CASES) {
  if (!c.motifs) fail('b:cases-intact', `hand-supplied case ${c.id} lost its motifs`);
  if (!c.phrasePlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its phrasePlan`);
  if (!c.texturePlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its texturePlan`);
}

// =================================================================
// report
// =================================================================
if (failures.length > 0) {
  console.error(`verify-stage4 FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  'verify-stage4 PASSED — validateMotifs catches every documented defect (key set, degree range, '
    + 'rhythm length/sum, contour consistency, register, anomaly, distinctness, envelope); '
    + 'generateMotifs(__mockResponse) parses/validates offline, returns the flat map, runs end-to-end through '
    + 'the pipeline (Stages 5a + 5b also mocked), throws on malformed/invalid mocks, and emits the soft '
    + 'end-on-chord-tone warning without failing.'
);
