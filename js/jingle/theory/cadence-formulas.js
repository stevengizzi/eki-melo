/* =================================================================
   CADENCE FORMULAS — the closing gestures Stage 8 splices in (buildplan
   Session 5; cadence-manifestation revision after the Session 9 checkpoint).

   One exported function per cadence type from the buildplan §3 vocabulary
   (PAC, IAC, half, deceptive, plagal, modal_iv_i, phrygian_ii_i), each of
   signature

     cadence(macroParams, section, voiceTracks?) →
       { lead:    [{ pitch, beat, duration }, …],
         harmony: [{ pitch, beat, duration }, …],
         bass:    [{ pitch, beat, duration }, …] }

   Each returns ONLY the events that overwrite the tail of the section; Stage 8
   discards the existing events in that beat range and splices these in. `pitch`
   is always a Pitch object. `beat` is absolute, relative to the start of the
   piece.

   ABSTRACT TYPE, VARIED MANIFESTATION (the post-Session-9 change). The cadence
   TYPE per section stays fixed and predetermined (like the rest of the Roman-
   numeral progression) — the harmonic resolution still lands, non-negotiably.
   But its MANIFESTATION is no longer identical every time:

   - SCOPE: every cadence now overwrites ONLY the section's final TWO BEATS (the
     resolution gesture: approach beat → resolution beat). It used to overwrite
     the whole final bar for the authentic-style cadences, which hard-stopped
     the melody. Freeing the first part of the final bar lets the lead's motif
     and the harmony/bass texture play INTO the cadence (the buildplan's "the
     section resolves" without the section's last bar going static).

   - REGISTER: the lead (and the harmony an octave below it) is voiced in the
     octave NEAREST the approaching melody — the last lead pitch sounding before
     the cadence window — rather than always snapping to the register centre. So
     the resolution continues from where the line left off instead of teleporting,
     and two same-type cadences in different melodic contexts (e.g. an AABA's two
     reprises) resolve in different registers. When there is no approaching lead
     pitch (a section that opens on the cadence, or a formula called in isolation)
     it falls back to the register-centre octave — the pre-revision voicing.

   The bass stays at its functional octave (3): the bass roots define the
   cadence's harmony and are fine to be consistent. Voices never cross (harmony
   ≤ lead by construction; bass well below both).

   Each approach/resolution pair is voiced from chord tones (root in the bass, a
   third or fifth inside, the cadence's required scale degree on top). All pitches
   come from mode-engine's degreeToPitch and roman-numeral's resolveRoman — no
   hardcoded note names.

   PORTABILITY. Imports only from theory/ (mode-engine.js, roman-numeral.js,
   pitch.js).
   ================================================================= */
import { degreeToPitch } from './mode-engine.js';
import { resolveRoman } from './roman-numeral.js';
import { toMidi } from './pitch.js';

const DEFAULT_LEAD_OCTAVE = 5;
const BASS_OCTAVE = 3;
const HARMONY_OCTAVES_BELOW_LEAD = 1; // harmony tracks the lead, one octave under it

function beatsPerBarOf(macroParams) {
  return macroParams.meter?.numerator ?? 4;
}

// Lead octave from register_center (e.g. "C5" → 5), matching Stage 6.
function leadOctaveOf(macroParams) {
  const match = String(macroParams.register_center ?? '').match(/(-?\d+)$/);
  return match ? parseInt(match[1], 10) : DEFAULT_LEAD_OCTAVE;
}

// The absolute beat where the section ends (exclusive).
function sectionEndBeat(macroParams, section) {
  return (section.startBar + section.bars) * beatsPerBarOf(macroParams);
}

// The lead Pitch sounding immediately before `beforeBeat` — the note the melody
// resolves FROM. Reads the (optional) Stage-6/7 voiceTracks; null when there is
// no voiceTracks or no lead note before the window.
function approachLeadPitch(voiceTracks, beforeBeat) {
  const lead = voiceTracks?.lead;
  if (!Array.isArray(lead)) return null;
  let best = null;
  for (const event of lead) {
    if (event && event.pitch && event.beat < beforeBeat - 1e-9) {
      if (best === null || event.beat > best.beat) best = event;
    }
  }
  return best ? best.pitch : null;
}

// The octave (within ±1 of `fallbackOctave`) at which `degree` sits nearest
// `refMidi`. Bounded to ±1 so the cadence follows the melody's register without
// diving toward the bass or leaping out of the lead's range.
function octaveNearestMidi(mode, tonic, degree, refMidi, fallbackOctave) {
  let bestOctave = fallbackOctave;
  let bestDistance = Infinity;
  for (let octave = fallbackOctave - 1; octave <= fallbackOctave + 1; octave++) {
    const distance = Math.abs(toMidi(degreeToPitch(mode, tonic, degree, octave)) - refMidi);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOctave = octave;
    }
  }
  return bestOctave;
}

const ev = (pitch, beat, duration) => ({ pitch, beat, duration });

/**
 * Build a final-two-beats cadence from a degree/chord `spec`:
 *   { lead: [approachDeg, resolutionDeg], harmony: [approachDeg, resolutionDeg],
 *     bass: [approachChordOrDeg, resolutionChordOrDeg] }
 * (a bass entry that is a string is a Roman numeral resolved to its root; a
 * number is a scale degree.) The lead + harmony are voiced in the register
 * nearest the approaching melody (via `voiceTracks`), the bass at its functional
 * octave. Returns the overwrite events for all three voices.
 */
