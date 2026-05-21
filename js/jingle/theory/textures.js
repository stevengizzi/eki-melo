/* =================================================================
   TEXTURES — the harmony-voice vocabulary (buildplan Session 6).

   Texture is CODE, not data: each texture is a pure function that takes the
   lead's events for a passage plus the chords under it, and returns the
   harmony voice's beat-stamped events. Stage 6 dispatches a TexturePlan's
   `mode` string against TEXTURE_REGISTRY and concatenates the results into
   the harmony track.

   SHARED SIGNATURE
     texture(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave,
             meter, params) → [{ pitch: Pitch, beat, duration }, …]

   - leadEventsInRange  the lead's { pitch, beat, duration, degree,
                        octave_offset } events within this passage's bar range.
                        `pitch` is a Pitch object; `degree` (1..7) and
                        `octave_offset` come from the motif realization and let
                        a texture reason in degree space (a third below, etc.)
                        without re-deriving from the Pitch.
   - chordsByAbsBar     a Map from ABSOLUTE bar index (0-indexed, from the start
                        of the piece) to a resolved chord { root, quality,
                        members:[root, third, fifth, …] } (Pitch objects) for
                        the bars in this passage. Its keys ARE the passage's bar
                        range — textures that work bar-by-bar read them directly.
   - mode, tonic        the active scale, piece-global this session.
   - leadOctave         the lead's register-center octave (e.g. 5), so a texture
                        can place itself relative to the lead.
   - meter              { numerator, denominator, grouping }.
   - params             texture-specific knobs (e.g. { degree: 5 } for oblique).

   OUTPUT. Beat-stamped harmony events with ABSOLUTE beats (same axis as the
   lead). Returning [] is valid (dropout, or a chord-needing texture with no
   chords). Every output pitch is a Pitch object — never a string, never null
   (Stage 6 inserts rests for gaps later, in toSequence).

   RANGE / VOICING CONSTRAINTS.
   - Harmony register window is MIDI 60 (C4) … 83 (B5). Any computed pitch
     outside it is octave-displaced back in (clampToRange).
   - Voice crossing: harmony sits AT OR BELOW the lead at every instant. A
     texture that would place harmony above the lead octave-displaces it down
     (placeAtOrBelow). The ONE documented exception is imitation: a one-beat-
     delay canon legitimately crosses when the lead has dipped below the echo,
     so it only range-clamps and may briefly sit above the lead.

   PORTABILITY. Imports only from theory/ (mode-engine.js, pitch.js). No synth,
   no pipeline — keeps the theory layer portable.
   ================================================================= */
import { degreeToPitch } from './mode-engine.js';
import { toMidi, pitchClassOf, pitchFromLetterAndAccidental } from './pitch.js';

const DEGREES_PER_OCTAVE = 7;
const HARMONY_LOW_MIDI = 60; // C4
const HARMONY_HIGH_MIDI = 83; // B5
const EPSILON = 1e-9;
const OCTAVE_GUARD = 16; // the window is 2 octaves wide; this never trips in practice

// Sharp-spelling table for respelling a bare MIDI number (imitation transposes
// in semitones, which has no diatonic letter to preserve). Audibly identical to
// any enharmonic; the synth boundary collapses spelling anyway.
const SHARP_SPELLING = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];

// --- meter / register helpers ----------------------------------------------

const beatsPerBarOf = (meter) => meter?.numerator ?? 4;

// An eighth note in the meter's beat-unit (0.5 in x/4, 1 in x/8) — see
// bass-patterns.js and buildplan §7.3.
const eighthDurOf = (meter) => (meter?.denominator ?? 4) / 8;

function midiToPitch(midi) {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const [letter, accidental] = SHARP_SPELLING[pitchClass];
  return pitchFromLetterAndAccidental(letter, accidental, octave);
}

// --- degree-space helpers --------------------------------------------------

// The lead event's linear scale-step height from the tonic (tonic = 0, the
// second = 1, the octave = 7), folding its octave_offset back in. This is the
// monotonic-in-pitch coordinate parallel/contrary motion reason in.
function leadLinearOf(leadEvent) {
  return (leadEvent.degree - 1) + (leadEvent.octave_offset ?? 0) * DEGREES_PER_OCTAVE;
}

// Realize a linear scale-step height as a Pitch in the given base octave,
// staying in mode (degreeToPitch keeps the modal spelling).
function pitchFromLinear(linear, mode, tonic, baseOctave) {
  const octaveShift = Math.floor(linear / DEGREES_PER_OCTAVE);
  const index = ((linear % DEGREES_PER_OCTAVE) + DEGREES_PER_OCTAVE) % DEGREES_PER_OCTAVE;
  return degreeToPitch(mode, tonic, index + 1, baseOctave + octaveShift);
}

// --- range / voice-crossing helpers ----------------------------------------

