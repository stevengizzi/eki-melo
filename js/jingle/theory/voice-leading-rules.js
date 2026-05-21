/* =================================================================
   VOICE-LEADING RULES — Stage 7's configurable rule set (buildplan Session 7).

   applyVoiceLeading(voiceTracks, macroParams, preset) → voiceTracks

   Scans the beat-stamped { pitch, beat, duration } VoiceTracks (the Session-5+
   shape: { lead, harmony, bass }, each sorted by beat) against a named rule set
   and applies REPAIR operations, returning a NEW VoiceTracks. The input is not
   mutated. `preset` selects the rule set ('chiptune_idiomatic' default, or
   'cpp_strict'); an unknown name throws.

   Two layers:
   - The PRESETS registry maps a preset name to a plain rule-CONFIGURATION
     object (one entry per rule: range_clamp / out_of_mode / voice_crossing /
     parallel_perfects / tritone_outline). A new preset is added by adding a
     data entry — no new code.
   - applyVoiceLeading is a thin dispatcher: it reads the active config and runs
     the same primitive repair operations (clampToRange, snapToMode, moveByStep,
     intervalBetween) accordingly.

   ANOMALY EXEMPTION. Stage 6 tags a lead event realized from a
   chromatic_neighbor anomaly with `anomalous: true`. The chiptune_idiomatic
   out_of_mode rule passes those through verbatim (never snaps them); cpp_strict
   snaps everything, anomaly or not.

   RANGE NOTE — DELIBERATE DEVIATION FROM THE PROMPT'S FIRST-PASS NUMBERS.
   The Session-7 prompt named lead C4..C6 and bass C2..C4. Measuring the actual
   Stage-6 output of the already-auditioned Session-6 cases showed the lead's
   octave-leap motifs reach F6 (MIDI 89) and the walking/arpeggio bass reaches
   G4 (MIDI 67) — both ABOVE those ceilings. Exit criterion (a) and the human
   checkpoint require chiptune_idiomatic to fire ZERO repairs on those approved
   cases (audibly identical to pre-Session-7). Clamping approved material to the
   literal numbers would regress it, so the enforced windows are widened to
   contain the genre's real register usage while still catching a genuinely
   out-of-register note (e.g. the > C7 pitch the verifier's range test uses):
     lead    C4 (60) .. C7 (96)
     harmony C4 (60) .. C7 (96)   (the *_above raised ceiling, per the prompt)
     bass    C2 (36) .. C5 (72)
   See the Session-7 journal entry for the measurements behind this.

   OUT-OF-MODE SCOPE — also a measurement-driven decision. Session 6's
   imitation_one_beat_delay deliberately emits a chromatic echo (a semitone
   shift to the nearest chord tone), so the Desert case carries an out-of-mode
   harmony F#5 that is NOT anomaly-flagged. Snapping it under chiptune_idiomatic
   would regress approved audio, so chiptune_idiomatic scopes out_of_mode to the
   LEAD voice only (exempting anomaly-flagged notes) — consistent with its
   philosophy of trusting the texture vocabulary (it likewise IGNORES voice
   crossing because "the texture vocabulary already encodes crossing intent").
   cpp_strict snaps ALL voices with no exemption ("strict mode adherence").

   PORTABILITY. Imports only from theory/ (mode-engine.js, pitch.js). No synth,
   no pipeline.
   ================================================================= */
import { pitchSetForScale } from './mode-engine.js';
import { toMidi, pitchClassOf } from './pitch.js';

const EPSILON = 1e-9;
const OCTAVE_GUARD = 32; // never trips in practice; bounds the displacement loops
const VOICES = ['lead', 'harmony', 'bass'];

// Enforced registral windows, shared by both presets ([lowMidi, highMidi]).
// Widened from the prompt's first-pass numbers to contain the approved
// Session-6 material — see the module header.
const RANGES = {
  lead: [60, 96], // C4 .. C7
  harmony: [60, 96], // C4 .. C7
  bass: [36, 72], // C2 .. C5
};

/**
 * PRESETS — preset name → rule configuration object. Adding a preset is a data
 * change here, not a code change; applyVoiceLeading dispatches over these.
 *
 * Per rule:
 *   range_clamp       { enabled }                       — clamp each voice to RANGES
 *   out_of_mode       { enabled, voices, exemptAnomalous, log }
 *   voice_crossing    { mode: 'ignore' | 'forbid' }
 *   parallel_perfects { mode: 'allow' | 'forbid' }
 *   tritone_outline   { mode: 'ignore' | 'repair' }
 */
