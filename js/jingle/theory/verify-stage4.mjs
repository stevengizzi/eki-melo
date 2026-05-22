/* =================================================================
   VERIFY-STAGE4 — exit-criterion check for MELODIC PHRASES, the Session-12
   phrase-motif rework of Stage 4. RUNS FULLY OFFLINE — no live API calls. Stage 4
   is exercised through its `__mockResponse` deterministic-fallback path; the
   end-to-end run drives Stages 5a (arrangement) + 5b (texture) through THEIR
   mocks too.

   It confirms:
     a. validateMotifs — a valid wrapped phrases object returns { ok:true,
        errors:[] }, and EACH documented HARD defect returns { ok:false } with a
        clear, retry-actionable message: wrong key set (missing / extra section),
        rhythm sum != section beats (both ends), out-of-range / non-integer degree,
        too few (<8) / too many (>32) degrees, rhythm length mismatch, non-positive
        rhythm, bad contour value, bad register, anomaly type/at_position/missing,
        and the envelope shape. The SOFT checks (strong-beat chord-fit, cross-
        section relationship, contour mismatch, anomaly reality) return ok:true
        with a populated `warnings` array — never a failure.
     b. generateMotifs(__mockResponse) — a VALID mock parses + validates and
        returns the FLAT per-section phrase map (keys = section labels, no
        `phrases` wrapper). Threaded through runPipelineGenerating (Stages 5a + 5b
        ALSO mocked) it runs end-to-end to a FinalJingle whose every pitch parses
        through the real synth.js noteToFreq. A malformed mock (bad JSON) throws; a
        semantically-invalid mock throws on validation. A soft chord-fit warning is
        emitted via onTrace WITHOUT failing.
     c. buildMotifsPrompt is a pure { system, user } builder naming the section
        labels, the per-bar chord tones, the cross-section intent, the shape
        vocabulary, the phrase-scale seed exemplars, the compositional guidance,
        and the active adventurousness directive.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts:
     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage4.mjs
     rm js/jingle/package.json
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
// Fixtures — a self-contained C major AABA piece, 2-bar sections (8 beats each).
// Phrases fill their sections (rhythm sums to 8) with strong beats on chord tones.
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

// A valid wrapped phrases object: each phrase fills its 2-bar (8-beat) section,
// strong beats on chord tones (bar1/bar2 chords = the first two Roman numerals).
const VALID = {
  phrases: {
    A1: { degrees: [1, 3, 5, 3, 5, 4, 3, 2], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
    A2: { degrees: [1, 3, 5, 3, 5, 4, 3, 1], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
    B: { degrees: [8, 6, 4, 6, 5, 3, 2, 1], rhythm: [1, 1, 1, 1, 1, 1, 1, 1], contour: 'falling_arc', register: 'high', anomaly: null },
    A3: { degrees: [1, 3, 5, 3, 4, 3, 2, 1], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
  },
};

// --- valid (2-arg and 3-arg forms) ---
expectOk('a:valid', validateMotifs(VALID, MACRO));
expectOk('a:valid-with-harmony', validateMotifs(VALID, MACRO, HARMONIC));

// A valid phrase WITH a chromatic_neighbor anomaly also passes.
const withAnomaly = clone(VALID);
withAnomaly.phrases.A1.anomaly = { type: 'chromatic_neighbor', at_position: 2 };
expectOk('a:valid-anomaly', validateMotifs(withAnomaly, MACRO));

// --- key set (per-section coverage, HARD) ---
const missing = clone(VALID);
delete missing.phrases.B;
expectInvalid('a:missing-section', validateMotifs(missing, MACRO), 'missing phrase');

const extra = clone(VALID);
extra.phrases.C = clone(VALID.phrases.B);
expectInvalid('a:extra-section', validateMotifs(extra, MACRO), 'unexpected phrase');

// --- rhythm sum EQUALS section beats (HARD, both ends) ---
const sumHigh = clone(VALID);
sumHigh.phrases.A1.rhythm = [1, 0.5, 0.5, 1, 1, 1, 1, 3]; // sum 9, section is 8
expectInvalid('a:rhythm-sum-high', validateMotifs(sumHigh, MACRO), 'fill its section');

const sumLow = clone(VALID);
sumLow.phrases.A1.rhythm = [1, 0.5, 0.5, 1, 1, 1, 1, 1]; // sum 7, section is 8
expectInvalid('a:rhythm-sum-low', validateMotifs(sumLow, MACRO), 'fill its section');

// --- degrees ---
const outOfRange = clone(VALID);
outOfRange.phrases.A1.degrees = [1, 3, 99, 3, 5, 4, 3, 2];
expectInvalid('a:degree-out-of-range', validateMotifs(outOfRange, MACRO), 'non-zero integer in');

const nonInteger = clone(VALID);
nonInteger.phrases.A1.degrees = [1, 3, 2.5, 3, 5, 4, 3, 2];
expectInvalid('a:degree-non-integer', validateMotifs(nonInteger, MACRO), 'non-zero integer in');

const zeroDegree = clone(VALID);
zeroDegree.phrases.A1.degrees = [1, 0, 5, 3, 5, 4, 3, 2];
expectInvalid('a:degree-zero', validateMotifs(zeroDegree, MACRO), 'non-zero integer in');

// The octave (8) and negative degrees are valid (§3 octave-displacement convention).
const octaveReach = clone(VALID);
octaveReach.phrases.A1.degrees = [1, 3, 5, 8, 5, 4, 3, 2]; // reaches the octave
expectOk('a:octave-reach', validateMotifs(octaveReach, MACRO));

const belowTonic = clone(VALID);
belowTonic.phrases.B.degrees = [8, 6, 4, 6, 5, 4, 3, -2]; // dips below the tonic
expectOk('a:below-tonic', validateMotifs(belowTonic, MACRO));

// too few (<8) / too many (>32) degrees — a phrase, not a cell.
const tooFew = clone(VALID);
tooFew.phrases.A1.degrees = [1, 3, 5, 4, 2];
tooFew.phrases.A1.rhythm = [2, 2, 2, 1, 1]; // sum 8
expectInvalid('a:too-few-degrees', validateMotifs(tooFew, MACRO), 'a phrase, not a cell');

const tooMany = clone(VALID);
tooMany.phrases.A1.degrees = Array.from({ length: 33 }, (_, i) => (i % 7) + 1);
tooMany.phrases.A1.rhythm = Array.from({ length: 33 }, () => 8 / 33); // sum 8
expectInvalid('a:too-many-degrees', validateMotifs(tooMany, MACRO), 'a phrase, not a cell');

// --- rhythm ---
const rhythmLenMismatch = clone(VALID);
rhythmLenMismatch.phrases.A1.rhythm = [1, 1]; // length 2 != degrees length 8
expectInvalid('a:rhythm-length', validateMotifs(rhythmLenMismatch, MACRO), 'length');

const rhythmNonPositive = clone(VALID);
rhythmNonPositive.phrases.A1.rhythm = [1, 0, 0.5, 1.5, 1, 1, 1, 2]; // a zero
expectInvalid('a:rhythm-non-positive', validateMotifs(rhythmNonPositive, MACRO), 'positive');

// --- contour / register ---
const badContourValue = clone(VALID);
badContourValue.phrases.A1.contour = 'zigzag';
expectInvalid('a:bad-contour-value', validateMotifs(badContourValue, MACRO), 'not one of');

const badRegister = clone(VALID);
badRegister.phrases.A1.register = 'middle';
expectInvalid('a:bad-register', validateMotifs(badRegister, MACRO), 'register');

// --- anomaly ---
const anomalyPosOOR = clone(VALID);
anomalyPosOOR.phrases.A1.anomaly = { type: 'chromatic_neighbor', at_position: 99 };
expectInvalid('a:anomaly-pos-out-of-range', validateMotifs(anomalyPosOOR, MACRO), 'at_position');

const anomalyBadType = clone(VALID);
anomalyBadType.phrases.A1.anomaly = { type: 'wrong_kind', at_position: 1 };
expectInvalid('a:anomaly-bad-type', validateMotifs(anomalyBadType, MACRO), 'anomaly.type');

const anomalyMissing = clone(VALID);
delete anomalyMissing.phrases.A1.anomaly;
expectInvalid('a:anomaly-missing', validateMotifs(anomalyMissing, MACRO), 'anomaly');

// --- rests (Session 12): null = a rest; the phrase must stay mostly notes ---
const withRest = clone(VALID);
withRest.phrases.A1.degrees = [1, 3, 5, null, 5, 4, 3, 2]; // a rest mid-phrase (still sums to 8)
expectOk('a:rest-valid', validateMotifs(withRest, MACRO));

const mostlyRests = clone(VALID);
mostlyRests.phrases.A1.degrees = [1, null, null, null, null, null, null, 2]; // only 2 sounded notes
expectInvalid('a:too-few-sounded', validateMotifs(mostlyRests, MACRO), 'sounded');

// --- envelope shape ---
expectInvalid('a:not-object', validateMotifs(null, MACRO), 'object');
expectInvalid('a:no-phrases', validateMotifs({ a: {} }, MACRO), 'phrases');

// =================================================================
// SOFT checks — return ok:true with a populated warnings array
// =================================================================

// (d) strong-beat chord-fit: a phrase whose downbeat sits OFF the bar's chord
// validates (ok:true) and warns — only when a harmonicPlan is supplied.
const offChord = clone(VALID);
offChord.phrases.A1.degrees = [2, 3, 5, 3, 5, 4, 3, 2]; // bar-1 downbeat degree 2 over I (1,3,5)
const offChordResult = validateMotifs(offChord, MACRO, HARMONIC);
expectOk('a:soft-chordfit-ok', offChordResult);
if (!offChordResult.warnings.some((w) => w.includes('chord tone'))) {
  fail('a:soft-chordfit-warns', `expected a chord-fit warning, got ${JSON.stringify(offChordResult.warnings)}`);
}
// Without a harmonicPlan the chord-fit check is skipped (no such warning).
const noHarmonyResult = validateMotifs(offChord, MACRO);
expectOk('a:soft-chordfit-skipped', noHarmonyResult);
if (noHarmonyResult.warnings.some((w) => w.includes('chord tone'))) {
  fail('a:soft-chordfit-skipped', 'chord-fit warning fired without a harmonicPlan');
}

// (c) cross-section relationship: two SAME-letter phrases sharing no positions warn.
const unrelated = clone(VALID);
unrelated.phrases.A2.degrees = [2, 4, 6, 2, 6, 5, 4, 3]; // no position matches A1's [1,3,5,3,5,4,3,2]
const unrelatedResult = validateMotifs(unrelated, MACRO);
expectOk('a:soft-related-ok', unrelatedResult);
if (!unrelatedResult.warnings.some((w) => w.toLowerCase().includes('related'))) {
  fail('a:soft-related-warns', `expected a relationship warning, got ${JSON.stringify(unrelatedResult.warnings)}`);
}

// ...and two DIFFERENT-letter phrases that are IDENTICAL warn (contrast collapsed).
const identicalContrast = clone(VALID);
identicalContrast.phrases.B = clone(VALID.phrases.A1); // B == A1 exactly
const identicalResult = validateMotifs(identicalContrast, MACRO);
expectOk('a:soft-contrast-ok', identicalResult);
if (!identicalResult.warnings.some((w) => w.toLowerCase().includes('contrast'))) {
  fail('a:soft-contrast-warns', `expected a contrast warning, got ${JSON.stringify(identicalResult.warnings)}`);
}

// (e) contour mismatch: a label that doesn't match the trajectory warns (soft).
const contourMismatch = clone(VALID);
contourMismatch.phrases.A1.contour = 'rising_arc'; // A1 ends (2) below its start... actually 2 > 1, so use a clear fall
contourMismatch.phrases.A1.degrees = [5, 4, 5, 3, 4, 2, 3, 1]; // ends 1 < starts 5 → not rising_arc
const contourResult = validateMotifs(contourMismatch, MACRO);
expectOk('a:soft-contour-ok', contourResult);
if (!contourResult.warnings.some((w) => w.toLowerCase().includes('rising_arc'))) {
  fail('a:soft-contour-warns', `expected a contour-mismatch warning, got ${JSON.stringify(contourResult.warnings)}`);
}

// (f) anomaly reality: a fake large_leap (a label on stepwise material) warns (soft).
const fakeLeap = clone(VALID);
fakeLeap.phrases.A1.anomaly = { type: 'large_leap', at_position: 1 }; // [1,3,...] step of 2, not a 6th+
const fakeLeapResult = validateMotifs(fakeLeap, MACRO);
expectOk('a:soft-anomaly-ok', fakeLeapResult);
if (!fakeLeapResult.warnings.some((w) => w.toLowerCase().includes('large_leap'))) {
  fail('a:soft-anomaly-warns', `expected a large_leap soft warning, got ${JSON.stringify(fakeLeapResult.warnings)}`);
}

// =================================================================
// c. buildMotifsPrompt — pure { system, user }, names labels + per-bar chords +
//    cross-section intent + vocab + exemplars + active directive
// =================================================================

const prompt = buildMotifsPrompt({
  macroParams: MACRO,
  harmonicPlan: HARMONIC,
  config: { knobs: { phrase_adventurousness: 'wild' } },
});
if (typeof prompt.system !== 'string' || prompt.system.length === 0) fail('c:system', 'system prompt missing');
for (const needle of [
  '"A1"', '"A2"', '"B"', '"A3"',                  // required section keys
  'chord tones at degrees',                        // the per-bar harmony block
  'CROSS-SECTION INTENT',                          // the cross-section conditioning
  'cadence approach',                              // the final-bar annotation
  'rising_arc', 'peak_descend', 'wandering',       // shape vocabulary
  'chromatic_neighbor', 'rhythmic_displacement',   // anomaly vocabulary
  'SEED EXEMPLARS',                                // the phrase-scale exemplars
  'at_position',                                   // the anomaly key the realizer reads
  'COMPOSITIONAL GUIDANCE',                         // the explicit coaching block
  'wild',                                          // active adventurousness directive
  'triumphant',                                    // the mood signal
]) {
  if (!prompt.user.includes(needle)) fail('c:user', `user prompt does not mention ${needle}`);
}

// =================================================================
// b. generateMotifs(__mockResponse) — offline parse/validate + e2e
// =================================================================

// Valid WRAPPED arrangement + texture mocks so Stages 5a/5b satisfy their mock
// paths. The arrangement places each section's phrase literally over the section.
const validPhraseMock = JSON.stringify({
  sections: {
    A1: { lead: [{ motif: 'A1', transform: 'literal', start_bar: 1, length_bars: 2 }] },
    A2: { lead: [{ motif: 'A2', transform: 'literal', start_bar: 1, length_bars: 2 }] },
    B: { lead: [{ motif: 'B', transform: 'literal', start_bar: 1, length_bars: 2 }] },
    A3: { lead: [{ motif: 'A3', transform: 'literal', start_bar: 1, length_bars: 2 }] },
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
const expectedLabels = ['A1', 'A2', 'B', 'A3'];

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

// (b1) valid phrase mock → flat per-section map (keys = section labels, no `phrases` wrapper).
const flat = await generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: validMotifMock });
if (flat.phrases !== undefined) fail('b1:flat', 'returned map still has a `phrases` wrapper — should be flat');
if (JSON.stringify(Object.keys(flat).sort()) !== JSON.stringify([...expectedLabels].sort())) {
  fail('b1:keys', `flat map keys ${JSON.stringify(Object.keys(flat))} != section labels ${JSON.stringify(expectedLabels)}`);
}

// (b2) the three mocks threaded through the runner → end-to-end FinalJingle.
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

// (b2b) a rest (null degree) realizes to an actual 'rest' in the lead track, and
// the run stays beat-aligned across voices.
const restMotifMock = JSON.stringify({
  phrases: {
    ...VALID.phrases,
    A1: { ...VALID.phrases.A1, degrees: [1, 3, 5, null, 5, 4, 3, 2] },
  },
});
let restJingle;
try {
  restJingle = await runPipelineGenerating({
    macroParams: MACRO, harmonicPlan: HARMONIC,
    __mockMotifResponse: restMotifMock, __mockPhraseResponse: validPhraseMock, __mockResponse: validTextureMock,
  });
} catch (error) {
  fail('b2b:rest-e2e', `a rest-bearing phrase threw: ${error.message}`);
}
if (restJingle) {
  if (!restJingle.lead.some(([note]) => note === 'rest')) fail('b2b:rest-e2e', 'expected a rest in the lead from a null degree');
  const lens = ['lead', 'harmony', 'bass'].map((v) => restJingle[v].reduce((s, e) => s + e[1], 0));
  if (Math.max(...lens) - Math.min(...lens) > 1e-6) fail('b2b:rest-align', `track lengths disagree with a rest: ${JSON.stringify(lens)}`);
}

// (b3) malformed phrase mock (not JSON) → throws.
await expectThrows('b3:bad-json', () => generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: 'this is not json {{{' }));

// (b4) semantically invalid mock (out-of-range degree — the counting-slip fixup
// never touches degrees, so this still throws). A gross rhythm-sum miss is covered
// by b5b:gross-miss above.
const semBadDegree = clone(VALID);
semBadDegree.phrases.A1.degrees = [1, 3, 99, 3, 5, 4, 3, 2]; // 99 is out of range
await expectThrows('b4:bad-degree', () => generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: JSON.stringify(semBadDegree) }));

// (b5) semantically invalid mock (bad contour VALUE) → throws.
const semBadContour = clone(VALID);
semBadContour.phrases.A1.contour = 'zigzag';
await expectThrows('b5:bad-contour-value', () => generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: JSON.stringify(semBadContour) }));

// (b5b) counting-slip fixup: a phrase whose rhythm is a beat short of its section
// is SNAPPED to exact (final note extended) and returns successfully with a soft
// note — no retry, no failure. A GROSS miss still throws.
const slip = clone(VALID);
slip.phrases.A1.rhythm = [1, 0.5, 0.5, 1, 1, 1, 1, 1]; // sums to 7, section is 8 (off by 1)
const slipTraces = [];
let slipResult;
try {
  slipResult = await generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: JSON.stringify(slip), onTrace: (t) => slipTraces.push(t) });
} catch (error) {
  fail('b5b:counting-slip', `a 1-beat near-miss should be fixed up, not thrown: ${error.message}`);
}
if (slipResult) {
  const a1Sum = slipResult.A1.rhythm.reduce((s, b) => s + b, 0);
  if (Math.abs(a1Sum - 8) > 1e-6) fail('b5b:counting-slip', `A1 should be snapped to 8 beats, got ${a1Sum}`);
  const notes = slipTraces.flatMap((t) => t.warnings ?? []);
  if (!notes.some((w) => w.toLowerCase().includes('counting-slip'))) {
    fail('b5b:counting-slip', `expected a counting-slip soft note, got ${JSON.stringify(notes)}`);
  }
}
// An OVER-shoot whose final note can't absorb the trim (the bug from the field:
// [1,1,2,1,1,1,1,1] = 9 over an 8-beat section) is fixed by trimming the LONGEST note.
const overShoot = clone(VALID);
overShoot.phrases.A1.rhythm = [1, 1, 2, 1, 1, 1, 1, 1]; // sums to 9, section is 8; final note is only 1
const overTraces = [];
let overResult;
try {
  overResult = await generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: JSON.stringify(overShoot), onTrace: (t) => overTraces.push(t) });
} catch (error) {
  fail('b5b:over-shoot', `a 1-beat over-shoot should be fixed up (trim the longest note), not thrown: ${error.message}`);
}
if (overResult) {
  const a1Sum = overResult.A1.rhythm.reduce((s, b) => s + b, 0);
  if (Math.abs(a1Sum - 8) > 1e-6) fail('b5b:over-shoot', `A1 should be snapped to 8 beats, got ${a1Sum}`);
}

// A GROSS miss (off by 5 beats, beyond the fixup tolerance) still throws.
const grossMiss = clone(VALID);
grossMiss.phrases.A1.rhythm = [1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]; // sums to 4.5, section is 8
await expectThrows('b5b:gross-miss', () => generateMotifs({ macroParams: MACRO, harmonicPlan: HARMONIC, __mockResponse: JSON.stringify(grossMiss) }));

// (b6) soft chord-fit: an off-chord-downbeat phrase does NOT fail — it returns and
// emits a warning via onTrace (naming the section).
const softTraces = [];
let offToneResult;
try {
  offToneResult = await generateMotifs({
    macroParams: MACRO,
    harmonicPlan: HARMONIC,
    __mockResponse: JSON.stringify(offChord),
    onTrace: (t) => softTraces.push(t),
  });
} catch (error) {
  fail('b6:soft-warning', `off-chord phrase should NOT throw, but did: ${error.message}`);
}
if (offToneResult) {
  const warnings = softTraces.flatMap((t) => t.warnings ?? []);
  if (warnings.length === 0) fail('b6:soft-warning', 'expected a soft chord-fit warning, got none');
  if (!warnings.some((w) => w.includes('"A1"'))) fail('b6:soft-warning', `expected the warning to name phrase "A1": ${JSON.stringify(warnings)}`);
}

// Sanity: hand-supplied CASES still carry motifs + phrasePlan + texturePlan, and
// their motif keys are SECTION LABELS (the phrase-shape contract).
for (const c of CASES) {
  if (!c.motifs) fail('b:cases-intact', `hand-supplied case ${c.id} lost its motifs`);
  if (!c.phrasePlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its phrasePlan`);
  if (!c.texturePlan) fail('b:cases-intact', `hand-supplied case ${c.id} lost its texturePlan`);
  const sectionLabels = new Set(c.macroParams.sections.map((s) => s.label));
  for (const key of Object.keys(c.motifs ?? {})) {
    if (!sectionLabels.has(key)) fail('b:phrase-shape', `case ${c.id} motif key "${key}" is not a section label (phrase-shape requires per-section keys)`);
  }
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
  'verify-stage4 PASSED — validateMotifs catches every documented HARD defect (per-section key set, rhythm '
    + 'sum = section beats, degree range/count, rhythm length/positivity, contour, register, anomaly, envelope) and '
    + 'returns the SOFT notes (chord-fit, cross-section relationship, contour mismatch, anomaly reality) as warnings; '
    + 'generateMotifs(__mockResponse) parses/validates offline, returns the flat per-section phrase map, runs '
    + 'end-to-end through the pipeline (Stages 5a + 5b also mocked), throws on malformed/invalid mocks, and emits the '
    + 'soft chord-fit warning without failing.'
);
