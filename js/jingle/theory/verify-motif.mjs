/* =================================================================
   VERIFY-MOTIF — exit-criterion check for the motif representation and the
   transformation library (buildplan Session 3).

   It confirms:
     1. motif.js — validateMotif accepts well-formed motifs and rejects each
        class of malformed input; renderMotifToDegreeEvents decomposes the
        octave-displacement cases from the buildplan correctly (+8, -8, -3,
        +9) and lays beats out in absolute time; motifTotalBeats sums rhythm;
        motifContour classifies the six contour categories; the
        degreeToLinear / linearToDegree bridge round-trips.
     2. transformations.js — every transformation is pure (the input motif is
        never mutated) and returns a valid motif; the degrees/rhythm
        length invariant holds (equal length except ornaments +1 and the
        fragments); and the specific algebra is correct: literal identity,
        transpose octave bookkeeping (degree 7 + 1 step = degree 8), thirds,
        sequence aliases, melodic inversion, retrograde (with anomaly
        mirroring), augment/diminute, fragment head/tail (with anomaly
        keep/drop/rebase), the neighbor ornaments (note inserted, rhythm
        split), and the chromatic passing tone (anomaly flagged).

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as verify-spelling.mjs and
   verify-forms.mjs (the repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-motif.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import {
  validateMotif,
  renderMotifToDegreeEvents,
  motifTotalBeats,
  motifContour,
  contourOfDegrees,
  degreeToLinear,
  linearToDegree,
} from './motif.js';
import * as T from './transformations.js';

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function expect(scope, actual, expected) {
  if (!eq(actual, expected)) {
    fail(scope, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectThrows(scope, thunk) {
  let threw = false;
  try {
    thunk();
  } catch {
    threw = true;
  }
  if (!threw) fail(scope, 'expected a throw, but none happened');
}

// A canonical valid motif reused across the transformation checks.
const base = {
  degrees: [1, 3, 5, 4],
  rhythm: [0.5, 0.5, 1, 0.5],
  contour: 'rising_arc',
  register: 'mid',
  anomaly: null,
};

// --- 1. motif.js -----------------------------------------------------------

// degree <-> linear round-trip across the conventional range (skip 0; -1 is a
// redundant tonic spelling and is not produced by linearToDegree).
for (let degree = -15; degree <= 15; degree++) {
  if (degree === 0 || degree === -1) continue;
  const back = linearToDegree(degreeToLinear(degree));
  expect('motif:degree-linear-roundtrip', back, degree);
}

// validateMotif accepts the base motif and returns it.
expect('motif:validate-accepts', validateMotif(base), base);

// validateMotif rejects each malformed class.
expectThrows('motif:validate-null', () => validateMotif(null));
expectThrows('motif:validate-degrees-empty', () =>
  validateMotif({ ...base, degrees: [], rhythm: [] })
);
expectThrows('motif:validate-degree-zero', () =>
  validateMotif({ ...base, degrees: [1, 0, 3], rhythm: [1, 1, 1] })
);
expectThrows('motif:validate-degree-nonint', () =>
  validateMotif({ ...base, degrees: [1, 2.5], rhythm: [1, 1] })
);
expectThrows('motif:validate-rhythm-length', () =>
  validateMotif({ ...base, rhythm: [1, 1] })
);
expectThrows('motif:validate-rhythm-nonpositive', () =>
  validateMotif({ ...base, rhythm: [0.5, 0.5, 1, 0] })
);
expectThrows('motif:validate-contour', () => validateMotif({ ...base, contour: 'spiral' }));
expectThrows('motif:validate-register', () => validateMotif({ ...base, register: 'middle' }));
expectThrows('motif:validate-anomaly-no-type', () =>
  validateMotif({ ...base, anomaly: { at_position: 1 } })
);

// renderMotifToDegreeEvents — the octave-displacement decomposition cases
// from buildplan §3 (degree -> { in-octave degree, net octave }).
const octaveMotif = {
  degrees: [1, 8, -8, -3, 9],
  rhythm: [1, 1, 1, 1, 1],
  contour: 'wandering',
  register: 'mid',
  anomaly: null,
};
const octaveEvents = renderMotifToDegreeEvents(octaveMotif, 0);
expect('motif:render-decompose', octaveEvents.map((e) => [e.degree, e.octave_offset]), [
  [1, 0], // 1  -> tonic
  [1, 1], // +8 -> tonic an octave up
  [1, -1], // -8 -> tonic an octave down
  [6, -1], // -3 -> sixth degree an octave down (the third below the tonic)
  [2, 1], // +9 -> second an octave up
]);

// renderMotifToDegreeEvents — absolute beat layout and duration.
const renderedBase = renderMotifToDegreeEvents(base, 4);
expect(
  'motif:render-beats',
  renderedBase.map((e) => e.beat),
  [4, 4.5, 5, 6]
);
expect(
  'motif:render-durations',
  renderedBase.map((e) => e.duration),
  [0.5, 0.5, 1, 0.5]
);
expectThrows('motif:render-bad-startbeat', () => renderMotifToDegreeEvents(base, 'x'));

// motifTotalBeats.
expect('motif:total-beats', motifTotalBeats(base), 2.5);

// motifContour — one representative per category, plus the buildplan example.
expect('motif:contour-rising', contourOfDegrees([1, 3, 5, 4]), 'rising_arc');
expect('motif:contour-rising-monotonic', contourOfDegrees([1, 2, 3, 5]), 'rising_arc');
expect('motif:contour-falling', contourOfDegrees([5, 3, 1]), 'falling_arc');
expect('motif:contour-peak', contourOfDegrees([1, 3, 5, 3, 1]), 'peak_descend');
expect('motif:contour-valley', contourOfDegrees([5, 3, 1, 3, 5]), 'valley_ascend');
expect('motif:contour-static-one', contourOfDegrees([4]), 'static');
expect('motif:contour-static-flat', contourOfDegrees([3, 3, 3]), 'static');
expect('motif:contour-wandering', contourOfDegrees([1, 5, 2, 6]), 'wandering');
// motifContour validates and reads the live degrees (not the stored label).
expect('motif:contour-derived', motifContour(base), 'rising_arc');

// --- 2. transformations.js -------------------------------------------------

// Purity + validity harness: snapshot the input, run the transform, confirm
// the input is untouched and the output validates and holds the structure
// invariant (rhythm length matches degrees length).
function checkTransform(scope, input, run) {
  const snapshot = structuredClone(input);
  const result = run(input);
  if (!eq(input, snapshot)) fail(scope, 'mutated its input motif');
  try {
    validateMotif(result);
  } catch (error) {
    fail(scope, `produced an invalid motif: ${error.message}`);
  }
  if (result.rhythm.length !== result.degrees.length) {
    fail(scope, `rhythm length ${result.rhythm.length} != degrees length ${result.degrees.length}`);
  }
  return result;
}

// literal — exact identity.
expect('xf:literal', checkTransform('xf:literal', base, T.literal), base);

// transpose_step — octave bookkeeping: degree 7 + 1 step = degree 8.
const up1 = checkTransform('xf:transpose_step', { ...base, degrees: [1, 5, 7], rhythm: [1, 1, 1] }, (m) =>
  T.transpose_step(m, { steps: 1 })
);
expect('xf:transpose_step-degrees', up1.degrees, [2, 6, 8]);
expect('xf:transpose_step-rhythm', up1.rhythm, [1, 1, 1]);
// Down across the tonic: degree 1 - 1 step = degree -2 (the second below).
const down1 = T.transpose_step(base, { steps: -1 });
expect('xf:transpose_step-down', down1.degrees, [-2, 2, 4, 3]);
expectThrows('xf:transpose_step-missing', () => T.transpose_step(base));

// transpose_third — up = +2 steps, down = -2 steps.
expect('xf:transpose_third-up', T.transpose_third(base, { direction: 'up' }).degrees, [3, 5, 7, 6]);
expect('xf:transpose_third-down', T.transpose_third(base, { direction: 'down' }).degrees, [-3, 1, 3, 2]);
expect('xf:transpose_third-default', T.transpose_third(base).degrees, [3, 5, 7, 6]);
expectThrows('xf:transpose_third-bad-dir', () => T.transpose_third(base, { direction: 'sideways' }));

// sequence aliases.
expect('xf:sequence_up', T.sequence_up_step(base).degrees, T.transpose_step(base, { steps: 1 }).degrees);
expect('xf:sequence_down', T.sequence_down_step(base).degrees, T.transpose_step(base, { steps: -1 }).degrees);

// invert — melodic mirror around the first degree by default.
const inverted = checkTransform('xf:invert', base, (m) => T.invert(m));
expect('xf:invert-degrees', inverted.degrees, [1, -3, -5, -4]);
// invert is its own inverse around a fixed pivot.
expect('xf:invert-involution', T.invert(inverted, { pivot: 1 }).degrees, base.degrees);
// explicit pivot.
expect('xf:invert-pivot', T.invert(base, { pivot: 5 }).degrees, [9, 7, 5, 6]);

// retrograde — reverses degrees and rhythm; mirrors anomaly position.
const anomalyMotif = { ...base, anomaly: { type: 'chromatic_neighbor', at_position: 1 } };
const retro = checkTransform('xf:retrograde', anomalyMotif, T.retrograde);
expect('xf:retrograde-degrees', retro.degrees, [4, 5, 3, 1]);
expect('xf:retrograde-rhythm', retro.rhythm, [0.5, 1, 0.5, 0.5]);
expect('xf:retrograde-anomaly', retro.anomaly, { type: 'chromatic_neighbor', at_position: 2 });

// augment / diminute — scale rhythm uniformly, leave degrees alone.
const aug = checkTransform('xf:augment', base, T.augment_2x);
expect('xf:augment-rhythm', aug.rhythm, [1, 1, 2, 1]);
expect('xf:augment-degrees', aug.degrees, base.degrees);
const dim = checkTransform('xf:diminute', base, T.diminute_2x);
expect('xf:diminute-rhythm', dim.rhythm, [0.25, 0.25, 0.5, 0.25]);

// fragment_head / fragment_tail — default count is half rounded up.
const head = checkTransform('xf:fragment_head', base, (m) => T.fragment_head(m));
expect('xf:fragment_head-degrees', head.degrees, [1, 3]);
expect('xf:fragment_head-rhythm', head.rhythm, [0.5, 0.5]);
const tail = checkTransform('xf:fragment_tail', base, (m) => T.fragment_tail(m));
expect('xf:fragment_tail-degrees', tail.degrees, [5, 4]);
expect('xf:fragment_tail-rhythm', tail.rhythm, [1, 0.5]);
expect('xf:fragment_head-count', T.fragment_head(base, { count: 3 }).degrees, [1, 3, 5]);
expectThrows('xf:fragment_head-oob', () => T.fragment_head(base, { count: 99 }));
// fragment anomaly handling: kept-and-rebased on tail, dropped when removed.
const fa = { ...base, anomaly: { type: 'chromatic_neighbor', at_position: 3 } };
expect('xf:fragment_tail-anomaly-rebase', T.fragment_tail(fa, { count: 2 }).anomaly, {
  type: 'chromatic_neighbor',
  at_position: 1,
});
expect('xf:fragment_head-anomaly-drop', T.fragment_head(fa, { count: 2 }).anomaly, null);

// ornament_upper_neighbor — inserts the step above at the last note; splits
// that note's rhythm; grows the note count by one.
const upper = checkTransform('xf:ornament_upper', base, (m) => T.ornament_upper_neighbor(m));
expect('xf:ornament_upper-degrees', upper.degrees, [1, 3, 5, 4, 5]);
expect('xf:ornament_upper-rhythm', upper.rhythm, [0.5, 0.5, 1, 0.25, 0.25]);

// ornament_lower_neighbor at an explicit position (the first note here, whose
// step below crosses the tonic to degree -2).
const lower = checkTransform('xf:ornament_lower', base, (m) =>
  T.ornament_lower_neighbor(m, { at_position: 0 })
);
expect('xf:ornament_lower-degrees', lower.degrees, [1, -2, 3, 5, 4]);
expect('xf:ornament_lower-rhythm', lower.rhythm, [0.25, 0.25, 0.5, 1, 0.5]);

// ornament_chromatic_passing — inserts a placeholder note and flags the
// anomaly pointing at the inserted note.
const chrom = checkTransform('xf:ornament_chromatic', base, (m) =>
  T.ornament_chromatic_passing(m, { at_position: 1 })
);
expect('xf:ornament_chromatic-degrees', chrom.degrees, [1, 3, 3, 5, 4]);
expect('xf:ornament_chromatic-rhythm', chrom.rhythm, [0.5, 0.25, 0.25, 1, 0.5]);
expect('xf:ornament_chromatic-anomaly', chrom.anomaly, {
  type: 'chromatic_neighbor',
  at_position: 2,
});
expectThrows('xf:ornament_chromatic-oob', () =>
  T.ornament_chromatic_passing(base, { at_position: 3 })
);

// --- report ----------------------------------------------------------------
if (failures.length > 0) {
  console.error(`verify-motif FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log('verify-motif PASSED — motif.js and transformations.js are consistent.');
