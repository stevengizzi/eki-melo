/* =================================================================
   CADENCE FORMULAS — the closing gestures Stage 8 splices in (buildplan
   Session 5).

   One exported function per cadence type from the buildplan §3 vocabulary
   (PAC, IAC, half, deceptive, plagal, modal_iv_i, phrygian_ii_i), each of
   signature

     cadence(macroParams, section, voiceTracks) →
       { lead:    [{ pitch, beat, duration }, …],
         harmony: [{ pitch, beat, duration }, …],
         bass:    [{ pitch, beat, duration }, …] }

   Each returns ONLY the events that overwrite the tail of the section; Stage 8
   discards the existing events in that beat range and splices these in. `pitch`
   is always a Pitch object. `beat` is absolute, relative to the start of the
   piece — the formula's origin is `section.startBar * beatsPerBar`, and it
   writes into the section's FINAL bar (or its final two beats for the cadences
   where only the closing resolution matters).

   HOW MANY BEATS EACH OVERWRITES (documented per formula below):
   - Full final bar — PAC, IAC, plagal, modal_iv_i, phrygian_ii_i. The approach
     chord fills the first half of the bar, the resolution the second half, so
     lead, harmony and bass all move together at the bar's midpoint (this is the
     buildplan's "approach lasts the first half, the tonic resolution the
     second half" voiced across all three voices).
   - Final two beats — half, deceptive. Only the closing two-chord gesture is
     written; the rest of the bar keeps whatever the upstream stages produced.

   VOICING. Lead sits at the register-center octave, harmony an octave below it,
   bass at octave 3 — so the three voices never cross. Every approach/resolution
   pair is voiced from chord tones of the chord it sounds over (root in the bass,
   a third or fifth in the inner voice, the cadence's required scale degree on
   top), so each beat spells a recognisable chord. All pitches come from
   mode-engine's degreeToPitch (melodic degrees, tonic) and roman-numeral's
   resolveRoman (the functional approach chords) — no hardcoded note names.

   PORTABILITY. Imports only from theory/ (mode-engine.js, roman-numeral.js).
   ================================================================= */
import { degreeToPitch } from './mode-engine.js';
import { resolveRoman } from './roman-numeral.js';

const DEFAULT_LEAD_OCTAVE = 5;
const HARMONY_OCTAVE = 4;
const BASS_OCTAVE = 3;

function beatsPerBarOf(macroParams) {
  return macroParams.meter?.numerator ?? 4;
}

// Lead octave from register_center (e.g. "C5" → 5), matching Stage 6.
function leadOctaveOf(macroParams) {
  const match = String(macroParams.register_center ?? '').match(/(-?\d+)$/);
  return match ? parseInt(match[1], 10) : DEFAULT_LEAD_OCTAVE;
}

// The absolute beat where the section's final bar begins, and where the section
// ends (exclusive).
function finalBarBounds(macroParams, section) {
  const beatsPerBar = beatsPerBarOf(macroParams);
  const sectionEnd = (section.startBar + section.bars) * beatsPerBar;
  return { beatsPerBar, finalBarStart: sectionEnd - beatsPerBar, sectionEnd };
}

const ev = (pitch, beat, duration) => ({ pitch, beat, duration });

/**
 * A two-chord cadence filling the whole final bar: the approach chord for the
 * first half, the resolution for the second. `lead`/`harmony`/`bass` each name
 * the [approachPitch, resolutionPitch] pair to sound. Used by every
 * authentic-style cadence (PAC, IAC, plagal, modal_iv_i, phrygian_ii_i).
 */
function fullBarCadence(macroParams, section, voices) {
  const { beatsPerBar, finalBarStart } = finalBarBounds(macroParams, section);
  const half = beatsPerBar / 2;
  const mid = finalBarStart + half;
  const pair = ([approach, resolution]) => [ev(approach, finalBarStart, half), ev(resolution, mid, half)];
  return { lead: pair(voices.lead), harmony: pair(voices.harmony), bass: pair(voices.bass) };
}

/**
 * A two-chord cadence filling only the section's final two beats. Used by the
 * cadences where only the closing gesture matters (half, deceptive).
 */
function lastTwoBeatsCadence(macroParams, section, voices) {
  const { sectionEnd } = finalBarBounds(macroParams, section);
  const start = sectionEnd - 2;
  const pair = ([first, second]) => [ev(first, start, 1), ev(second, start + 1, 1)];
  return { lead: pair(voices.lead), harmony: pair(voices.harmony), bass: pair(voices.bass) };
}

// Convenience pitch builders bound to a piece's mode/tonic/octaves.
function pitchKit(macroParams) {
  const { mode, tonic } = macroParams;
  const leadOctave = leadOctaveOf(macroParams);
  return {
    lead: (degree) => degreeToPitch(mode, tonic, degree, leadOctave),
    harm: (degree) => degreeToPitch(mode, tonic, degree, HARMONY_OCTAVE),
    bassDegree: (degree) => degreeToPitch(mode, tonic, degree, BASS_OCTAVE),
    bassRoman: (roman) => resolveRoman(roman, mode, tonic, BASS_OCTAVE).root,
    tonicBass: () => degreeToPitch(mode, tonic, 1, BASS_OCTAVE),
  };
}