// Octave-displace `pitch` until it sits within the harmony register window.
function clampToRange(pitch) {
  let result = pitch;
  let guard = 0;
  while (toMidi(result) < HARMONY_LOW_MIDI && guard++ < OCTAVE_GUARD) {
    result = { ...result, octave: result.octave + 1 };
  }
  while (toMidi(result) > HARMONY_HIGH_MIDI && guard++ < OCTAVE_GUARD) {
    result = { ...result, octave: result.octave - 1 };
  }
  return result;
}

// Bring `pitch` into range, THEN drop it by octaves until it sits at or below
// `leadMidi` (the no-voice-crossing rule), without falling below the window
// floor. `leadMidi` of null/undefined means "no lead to stay under" → range
// clamp only.
function placeAtOrBelow(pitch, leadMidi) {
  let result = clampToRange(pitch);
  if (leadMidi == null) return result;
  let guard = 0;
  while (
    toMidi(result) > leadMidi + EPSILON &&
    toMidi(result) - 12 >= HARMONY_LOW_MIDI &&
    guard++ < OCTAVE_GUARD
  ) {
    result = { ...result, octave: result.octave - 1 };
  }
  return result;
}

// The lead Pitch sounding at absolute beat `beat`, or null in a gap. Used by
// rhythm-independent textures to honor the no-crossing rule against whichever
// lead note is sounding.
function leadPitchAtBeat(leadEventsInRange, beat) {
  for (const event of leadEventsInRange) {
    if (beat >= event.beat - EPSILON && beat < event.beat + event.duration - EPSILON) {
      return event.pitch;
    }
  }
  return null;
}

const midiOrNull = (pitch) => (pitch ? toMidi(pitch) : null);

// The lowest lead MIDI in the passage (so a held tone can sit under ALL of it),
// or null if the passage has no lead.
function lowestLeadMidi(leadEventsInRange) {
  if (leadEventsInRange.length === 0) return null;
  return Math.min(...leadEventsInRange.map((event) => toMidi(event.pitch)));
}

const roundBeat = (beat) => Math.round(beat * 1e6) / 1e6;

// The absolute bar indices a passage covers, ascending (the keys of
// chordsByAbsBar). The chord for a missing key is the first available chord.
const passageBars = (chordsByAbsBar) => [...chordsByAbsBar.keys()].sort((a, b) => a - b);

// =================================================================
// PARALLEL MOTION
// =================================================================

// One harmony event per lead event, a fixed number of scale steps from the
// lead and clamped to sit at or below it. `steps` is signed in scale degrees
// (a third = ±2, a sixth = ±5).
function parallelBySteps(leadEventsInRange, steps, mode, tonic, leadOctave) {
  return leadEventsInRange.map((event) => {
    const pitch = pitchFromLinear(leadLinearOf(event) + steps, mode, tonic, leadOctave);
    return {
      pitch: placeAtOrBelow(pitch, toMidi(event.pitch)),
      beat: event.beat,
      duration: event.duration,
    };
  });
}

/**
 * A scale-degree third (two scale steps) below the lead, one event per lead
 * note. The Session-4 placeholder behavior, preserved.
 */
export function parallel_thirds_below(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave) {
  return parallelBySteps(leadEventsInRange, -2, mode, tonic, leadOctave);
}

/**
 * A third above the lead, octave-displaced down so it never crosses above it.
 */
export function parallel_thirds_above(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave) {
  return parallelBySteps(leadEventsInRange, +2, mode, tonic, leadOctave);
}

/**
 * A scale-degree sixth (five scale steps) below the lead.
 */
export function parallel_sixths_below(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave) {
  return parallelBySteps(leadEventsInRange, -5, mode, tonic, leadOctave);
}

/**
 * A sixth above the lead, octave-displaced down so it never crosses above it.
 */
export function parallel_sixths_above(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave) {
  return parallelBySteps(leadEventsInRange, +5, mode, tonic, leadOctave);
}

// =================================================================
// CONTRARY MOTION
// =================================================================

/**
 * Harmony moves opposite to the lead. It starts a third below the lead's first
 * note; on each subsequent lead step it moves ONE scale step the other way (and
 * stays put when the lead repeats a pitch). Stays in mode (degreeToPitch per
 * step) and clamps at or below the lead.
 */
export function contrary_motion(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave) {
  if (leadEventsInRange.length === 0) return [];

  let harmonyLinear = leadLinearOf(leadEventsInRange[0]) - 2; // a third below the first note
  let prevLeadLinear = leadLinearOf(leadEventsInRange[0]);
  const events = [];

  leadEventsInRange.forEach((event, i) => {
    if (i > 0) {
      const leadStep = Math.sign(leadLinearOf(event) - prevLeadLinear);
      harmonyLinear -= leadStep; // opposite direction, one scale step (0 when the lead repeats)
      prevLeadLinear = leadLinearOf(event);
    }
    const pitch = pitchFromLinear(harmonyLinear, mode, tonic, leadOctave);
    events.push({
      pitch: placeAtOrBelow(pitch, toMidi(event.pitch)),
      beat: event.beat,
      duration: event.duration,
    });
  });
  return events;
}

