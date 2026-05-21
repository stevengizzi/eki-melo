/* =================================================================
   VERIFY-SPELLING — exit-criterion check for the Pitch/spelling amendment.

   For every scale in scales.json this confirms four things:
     1. Each spelled degree (letter pitch class + accidental) agrees on
        pitch class with the cumulative-sum of the scale's intervals.
     2. Rooted on a representative set of chromatic tonics, every degree's
        toScoreString round-trips losslessly through parseScoreString.
     3. Every degree, rendered via toSynthString for both accidental
        preferences, parses through the real synth.js noteToFreq to a
        finite, positive frequency.
     4. Hand-checked spot cases (Gb major, F# major, D dorian, A harmonic
        minor, hungarian minor on C) produce the exact theoretical spelling.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. The theory/ modules and synth.js are .js files using ESM
   syntax, but the repo has NO package.json by design (no build step). So
   Node treats .js as CommonJS unless told otherwise. To run this test,
   drop a throwaway package.json making js/jingle/ a module scope, run, then
   delete it (do NOT commit it):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-spelling.mjs
     rm js/jingle/package.json

   The browser needs none of this — it loads these modules directly.
   ================================================================= */
import scales from './scales.json' with { type: 'json' };
import { pitchSetForScale } from './mode-engine.js';
import { toScoreString, parseScoreString, pitchEquals, pitchClassOf } from './pitch.js';
import { toSynthString } from './synth-rendering.js';
import { noteToFreq } from '../synth.js';

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const REPRESENTATIVE_TONICS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PREFERENCES = ['sharp', 'flat'];

const failures = [];
const fail = (scale, detail) => failures.push(`[${scale}] ${detail}`);

// Note name without the octave digits, for comparing against a known spelling.
const noteName = (pitch) => toScoreString(pitch).replace(/-?\d+$/, '');

function intervalPitchClasses(intervals) {
  const classes = [0];
  for (let i = 0; i < intervals.length - 1; i++) {
    classes.push((classes[i] + intervals[i]) % 12);
  }
  return classes;
}

// --- 1. Spelling pitch classes agree with the intervals (at C root). -------
for (const [name, scale] of Object.entries(scales)) {
  if (scale.spelling.length !== scale.intervals.length) {
    fail(name, `spelling has ${scale.spelling.length} entries, intervals has ${scale.intervals.length}`);
    continue;
  }
  const fromIntervals = intervalPitchClasses(scale.intervals);
  scale.spelling.forEach((degree, i) => {
    const letter = LETTERS[((degree.letter_step % 7) + 7) % 7];
    const spelledClass = ((LETTER_PITCH_CLASS[letter] + degree.accidental) % 12 + 12) % 12;
    if (spelledClass !== fromIntervals[i]) {
      fail(name, `degree ${i + 1}: spelling gives pc ${spelledClass} (${letter}${degree.accidental >= 0 ? '+' : ''}${degree.accidental}), intervals give pc ${fromIntervals[i]}`);
    }
  });
}

// --- 2 & 3. Score-string round-trip + synth-string parseability. -----------
for (const name of Object.keys(scales)) {
  for (const tonic of REPRESENTATIVE_TONICS) {
    let pitches;
    try {
      pitches = pitchSetForScale(name, tonic);
    } catch (err) {
      fail(name, `rooted on ${tonic}: pitchSetForScale threw: ${err.message}`);
      continue;
    }
    for (const pitch of pitches) {
      // (2) score string round-trips through the parser to the same Pitch.
      const score = toScoreString(pitch);
      const reparsed = parseScoreString(score);
      if (!pitchEquals(pitch, reparsed)) {
        fail(name, `rooted on ${tonic}: ${score} did not round-trip (got ${toScoreString(reparsed)})`);
      }

      // (3) every synth rendering parses to a finite, positive frequency.
      for (const preference of PREFERENCES) {
        const synthString = toSynthString(pitch, preference);
        const freq = noteToFreq(synthString);
        if (!Number.isFinite(freq) || freq <= 0) {
          fail(name, `rooted on ${tonic}: ${score} -> toSynthString(${preference})="${synthString}" -> noteToFreq=${freq}`);
        }
        // The respelling must preserve the sounding pitch class.
        const synthPc = pitchClassOf(parseScoreString(synthString));
        if (synthPc !== pitchClassOf(pitch)) {
          fail(name, `rooted on ${tonic}: ${score} -> synth "${synthString}" changed pitch class (${pitchClassOf(pitch)} -> ${synthPc})`);
        }
      }
    }
  }
}

// --- 4. Hand-checked spot cases. -------------------------------------------
const SPOT_CHECKS = [
  ['major', 'Gb', ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F']],
  ['major', 'F#', ['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']],
  ['dorian', 'D', ['D', 'E', 'F', 'G', 'A', 'B', 'C']],
  ['harmonic_minor', 'A', ['A', 'B', 'C', 'D', 'E', 'F', 'G#']],
  ['hungarian_minor', 'C', ['C', 'D', 'Eb', 'F#', 'G', 'Ab', 'B']]
];

for (const [name, tonic, expected] of SPOT_CHECKS) {
  const actual = pitchSetForScale(name, tonic).map(noteName);
  const matches = actual.length === expected.length && actual.every((n, i) => n === expected[i]);
  if (!matches) {
    fail(name, `spot-check rooted on ${tonic}: expected [${expected.join(' ')}], got [${actual.join(' ')}]`);
  } else {
    console.log(`spot-check OK: ${name} on ${tonic} = ${actual.join(' ')}`);
  }
}

// --- Report. ---------------------------------------------------------------
const scaleCount = Object.keys(scales).length;
console.log(
  `\nChecked ${scaleCount} scales x ${REPRESENTATIVE_TONICS.length} tonics ` +
  `(score round-trip + synth parse x ${PREFERENCES.length} preferences) + ${SPOT_CHECKS.length} spot-checks.`
);

if (failures.length > 0) {
  console.error(`\nFAILED — ${failures.length} problem(s):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}

console.log('\nPASSED — every spelling agrees with its intervals, round-trips, and parses in the synth.');