export const PRESETS = {
  // The deployed-genre rule set: permissive, trusts the texture vocabulary.
  chiptune_idiomatic: {
    range_clamp: { enabled: true },
    out_of_mode: { enabled: true, voices: ['lead'], exemptAnomalous: true, log: false },
    voice_crossing: { mode: 'ignore' },
    parallel_perfects: { mode: 'allow' },
    tritone_outline: { mode: 'ignore' },
  },
  // Common-practice strict counterpoint: forbids crossings and parallel
  // perfects, snaps every voice to mode, fills melodic tritones.
  cpp_strict: {
    range_clamp: { enabled: true },
    out_of_mode: { enabled: true, voices: ['lead', 'harmony', 'bass'], exemptAnomalous: false, log: true },
    voice_crossing: { mode: 'forbid' },
    parallel_perfects: { mode: 'forbid' },
    tritone_outline: { mode: 'repair' },
  },
};

// =================================================================
// PRIMITIVE REPAIR OPERATIONS (exported so the rules compose cleanly)
// =================================================================

/**
 * Octave-displace `pitch` until it sits within [lowMidi, highMidi], preserving
 * its letter and accidental (only the octave moves). Returns a new Pitch.
 */
export function clampToRange(pitch, lowMidi, highMidi) {
  if (!Number.isFinite(lowMidi) || !Number.isFinite(highMidi) || lowMidi > highMidi) {
    throw new Error(`clampToRange needs lowMidi <= highMidi, got ${lowMidi}..${highMidi}.`);
  }
  let result = pitch;
  let guard = 0;
  while (toMidi(result) < lowMidi && guard++ < OCTAVE_GUARD) {
    result = { ...result, octave: result.octave + 1 };
  }
  while (toMidi(result) > highMidi && guard++ < OCTAVE_GUARD) {
    result = { ...result, octave: result.octave - 1 };
  }
  return result;
}

/**
 * The nearest in-mode pitch to `pitch` (by semitone distance), preferring the
 * LOWER pitch on ties (downward). Returns the mode's canonical spelling of that
 * pitch — so the snapped note reads correctly in the active mode. A pitch
 * already in mode snaps to its own pitch class at the nearest octave.
 */
export function snapToMode(pitch, mode, tonic) {
  const midi = toMidi(pitch);
  const candidates = inModeCandidates(mode, tonic, pitch.octave - 1, pitch.octave + 1);
  let best = candidates[0];
  let bestDist = Infinity;
  let bestMidi = Infinity;
  for (const candidate of candidates) {
    const candidateMidi = toMidi(candidate);
    const dist = Math.abs(candidateMidi - midi);
    if (dist < bestDist || (dist === bestDist && candidateMidi < bestMidi)) {
      best = candidate;
      bestDist = dist;
      bestMidi = candidateMidi;
    }
  }
  return best;
}

/**
 * `pitch` moved by one scale step of `mode`/`tonic`: `direction` >= 0 steps up,
 * < 0 steps down. If `pitch` does not sit exactly on a scale degree it is first
 * snapped to the nearest one, then stepped. Returns a new Pitch.
 */
export function moveByStep(pitch, mode, tonic, direction) {
  const ladder = inModeCandidates(mode, tonic, pitch.octave - 2, pitch.octave + 2);
  const midi = toMidi(pitch);
  let index = 0;
  let bestDist = Infinity;
  ladder.forEach((candidate, i) => {
    const dist = Math.abs(toMidi(candidate) - midi);
    if (dist < bestDist) {
      bestDist = dist;
      index = i;
    }
  });
  const target = index + (direction >= 0 ? 1 : -1);
  const bounded = Math.max(0, Math.min(ladder.length - 1, target));
  return ladder[bounded];
}

/**
 * Signed semitone interval from `pitchA` to `pitchB`: positive when `pitchB` is
 * above `pitchA`, negative when below, zero when enharmonically unison.
 */
export function intervalBetween(pitchA, pitchB) {
  return toMidi(pitchB) - toMidi(pitchA);
}