// =================================================================
// HELD / DRONE TEXTURES
// =================================================================

// One held event per bar of the passage, all on `pitch`, placed at or below
// the lowest lead note so it never crosses for the whole passage.
function heldPerBar(pitch, leadEventsInRange, chordsByAbsBar, meter) {
  const bars = passageBars(chordsByAbsBar);
  if (bars.length === 0) return [];
  const beatsPerBar = beatsPerBarOf(meter);
  const placed = placeAtOrBelow(pitch, lowestLeadMidi(leadEventsInRange));
  return bars.map((bar) => ({ pitch: placed, beat: bar * beatsPerBar, duration: beatsPerBar }));
}

/**
 * Harmony holds a single pitch through the passage, rearticulating once per
 * bar. The pitch is the chord's root (default) or fifth (params.degree === 5).
 * Taken from the passage's FIRST chord, since the held tone does not move.
 */
export function oblique_held(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave, meter, params = {}) {
  const bars = passageBars(chordsByAbsBar);
  if (bars.length === 0) return [];
  const chord = chordsByAbsBar.get(bars[0]);
  const useFifth = params.degree === 5 || params.degree === 'fifth';
  const pitch = useFifth ? chord.members[2] : chord.members[0];
  return heldPerBar(pitch, leadEventsInRange, chordsByAbsBar, meter);
}

/**
 * Harmony holds the SECTION's tonic (scale degree 1) — NOT the chord's root —
 * rearticulated once per bar.
 */
export function drone_on_1(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave, meter) {
  return heldPerBar(degreeToPitch(mode, tonic, 1, 4), leadEventsInRange, chordsByAbsBar, meter);
}

/**
 * Harmony holds the section's scale degree 5, rearticulated once per bar.
 */
export function drone_on_5(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave, meter) {
  return heldPerBar(degreeToPitch(mode, tonic, 5, 4), leadEventsInRange, chordsByAbsBar, meter);
}

// =================================================================
// IMITATION
// =================================================================

// The signed semitone shift (smallest magnitude, ties resolved downward) that
// lands `fromPitch`'s pitch class on the nearest chord-tone pitch class.
function shiftToNearestChordTone(fromPitch, chord) {
  const targets = chord.members.map(pitchClassOf);
  const fromPc = pitchClassOf(fromPitch);
  let best = 0;
  let bestAbs = Infinity;
  for (let delta = -6; delta <= 6; delta++) {
    const pc = (((fromPc + delta) % 12) + 12) % 12;
    if (!targets.includes(pc)) continue;
    const abs = Math.abs(delta);
    if (abs < bestAbs || (abs === bestAbs && delta < best)) {
      bestAbs = abs;
      best = delta;
    }
  }
  return best;
}

/**
 * Harmony plays the lead's line one beat later, transposed (in semitones) so
 * its first note lands on the chord tone nearest the lead's first pitch — a
 * one-beat-delay canon. Two Session-6 rules shape the echo:
 *
 *  - REST ON COINCIDENT ATTACK. The literal "rest wherever the harmony overlaps
 *    a still-sounding lead note" is degenerate (the lead sounds continuously, so
 *    nothing would ever play). We read it as the strongest overlap — a
 *    simultaneous attack — and suppress (rest) any echo note whose onset
 *    coincides with a lead onset, leaving an audible call-and-echo with gaps.
 *  - CLIP THE TAIL. The one-beat delay would push the final echo past the
 *    passage; events starting at/after the passage end are dropped and a
 *    straddler is truncated, so imitation never spills into the next texture.
 *
 * VOICE CROSSING is allowed here (the documented exception): a delayed echo can
 * legitimately sit above the lead when the lead has dipped low. Output is only
 * range-clamped, never forced under the lead.
 */
export function imitation_one_beat_delay(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave, meter) {
  if (leadEventsInRange.length === 0) return [];
  const beatsPerBar = beatsPerBarOf(meter);
  const bars = passageBars(chordsByAbsBar);
  const passageEndBeat =
    bars.length > 0 ? (bars[bars.length - 1] + 1) * beatsPerBar : Infinity;

  const first = leadEventsInRange[0];
  const firstBar = Math.floor(first.beat / beatsPerBar);
  const chord = chordsByAbsBar.get(firstBar) ?? (bars.length > 0 ? chordsByAbsBar.get(bars[0]) : null);
  const shift = chord ? shiftToNearestChordTone(first.pitch, chord) : 0;

  const leadOnsets = new Set(leadEventsInRange.map((event) => roundBeat(event.beat)));

  const events = [];
  for (const event of leadEventsInRange) {
    const onset = event.beat + 1; // one beat-unit later
    if (onset >= passageEndBeat - EPSILON) continue; // tail past the passage
    if (leadOnsets.has(roundBeat(onset))) continue; // would attack with the lead → rest
    const duration = Math.min(event.duration, passageEndBeat - onset);
    if (duration <= EPSILON) continue;
    events.push({
      pitch: clampToRange(midiToPitch(toMidi(event.pitch) + shift)),
      beat: onset,
      duration,
    });
  }
  return events;
}

