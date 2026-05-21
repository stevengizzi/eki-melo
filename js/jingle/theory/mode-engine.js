/* =================================================================
   MODE ENGINE — resolves any scale name to its pitch set in any key

   The deterministic music-theory layer for the composition pipeline
   (buildplan Session 1). Reads the verified scale library in
   scales.json and answers: what pitches does scale X rooted on Y
   contain, and which concrete pitch is degree D of that scale?

   PITCH SPELLING. Output pitch strings (e.g. "Eb5", "F#3") are spelled
   by pitch class with a single sharp-or-flat preference derived from
   the tonic — never by diatonic letter-stepping. This is deliberate:
   the existing synth's noteToFreq (js/jingle/synth.js) only understands
   the 17 names in NOTE_MAP and a single accidental, so spellings like
   "Cb", "E#", or "F##" would parse to NaN and play silence. Enharmonic
   equivalents are frequency-identical, so choosing by pitch class costs
   nothing audible and keeps every output parseable.

   DEGREE NUMBERING. degreeToPitch uses the interval-number convention:
   a degree's magnitude is the interval size from the tonic (1 = unison/
   tonic, 2 = a second, 3 = a third, 8 = the octave) and its sign is the
   direction. So +8 is the tonic an octave up, -8 the tonic an octave
   down, and -3 the third below the tonic. This is the model implied by
   the motif schema in the buildplan (degrees 1-7 with +8/-8 markers and
   negative degrees for notes below the tonic).
   ================================================================= */
import scales from './scales.json' with { type: 'json' };

// Pitch class of each note name the tonic may be given as. Mirrors the
// subset of synth.js NOTE_MAP used for roots; both sharp and flat
// spellings resolve to the same class.
const NOTE_TO_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11
};

// Per-class names guaranteed to live in synth.js NOTE_MAP. No "Cb",
// "E#", or double accidentals ever appear here, so every emitted name
// is parseable by noteToFreq.
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Tonics on the sharp side of the circle of fifths spell black keys as
// sharps; everything else (C, F, and any flat tonic) spells them flat.
const SHARP_SIDE_TONICS = new Set(['G', 'D', 'A', 'E', 'B']);

function pitchClassOf(tonic) {
  if (typeof tonic !== 'string' || !(tonic in NOTE_TO_PC)) {
    throw new Error(`Unknown tonic "${tonic}". Expected a note name like "C", "F#", or "Bb".`);
  }
  return NOTE_TO_PC[tonic];
}

function accidentalPreferenceFor(tonic) {
  if (tonic.includes('#')) return 'sharp';
  if (tonic.includes('b')) return 'flat';
  return SHARP_SIDE_TONICS.has(tonic) ? 'sharp' : 'flat';
}

function nameForPitchClass(pitchClass, preference) {
  return (preference === 'sharp' ? SHARP_NAMES : FLAT_NAMES)[pitchClass];
}

// Semitone offset of each scale degree from the tonic, within one
// octave. [0, i0, i0+i1, ...] with one entry per note (the trailing
// octave step is not included).
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

/**
 * The full scale data object for `name`, returned as a fresh copy so
 * callers cannot mutate the shared library.
 */
export function getScale(name) {
  return structuredClone(rawScale(name));
}

/**
 * Pitch class names of `name` rooted on `tonic`, in ascending order,
 * one per scale degree. e.g. pitchSetForScale("dorian", "D") →
 * ["D", "E", "F", "G", "A", "B", "C"].
 */
export function pitchSetForScale(name, tonic) {
  const scale = rawScale(name);
  const tonicPc = pitchClassOf(tonic);
  const preference = accidentalPreferenceFor(tonic);
  return cumulativeOffsets(scale.intervals)
    .map((offset) => nameForPitchClass((tonicPc + offset) % 12, preference));
}

/**
 * The concrete pitch of scale degree `degree` of `name` rooted on
 * `tonic`, where `octave` is the scientific-notation octave of the
 * tonic. Returns a pitch string like "D5" parseable by synth.js
 * noteToFreq.
 *
 * `degree` uses interval numbering: 1 = tonic, 2 = the second, 8 = the
 * octave above, with negative values mirroring below the tonic
 * (-3 = the third below). Values beyond ±8 wrap with octave bookkeeping
 * (9 = the second an octave up, and so on).
 */
export function degreeToPitch(name, tonic, degree, octave = 4) {
  if (!Number.isInteger(degree) || degree === 0) {
    throw new Error(`degree must be a non-zero integer, got ${degree}.`);
  }
  if (!Number.isInteger(octave)) {
    throw new Error(`octave must be an integer, got ${octave}.`);
  }
  const scale = rawScale(name);
  const offsets = cumulativeOffsets(scale.intervals);
  const noteCount = offsets.length;

  const stepsFromTonic = Math.sign(degree) * (Math.abs(degree) - 1);
  const octaveShift = Math.floor(stepsFromTonic / noteCount);
  const scaleIndex = ((stepsFromTonic % noteCount) + noteCount) % noteCount;

  const tonicSemitone = (octave - 4) * 12 + pitchClassOf(tonic);
  const noteSemitone = tonicSemitone + octaveShift * 12 + offsets[scaleIndex];

  const finalPitchClass = ((noteSemitone % 12) + 12) % 12;
  const finalOctave = 4 + Math.floor(noteSemitone / 12);
  return nameForPitchClass(finalPitchClass, accidentalPreferenceFor(tonic)) + finalOctave;
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
