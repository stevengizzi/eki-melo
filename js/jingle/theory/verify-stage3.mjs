/* =================================================================
   VERIFY-STAGE3 — exit-criterion check for the harmonic plan, the FOURTH LLM
   stage (buildplan Session 11). RUNS FULLY OFFLINE — no live API calls. Stage 3
   is exercised through its `__mockResponse` deterministic-fallback path; the
   end-to-end run drives Stages 4 + 5a + 5b through THEIR mocks too.

   It confirms:
     a. validateHarmonicPlan — a valid wrapped harmonic plan returns { ok:true,
        errors:[] }, and EACH documented defect returns { ok:false } with a clear,
        retry-actionable message: wrong key set (missing / extra section),
        malformed bars, out-of-range bars, coverage gap / overlap, empty
        progression, bad cadence value, unparseable Roman numeral, out-of-mode
        chord with modal interchange OFF, cadence/final-chord mismatch for each of
        the seven cadence types, and mode/cadence incompatibility (modal_iv_i in a
        major mode; phrygian_ii_i in lydian). The soft warnings (single-chord
        static section, cross-boundary repeat, modal borrow) EMIT without failing.
     b. generateHarmonicPlan(__mockResponse) — a VALID mock parses + validates and
        returns the CANONICAL §3 plan ({ sections: [ {label, progression:[strings],
        cadence} ] }, per-bar expanded, no {roman,bars} envelope). Threaded through
        runPipelineGenerating (Stages 4 + 5a + 5b ALSO mocked) it runs end-to-end
        (Stage 3 → 4 → 5a → 5b → 6 → 7 → 8 → toSynthString) to a FinalJingle whose
        every pitch parses through the real synth.js noteToFreq. A malformed mock
        (bad JSON) throws; a semantically-invalid mock throws on validation.
     c. buildHarmonicPlanPrompt is a pure { system, user } builder naming the
        required section labels, the available diatonic chords for the mode, the
        cadence/mode compatibility table, the memorable-progression exemplars, the
        harmonic-rhythm guidance, and the active adventurousness directive.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts
   (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage3.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import {
  validateHarmonicPlan,
  generateHarmonicPlan,
  buildHarmonicPlanPrompt,
} from '../pipeline/stage-3-harmony.js';
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
// A plan that is VALID but emits a soft warning mentioning `keyword`.
const expectWarns = (scope, result, keyword) => {
  if (!result.ok) fail(scope, `expected ok:true (soft warning, not failure), got errors: ${JSON.stringify(result.errors)}`);
  if (!result.warnings.some((w) => w.toLowerCase().includes(keyword.toLowerCase()))) {
    fail(scope, `expected a soft warning mentioning "${keyword}", got ${JSON.stringify(result.warnings)}`);
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
// Fixtures
// =================================================================

// A C major AABA piece (2 bars per section), independent of the inspector cases.
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

// A valid WRAPPED harmonic plan for MACRO: each 2-bar section tiled one chord per
// bar, every final chord a V so the V-cadences (half/deceptive/PAC) are compatible.
// All chords diatonic in C major; no modal interchange needed.
const VALID = {
  sections: {
    A1: { progression: [{ roman: 'I', bars: [1, 1] }, { roman: 'V', bars: [2, 2] }], cadence: 'half' },
    A2: { progression: [{ roman: 'vi', bars: [1, 1] }, { roman: 'V', bars: [2, 2] }], cadence: 'deceptive' },
    B: { progression: [{ roman: 'IV', bars: [1, 1] }, { roman: 'V', bars: [2, 2] }], cadence: 'half' },
    A3: { progression: [{ roman: 'IV', bars: [1, 1] }, { roman: 'V', bars: [2, 2] }], cadence: 'PAC' },
  },
};

// A single-section macro of `bars` bars in any mode/tonic — for isolating cadence
// / Roman / coverage checks. computeSectionPlan reads the explicit `sections`.
function singleSection(mode, tonic, bars, label = 'A') {
  return {
    tempo: 120,
    meter: { numerator: 4, denominator: 4, grouping: [4] },
    tonic,
    mode,
    form: 'through_composed',
    total_bars: bars,
    register_center: `${tonic}5`,
    harmonic_rhythm: [1],
    mood: 'test',
    sections: [{ label, bars }],
  };
}
const wrap1 = (progression, cadence, label = 'A') => ({ sections: { [label]: { progression, cadence } } });
const MI_ON = { knobs: { allow_modal_interchange: true } };

// =================================================================
// a. validateHarmonicPlan
// =================================================================

// --- valid ---
expectOk('a:valid', validateHarmonicPlan(VALID, MACRO));

// --- envelope shape ---
expectInvalid('a:not-object', validateHarmonicPlan(null, MACRO), 'object');
expectInvalid('a:no-sections', validateHarmonicPlan({ A1: {} }, MACRO), 'sections');

// --- key set ---
const missing = clone(VALID);
delete missing.sections.B;
expectInvalid('a:missing-section', validateHarmonicPlan(missing, MACRO), 'missing section');

const extra = clone(VALID);
extra.sections.Z = { progression: [{ roman: 'I', bars: [1, 2] }], cadence: 'half' };
expectInvalid('a:extra-section', validateHarmonicPlan(extra, MACRO), 'unexpected section');

// --- progression shape ---
const emptyProg = clone(VALID);
emptyProg.sections.A1.progression = [];
expectInvalid('a:empty-progression', validateHarmonicPlan(emptyProg, MACRO), 'non-empty');

const missingProg = clone(VALID);
delete missingProg.sections.A1.progression;
expectInvalid('a:missing-progression', validateHarmonicPlan(missingProg, MACRO), 'progression');

// --- bars: malformed / out of range ---
const badBarsShape = clone(VALID);
badBarsShape.sections.A1.progression = [{ roman: 'I', bars: 3 }, { roman: 'V', bars: [2, 2] }];
expectInvalid('a:bars-not-tuple', validateHarmonicPlan(badBarsShape, MACRO), 'tuple');

const barsOOR = clone(VALID);
barsOOR.sections.A1.progression = [{ roman: 'I', bars: [1, 5] }]; // section only 2 bars
expectInvalid('a:bars-out-of-range', validateHarmonicPlan(barsOOR, MACRO), 'out of range');

// --- coverage: gap / overlap (use a 4-bar single section) ---
const gapMacro = singleSection('major', 'C', 4);
expectInvalid(
  'a:coverage-gap',
  validateHarmonicPlan(wrap1([{ roman: 'I', bars: [1, 1] }, { roman: 'V', bars: [3, 4] }], 'half'), gapMacro),
  'gap'
);
expectInvalid(
  'a:coverage-overlap',
  validateHarmonicPlan(wrap1([{ roman: 'I', bars: [1, 2] }, { roman: 'V', bars: [2, 4] }], 'half'), gapMacro),
  'overlap'
);
// a complete tiling of the 4-bar section is fine
expectOk(
  'a:coverage-full',
  validateHarmonicPlan(wrap1([{ roman: 'I', bars: [1, 2] }, { roman: 'V', bars: [3, 4] }], 'half'), gapMacro)
);

// --- cadence value ---
const badCadence = clone(VALID);
badCadence.sections.A1.cadence = 'turnaround';
expectInvalid('a:bad-cadence', validateHarmonicPlan(badCadence, MACRO), 'not one of');

// --- unparseable Roman numeral ---
const badRoman = clone(VALID);
badRoman.sections.A1.progression = [{ roman: 'I', bars: [1, 1] }, { roman: 'H7', bars: [2, 2] }];
expectInvalid('a:unparseable-roman', validateHarmonicPlan(badRoman, MACRO), 'parseable');

// --- out-of-mode chord: modal interchange OFF rejects, ON accepts + warns ---
// bVII is non-final (V is final, half-compatible), so only the out-of-mode rule fires.
const borrowedPlan = wrap1([{ roman: 'bVII', bars: [1, 2] }, { roman: 'V', bars: [3, 4] }], 'half');
expectInvalid('a:out-of-mode-off', validateHarmonicPlan(borrowedPlan, gapMacro), 'not diatonic');
expectWarns('a:out-of-mode-on', validateHarmonicPlan(borrowedPlan, gapMacro, MI_ON), 'borrows');

// --- cadence / final-chord mismatch (each of the seven types) ---
// V-cadences (PAC/IAC/half/deceptive) need a final V; give them a wrong final chord.
expectInvalid('a:PAC-mismatch', validateHarmonicPlan(wrap1([{ roman: 'I', bars: [1, 2] }, { roman: 'vi', bars: [3, 4] }], 'PAC'), gapMacro), 'PAC requires V');
expectInvalid('a:IAC-mismatch', validateHarmonicPlan(wrap1([{ roman: 'V', bars: [1, 2] }, { roman: 'I', bars: [3, 4] }], 'IAC'), gapMacro), 'IAC requires V');
expectInvalid('a:half-mismatch', validateHarmonicPlan(wrap1([{ roman: 'I', bars: [1, 2] }, { roman: 'IV', bars: [3, 4] }], 'half'), gapMacro), 'half cadence ends ON V');
expectInvalid('a:deceptive-mismatch', validateHarmonicPlan(wrap1([{ roman: 'IV', bars: [1, 2] }, { roman: 'I', bars: [3, 4] }], 'deceptive'), gapMacro), 'deceptive cadence resolves V');
// plagal needs final IV/iv; give it V.
expectInvalid('a:plagal-mismatch', validateHarmonicPlan(wrap1([{ roman: 'I', bars: [1, 2] }, { roman: 'V', bars: [3, 4] }], 'plagal'), gapMacro), 'plagal cadence is IV');
// modal_iv_i needs a minor iv; in A aeolian (minor i, mode OK) give it V (wrong degree).
const aeolianMacro = singleSection('aeolian', 'A', 4);
expectInvalid('a:modal_iv_i-degree', validateHarmonicPlan(wrap1([{ roman: 'i', bars: [1, 2] }, { roman: 'V', bars: [3, 4] }], 'modal_iv_i'), aeolianMacro), 'modal_iv_i is iv');
// modal_iv_i with a MAJOR IV in a minor context (D dorian: degree-4 is major) → rejected as plagal-not-modal.
const dorianMacro = singleSection('dorian', 'D', 4);
expectInvalid('a:modal_iv_i-major-IV', validateHarmonicPlan(wrap1([{ roman: 'i', bars: [1, 2] }, { roman: 'IV', bars: [3, 4] }], 'modal_iv_i'), dorianMacro), 'minor iv');
// phrygian_ii_i needs bII; in E phrygian (flat-2, mode OK) give it i.
const phrygianMacro = singleSection('phrygian', 'E', 4);
expectInvalid('a:phrygian-mismatch', validateHarmonicPlan(wrap1([{ roman: 'iv', bars: [1, 2] }, { roman: 'i', bars: [3, 4] }], 'phrygian_ii_i'), phrygianMacro), 'phrygian cadence is bII');

// --- valid cadence/final-chord pairings (positive controls) ---
expectOk('a:plagal-valid', validateHarmonicPlan(wrap1([{ roman: 'I', bars: [1, 2] }, { roman: 'IV', bars: [3, 4] }], 'plagal'), gapMacro));
expectOk('a:modal_iv_i-valid', validateHarmonicPlan(wrap1([{ roman: 'i', bars: [1, 2] }, { roman: 'iv', bars: [3, 4] }], 'modal_iv_i'), aeolianMacro));
// phrygian "II" IS the bII (the mode names degree 2 as the flat-2).
expectOk('a:phrygian-valid-II', validateHarmonicPlan(wrap1([{ roman: 'i', bars: [1, 2] }, { roman: 'II', bars: [3, 4] }], 'phrygian_ii_i'), phrygianMacro));

// --- mode / cadence incompatibility (HARD) ---
expectInvalid('a:modal_iv_i-in-major', validateHarmonicPlan(wrap1([{ roman: 'I', bars: [1, 2] }, { roman: 'IV', bars: [3, 4] }], 'modal_iv_i'), gapMacro), 'minor tonic');
const lydianMacro = singleSection('lydian', 'C', 4);
expectInvalid('a:phrygian-in-lydian', validateHarmonicPlan(wrap1([{ roman: 'I', bars: [1, 2] }, { roman: 'II', bars: [3, 4] }], 'phrygian_ii_i'), lydianMacro), 'flat-2');

// --- soft warnings emit without failing ---
// single-chord static section (one chord over 4 bars, valid half cadence on V).
expectWarns('a:soft-static', validateHarmonicPlan(wrap1([{ roman: 'V', bars: [1, 4] }], 'half'), gapMacro), 'static');
// repeated chord across a section boundary (A ends V, B starts V) — both valid.
const boundaryMacro = {
  ...MACRO,
  form: 'binary',
  sections: [{ label: 'A', bars: 2 }, { label: 'B', bars: 2 }],
};
const boundaryPlan = {
  sections: {
    A: { progression: [{ roman: 'I', bars: [1, 1] }, { roman: 'V', bars: [2, 2] }], cadence: 'half' },
    B: { progression: [{ roman: 'V', bars: [1, 1] }, { roman: 'V', bars: [2, 2] }], cadence: 'half' },
  },
};
expectWarns('a:soft-boundary', validateHarmonicPlan(boundaryPlan, boundaryMacro), 'boundary');

// =================================================================
// c. buildHarmonicPlanPrompt — pure { system, user }, names labels + vocab + table
// =================================================================

const prompt = buildHarmonicPlanPrompt({
  macroParams: MACRO,
  config: { knobs: { harmonic_adventurousness: 'wild', allow_modal_interchange: true } },
});
if (typeof prompt.system !== 'string' || prompt.system.length === 0) fail('c:system', 'system prompt missing');
for (const needle of [
  '"A1"', '"B"', '"A3"',                          // required section labels
  'AVAILABLE DIATONIC CHORDS',                    // the chord listing
  '(C major)',                                    // a resolved chord with its pitch+quality
  'CADENCE TYPES',                                // the compatibility table
  'modal_iv_i', 'phrygian_ii_i', 'deceptive',     // cadence names from the table
  'HARMONIC RHYTHM',                              // the harmonic-rhythm guidance
  'I–V–vi–IV', 'i–bVII–bVI–V',                     // memorable-progression exemplars
  'CLEAR HARMONIC FUNCTION',                       // the function coaching
  'CONTRAST THE B SECTION',                        // the B-contrast coaching
  'wild',                                         // active adventurousness directive
  'triumphant',                                   // the mood signal
  'MODAL INTERCHANGE: ON',                         // interchange invitation (flag on)
]) {
  if (!prompt.user.includes(needle)) fail('c:user', `user prompt does not mention ${needle}`);
}
// With modal interchange OFF the prompt tells the model to stay diatonic.
const promptOff = buildHarmonicPlanPrompt({ macroParams: MACRO, config: { knobs: { harmonic_adventurousness: 'tame' } } });
if (!promptOff.user.includes('MODAL INTERCHANGE: OFF')) fail('c:user-off', 'tame/off prompt should say MODAL INTERCHANGE: OFF');

// =================================================================
// b. generateHarmonicPlan(__mockResponse) — offline parse/validate + e2e
// =================================================================

const validHarmonyMock = JSON.stringify(VALID);

// (b1) valid harmony mock → canonical §3 array shape (NOT the {roman,bars} envelope).
const planFlat = await generateHarmonicPlan({ macroParams: MACRO, __mockResponse: validHarmonyMock });
if (!Array.isArray(planFlat.sections)) {
  fail('b1:shape', `expected { sections: [ ... ] } array, got ${JSON.stringify(planFlat).slice(0, 120)}`);
} else {
  if (planFlat.sections.length !== 4) fail('b1:count', `expected 4 sections, got ${planFlat.sections.length}`);
  const a1 = planFlat.sections.find((s) => s.label === 'A1');
  if (!a1) fail('b1:labels', 'A1 missing from unwrapped plan');
  else {
    if (!Array.isArray(a1.progression) || a1.progression.some((r) => typeof r !== 'string')) {
      fail('b1:progression', `A1 progression should be an array of roman STRINGS, got ${JSON.stringify(a1.progression)}`);
    }
    // per-bar expanded: A1 is 2 bars, I then V
    if (JSON.stringify(a1.progression) !== JSON.stringify(['I', 'V'])) {
      fail('b1:expand', `A1 progression should expand to ["I","V"], got ${JSON.stringify(a1.progression)}`);
    }
    if (a1.cadence !== 'half') fail('b1:cadence', `A1 cadence should be "half", got ${a1.cadence}`);
  }
}

// A chord HELD across two bars expands to two copies — slow harmonic rhythm.
const heldMacro = singleSection('major', 'C', 4);
const heldPlan = await generateHarmonicPlan({
  macroParams: heldMacro,
  __mockResponse: JSON.stringify(wrap1([{ roman: 'I', bars: [1, 2] }, { roman: 'V', bars: [3, 4] }], 'half')),
});
if (JSON.stringify(heldPlan.sections[0].progression) !== JSON.stringify(['I', 'I', 'V', 'V'])) {
  fail('b1:held-expand', `held chord should expand per-bar to ["I","I","V","V"], got ${JSON.stringify(heldPlan.sections[0].progression)}`);
}

// (b2) the four mocks threaded through the runner → end-to-end FinalJingle.
// Stage 3 + 4 + 5a + 5b all run via their offline mock; no network.
const validMotifMock = JSON.stringify({
  motifs: {
    a: { degrees: [1, 3, 5, 4, 3, 1], rhythm: [0.5, 0.5, 1, 0.5, 0.5, 0.5], contour: 'peak_descend', register: 'mid', anomaly: null },
    b: { degrees: [5, 4, 3, 1], rhythm: [0.5, 0.5, 1, 0.5], contour: 'falling_arc', register: 'mid', anomaly: null },
  },
});
const validPhraseMock = JSON.stringify({
  sections: {
    A1: { phrase_structure: 'period', lead: [{ motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 }, { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 }] },
    A2: { phrase_structure: 'period', lead: [{ motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 }, { motif: 'a', transform: { name: 'transpose_third', params: { direction: 'up' } }, start_bar: 2, length_bars: 1 }] },
    B: { phrase_structure: 'period', lead: [{ motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 }, { motif: 'b', transform: 'invert', start_bar: 2, length_bars: 1 }] },
    A3: { phrase_structure: 'period', lead: [{ motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 }, { motif: 'a', transform: 'retrograde', start_bar: 2, length_bars: 1 }] },
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

let jingle;
try {
  jingle = await runPipelineGenerating({
    macroParams: MACRO,
    title: 'verify-3',
    mood: 'triumphant',
    __mockHarmonyResponse: validHarmonyMock,
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
      if (!(typeof duration === 'number' && duration > 0)) fail(`b2:${voice}`, `event ${i} duration not positive: ${duration}`);
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

// (b3) malformed harmony mock (not JSON) → throws.
await expectThrows('b3:bad-json', () => generateHarmonicPlan({ macroParams: MACRO, __mockResponse: 'not json {{{' }));

// (b4) semantically invalid harmony mock (cadence/final-chord mismatch) → throws.
const semBad = clone(VALID);
semBad.sections.A3.progression = [{ roman: 'I', bars: [1, 1] }, { roman: 'vi', bars: [2, 2] }]; // PAC needs V
await expectThrows('b4:invalid', () => generateHarmonicPlan({ macroParams: MACRO, __mockResponse: JSON.stringify(semBad) }));

// (b5) soft warning surfaces via onTrace without failing.
const softMacro = singleSection('major', 'C', 4);
const softTraces = [];
await generateHarmonicPlan({
  macroParams: softMacro,
  __mockResponse: JSON.stringify(wrap1([{ roman: 'V', bars: [1, 4] }], 'half')),
  onTrace: (t) => softTraces.push(t),
});
const softWarnings = softTraces.flatMap((t) => t.warnings ?? []);
if (!softWarnings.some((w) => w.toLowerCase().includes('static'))) {
  fail('b5:soft-trace', `expected a static soft warning via onTrace, got ${JSON.stringify(softWarnings)}`);
}

// =================================================================
// Sanity: the inspector cases are intact and the new harmony case exists.
// =================================================================
const inclHarmony = GENERATED_CASES.find((c) => c.id === 'sunrise-fully-llm-harmony');
if (!inclHarmony) {
  fail('b:setup', 'GENERATED_CASES is missing sunrise-fully-llm-harmony');
} else {
  if (inclHarmony.harmonicPlan !== undefined) fail('b:setup', 'sunrise-fully-llm-harmony should OMIT harmonicPlan');
  if (inclHarmony.motifs !== undefined) fail('b:setup', 'sunrise-fully-llm-harmony should OMIT motifs');
  if (inclHarmony.phrasePlan !== undefined) fail('b:setup', 'sunrise-fully-llm-harmony should OMIT phrasePlan');
  if (inclHarmony.texturePlan !== undefined) fail('b:setup', 'sunrise-fully-llm-harmony should OMIT texturePlan');
  if (inclHarmony.macroParams.mood === undefined) fail('b:setup', 'sunrise-fully-llm-harmony macroParams should carry a mood (Stage 3 reads it)');
}
// hand-supplied CASES still carry a full hand-written plan (the sync verifiers depend on it).
for (const c of CASES) {
  if (!c.harmonicPlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its harmonicPlan`);
  if (!c.motifs) fail('b:cases-intact', `hand-supplied case ${c.id} lost its motifs`);
  if (!c.phrasePlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its phrasePlan`);
  if (!c.texturePlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its texturePlan`);
}

// =================================================================
// report
// =================================================================
if (failures.length > 0) {
  console.error(`verify-stage3 FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  'verify-stage3 PASSED — validateHarmonicPlan catches every documented defect (key set, bars shape/range, '
    + 'coverage gap/overlap, empty progression, cadence value, unparseable Roman, out-of-mode chord with '
    + 'interchange off, cadence/final-chord mismatch for all 7 types, mode/cadence incompatibility) and emits '
    + 'the soft warnings (static section, cross-boundary repeat, modal borrow) without failing; '
    + 'generateHarmonicPlan(__mockResponse) parses/validates offline, returns the canonical §3 array (per-bar '
    + 'expanded), runs end-to-end through the pipeline (Stages 4 + 5a + 5b also mocked), and throws on '
    + 'malformed/invalid mocks.'
);