// A de-duplicated, MIDI-ascending list of the mode's pitches across the octave
// range [lowOctave, highOctave] inclusive — the ladder snapToMode / moveByStep
// search over.
function inModeCandidates(mode, tonic, lowOctave, highOctave) {
  const byMidi = new Map();
  for (let octave = lowOctave; octave <= highOctave; octave++) {
    for (const pitch of pitchSetForScale(mode, tonic, octave)) {
      byMidi.set(toMidi(pitch), pitch);
    }
  }
  return [...byMidi.entries()].sort((a, b) => a[0] - b[0]).map(([, pitch]) => pitch);
}

// =================================================================
// RULE IMPLEMENTATIONS (each mutates `tracks` in place — `tracks` is the
// caller's private clone — and pushes one entry per repair onto `repairs`)
// =================================================================

const recordRepair = (repairs, voice, type, beat, before, after) =>
  repairs.push({ voice, type, beat, before, after });

// range_clamp — octave-displace any out-of-window pitch back into its voice's
// registral window. Enforced under both presets.
function ruleRangeClamp(tracks, repairs) {
  for (const voice of VOICES) {
    const [low, high] = RANGES[voice];
    tracks[voice] = tracks[voice].map((event) => {
      if (!event.pitch) return event;
      const clamped = clampToRange(event.pitch, low, high);
      if (toMidi(clamped) === toMidi(event.pitch)) return event;
      recordRepair(repairs, voice, 'range_clamp', event.beat, event.pitch, clamped);
      return { ...event, pitch: clamped };
    });
  }
}

// out_of_mode — snap a pitch whose class is outside the mode to the nearest
// in-mode pitch. Scope (which voices) and the anomaly exemption come from the
// preset config.
function ruleOutOfMode(tracks, cfg, mode, tonic, modeClasses, repairs) {
  for (const voice of cfg.voices) {
    tracks[voice] = tracks[voice].map((event) => {
      if (!event.pitch) return event;
      if (cfg.exemptAnomalous && event.anomalous) return event;
      if (modeClasses.has(pitchClassOf(event.pitch))) return event;
      const snapped = snapToMode(event.pitch, mode, tonic);
      recordRepair(repairs, voice, 'snap_to_mode', event.beat, event.pitch, snapped);
      return { ...event, pitch: snapped };
    });
  }
}

// The Pitch sounding in `track` at absolute `beat` (the event covering it), or
// null in a gap.
function pitchSoundingAt(track, beat) {
  for (const event of track) {
    if (event.pitch && beat >= event.beat - EPSILON && beat < event.beat + event.duration - EPSILON) {
      return event.pitch;
    }
  }
  return null;
}

// Drop `pitch` by whole octaves until it sits at or below `ceilingMidi`,
// without falling below `floorMidi`. Returns a new Pitch (possibly unchanged
// when it can't be brought under without leaving the window).
function dropAtOrBelow(pitch, ceilingMidi, floorMidi) {
  let result = pitch;
  let guard = 0;
  while (toMidi(result) > ceilingMidi + EPSILON && toMidi(result) - 12 >= floorMidi && guard++ < OCTAVE_GUARD) {
    result = { ...result, octave: result.octave - 1 };
  }
  return result;
}

// voice_crossing (forbid) — keep the canonical ordering lead >= harmony >= bass.
// Harmony above the lead at its onset is octave-displaced down; then bass above
// the (repaired) harmony is octave-displaced down. cpp_strict only.
function ruleVoiceCrossing(tracks, repairs) {
  tracks.harmony = tracks.harmony.map((event) => {
    if (!event.pitch) return event;
    const lead = pitchSoundingAt(tracks.lead, event.beat);
    if (!lead || toMidi(event.pitch) <= toMidi(lead) + EPSILON) return event;
    const dropped = dropAtOrBelow(event.pitch, toMidi(lead), RANGES.harmony[0]);
    if (toMidi(dropped) === toMidi(event.pitch)) return event;
    recordRepair(repairs, 'harmony', 'uncross', event.beat, event.pitch, dropped);
    return { ...event, pitch: dropped };
  });
  tracks.bass = tracks.bass.map((event) => {
    if (!event.pitch) return event;
    const harmony = pitchSoundingAt(tracks.harmony, event.beat);
    if (!harmony || toMidi(event.pitch) <= toMidi(harmony) + EPSILON) return event;
    const dropped = dropAtOrBelow(event.pitch, toMidi(harmony), RANGES.bass[0]);
    if (toMidi(dropped) === toMidi(event.pitch)) return event;
    recordRepair(repairs, 'bass', 'uncross', event.beat, event.pitch, dropped);
    return { ...event, pitch: dropped };
  });
}

