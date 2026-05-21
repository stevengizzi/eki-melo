/* =================================================================
   MODE ENGINE — resolves any scale name to its pitch set in any key.

   The deterministic music-theory layer for the composition pipeline
   (buildplan Session 1, amended). Reads the verified scale library in
   scales.json and answers: what pitches does scale X rooted on Y contain,
   and which concrete pitch is degree D of that scale?

   PITCH IDENTITY, NOT RENDERING. Every result is a structured Pitch object
   ({ letter, accidental, octave }) carrying its full music-theoretic
   spelling — see pitch.js. Spelling is derived from each scale's `spelling`
   array (a `letter_step` + `accidental` per degree) combined with the
   tonic, so the output is theoretically correct: Gb major spells its 4th as
   Cb (not B), F# major's 7th as E# (not F). Letters are assigned by the
   scale formula and the accidental — including a double accidental where the
   theory demands one — falls out of the arithmetic. The synth's
   single-accidental needs are served separately by synth-rendering.js's
   toSynthString, applied at the synth boundary.

   PORTABILITY. This module imports only from pitch.js and scales.json,
   nothing synth-specific. It is portable to other composition projects
   (including score-notation ones) as-is.

   DEGREE NUMBERING. degreeToPitch uses the interval-number convention: a
   degree's magnitude is the interval size from the tonic (1 = unison/tonic,
   2 = a second, 8 = the octave) and its sign is the direction. So +8 is the
   tonic an octave up, -8 the tonic an octave down, and -3 the third below
   the tonic. This is the model implied by the motif schema in the buildplan.
   ================================================================= */
import scales from './scales.json' with { type: 'json' };
import { pitchFromLetterAndAccidental, toMidi, parseScoreString } from './pitch.js';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTER_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

// A diatonic "letter ordinal": octave * 7 + the letter's index from C, so
// that advancing by N letters and inverting the result both wrap the octave
// at the C boundary (B4 + 1 letter = C5), matching scientific pitch notation.
function letterOrdinal(letter, octave) {
  return octave * 7 + LETTER_INDEX[letter];
}

function letterFromOrdinal(ordinal) {
  return LETTERS[((ordinal % 7) + 7) % 7];
}

function octaveFromOrdinal(ordinal) {
  return Math.floor(ordinal / 7);
}

// Semitone offset of each scale degree from the tonic, within one octave:
// [0, i0, i0+i1, ...] with one entry per note (the trailing octave step is
// not included).
function cumulativeOffsets(intervals) {
  const offsets = [0];
  for (let i = 0; i < intervals.length - 1; i++) {
    offsets.push(offsets[i] + intervals[i]);
  }
  return offsets;
}

function rawScale(name) {
  if (typeof name !== 'string' || !(name in scales)) {
    throw new Error(`Unknown scale "${name}". See scales.json for available scales.`);
  }
  return scales[name];
}

// Normalise a tonic argument to a Pitch. Accepts a Pitch object (used as-is,
// its own octave honoured), a score string with an octave ("Gb4"), or a bare
// note name ("D", "F#", "Bb") that takes the supplied default octave.
function resolveTonic(tonic, octave) {
  if (tonic && typeof tonic === 'object') {
    return pitchFromLetterAndAccidental(tonic.letter, tonic.accidental, tonic.octave);
  }
  if (typeof tonic === 'string') {
    const hasOctave = /-?\d+$/.test(tonic);
    return parseScoreString(hasOctave ? tonic : `${tonic}${octave}`);
  }
  throw new Error(`tonic must be a note name (e.g. "D", "Gb") or a Pitch object, got ${typeof tonic}.`);
}

// Build the Pitch for one scale degree given the tonic, the degree's
// letter_step (diatonic letters to advance from the tonic) and its semitone
// offset from the tonic. The accidental is whatever lands the assigned
// letter on the target sounding pitch — so double accidentals appear exactly
// when the theory requires them.
function spellDegree(tonicOrdinal, tonicMidi, letterStep, semitoneOffset) {
  const ordinal = tonicOrdinal + letterStep;
  const letter = letterFromOrdinal(ordinal);
  const letterOctave = octaveFromOrdinal(ordinal);
  const targetMidi = tonicMidi + semitoneOffset;
  const naturalMidi = (letterOctave + 1) * 12 + LETTER_PITCH_CLASS[letter];
  return pitchFromLetterAndAccidental(letter, targetMidi - naturalMidi, letterOctave);
}

/**
 * The full scale data object for `name`, returned as a fresh copy so callers
 * cannot mutate the shared library.
 */
export function getScale(name) {
  return structuredClone(rawScale(name));
}

/**
 * Pitch objects of `name` rooted on `tonic`, in ascending order, one per
 * scale degree. `tonic` is a note name or Pitch; `octave` (default 4) is the
 * tonic's octave when given without one. e.g. pitchSetForScale("dorian", "D")
 * yields the spellings D E F G A B C (each as a Pitch object).
 */
export function pitchSetForScale(name, tonic, octave = 4) {
  const scale = rawScale(name);
  const tonicPitch = resolveTonic(tonic, octave);
  const tonicOrdinal = letterOrdinal(tonicPitch.letter, tonicPitch.octave);
  const tonicMidi = toMidi(tonicPitch);
  const offsets = cumulativeOffsets(scale.intervals);
  return scale.spelling.map((degree, i) =>
    spellDegree(tonicOrdinal, tonicMidi, degree.letter_step, offsets[i])
  );
}

/**
 * The Pitch of scale degree `degree` of `name` rooted on `tonic`, where
 * `octave` is the scientific-notation octave of the tonic.
 *
 * `degree` uses interval numbering: 1 = tonic, 2 = the second, 8 = the octave
 * above, with negative values mirroring below the tonic (-3 = the third
 * below). Values beyond ±8 wrap with octave bookkeeping (9 = the second an
 * octave up, and so on).
 */
export function degreeToPitch(name, tonic, degree, octave = 4) {
  if (!Number.isInteger(degree) || degree === 0) {
    throw new Error(`degree must be a non-zero integer, got ${degree}.`);
  }
  const scale = rawScale(name);
  const tonicPitch = resolveTonic(tonic, octave);
  const offsets = cumulativeOffsets(scale.intervals);
  const noteCount = offsets.length;

  const stepsFromTonic = Math.sign(degree) * (Math.abs(degree) - 1);
  const octaveShift = Math.floor(stepsFromTonic / noteCount);
  const scaleIndex = ((stepsFromTonic % noteCount) + noteCount) % noteCount;

  const tonicOrdinal = letterOrdinal(tonicPitch.letter, tonicPitch.octave) + octaveShift * 7;
  const tonicMidi = toMidi(tonicPitch) + octaveShift * 12;
  return spellDegree(
    tonicOrdinal,
    tonicMidi,
    scale.spelling[scaleIndex].letter_step,
    offsets[scaleIndex]
  );
}

/**
 * Names of every scale whose `tags` include `tag`.
 */
export function listScalesByTag(tag) {
  if (typeof tag !== 'string') {
    throw new Error(`tag must be a string, got ${typeof tag}.`);
  }
  return Object.keys(scales).filter((name) => scales[name].tags.includes(tag));
}

/**
 * Names of every scale in `family`.
 */
export function listScalesByFamily(family) {
  if (typeof family !== 'string') {
    throw new Error(`family must be a string, got ${typeof family}.`);
  }
  return Object.keys(scales).filter((name) => scales[name].family === family);
}
