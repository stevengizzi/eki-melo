/* =================================================================
   MOTIF — the scale-degree representation of a melodic cell, plus the
   helpers that read it.

   A motif is the smallest reusable unit of melody in the composition
   pipeline (buildplan Session 3). It lives in DEGREE SPACE, not pitch
   space: it knows it goes "up a third then down a step" without yet
   knowing which mode or key it will be realized in. Stage 6 (Session 4)
   turns degrees into concrete pitches via mode-engine's degreeToPitch;
   everything before that — motif design, transformation, phrase placement
   — is mode-agnostic and lives here.

   SHAPE.
     {
       degrees:  number[]   one entry per note; non-zero integers
       rhythm:   number[]   one entry per note; positive beat values
       contour:  string     one of CONTOURS (descriptive label)
       register: string     one of REGISTERS (octave placement hint)
       anomaly:  object|null a single declared rule-breaker (e.g. a
                            chromatic neighbor), or null
     }

   DEGREE NUMBERING. Degrees use the interval-number convention shared with
   mode-engine.js: a degree's magnitude is the interval size from the tonic
   (1 = tonic, 2 = a second, 8 = the octave) and its sign is the direction.
   So 1..7 are the in-octave degrees, +8 is the tonic an octave up, -8 the
   tonic an octave down, +9 the second an octave up, and -3 the third below
   the tonic. There is no degree 0 (and -1 is a redundant spelling of the
   tonic). Octave bookkeeping is heptatonic here by design: a motif is
   authored in seven-degree thinking, so +8 always means "up an octave"
   regardless of how many notes the realizing scale turns out to have. A
   pentatonic realization of these degrees is mode-engine's concern, not the
   motif's.

   PORTABILITY. This module has zero imports — no synth, no scales, nothing
   outside itself. It is portable to any composition project as-is.
   ================================================================= */

// The closed vocabulary of contour labels (motifContour derives one of
// these from a degree sequence) and register hints. Bad values are rejected
// at validation rather than caught downstream.
export const CONTOURS = [
  'rising_arc',
  'falling_arc',
  'peak_descend',
  'valley_ascend',
  'static',
  'wandering',
];

export const REGISTERS = ['low', 'mid', 'high'];

// Number of scale degrees per octave in motif space (always heptatonic —
// see the module header).
const DEGREES_PER_OCTAVE = 7;

/**
 * Linear height of a degree: its signed number of scale steps from the
 * tonic (tonic = 0, the second = 1, the octave = 7, the third below = -2).
 * This is the monotonic-in-pitch coordinate the rest of the module reasons
 * in; it is the inverse of linearToDegree.
 */
export function degreeToLinear(degree) {
  return Math.sign(degree) * (Math.abs(degree) - 1);
}

/**
 * The interval-number degree for a linear height (the inverse of
 * degreeToLinear): 0 → 1 (tonic), 7 → 8 (octave up), -1 → -2 (second
 * below). The convention has no degree 0, so non-negative heights map to
 * +1 and negative heights to -1.
 */
export function linearToDegree(linear) {
  return linear >= 0 ? linear + 1 : linear - 1;
}

// Split a degree into its in-octave degree (1..7) and the net octave it
// sits in. Heptatonic wrap: +8 → { degree: 1, octaveOffset: +1 },
// -3 → { degree: 6, octaveOffset: -1 }.
function decomposeDegree(degree) {
  const linear = degreeToLinear(degree);
  const octaveOffset = Math.floor(linear / DEGREES_PER_OCTAVE);
  const indexInOctave = ((linear % DEGREES_PER_OCTAVE) + DEGREES_PER_OCTAVE) % DEGREES_PER_OCTAVE;
  return { degree: indexInOctave + 1, octaveOffset };
}

const isNonZeroInteger = (value) => Number.isInteger(value) && value !== 0;
const isPositiveFinite = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Throw a descriptive error if `motif` is not a well-formed motif; return
 * the motif unchanged otherwise. Checks: degrees is a non-empty array of
 * non-zero integers; rhythm is an equal-length array of positive finite
 * numbers; contour and register are members of their vocabularies; anomaly
 * is null or an object carrying a string `type`.
 */
