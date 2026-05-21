/* =================================================================
   ROMAN NUMERAL — STUB (buildplan Session 4).

   *** PLACEHOLDER. Replaced in Session 5 by theory/roman-numeral.js. ***

   resolveRoman(romanString, mode, tonic, octave?) →
     { root: Pitch, quality, members: [Pitch, ...] }

   This stub resolves DIATONIC TRIADS only. A Roman numeral names a scale
   degree (I/i → 1, II/ii → 2, … VII/vii → 7); the chord is the diatonic
   triad stacked in thirds on that degree of the active mode — degrees d,
   d+2, d+4 — and its quality is derived from the resulting pitches, not from
   the numeral's case. Because the chord is built from the *mode's own*
   thirds, modal spellings fall out for free: "II" in E phrygian-dominant is
   F-A-C (the famous bII sound) because degree 2 of that mode is F.

   WHAT IT DELIBERATELY DOES NOT DO (deferred to Session 5's full resolver):
   - Chromatic alteration of a degree (bII, #IV, bVII as borrowed/altered
     chords). A leading accidental THROWS with a pointer to Session 5. For
     Session-4 hand-written plans, express every chord as a mode-relative
     diatonic numeral and let the mode supply the spelling.
   - Seventh chords, explicit quality enforcement from case, secondary
     dominants, modal interchange. Trailing quality markers (°, +, 7) are
     tolerated and ignored — the triad and its derived quality are returned
     regardless.

   The signature carries an optional trailing `octave` (default 4) so a caller
   can resolve the chord directly in a target register (Stage 6 resolves bass
   chords at octave 3). Session 5's resolver keeps the same signature so the
   import drops in cleanly:  s/roman-numeral-stub/roman-numeral/.

   PORTABILITY. Imports only from theory/ (mode-engine.js, pitch.js).
   ================================================================= */
import { degreeToPitch } from './mode-engine.js';
import { toMidi } from './pitch.js';

// Roman numeral core → scale degree (1-based). Case is irrelevant to the
// degree; quality is derived from the realized pitches below.
const ROMAN_TO_DEGREE = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7 };

// <leading accidental?><roman core><trailing quality marker?><seventh?>
const ROMAN_PATTERN = /^([b#])?([iIvV]+)([°o+]?)(7)?$/;

// Triad quality from the two stacked-third interval sizes (in semitones).
function qualityFromIntervals(rootToThird, thirdToFifth) {
  if (rootToThird === 4 && thirdToFifth === 3) return 'major';
  if (rootToThird === 3 && thirdToFifth === 4) return 'minor';
  if (rootToThird === 3 && thirdToFifth === 3) return 'diminished';
  if (rootToThird === 4 && thirdToFifth === 4) return 'augmented';
  return 'other';
}

/**
 * Resolve a diatonic-triad Roman numeral to its root, quality, and members in
 * `mode` rooted on `tonic`. `octave` (default 4) is the octave the root is
 * placed in; the third and fifth stack ascending above it. See the module
 * header for the (deliberately narrow) scope of this stub.
 *
 * Throws on a non-string numeral, an unrecognised numeral, or a leading
 * accidental (chromatic alteration is a Session-5 feature).
 */
export function resolveRoman(romanString, mode, tonic, octave = 4) {
  if (typeof romanString !== 'string') {
    throw new Error(`resolveRoman expects a Roman-numeral string, got ${typeof romanString}.`);
  }
  const match = romanString.trim().match(ROMAN_PATTERN);
  if (!match) {
    throw new Error(`Unparseable Roman numeral ${JSON.stringify(romanString)}. Expected e.g. "I", "ii", "V", "vii".`);
  }
  const [, accidental, core] = match;
  if (accidental) {
    throw new Error(
      `Roman numeral ${JSON.stringify(romanString)} has a chromatic alteration ("${accidental}"), ` +
        `which the Session-4 stub does not resolve. Use a mode-relative diatonic numeral ` +
        `(the mode supplies the spelling), or wait for Session 5's roman-numeral.js.`
    );
  }
  const degree = ROMAN_TO_DEGREE[core.toUpperCase()];
  if (degree === undefined) {
    throw new Error(`Unrecognised Roman numeral core ${JSON.stringify(core)} in ${JSON.stringify(romanString)}.`);
  }

  // Stack the diatonic triad in thirds on the degree, ascending from `octave`.
  const root = degreeToPitch(mode, tonic, degree, octave);
  const third = degreeToPitch(mode, tonic, degree + 2, octave);
  const fifth = degreeToPitch(mode, tonic, degree + 4, octave);
  const quality = qualityFromIntervals(toMidi(third) - toMidi(root), toMidi(fifth) - toMidi(third));

  return { root, quality, members: [root, third, fifth] };
}
