/* =================================================================
   TRANSFORMATIONS — the motivic development algebra.

   Each export is a pure function (motif, params) → motif that develops a
   motif the way a composer would: transpose it, sequence it, invert it,
   fragment it, ornament it. Stage 5a (phrase placement) names one of these
   per motif occurrence in the PhrasePlan; Stage 6 applies it before
   realizing the result to pitches.

   DEGREE SPACE. Every transformation works on scale degrees, never on
   pitches. "Up a third" means up two scale steps in whatever mode realizes
   the motif later — so a transformation behaves identically in major,
   dorian, or phrygian dominant. The interval-number degree convention (and
   the degreeToLinear / linearToDegree bridge to a plain linear height) is
   defined in motif.js and reused here so octave bookkeeping is consistent:
   sequencing degree 7 up one step yields degree 8 (the octave), not a
   wrapped degree 1.

   PURITY. Inputs are never mutated; every function returns a fresh motif.
   The result's `contour` is recomputed from its resulting degrees (via
   contourOfDegrees) so the label stays honest — except `literal`, which is
   the identity and returns the motif verbatim. The result's `register` is
   carried through unchanged. Any declared `anomaly` is preserved and, where
   a transformation reorders or resizes the note list (retrograde, fragment,
   the ornaments), its `at_position` is remapped to keep pointing at the same
   note — or dropped if that note no longer exists.

   STRUCTURE INVARIANT. degrees and rhythm stay equal in length. The only
   functions that change the note count are the ornaments (add one note) and
   the fragments (remove notes); augment/diminute scale rhythm uniformly and
   leave the note count alone.

   PORTABILITY. Imports only from motif.js (itself dependency-free).
   ================================================================= */
import {
  validateMotif,
  contourOfDegrees,
  degreeToLinear,
  linearToDegree,
} from './motif.js';

// Build a fresh motif from new degrees/rhythm, recomputing the contour and
// carrying the source's register. `anomaly` is taken verbatim (already a
// fresh object, or null) — callers decide whether to preserve, remap, drop,
// or replace it.
function buildMotif(source, degrees, rhythm, anomaly) {
  return {
    degrees,
    rhythm,
    contour: contourOfDegrees(degrees),
    register: source.register,
    anomaly: anomaly ?? null,
  };
}

// A fresh copy of the source's anomaly with no positional change, or null.
function carryAnomaly(motif) {
  return motif.anomaly ? structuredClone(motif.anomaly) : null;
}

