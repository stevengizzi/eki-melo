/* =================================================================
   VERIFY-STAGE5A — exit-criterion check for ARRANGEMENT, the Session-12 re-scope
   of Stage 5a. RUNS FULLY OFFLINE — no live API calls. Stage 5a is exercised
   through its `__mockResponse` deterministic-fallback path; the end-to-end run
   drives Stage 5b through ITS mock too.

   It confirms:
     a. validatePhrasePlan — a valid arrangement (one literal assignment per
        section, placing that section's phrase) returns { ok:true, errors:[] }, and
        EACH documented defect returns { ok:false } with a clear, retry-actionable
        message: unknown phrase, unknown transform, missing transform param, a bar-
        coverage gap / overlap / wrong start, the schema rules (missing/extra
        section, envelope), and the chord-fit guard. phrase_structure is now
        OPTIONAL metadata (a bad value is a SOFT warning, not a failure); adjacent-
        identical placement is SOFT.
     c. THE DETERMINISTIC BEAT-LENGTH / OVERFLOW CHECK — a placed phrase whose
        REALIZED length (after its transform) overflows its bar-slot, or leaves an
        internal gap, is rejected (HARD) with an actionable message; a length-
        preserving transform on a full-section slot, and a correctly-sized length-
        CHANGING transform on a matching sub-slot, both pass.
     b. generatePhrasePlan(__mockResponse) — a VALID mock parses + validates and
        returns the FLAT plan (keys = section labels, no `sections` wrapper).
        Threaded through runPipelineGenerating (Stage 5b ALSO mocked) it runs
        end-to-end to a FinalJingle whose every pitch parses through synth.js
        noteToFreq. A malformed mock throws; a semantically-invalid mock throws.
     d. buildPhrasePlanPrompt is a pure { system, user } builder naming the section
        labels, the phrase summaries, the transform vocabulary, and the active
        arrangement-adventurousness directive.

   RUNNING IT. Same throwaway-package.json dance as the other verify scripts:
     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage5a.mjs
     rm js/jingle/package.json
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
// a. validatePhrasePlan — C major AABA, 2-bar sections (8 beats each). MOTIFS is
//    the per-section PHRASE map (keys = section labels). Each phrase fills its
//    section (rhythm sums to 8). VALID places each phrase literally over its section.
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
  sections: [
    { label: 'A1', bars: 2 },
    { label: 'A2', bars: 2 },
    { label: 'B', bars: 2 },
    { label: 'A3', bars: 2 },
  ],
};

const MOTIFS = {
  A1: { degrees: [1, 3, 5, 3, 5, 4, 3, 2], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
  A2: { degrees: [1, 3, 5, 3, 5, 4, 3, 1], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
  B: { degrees: [8, 6, 4, 6, 5, 3, 2, 1], rhythm: [1, 1, 1, 1, 1, 1, 1, 1], contour: 'falling_arc', register: 'high', anomaly: null },
  A3: { degrees: [1, 3, 5, 3, 4, 3, 2, 1], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
};

const HARMONIC = {
  sections: [
    { label: 'A1', progression: ['I', 'V', 'vi', 'IV'], cadence: 'IAC', anomaly: null },
    { label: 'A2', progression: ['I', 'V', 'vi', 'IV'], cadence: 'deceptive', anomaly: null },
    { label: 'B', progression: ['IV', 'I', 'ii', 'V'], cadence: 'half', anomaly: null },
    { label: 'A3', progression: ['I', 'IV', 'V', 'I'], cadence: 'PAC', anomaly: null },
  ],
};

// A valid arrangement: one literal assignment per section, covering its 2 bars.
const VALID = {
  sections: {
    A1: { lead: [{ motif: 'A1', transform: 'literal', start_bar: 1, length_bars: 2 }] },
    A2: { lead: [{ motif: 'A2', transform: 'literal', start_bar: 1, length_bars: 2 }] },
    B: { lead: [{ motif: 'B', transform: 'literal', start_bar: 1, length_bars: 2 }] },
    A3: { lead: [{ motif: 'A3', transform: 'literal', start_bar: 1, length_bars: 2 }] },
  },
};

expectOk('a:valid', validatePhrasePlan(VALID, MACRO, MOTIFS));
expectOk('a:valid-with-harmony', validatePhrasePlan(VALID, MACRO, MOTIFS, HARMONIC));

// A length-PRESERVING variation on a full-section slot is valid (ornament keeps total length).
const variedReprise = clone(VALID);
variedReprise.sections.A3.lead = [{ motif: 'A3', transform: { name: 'ornament_upper_neighbor', params: { at_position: 1 } }, start_bar: 1, length_bars: 2 }];
expectOk('a:valid-variation', validatePhrasePlan(variedReprise, MACRO, MOTIFS));

// unknown phrase (motif key not in MOTIFS)
const badMotif = clone(VALID);
badMotif.sections.A1.lead[0].motif = 'Z';
expectInvalid('a:unknown-phrase', validatePhrasePlan(badMotif, MACRO, MOTIFS), 'known phrase');

// unknown transform
const badTransform = clone(VALID);
badTransform.sections.A1.lead[0].transform = 'nope_transform';
expectInvalid('a:unknown-transform', validatePhrasePlan(badTransform, MACRO, MOTIFS), 'unknown transform');

// transpose_step without its required integer "steps" param (caught at the seam)
const missingSteps = clone(VALID);
missingSteps.sections.A1.lead[0] = { motif: 'A1', transform: 'transpose_step', start_bar: 1, length_bars: 2 };
expectInvalid('a:transpose-step-no-param', validatePhrasePlan(missingSteps, MACRO, MOTIFS), 'steps');

// coverage: a gap (a 1-bar assignment leaves bar 2 uncovered)
const gap = clone(VALID);
gap.sections.A1.lead = [{ motif: 'A1', transform: 'literal', start_bar: 1, length_bars: 1 }];
expectInvalid('a:coverage-gap', validatePhrasePlan(gap, MACRO, MOTIFS), 'uncovered');

// coverage: an overlap
const overlap = clone(VALID);
overlap.sections.A1.lead = [
  { motif: 'A1', transform: 'literal', start_bar: 1, length_bars: 2 },
  { motif: 'A1', transform: 'literal', start_bar: 2, length_bars: 1 },
];
expectInvalid('a:overlap', validatePhrasePlan(overlap, MACRO, MOTIFS), 'overlap');

// coverage: doesn't start at bar 1
const badStart = clone(VALID);
badStart.sections.A1.lead = [{ motif: 'A1', transform: 'literal', start_bar: 2, length_bars: 1 }];
expectInvalid('a:bad-start', validatePhrasePlan(badStart, MACRO, MOTIFS), 'start at bar 1');

// schema: missing / extra section, envelope
const missing = clone(VALID);
delete missing.sections.A3;
expectInvalid('a:missing-section', validatePhrasePlan(missing, MACRO, MOTIFS), 'missing section');

const extra = clone(VALID);
extra.sections.C = { lead: [{ motif: 'A1', transform: 'literal', start_bar: 1, length_bars: 2 }] };
expectInvalid('a:extra-section', validatePhrasePlan(extra, MACRO, MOTIFS), 'unexpected section');

expectInvalid('a:not-object', validatePhrasePlan(null, MACRO, MOTIFS), 'object');
expectInvalid('a:no-sections', validatePhrasePlan({ A1: {} }, MACRO, MOTIFS), 'sections');

// phrase_structure is OPTIONAL metadata now — a bad value is a SOFT warning, not a failure.
const badStructure = clone(VALID);
badStructure.sections.A1.phrase_structure = 'verse';
const badStructureResult = validatePhrasePlan(badStructure, MACRO, MOTIFS);
if (!badStructureResult.ok) fail('a:phrase-structure-soft', `bad phrase_structure should be a soft note, got errors: ${JSON.stringify(badStructureResult.errors)}`);
if (!badStructureResult.warnings.some((w) => w.toLowerCase().includes('phrase_structure'))) {
  fail('a:phrase-structure-soft', `expected a soft phrase_structure warning, got ${JSON.stringify(badStructureResult.warnings)}`);
}

// =================================================================
// c. THE DETERMINISTIC BEAT-LENGTH / OVERFLOW CHECK (HARD)
// =================================================================

// Overflow: augment_2x DOUBLES the phrase (8 → 16 beats) but the slot is 8 beats.
const overflow = clone(VALID);
overflow.sections.A1.lead = [{ motif: 'A1', transform: 'augment_2x', start_bar: 1, length_bars: 2 }];
expectInvalid('c:overflow', validatePhrasePlan(overflow, MACRO, MOTIFS), 'overflow');

// Internal gap: diminute_2x HALVES the phrase (8 → 4 beats) in an 8-beat slot.
const internalGap = clone(VALID);
internalGap.sections.A1.lead = [{ motif: 'A1', transform: 'diminute_2x', start_bar: 1, length_bars: 2 }];
expectInvalid('c:internal-gap', validatePhrasePlan(internalGap, MACRO, MOTIFS), 'internal gap');

// fragment_tail also leaves an internal gap on a full-section slot.
const fragGap = clone(VALID);
fragGap.sections.A1.lead = [{ motif: 'A1', transform: 'fragment_tail', start_bar: 1, length_bars: 2 }];
expectInvalid('c:fragment-gap', validatePhrasePlan(fragGap, MACRO, MOTIFS), 'internal gap');

// A correctly-sized length-CHANGING transform passes: a 4-bar (16-beat) phrase,
// diminute_2x (→ 8 beats) placed twice across two 2-bar sub-slots, tiles the
// section exactly — and exercises the adjacent-identical SOFT warning.
const ADJ_MACRO = {
  tempo: 120, meter: { numerator: 4, denominator: 4, grouping: [4] }, tonic: 'C', mode: 'major',
  form: 'through_composed', total_bars: 4, register_center: 'C5', sections: [{ label: 'A', bars: 4 }],
};
const ADJ_MOTIFS = {
  A: { degrees: [1, 2, 3, 4, 5, 4, 3, 2, 1, 2, 3, 4, 5, 4, 3, 1], rhythm: Array.from({ length: 16 }, () => 1), contour: 'wandering', register: 'mid', anomaly: null },
};
const adjacent = {
  sections: {
    A: {
      lead: [
        { motif: 'A', transform: 'diminute_2x', start_bar: 1, length_bars: 2 },
        { motif: 'A', transform: 'diminute_2x', start_bar: 3, length_bars: 2 },
      ],
    },
  },
};
const adjacentResult = validatePhrasePlan(adjacent, ADJ_MACRO, ADJ_MOTIFS);
if (!adjacentResult.ok) fail('c:diminute-tiles', `correctly-sized diminute tiling should pass, got: ${JSON.stringify(adjacentResult.errors)}`);
if (!adjacentResult.warnings.some((w) => w.toLowerCase().includes('repeat'))) {
  fail('c:adjacent-soft', `expected an adjacent-identical soft warning, got ${JSON.stringify(adjacentResult.warnings)}`);
}

// =================================================================
// chord-fit guard (Session 11, reduced scope): a TRANSPOSING transform that shifts
// a phrase ENTIRELY off its bar's chord is rejected WHEN a harmonicPlan is supplied.
// =================================================================
const GUARD_MACRO = {
  ...MACRO, tonic: 'C', mode: 'major', form: 'binary', total_bars: 4,
  sections: [{ label: 'A', bars: 2 }, { label: 'B', bars: 2 }],
};
const GUARD_MOTIFS = {
  A: { degrees: [1, 3, 5, 8, 5, 3, 1, 3], rhythm: [1, 1, 1, 1, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
  B: { degrees: [1, 3, 5, 3, 5, 4, 3, 1], rhythm: [1, 1, 1, 1, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
};
// A's progression is I, I — sequence_up_step over bar 1's I sends the I-arpeggio
// phrase to degree classes {2,4,6}, none of which are chord tones of I {1,3,5}.
const GUARD_HARMONY_OFF = {
  sections: [
    { label: 'A', progression: ['I', 'I'], cadence: 'PAC' },
    { label: 'B', progression: ['I', 'I'], cadence: 'PAC' },
  ],
};
const offChordPlan = {
  sections: {
    A: { lead: [{ motif: 'A', transform: 'sequence_up_step', start_bar: 1, length_bars: 2 }] },
    B: { lead: [{ motif: 'B', transform: 'literal', start_bar: 1, length_bars: 2 }] },
  },
};
expectInvalid('a:guard-off-chord', validatePhrasePlan(offChordPlan, GUARD_MACRO, GUARD_MOTIFS, GUARD_HARMONY_OFF), 'wholesale clash');
// The 3-arg form (no harmonicPlan) skips the guard — otherwise valid.
expectOk('a:guard-skipped-no-harmony', validatePhrasePlan(offChordPlan, GUARD_MACRO, GUARD_MOTIFS));
// A partial fit (bar 1 = V → the transposed phrase shares degree 2 with V {5,7,2}) passes.
const GUARD_HARMONY_PARTIAL = {
  sections: [
    { label: 'A', progression: ['V', 'V'], cadence: 'half' },
    { label: 'B', progression: ['I', 'I'], cadence: 'PAC' },
  ],
};
expectOk('a:guard-partial-fit', validatePhrasePlan(offChordPlan, GUARD_MACRO, GUARD_MOTIFS, GUARD_HARMONY_PARTIAL));

// =================================================================
// d. buildPhrasePlanPrompt — pure { system, user }, names labels + vocab + directive
// =================================================================

const prompt = buildPhrasePlanPrompt({
  macroParams: MACRO,
  motifs: MOTIFS,
  harmonicPlan: HARMONIC,
  config: { knobs: { arrangement_adventurousness: 'wild' } },
});
if (typeof prompt.system !== 'string' || prompt.system.length === 0) fail('d:system', 'system prompt missing');
for (const needle of ['"A1"', '"B"', '"A3"', 'literal', 'transpose_third', 'PHRASES', 'sections', 'wild']) {
  if (!prompt.user.includes(needle)) fail('d:user', `user prompt does not mention ${needle}`);
}

// =================================================================
// b. generatePhrasePlan(__mockResponse) — offline parse/validate + e2e
// =================================================================

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

// The fully-generated case must exist and omit BOTH the phrasePlan and texturePlan.
const wanderer = GENERATED_CASES.find((c) => c.id === 'wanderer-fully-generated');
if (!wanderer) {
  fail('b:setup', 'GENERATED_CASES is missing wanderer-fully-generated');
} else {
  if (wanderer.phrasePlan !== undefined) fail('b:setup', 'wanderer-fully-generated should OMIT phrasePlan');
  if (wanderer.texturePlan !== undefined) fail('b:setup', 'wanderer-fully-generated should OMIT texturePlan');
  if (wanderer.motifs === undefined) fail('b:setup', 'wanderer-fully-generated should KEEP its (phrase-shaped) motifs');
}

const E2E = { macroParams: MACRO, motifs: MOTIFS, harmonicPlan: HARMONIC, title: 'verify-5a', mood: 'test' };
const expectedLabels = computeSectionPlan(MACRO).map((s) => s.label);
const validPhraseMock = JSON.stringify(VALID);
const validTextureMock = JSON.stringify(buildValidWrappedTexture(MACRO));

// (b1) valid arrangement mock → flat plan (keys = labels, no `sections` wrapper).
const flat = await generatePhrasePlan({ ...E2E, __mockResponse: validPhraseMock });
if (flat.sections !== undefined) fail('b1:flat', 'returned plan still has a `sections` wrapper — should be flat');
if (JSON.stringify(Object.keys(flat).sort()) !== JSON.stringify([...expectedLabels].sort())) {
  fail('b1:keys', `flat plan keys ${JSON.stringify(Object.keys(flat))} != section labels ${JSON.stringify(expectedLabels)}`);
}

// (b2) valid arrangement + texture mocks threaded through the runner → e2e FinalJingle.
let jingle;
try {
  jingle = await runPipelineGenerating({
    ...E2E,
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
await expectThrows('b3:bad-json', () => generatePhrasePlan({ ...E2E, __mockResponse: 'this is not json {{{' }));

// (b4) semantically invalid mock (beat-length overflow) → throws.
const semOverflow = clone(VALID);
semOverflow.sections.A1.lead = [{ motif: 'A1', transform: 'augment_2x', start_bar: 1, length_bars: 2 }];
await expectThrows('b4:overflow', () => generatePhrasePlan({ ...E2E, __mockResponse: JSON.stringify(semOverflow) }));

// (b5) semantically invalid mock (unknown transform) → throws.
const semBadTransform = clone(VALID);
semBadTransform.sections.A1.lead[0].transform = 'no_such_transform';
await expectThrows('b5:bad-transform', () => generatePhrasePlan({ ...E2E, __mockResponse: JSON.stringify(semBadTransform) }));

// Sanity: hand-supplied CASES still carry BOTH a phrasePlan and a texturePlan.
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
  'verify-stage5a PASSED — validatePhrasePlan catches every documented defect (unknown phrase/transform, missing '
    + 'param, bar-coverage gap/overlap/start, schema, chord-fit guard) and the DETERMINISTIC beat-length/overflow '
    + 'check (overflow + internal gap rejected; correctly-sized tiling passes); phrase_structure is soft, adjacent-'
    + 'identical is soft; generatePhrasePlan(__mockResponse) parses/validates offline, returns the flat plan, runs '
    + 'end-to-end through the pipeline (Stage 5b also mocked), and throws on malformed/invalid mocks.'
);