export function validateMotif(motif) {
  if (!motif || typeof motif !== 'object' || Array.isArray(motif)) {
    throw new Error(`Motif must be an object, got ${motif === null ? 'null' : typeof motif}.`);
  }

  const { degrees, rhythm, contour, register, anomaly } = motif;

  if (!Array.isArray(degrees) || degrees.length === 0) {
    throw new Error('Motif.degrees must be a non-empty array.');
  }
  degrees.forEach((degree, i) => {
    if (!isNonZeroInteger(degree)) {
      throw new Error(`Motif.degrees[${i}] must be a non-zero integer, got ${JSON.stringify(degree)}.`);
    }
  });

  if (!Array.isArray(rhythm) || rhythm.length !== degrees.length) {
    throw new Error(
      `Motif.rhythm must be an array the same length as degrees ` +
        `(${degrees.length}), got length ${Array.isArray(rhythm) ? rhythm.length : typeof rhythm}.`
    );
  }
  rhythm.forEach((beats, i) => {
    if (!isPositiveFinite(beats)) {
      throw new Error(`Motif.rhythm[${i}] must be a positive number of beats, got ${JSON.stringify(beats)}.`);
    }
  });

  if (!CONTOURS.includes(contour)) {
    throw new Error(`Motif.contour must be one of ${CONTOURS.join(', ')}, got ${JSON.stringify(contour)}.`);
  }
  if (!REGISTERS.includes(register)) {
    throw new Error(`Motif.register must be one of ${REGISTERS.join(', ')}, got ${JSON.stringify(register)}.`);
  }

  if (anomaly !== null) {
    if (typeof anomaly !== 'object' || Array.isArray(anomaly)) {
      throw new Error(`Motif.anomaly must be null or an object, got ${typeof anomaly}.`);
    }
    if (typeof anomaly.type !== 'string' || anomaly.type.length === 0) {
      throw new Error('Motif.anomaly must carry a non-empty string "type".');
    }
  }

  return motif;
}

/**
 * The contour label of a degree sequence, classified by the position of its
 * single turning point (if any) and whether it ends above or below where it
 * began. Used internally and by transformations.js; assumes `degrees` is a
 * valid (non-empty, non-zero-integer) array. motifContour is the validating
 * public entry point.
 *
 * - static       — no movement (one note, or all the same pitch)
 * - rising_arc   — monotonic up, OR up-then-down ending higher than it began
 * - falling_arc  — monotonic down, OR down-then-up ending lower than it began
 * - peak_descend — up to an apex, then back down to or below the start
 * - valley_ascend— down to a nadir, then back up to or above the start
 * - wandering    — two or more turning points (no single arc)
 *
 * Degrees are read literally: writing 1 (the low tonic) where 8 (the octave)
 * was meant changes the contour, since 1 sits below 7 in pitch.
 */
export function contourOfDegrees(degrees) {
  const heights = degrees.map(degreeToLinear);
  const n = heights.length;
  if (n === 1) return 'static';
  if (Math.max(...heights) === Math.min(...heights)) return 'static';

  // Reduce to a sequence of monotonic runs: each consecutive non-zero step
  // direction, with repeated pitches ignored and same-direction steps
  // collapsed. [up, up, down] becomes [+1, -1]; its length is the run count.
  const runs = [];
  for (let i = 1; i < n; i++) {
    const step = Math.sign(heights[i] - heights[i - 1]);
    if (step === 0) continue;
    if (runs.length === 0 || runs[runs.length - 1] !== step) runs.push(step);
  }

  if (runs.length >= 3) return 'wandering';
  if (runs.length === 1) return runs[0] > 0 ? 'rising_arc' : 'falling_arc';

  const endsAboveStart = heights[n - 1] > heights[0];
  const endsBelowStart = heights[n - 1] < heights[0];
  if (runs[0] > 0) return endsAboveStart ? 'rising_arc' : 'peak_descend';
  return endsBelowStart ? 'falling_arc' : 'valley_ascend';
}

/**
 * The contour label of `motif`, derived from its degree sequence. Validates
 * the motif first. Note this is computed fresh and may differ from the
 * motif's stored `contour` field if that was hand-authored.
 */
export function motifContour(motif) {
  validateMotif(motif);
  return contourOfDegrees(motif.degrees);
}

/**
 * The total length of `motif` in beats — the sum of its rhythm values.
 */
export function motifTotalBeats(motif) {
  validateMotif(motif);
  return motif.rhythm.reduce((total, beats) => total + beats, 0);
}

/**
 * Render `motif` to a flat array of degree events, one per note, starting at
 * absolute beat `startBeat` (default 0). Each event is
 * `{ degree, octave_offset, beat, duration }` where `degree` is the in-octave
 * degree (1..7), `octave_offset` is the net octave the note sits in (so an
 * input degree of +8 yields `{ degree: 1, octave_offset: 1 }`), `beat` is the
 * absolute start beat, and `duration` is the note's length in beats.
 *
 * Stage 6 realizes each event with mode-engine's degreeToPitch by passing the
 * in-octave `degree` against a tonic octave shifted by `octave_offset`.
 */
export function renderMotifToDegreeEvents(motif, startBeat = 0) {
  validateMotif(motif);
  if (typeof startBeat !== 'number' || !Number.isFinite(startBeat)) {
    throw new Error(`startBeat must be a finite number, got ${JSON.stringify(startBeat)}.`);
  }

  let beat = startBeat;
  return motif.degrees.map((rawDegree, i) => {
    const duration = motif.rhythm[i];
    const { degree, octaveOffset } = decomposeDegree(rawDegree);
    const event = { degree, octave_offset: octaveOffset, beat, duration };
    beat += duration;
    return event;
  });
}