// =================================================================
// VOICE EXCHANGE (Session-6 placeholder)
// =================================================================

/**
 * SESSION-6 PLACEHOLDER. Harmony simply plays the lead's pitches an octave
 * below (one event per lead note, same beat and duration). True voice exchange
 * — the lead taking a held tone while the harmony carries the melody — is a
 * future refinement (it needs Stage 6 to rewrite the lead too); this octave-
 * below double is the audible stand-in, and is always at or below the lead.
 */
export function voice_exchange(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave) {
  return leadEventsInRange.map((event) => ({
    pitch: clampToRange({ ...event.pitch, octave: event.pitch.octave - 1 }),
    beat: event.beat,
    duration: event.duration,
  }));
}

// =================================================================
// DROPOUT
// =================================================================

/**
 * Harmony plays nothing for the passage.
 */
export function dropout() {
  return [];
}

// =================================================================
// CHORD-TONE PULSE
// =================================================================

/**
 * Harmony cycles the bar's chord tones — root → third → fifth → third → … — in
 * steady eighth notes for the whole passage, regardless of the lead's rhythm.
 * Each note is clamped at or below whatever lead note is sounding under it.
 */
export function chord_tones_pulse(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave, meter) {
  const bars = passageBars(chordsByAbsBar);
  if (bars.length === 0) return [];
  const beatsPerBar = beatsPerBarOf(meter);
  const eighth = eighthDurOf(meter);
  const notesPerBar = Math.max(1, Math.round(beatsPerBar / eighth));
  const cycle = [0, 1, 2, 1]; // root, third, fifth, third (member indices)

  const events = [];
  let step = 0;
  for (const bar of bars) {
    const chord = chordsByAbsBar.get(bar);
    for (let i = 0; i < notesPerBar; i++) {
      const beat = bar * beatsPerBar + i * eighth;
      const tone = chord.members[cycle[step % cycle.length]];
      events.push({
        pitch: placeAtOrBelow(tone, midiOrNull(leadPitchAtBeat(leadEventsInRange, beat))),
        beat,
        duration: eighth,
      });
      step += 1;
    }
  }
  return events;
}

// =================================================================
// HETEROPHONY
// =================================================================

/**
 * Harmony shadows the lead at twice its rhythmic density: each lead event
 * becomes two half-duration events — the lead's own pitch, then a passing /
 * neighbor tone a scale step toward the NEXT lead pitch (the same pitch when the
 * lead repeats, or has reached its end). The shadow is voiced an octave below
 * the lead so the rising ornament never crosses above it (the literal-unison
 * reading the prompt names would cross on an ascending step; octave-below keeps
 * the same pitch CLASS while honoring the no-crossing rule). The octave doubling
 * plus the ornament reads as heterophony rather than a plain unison.
 */
export function heterophony(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave) {
  const events = [];
  leadEventsInRange.forEach((event, i) => {
    const half = event.duration / 2;
    const baseLinear = leadLinearOf(event);

    // First half — the lead's pitch, an octave below.
    events.push({
      pitch: clampToRange(pitchFromLinear(baseLinear, mode, tonic, leadOctave - 1)),
      beat: event.beat,
      duration: half,
    });

    // Second half — a scale step toward the next lead pitch (0 = stay put).
    const next = leadEventsInRange[i + 1];
    const direction = next ? Math.sign(leadLinearOf(next) - baseLinear) : 0;
    events.push({
      pitch: clampToRange(pitchFromLinear(baseLinear + direction, mode, tonic, leadOctave - 1)),
      beat: event.beat + half,
      duration: half,
    });
  });
  return events;
}

// =================================================================
// REGISTRY
// =================================================================

/**
 * name → texture function, so Stage 6 dispatches a TexturePlan's `mode` string.
 */
export const TEXTURE_REGISTRY = {
  parallel_thirds_below,
  parallel_thirds_above,
  parallel_sixths_below,
  parallel_sixths_above,
  contrary_motion,
  oblique_held,
  drone_on_1,
  drone_on_5,
  imitation_one_beat_delay,
  voice_exchange,
  dropout,
  chord_tones_pulse,
  heterophony,
};