// Add `steps` scale steps to a degree, in linear space, so the result keeps
// correct octave bookkeeping (degree 7 + 1 step → degree 8). A rest (null) is
// transposition-invariant — it stays a rest.
function shiftDegree(degree, steps) {
  if (degree === null) return null;
  return linearToDegree(degreeToLinear(degree) + steps);
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer, got ${JSON.stringify(value)}.`);
  }
}

/**
 * Identity. Returns an exact deep copy of the motif (contour and anomaly
 * preserved verbatim — this is the one transformation that does not
 * recompute the contour).
 */
export function literal(motif) {
  validateMotif(motif);
  return structuredClone(motif);
}

/**
 * Transpose every degree by `steps` scale steps (a positive number moves up,
 * negative down), with octave bookkeeping: degree 7 transposed up one step
 * becomes degree 8 (the octave), degree 1 down one step becomes degree -2
 * (the second below). Rhythm and anomaly position are unchanged.
 */
export function transpose_step(motif, { steps } = {}) {
  validateMotif(motif);
  requireInteger(steps, 'transpose_step steps');
  const degrees = motif.degrees.map((degree) => shiftDegree(degree, steps));
  return buildMotif(motif, degrees, [...motif.rhythm], carryAnomaly(motif));
}

/**
 * Transpose by a third (two scale steps). `direction` is "up" (default) or
 * "down".
 */
export function transpose_third(motif, { direction = 'up' } = {}) {
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`transpose_third direction must be "up" or "down", got ${JSON.stringify(direction)}.`);
  }
  return transpose_step(motif, { steps: direction === 'down' ? -2 : 2 });
}

/**
 * Sequence the motif up one scale step (transpose_step with steps = +1).
 */
export function sequence_up_step(motif) {
  return transpose_step(motif, { steps: 1 });
}

/**
 * Sequence the motif down one scale step (transpose_step with steps = -1).
 */
export function sequence_down_step(motif) {
  return transpose_step(motif, { steps: -1 });
}

/**
 * Melodic inversion: reflect every degree around `pivot`. The reflection is
 * computed in linear pitch-height space (degree' such that its height is
 * 2·pivotHeight − height), so it is the true melodic mirror — an ascending
 * third below the pivot becomes a descending third above it, with no
 * spurious landing on the tonic. `pivot` defaults to the motif's first
 * degree, which fixes that note and mirrors the rest around it. Rhythm and
 * anomaly position are unchanged.
 */
export function invert(motif, { pivot } = {}) {
  validateMotif(motif);
  // Default pivot = the first SOUNDED degree (skip leading rests).
  const firstSounded = motif.degrees.find((d) => d !== null);
  const pivotDegree = pivot === undefined ? firstSounded : pivot;
  requireInteger(pivotDegree, 'invert pivot');
  if (pivotDegree === 0) {
    throw new Error('invert pivot must be a non-zero degree (there is no degree 0).');
  }
  const pivotHeight = degreeToLinear(pivotDegree);
  const degrees = motif.degrees.map((degree) =>
    degree === null ? null : linearToDegree(2 * pivotHeight - degreeToLinear(degree))
  );
  return buildMotif(motif, degrees, [...motif.rhythm], carryAnomaly(motif));
}

/**
 * Reverse the motif in time: both degrees and rhythm are reversed. A declared
 * anomaly's position is mirrored to keep pointing at the same note.
 */
export function retrograde(motif) {
  validateMotif(motif);
  const n = motif.degrees.length;
  const degrees = [...motif.degrees].reverse();
  const rhythm = [...motif.rhythm].reverse();

  let anomaly = carryAnomaly(motif);
  if (anomaly && Number.isInteger(anomaly.at_position)) {
    anomaly = { ...anomaly, at_position: n - 1 - anomaly.at_position };
  }
  return buildMotif(motif, degrees, rhythm, anomaly);
}

/**
 * Augmentation: double every rhythm value (the motif plays twice as slow).
 * Degrees, contour, and anomaly are unchanged.
 */
export function augment_2x(motif) {
  validateMotif(motif);
  const rhythm = motif.rhythm.map((beats) => beats * 2);
  return buildMotif(motif, [...motif.degrees], rhythm, carryAnomaly(motif));
}

/**
 * Diminution: halve every rhythm value (the motif plays twice as fast).
 * Degrees, contour, and anomaly are unchanged.
 */
export function diminute_2x(motif) {
  validateMotif(motif);
  const rhythm = motif.rhythm.map((beats) => beats / 2);
  return buildMotif(motif, [...motif.degrees], rhythm, carryAnomaly(motif));
}

// Resolve a fragment `count`: validate if supplied, otherwise default to
// half the motif rounded up.
function resolveFragmentCount(count, length, label) {
  if (count === undefined) return Math.ceil(length / 2);
  requireInteger(count, `${label} count`);
  if (count < 1 || count > length) {
    throw new Error(`${label} count must be between 1 and ${length}, got ${count}.`);
  }
  return count;
}

/**
 * Keep only the first `count` notes (the head). `count` defaults to half the
 * motif, rounded up. An anomaly inside the kept range is preserved; one on a
 * dropped note is removed.
 */
export function fragment_head(motif, { count } = {}) {
  validateMotif(motif);
  const keep = resolveFragmentCount(count, motif.degrees.length, 'fragment_head');
  const degrees = motif.degrees.slice(0, keep);
  const rhythm = motif.rhythm.slice(0, keep);

  let anomaly = carryAnomaly(motif);
  if (anomaly && Number.isInteger(anomaly.at_position) && anomaly.at_position >= keep) {
    anomaly = null;
  }
  return buildMotif(motif, degrees, rhythm, anomaly);
}

/**
 * Keep only the last `count` notes (the tail). `count` defaults to half the
 * motif, rounded up. An anomaly inside the kept range is preserved (with its
 * position re-based to the new start); one on a dropped note is removed.
 */
export function fragment_tail(motif, { count } = {}) {
  validateMotif(motif);
  const length = motif.degrees.length;
  const keep = resolveFragmentCount(count, length, 'fragment_tail');
  const start = length - keep;
  const degrees = motif.degrees.slice(start);
  const rhythm = motif.rhythm.slice(start);

  let anomaly = carryAnomaly(motif);
  if (anomaly && Number.isInteger(anomaly.at_position)) {
    const rebased = anomaly.at_position - start;
    anomaly = rebased >= 0 ? { ...anomaly, at_position: rebased } : null;
  }
  return buildMotif(motif, degrees, rhythm, anomaly);
}

// Validate an ornament position. `maxPosition` is the highest index allowed
// (length-1 for the neighbors, length-2 for the chromatic passing tone,
// which needs a following note to pass into).
function resolveOrnamentPosition(at_position, defaultPosition, maxPosition, label) {
  const position = at_position === undefined ? defaultPosition : at_position;
  requireInteger(position, `${label} at_position`);
  if (position < 0 || position > maxPosition) {
    throw new Error(`${label} at_position must be between 0 and ${maxPosition}, got ${position}.`);
  }
  return position;
}

// Insert one note after `position`, splitting that note's rhythm in half so
// the original note and the inserted note each take half. Returns the new
// degrees/rhythm and the index the inserted note landed at (position + 1).
function spliceOrnament(motif, position, insertedDegree) {
  const half = motif.rhythm[position] / 2;
  const degrees = [
    ...motif.degrees.slice(0, position + 1),
    insertedDegree,
    ...motif.degrees.slice(position + 1),
  ];
  const rhythm = [
    ...motif.rhythm.slice(0, position),
    half,
    half,
    ...motif.rhythm.slice(position + 1),
  ];
  return { degrees, rhythm, insertedIndex: position + 1 };
}

// Shift a carried anomaly's position to account for one note inserted at
// `insertedIndex`: any anomaly at or after that index moves up by one.
function shiftAnomalyForInsert(motif, insertedIndex) {
  const anomaly = carryAnomaly(motif);
  if (anomaly && Number.isInteger(anomaly.at_position) && anomaly.at_position >= insertedIndex) {
    return { ...anomaly, at_position: anomaly.at_position + 1 };
  }
  return anomaly;
}

/**
 * Ornament the note at `at_position` (default: the last note) with an upper
 * neighbor — the scale step above it — inserted right after it. That note's
 * rhythm is split in half between the original note and the neighbor, so the
 * note count grows by one.
 */
export function ornament_upper_neighbor(motif, { at_position } = {}) {
  validateMotif(motif);
  const position = resolveOrnamentPosition(
    at_position,
    motif.degrees.length - 1,
    motif.degrees.length - 1,
    'ornament_upper_neighbor'
  );
  const neighbor = shiftDegree(motif.degrees[position], 1);
  const { degrees, rhythm, insertedIndex } = spliceOrnament(motif, position, neighbor);
  return buildMotif(motif, degrees, rhythm, shiftAnomalyForInsert(motif, insertedIndex));
}

/**
 * Ornament the note at `at_position` (default: the last note) with a lower
 * neighbor — the scale step below it — inserted right after it. That note's
 * rhythm is split in half between the original note and the neighbor.
 */
export function ornament_lower_neighbor(motif, { at_position } = {}) {
  validateMotif(motif);
  const position = resolveOrnamentPosition(
    at_position,
    motif.degrees.length - 1,
    motif.degrees.length - 1,
    'ornament_lower_neighbor'
  );
  const neighbor = shiftDegree(motif.degrees[position], -1);
  const { degrees, rhythm, insertedIndex } = spliceOrnament(motif, position, neighbor);
  return buildMotif(motif, degrees, rhythm, shiftAnomalyForInsert(motif, insertedIndex));
}

/**
 * Insert a chromatic passing tone between the note at `at_position` (default:
 * the second-to-last note) and the note after it, splitting the first note's
 * rhythm in half. A chromatic pitch has no integer scale degree, so the
 * inserted note is stored with the departure note's degree as a placeholder
 * and the actual chromatic inflection is carried in the returned motif's
 * anomaly: `{ type: "chromatic_neighbor", at_position }`, where at_position
 * points at the inserted note in the returned motif. Stage 6 reads the
 * anomaly to realize the chromatic pitch (its direction inferred from the
 * flanking notes). This sets the motif's single anomaly slot, replacing any
 * existing anomaly.
 */
export function ornament_chromatic_passing(motif, { at_position } = {}) {
  validateMotif(motif);
  if (motif.degrees.length < 2) {
    throw new Error('ornament_chromatic_passing needs at least two notes to pass between.');
  }
  const position = resolveOrnamentPosition(
    at_position,
    motif.degrees.length - 2,
    motif.degrees.length - 2,
    'ornament_chromatic_passing'
  );
  const departureDegree = motif.degrees[position];
  const { degrees, rhythm, insertedIndex } = spliceOrnament(motif, position, departureDegree);
  const anomaly = { type: 'chromatic_neighbor', at_position: insertedIndex };
  return buildMotif(motif, degrees, rhythm, anomaly);
}
