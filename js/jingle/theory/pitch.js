/* =================================================================
   PITCH — the music-theoretic identity of a pitch, separate from any
   rendering of it.

   A Pitch carries its full theoretical spelling, independent of how it
   will eventually be sounded or notated:

     { letter: 'F', accidental: 1, octave: 5 }   // F#5

   - letter      one of 'A'..'G' (the diatonic letter name)
   - accidental  integer semitone offset from the natural letter:
                 -2 double-flat (bb), -1 flat (b), 0 natural,
                 +1 sharp (#), +2 double-sharp (x / ##)
   - octave      scientific pitch notation octave (C4 = middle C, MIDI 60)

   Derived properties (computed, never stored): pitch class (0-11) and the
   MIDI number. The MIDI number is the canonical bridge to any class- or
   frequency-based representation — see synth-rendering.js, which collapses
   a Pitch to the synth's single-accidental alphabet using MIDI as the
   source of truth.

   PORTABILITY. This module has ZERO dependencies — not on the synth, not on
   scales.json, not on anything outside theory/. Score-notation back-ends
   (LilyPond, MusicXML, VexFlow) consume toScoreString output verbatim: the
   theoretical spelling is preserved exactly, so a Cb is a Cb (not a B), the
   #4 of lydian is F# (not Gb), and double accidentals survive intact.

   SCOPE. The accidental range is -2..+2. Spellings that would require a
   triple accidental (e.g. rooting a scale that already carries a double
   flat on a tonic like Cb) are out of scope and throw at construction time,
   rather than emit a malformed Pitch.
   ================================================================= */

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// Pitch class of each natural letter (no accidental), within one octave.
const LETTER_PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const VALID_LETTERS = new Set(LETTERS);

// Score-notation accidental glyphs, keyed by integer offset. Double-sharp
// renders as "##" so the string round-trips through parseScoreString; the
// single-glyph "x" is accepted on input but never emitted.
const ACCIDENTAL_TO_GLYPH = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };
const GLYPH_TO_ACCIDENTAL = { '': 0, '#': 1, '##': 2, x: 2, b: -1, bb: -2 };

const SCORE_STRING = /^([A-G])(##|#|bb|b|x)?(-?\d+)$/;

/**
 * Construct a validated Pitch from its components. `letter` is 'A'..'G',
 * `accidental` an integer in -2..+2, `octave` an integer (scientific pitch
 * notation). Throws on malformed input or out-of-range accidental.
 */
export function pitchFromLetterAndAccidental(letter, accidental, octave) {
  if (!VALID_LETTERS.has(letter)) {
    throw new Error(`Pitch letter must be one of A-G, got ${JSON.stringify(letter)}.`);
  }
  if (!Number.isInteger(accidental) || accidental < -2 || accidental > 2) {
    throw new Error(
      `Pitch accidental must be an integer in -2..+2, got ${JSON.stringify(accidental)} ` +
      `(for letter ${letter}, octave ${octave}). Triple accidentals are out of scope.`
    );
  }
  if (!Number.isInteger(octave)) {
    throw new Error(`Pitch octave must be an integer, got ${JSON.stringify(octave)}.`);
  }
  return { letter, accidental, octave };
}

function assertPitch(pitch) {
  if (!pitch || typeof pitch !== 'object') {
    throw new Error(`Expected a Pitch object, got ${typeof pitch}.`);
  }
  return pitchFromLetterAndAccidental(pitch.letter, pitch.accidental, pitch.octave);
}

/**
 * Pitch class (0-11) of `pitch`, accidental folded in. Enharmonically equal
 * pitches share a pitch class (Cb4 and B3 both yield 11).
 */
export function pitchClassOf(pitch) {
  assertPitch(pitch);
  return ((LETTER_PITCH_CLASS[pitch.letter] + pitch.accidental) % 12 + 12) % 12;
}

/**
 * MIDI number of `pitch` (C4 = 60). The octave stays attached to the letter,
 * so accidentals that cross an octave boundary resolve correctly: Cb4 is
 * MIDI 59 (one below C4), the same as B3.
 */
export function toMidi(pitch) {
  assertPitch(pitch);
  return (pitch.octave + 1) * 12 + LETTER_PITCH_CLASS[pitch.letter] + pitch.accidental;
}

/**
 * The theoretical spelling of `pitch` as a string, verbatim:
 * "F#5", "Cb4", "E#3", "Bbb2", "F##5". This is what score-notation
 * back-ends consume — it never collapses enharmonics.
 */
export function toScoreString(pitch) {
  assertPitch(pitch);
  return pitch.letter + ACCIDENTAL_TO_GLYPH[String(pitch.accidental)] + pitch.octave;
}

/**
 * Parse a score-notation string back into a Pitch. Inverse of
 * toScoreString (and also accepts "x" as double-sharp). The octave is
 * required: "F#5" parses, "F#" does not.
 */
export function parseScoreString(str) {
  if (typeof str !== 'string') {
    throw new Error(`parseScoreString expects a string, got ${typeof str}.`);
  }
  const match = str.match(SCORE_STRING);
  if (!match) {
    throw new Error(`Unparseable score string ${JSON.stringify(str)}. Expected e.g. "F#5", "Cb4", "Bbb2".`);
  }
  const [, letter, glyph = '', octave] = match;
  return pitchFromLetterAndAccidental(letter, GLYPH_TO_ACCIDENTAL[glyph], parseInt(octave, 10));
}

/**
 * True when two pitches share the same theoretical identity (letter,
 * accidental, and octave). Enharmonic equivalents are NOT equal here
 * (Cb4 !== B3) — compare pitch classes or MIDI numbers for that.
 */
export function pitchEquals(a, b) {
  assertPitch(a);
  assertPitch(b);
  return a.letter === b.letter && a.accidental === b.accidental && a.octave === b.octave;
}