/**
 * PAC — perfect authentic. Bass V→i across the final bar; lead resolves ^2→^1
 * landing on the tonic; harmony voices the third of each chord (^7 over V →
 * ^3 over i), so the approach spells a full V triad and the resolution the
 * tonic. Overwrites the whole final bar.
 */
export function PAC(macroParams, section) {
  const k = pitchKit(macroParams);
  return fullBarCadence(macroParams, section, {
    lead: [k.lead(2), k.lead(1)],
    harmony: [k.harm(7), k.harm(3)],
    bass: [k.bassRoman('V'), k.tonicBass()],
  });
}

/**
 * IAC — imperfect authentic. Bass V→i as in the PAC, but the lead lands on ^3
 * (a chord tone of the tonic, NOT ^1), so the close is softer. Harmony takes
 * the fifth at the resolution, completing the triad. Overwrites the final bar.
 */
export function IAC(macroParams, section) {
  const k = pitchKit(macroParams);
  return fullBarCadence(macroParams, section, {
    lead: [k.lead(2), k.lead(3)],
    harmony: [k.harm(7), k.harm(5)],
    bass: [k.bassRoman('V'), k.tonicBass()],
  });
}

/**
 * half — ends hanging on the dominant. Bass holds ^5, harmony the third of V
 * (^7), lead steps ^1→^2 to land on the dominant's fifth (^2) — never ^1, never
 * resolving. Overwrites only the final two beats.
 */
export function half(macroParams, section) {
  const k = pitchKit(macroParams);
  return lastTwoBeatsCadence(macroParams, section, {
    lead: [k.lead(1), k.lead(2)],
    harmony: [k.harm(7), k.harm(7)],
    bass: [k.bassRoman('V'), k.bassRoman('V')],
  });
}

/**
 * deceptive — V→vi/VI instead of the expected tonic. The bass steps ^5→^6 (the
 * "surprise"); the lead steps up ^2→^3 to land on the submediant's fifth, while
 * the harmony carries the leading-tone resolution ^7→^8 (ascending to the
 * octave, which is the submediant's third). The resolution beat spells a full
 * submediant triad. Overwrites only the final two beats.
 */
export function deceptive(macroParams, section) {
  const k = pitchKit(macroParams);
  return lastTwoBeatsCadence(macroParams, section, {
    lead: [k.lead(2), k.lead(3)],
    harmony: [k.harm(7), k.harm(8)],
    bass: [k.bassRoman('V'), k.bassDegree(6)],
  });
}

/**
 * plagal — the "amen" subdominant→tonic. Bass IV/iv→i, the lead holds the
 * common tone ^1 across both chords (^1 is the fifth of IV and the root of I),
 * and harmony does the characteristic ^6→^3 inner descent. The subdominant's
 * quality is whatever the active mode supplies. Overwrites the whole final bar.
 */
export function plagal(macroParams, section) {
  const k = pitchKit(macroParams);
  return fullBarCadence(macroParams, section, {
    lead: [k.lead(1), k.lead(1)],
    harmony: [k.harm(6), k.harm(3)],
    bass: [k.bassRoman('IV'), k.tonicBass()],
  });
}

/**
 * modal_iv_i — the characteristic modal subdominant→tonic, with NO raised
 * leading tone (we never substitute a V). Bass iv/IV→i; the lead steps ^4→^3 to
 * land on the modal third, harmony moves ^6→^5 so the resolution spells a full
 * tonic triad. The subdominant and tonic qualities both come from the mode.
 * Overwrites the whole final bar.
 */
export function modal_iv_i(macroParams, section) {
  const k = pitchKit(macroParams);
  return fullBarCadence(macroParams, section, {
    lead: [k.lead(4), k.lead(3)],
    harmony: [k.harm(6), k.harm(5)],
    bass: [k.bassRoman('IV'), k.tonicBass()],
  });
}

/**
 * phrygian_ii_i — the phrygian cadence: bII→i, a half-step descent in the bass
 * (e.g. F→E). The lead mirrors it ^2→^1 (also a half step in phrygian-family
 * modes where ^2 is the b2), and harmony moves ^4→^3. The bII root comes from
 * resolveRoman('bII'); in phrygian-dominant the bII is diatonic, so this lands
 * on the same F as the modal degree 2. Overwrites the whole final bar.
 */
export function phrygian_ii_i(macroParams, section) {
  const k = pitchKit(macroParams);
  return fullBarCadence(macroParams, section, {
    lead: [k.lead(2), k.lead(1)],
    harmony: [k.harm(4), k.harm(3)],
    bass: [k.bassRoman('bII'), k.tonicBass()],
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
