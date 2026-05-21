/* =================================================================
   SYNTH RENDERING — collapse a Pitch to the synth's note alphabet.

   This is the ONLY file in theory/ that knows about the synth's
   single-accidental constraint. The chiptune synth's noteToFreq
   (js/jingle/synth.js) understands a 17-name map with at most one
   accidental: it has no "Cb", "Fb", "E#", "B#", or double accidentals —
   those parse to NaN and play silence. So when feeding the synth, every
   pitch must be respelled into that safe alphabet.

   toSynthString does this by treating the MIDI number as the source of
   truth: it computes midi(pitch), then names that MIDI number with either
   the sharp or the flat single-accidental spelling per the preference. The
   theoretical letter/accidental of the input is discarded — only the sounding
   pitch matters here. So Cb4 (MIDI 59) renders "B3" under either preference,
   and E#3 (MIDI 53) renders "F3".

   CONTRACT, NOT IMPORT. Downstream pipeline stages (Session 4+) call this
   at the Stage 6 -> synth boundary. We deliberately do NOT import from
   synth.js: the only obligation is that every string emitted here is one
   noteToFreq accepts. That contract is enforced by the Node verification
   (verify-spelling.mjs), which feeds every rendered string back through the
   real noteToFreq — but the dependency stays one-directional and documented,
   keeping theory/ portable to projects that have no synth at all.
   ================================================================= */
import { toMidi } from './pitch.js';

// One name per pitch class, each guaranteed present in synth.js NOTE_MAP.
// Black keys spell as sharps or flats depending on the chosen preference;
// the white keys are identical in both.
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Render `pitch` as a synth-parseable note string (e.g. "F#5", "B3"),
 * collapsing any theoretical spelling onto the synth's single-accidental
 * alphabet via the MIDI number. `accidentalPreference` is 'sharp' (default)
 * or 'flat' and only affects how black keys are named; the resulting
 * frequency is identical either way.
 */
export function toSynthString(pitch, accidentalPreference = 'sharp') {
  if (accidentalPreference !== 'sharp' && accidentalPreference !== 'flat') {
    throw new Error(`accidentalPreference must be 'sharp' or 'flat', got ${JSON.stringify(accidentalPreference)}.`);
  }
  const midi = toMidi(pitch);
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const names = accidentalPreference === 'flat' ? FLAT_NAMES : SHARP_NAMES;
  return names[pitchClass] + octave;
}