const simpleInterval = (semitones) => ((Math.abs(semitones) % 12) + 12) % 12;
const isPerfect = (interval) => interval === 0 || interval === 7; // unison/octave or fifth

// The beats at which both `upper` and `lower` have an event onset, ascending —
// the instants a parallel-perfect check can compare the two voices.
function sharedOnsets(upper, lower) {
  const lowerOnsets = new Set(lower.filter((e) => e.pitch).map((e) => Math.round(e.beat / EPSILON) * EPSILON));
  const beats = [];
  for (const event of upper) {
    if (!event.pitch) continue;
    const key = Math.round(event.beat / EPSILON) * EPSILON;
    if (lowerOnsets.has(key)) beats.push(event.beat);
  }
  return [...new Set(beats)].sort((a, b) => a - b);
}

// parallel_perfects (forbid) — for a (upper, lower) voice pair, detect two
// consecutive same-direction perfect intervals at shared onsets and nudge the
// lower voice's second note by one scale step to break the parallel. cpp_strict.
//
// "whichever keeps it closer to the chord tone": Stage 7 is not handed the
// HarmonicPlan (its signature is (voiceTracks, macroParams, preset)), so the
// chord is not available here. We approximate that intent by choosing the step
// that (a) actually breaks the parallel and (b) does not push the lower voice
// above the upper (no new crossing), preferring downward on a tie. Documented
// in the journal as the one place cpp_strict can only approximate the rule.
function ruleParallelPerfects(tracks, mode, tonic, repairs) {
  const repairPair = (upperName, lowerName) => {
    const upper = tracks[upperName];
    const lower = tracks[lowerName];
    const beats = sharedOnsets(upper, lower);
    for (let k = 0; k + 1 < beats.length; k++) {
      const u1 = pitchSoundingAt(upper, beats[k]);
      const u2 = pitchSoundingAt(upper, beats[k + 1]);
      const l1 = pitchSoundingAt(lower, beats[k]);
      const l2 = pitchSoundingAt(lower, beats[k + 1]);
      if (!u1 || !u2 || !l1 || !l2) continue;
      const i1 = simpleInterval(intervalBetween(l1, u1));
      const i2 = simpleInterval(intervalBetween(l2, u2));
      if (!isPerfect(i1) || i2 !== i1) continue;
      const upperDir = Math.sign(toMidi(u2) - toMidi(u1));
      const lowerDir = Math.sign(toMidi(l2) - toMidi(l1));
      if (upperDir === 0 || upperDir !== lowerDir) continue;

      const fixed = chooseParallelFix(l2, u2, mode, tonic);
      if (!fixed) continue;
      // Write the new pitch onto the lower voice's event(s) starting at this beat.
      let changed = null;
      tracks[lowerName] = lower.map((event) => {
        if (event.pitch && Math.abs(event.beat - beats[k + 1]) < EPSILON) {
          changed = event;
          return { ...event, pitch: fixed };
        }
        return event;
      });
      if (changed) recordRepair(repairs, lowerName, 'parallel_break', beats[k + 1], changed.pitch, fixed);
    }
  };
  repairPair('lead', 'harmony');
  repairPair('harmony', 'bass');
  repairPair('lead', 'bass');
}

// Pick the one-scale-step nudge of `lower` that breaks the parallel against
// `upper` without crossing above it; prefer down on a tie. Returns null if
// neither direction helps (leave the parallel rather than make it worse).
function chooseParallelFix(lower, upper, mode, tonic) {
  const upperMidi = toMidi(upper);
  const breaksAndFits = (candidate) =>
    !isPerfect(simpleInterval(toMidi(upper) - toMidi(candidate))) && toMidi(candidate) <= upperMidi + EPSILON;
  const down = moveByStep(lower, mode, tonic, -1);
  if (breaksAndFits(down)) return down;
  const up = moveByStep(lower, mode, tonic, +1);
  if (breaksAndFits(up)) return up;
  return null;
}

