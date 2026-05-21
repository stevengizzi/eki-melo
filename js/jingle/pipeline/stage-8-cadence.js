/* =================================================================
   STAGE 8 — CADENCE ENFORCEMENT (buildplan Session 5).

   enforceCadences(voiceTracks, harmonicPlan, macroParams, config) → voiceTracks

   Cadence enforcement is non-negotiable: each section's final gesture is
   OVERWRITTEN to land a clean cadence of the section's declared type, ignoring
   whatever the upstream stages produced in that beat range. This is what turns
   "the section stops on the last motif fragment" into "the section resolves."

   Operates on beat-stamped { pitch, beat, duration } events (the Session-5
   VoiceTracks shape — see stage-6-voice.js). The runner sequences to the synth
   shape after this stage, so the rest insertion / gap collapse happens once,
   downstream — Stage 8 only has to leave each voice's events sorted and
   non-overlapping.

   ALGORITHM.
   1. Recompute the section plan (computeSectionPlan, shared with Stage 6) for
      per-section bar offsets.
   2. For each section, read its cadence type from the matching HarmonicPlan
      section (by label). 'none' / missing → leave the section untouched.
   3. Call the matching formula from theory/cadence-formulas.js. It returns the
      overwrite events for lead/harmony/bass, beat-stamped in piece-absolute
      beats, covering the section's final bar (or final two beats).
   4. Splice per voice: the overwrite window runs from the formula's earliest
      event beat to the section end. Drop existing events that start inside the
      window; truncate an event that straddles the window's start; then insert
      the formula's events and re-sort by beat.

   PORTABILITY. pipeline/ code — may import theory/ and the sibling Stage-6
   helper. Touches no existing app file.
   ================================================================= */
import { CADENCE_FORMULAS } from '../theory/cadence-formulas.js';
import { computeSectionPlan } from './stage-6-voice.js';

const EPSILON = 1e-9;
const VOICES = ['lead', 'harmony', 'bass'];

// The earliest beat across every event the formula returns — the point where
// the section's tail is overwritten. All three voices share it (the formulas
// start every voice at the same beat), so taking the global minimum is robust.
function overwriteStartOf(overwrite) {
  let start = Infinity;
  for (const voice of VOICES) {
    for (const event of overwrite[voice]) {
      if (event.beat < start) start = event.beat;
    }
  }
  return start;
}

// Replace the events of one voice in [overwriteStart, sectionEnd) with
// `newEvents`. Events wholly before the window are kept; one straddling the
// window's start is truncated to it; events at/after the window are dropped
// (the formula's events cover the section to its end). Events belonging to
// later sections (beat >= sectionEnd) are untouched.
function spliceVoice(events, overwriteStart, sectionEnd, newEvents) {
  const kept = events.flatMap((event) => {
    const end = event.beat + event.duration;
    if (end <= overwriteStart + EPSILON) return [event]; // entirely before the window
    if (event.beat >= sectionEnd - EPSILON) return [event]; // belongs to a later section
    if (event.beat < overwriteStart - EPSILON) {
      // straddles the window start — truncate to it
      return [{ ...event, duration: overwriteStart - event.beat }];
    }
    return []; // inside the window — overwritten
  });
  return [...kept, ...newEvents].sort((a, b) => a.beat - b.beat);
}

/**
 * Overwrite each section's closing beats with its declared cadence. Returns a
 * new VoiceTracks ({ lead, harmony, bass } of beat-stamped events); the input
 * is not mutated. `config` is accepted for signature stability and threaded
 * through but does not gate enforcement (cadences are non-negotiable).
 */
export function enforceCadences(voiceTracks, harmonicPlan, macroParams /* , config */) {
  const sections = computeSectionPlan(macroParams);
  const beatsPerBar = macroParams.meter?.numerator ?? 4;
  const cadenceByLabel = new Map(
    (harmonicPlan?.sections ?? []).map((s) => [s.label, s.cadence])
  );

  const tracks = {
    lead: [...voiceTracks.lead],
    harmony: [...voiceTracks.harmony],
    bass: [...voiceTracks.bass],
  };

  for (const section of sections) {
    const cadenceType = cadenceByLabel.get(section.label);
    if (!cadenceType || cadenceType === 'none') continue;

    const formula = CADENCE_FORMULAS[cadenceType];
    if (typeof formula !== 'function') {
      throw new Error(
        `Unknown cadence type "${cadenceType}" for section "${section.label}". ` +
          `See theory/cadence-formulas.js for the supported cadences.`
      );
    }

    const overwrite = formula(macroParams, section, voiceTracks);
    const overwriteStart = overwriteStartOf(overwrite);
    const sectionEnd = (section.startBar + section.bars) * beatsPerBar;

    for (const voice of VOICES) {
      tracks[voice] = spliceVoice(tracks[voice], overwriteStart, sectionEnd, overwrite[voice]);
    }
  }

  return tracks;
}