function cadence(macroParams, section, voiceTracks, spec) {
  const { mode, tonic } = macroParams;
  const sectionEnd = sectionEndBeat(macroParams, section);
  const start = sectionEnd - 2;

  const fallbackLeadOctave = leadOctaveOf(macroParams);
  const approach = approachLeadPitch(voiceTracks, start);
  const resolutionDegree = spec.lead[1];
  const leadOctave = approach
    ? octaveNearestMidi(mode, tonic, resolutionDegree, toMidi(approach), fallbackLeadOctave)
    : fallbackLeadOctave;
  const harmonyOctave = leadOctave - HARMONY_OCTAVES_BELOW_LEAD;

  const leadPitch = (degree) => degreeToPitch(mode, tonic, degree, leadOctave);
  const harmonyPitch = (degree) => degreeToPitch(mode, tonic, degree, harmonyOctave);
  const bassPitch = (chordOrDegree) =>
    typeof chordOrDegree === 'string'
      ? resolveRoman(chordOrDegree, mode, tonic, BASS_OCTAVE).root
      : degreeToPitch(mode, tonic, chordOrDegree, BASS_OCTAVE);

  const pair = (toPitch, [approachValue, resolutionValue]) => [
    ev(toPitch(approachValue), start, 1),
    ev(toPitch(resolutionValue), start + 1, 1),
  ];
  return {
    lead: pair(leadPitch, spec.lead),
    harmony: pair(harmonyPitch, spec.harmony),
    bass: pair(bassPitch, spec.bass),
  };
}

/**
 * PAC — perfect authentic. Bass V→i; lead resolves ^2→^1 landing on the tonic;
 * harmony voices the third of each chord (^7 over V → ^3 over i), so the approach
 * spells a V triad and the resolution the tonic.
 */
export function PAC(macroParams, section, voiceTracks) {
  return cadence(macroParams, section, voiceTracks, {
    lead: [2, 1],
    harmony: [7, 3],
    bass: ['V', 1],
  });
}

/**
 * IAC — imperfect authentic. Bass V→i as in the PAC, but the lead lands on ^3 (a
 * chord tone of the tonic, NOT ^1), so the close is softer. Harmony takes the
 * fifth at the resolution, completing the triad.
 */
export function IAC(macroParams, section, voiceTracks) {
  return cadence(macroParams, section, voiceTracks, {
    lead: [2, 3],
    harmony: [7, 5],
    bass: ['V', 1],
  });
}

/**
 * half — ends hanging on the dominant. Bass holds ^5, harmony the third of V
 * (^7), lead steps ^1→^2 to land on the dominant's fifth (^2) — never ^1, never
 * resolving.
 */
export function half(macroParams, section, voiceTracks) {
  return cadence(macroParams, section, voiceTracks, {
    lead: [1, 2],
    harmony: [7, 7],
    bass: ['V', 'V'],
  });
}

/**
 * deceptive — V→vi/VI instead of the expected tonic. The bass steps ^5→^6 (the
 * "surprise"); the lead steps up ^2→^3 to land on the submediant's fifth, while
 * the harmony carries the leading-tone resolution ^7→^8 (ascending to the octave,
 * which is the submediant's third). The resolution beat spells a submediant triad.
 */
export function deceptive(macroParams, section, voiceTracks) {
  return cadence(macroParams, section, voiceTracks, {
    lead: [2, 3],
    harmony: [7, 8],
    bass: ['V', 6],
  });
}

/**
 * plagal — the "amen" subdominant→tonic. Bass IV/iv→i, the lead holds the common
 * tone ^1 across both chords (^1 is the fifth of IV and the root of I), and
 * harmony does the characteristic ^6→^3 inner descent. The subdominant's quality
 * is whatever the active mode supplies.
 */
export function plagal(macroParams, section, voiceTracks) {
  return cadence(macroParams, section, voiceTracks, {
    lead: [1, 1],
    harmony: [6, 3],
    bass: ['IV', 1],
  });
}

/**
 * modal_iv_i — the characteristic modal subdominant→tonic, with NO raised leading
 * tone (we never substitute a V). Bass iv/IV→i; the lead steps ^4→^3 to land on
 * the modal third, harmony moves ^6→^5 so the resolution spells a tonic triad.
 * The subdominant and tonic qualities both come from the mode.
 */
export function modal_iv_i(macroParams, section, voiceTracks) {
  return cadence(macroParams, section, voiceTracks, {
    lead: [4, 3],
    harmony: [6, 5],
    bass: ['IV', 1],
  });
}

/**
 * phrygian_ii_i — the phrygian cadence: bII→i, a half-step descent in the bass
 * (e.g. F→E). The lead mirrors it ^2→^1 (also a half step in phrygian-family
 * modes where ^2 is the b2), and harmony moves ^4→^3. The bII root comes from
 * resolveRoman('bII'); in phrygian-dominant the bII is diatonic, so it lands on
 * the same F as the modal degree 2.
 */
export function phrygian_ii_i(macroParams, section, voiceTracks) {
  return cadence(macroParams, section, voiceTracks, {
    lead: [2, 1],
    harmony: [4, 3],
    bass: ['bII', 1],
  });
}

// Registry for name → formula dispatch (Stage 8 reads the HarmonicPlan's
// per-section cadence strings against this).
export const CADENCE_FORMULAS = {
  PAC,
  IAC,
  half,
  deceptive,
  plagal,
  modal_iv_i,
  phrygian_ii_i,
};