// tritone_outline (repair) — scan each voice for a melodic interval of exactly
// 6 semitones between consecutive sounding events; insert a stepwise in-mode
// passing tone in the second half of the first event (whose duration is halved
// to make room). cpp_strict.
function ruleTritoneOutline(tracks, mode, tonic, repairs) {
  for (const voice of VOICES) {
    const events = tracks[voice];
    const out = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const next = events[i + 1];
      if (event.pitch && next && next.pitch && Math.abs(intervalBetween(event.pitch, next.pitch)) === 6) {
        const half = event.duration / 2;
        const direction = Math.sign(intervalBetween(event.pitch, next.pitch));
        const passing = moveByStep(event.pitch, mode, tonic, direction);
        out.push({ ...event, duration: half });
        out.push({ pitch: passing, beat: event.beat + half, duration: half });
        recordRepair(repairs, voice, 'tritone_passing', event.beat + half, null, passing);
      } else {
        out.push(event);
      }
    }
    tracks[voice] = out;
  }
}

// =================================================================
// DISPATCHER
// =================================================================

function cloneTracks(voiceTracks) {
  const cloneVoice = (track) => track.map((event) => ({ ...event }));
  return {
    lead: cloneVoice(voiceTracks.lead),
    harmony: cloneVoice(voiceTracks.harmony),
    bass: cloneVoice(voiceTracks.bass),
  };
}

/**
 * Run the named voice-leading rule set against `voiceTracks`, returning both
 * the repaired VoiceTracks and the ordered list of repairs applied. The input
 * is not mutated. Each repair is `{ voice, type, beat, before, after }` where
 * `before`/`after` are Pitch objects (before is null for an inserted note).
 *
 * Rule order: out_of_mode → range_clamp → voice_crossing → parallel_perfects →
 * tritone_outline. (Fix pitch classes, then octaves, then crossings, then
 * parallels, then insert passing tones last so nothing downstream re-scans the
 * inserted notes.)
 */
export function voiceLeadingReport(voiceTracks, macroParams, preset = 'chiptune_idiomatic') {
  const config = PRESETS[preset];
  if (!config) {
    throw new Error(
      `Unknown voice-leading preset "${preset}". Available: ${Object.keys(PRESETS).join(', ')}.`
    );
  }
  if (!macroParams || typeof macroParams.mode !== 'string' || macroParams.tonic == null) {
    throw new Error('applyVoiceLeading needs macroParams with a mode and tonic to run mode-aware rules.');
  }

  const { mode, tonic } = macroParams;
  const modeClasses = new Set(pitchSetForScale(mode, tonic).map(pitchClassOf));
  const tracks = cloneTracks(voiceTracks);
  const repairs = [];

  if (config.out_of_mode.enabled) ruleOutOfMode(tracks, config.out_of_mode, mode, tonic, modeClasses, repairs);
  if (config.range_clamp.enabled) ruleRangeClamp(tracks, repairs);
  if (config.voice_crossing.mode === 'forbid') ruleVoiceCrossing(tracks, repairs);
  if (config.parallel_perfects.mode === 'forbid') ruleParallelPerfects(tracks, mode, tonic, repairs);
  if (config.tritone_outline.mode === 'repair') ruleTritoneOutline(tracks, mode, tonic, repairs);

  // Keep each voice sorted by beat (tritone insertion / parallel fixes preserve
  // order, but re-sort defensively so downstream Stage 8 sees clean tracks).
  for (const voice of VOICES) tracks[voice].sort((a, b) => a.beat - b.beat);

  return { tracks, repairs };
}

/**
 * Apply the named voice-leading rule set, returning a NEW VoiceTracks with
 * repairs applied (the input is not mutated). `preset` defaults to
 * 'chiptune_idiomatic'; an unknown preset throws. This is the Stage-7 contract;
 * use voiceLeadingReport when you also need the list of repairs (the inspector).
 */
export function applyVoiceLeading(voiceTracks, macroParams, preset = 'chiptune_idiomatic') {
  return voiceLeadingReport(voiceTracks, macroParams, preset).tracks;
}

/**
 * A human-readable one-line summary of a repairs list, for the inspector:
 * "Repairs: 3 (lead: 1, harmony: 2, bass: 0)".
 */
export function summarizeRepairs(repairs) {
  const counts = { lead: 0, harmony: 0, bass: 0 };
  for (const repair of repairs) counts[repair.voice] += 1;
  return `Repairs: ${repairs.length} (lead: ${counts.lead}, harmony: ${counts.harmony}, bass: ${counts.bass})`;
}
