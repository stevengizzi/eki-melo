/* =================================================================
   BASS PATTERNS — figured bass-line generators (buildplan Session 4).

   One exported function per pattern, each of signature

     pattern(chord, mode, tonic, meter, barCount, params?) → [{ pitch, duration }, …]

   where `chord` is a resolved chord from the Roman-numeral resolver
   ({ root, quality, members: [root, third, fifth] }, all Pitch objects),
   `mode` / `tonic` name the active scale, `meter` is
   { numerator, denominator, grouping }, `barCount` is how many bars to cover,
   and the optional `params` carries pattern-specific knobs:

     - octave     bass register the line sits in (default 3)
     - degree     pedal target: 1 (section tonic) or 5 (its dominant)
     - nextChord  the following chord, so `walking` can step toward its root

   Every event's `pitch` is a Pitch object — NO synth strings here.
   Conversion to the synth alphabet happens once, at the Stage 6 → synth
   boundary in pipeline-runner.js.

   METER / BEAT UNITS. Per buildplan §7.3, rhythm values are in the meter's
   denominator unit: a "beat" is a quarter note in x/4 and an eighth in x/8.
   So a bar spans `numerator` beat-units (beatsPerBar), a quarter note is
   denominator/4 beat-units and an eighth is denominator/8. root_fifth and
   arpeggio adapt their figures to this; `walking` is 4/4-only and falls back
   to root_fifth elsewhere this session.

   PORTABILITY. Imports only from theory/ (mode-engine.js, pitch.js).
   ================================================================= */
import { degreeToPitch, pitchSetForScale } from './mode-engine.js';
import { toMidi } from './pitch.js';

const DEFAULT_BASS_OCTAVE = 3;

// Derived meter quantities, with sensible defaults for a missing meter.
function meterShape(meter) {
  const numerator = meter?.numerator ?? 4;
  const denominator = meter?.denominator ?? 4;
  return {
    numerator,
    denominator,
    beatsPerBar: numerator,
    quarterDur: denominator / 4,
    eighthDur: denominator / 8,
    isCommon: numerator === 4 && denominator === 4,
    isCompound: denominator === 8 && numerator % 3 === 0,
  };
}

const octaveOf = (params) => params.octave ?? DEFAULT_BASS_OCTAVE;

// Repeat `perBar` (a function bar → events) for `barCount` bars and flatten.
function overBars(barCount, perBar) {
  return Array.from({ length: barCount }, (_, bar) => perBar(bar)).flat();
}

/**
 * Root–fifth alternation: root on the odd beats, fifth on the even ones. In
 * 4/4 that is root–fifth–root–fifth (one per quarter); in 3/4, root–fifth–root.
 * In compound meters (6/8, 9/8) the bar is grouped into dotted-quarter pulses
 * and each pulse carries root then fifth, so the root lands on every pulse.
 */
export function root_fifth(chord, mode, tonic, meter, barCount, params = {}) {
  const { beatsPerBar, isCompound } = meterShape(meter);
  const root = chord.root;
  const fifth = chord.members[2];

  if (isCompound) {
    const pulseHalf = 1.5; // half of a dotted-quarter pulse (3 eighth-units)
    const pulses = beatsPerBar / 3;
    return overBars(barCount, () =>
      Array.from({ length: pulses }, () => [
        { pitch: root, duration: pulseHalf },
        { pitch: fifth, duration: pulseHalf },
      ]).flat()
    );
  }

  return overBars(barCount, () =>
    Array.from({ length: beatsPerBar }, (_, beat) => ({
      pitch: beat % 2 === 0 ? root : fifth,
      duration: 1,
    }))
  );
}

// A MIDI-sorted ladder of the mode's pitches across the bass register, used
// by `walking` to find the next scale step toward a target.
function scaleLadder(mode, tonic) {
  const rungs = [2, 3, 4, 5]
    .flatMap((octave) => pitchSetForScale(mode, tonic, octave))
    .map((pitch) => ({ pitch, midi: toMidi(pitch) }))
    .sort((a, b) => a.midi - b.midi);
  // De-duplicate enharmonic collisions at octave seams by MIDI.
  return rungs.filter((rung, i) => i === 0 || rung.midi !== rungs[i - 1].midi);
}

// One scale step along the ladder from `from`, in the direction of `target`.
function stepToward(ladder, from, target) {
  const fromMidi = toMidi(from);
  const targetMidi = toMidi(target);
  let nearest = 0;
  ladder.forEach((rung, i) => {
    if (Math.abs(rung.midi - fromMidi) < Math.abs(ladder[nearest].midi - fromMidi)) nearest = i;
  });
  const direction = Math.sign(targetMidi - fromMidi) || 1;
  const next = Math.min(Math.max(nearest + direction, 0), ladder.length - 1);
  return ladder[next].pitch;
}

/**
 * Walking quarter-note line (4/4 only): root, a scale step toward the next
 * chord's root, the fifth, then another scale step toward the next chord's
 * root. `params.nextChord` supplies the target; without it the line steps
 * within the current chord. Any non-4/4 meter falls back to root_fifth this
 * session.
 */
export function walking(chord, mode, tonic, meter, barCount, params = {}) {
  const shape = meterShape(meter);
  if (!shape.isCommon) return root_fifth(chord, mode, tonic, meter, barCount, params);

  const ladder = scaleLadder(mode, tonic);
  const root = chord.root;
  const fifth = chord.members[2];
  const nextRoot = params.nextChord ? params.nextChord.root : root;

  return overBars(barCount, () => [
    { pitch: root, duration: 1 },
    { pitch: stepToward(ladder, root, nextRoot), duration: 1 },
    { pitch: fifth, duration: 1 },
    { pitch: stepToward(ladder, fifth, nextRoot), duration: 1 },
  ]);
}

/**
 * Pedal point: hold a single Pitch — scale degree `params.degree` (1 or 5) of
 * the SECTION's tonic, not the chord's root — rearticulated once per bar so it
 * keeps a pulse rather than fading. Defaults to the tonic (degree 1).
 */
export function pedal(chord, mode, tonic, meter, barCount, params = {}) {
  const { beatsPerBar } = meterShape(meter);
  const degree = params.degree === 5 ? 5 : 1;
  const pitch = degreeToPitch(mode, tonic, degree, octaveOf(params));
  return overBars(barCount, () => [{ pitch, duration: beatsPerBar }]);
}

/**
 * Arpeggio: the chord's root–third–fifth–third cycled in eighth notes,
 * filling each bar. The eighth-note duration adapts to the meter's beat unit
 * (0.5 in x/4, 1 in x/8).
 */
export function arpeggio(chord, mode, tonic, meter, barCount, params = {}) {
  const { beatsPerBar, eighthDur } = meterShape(meter);
  const [root, third, fifth] = chord.members;
  const cycle = [root, third, fifth, third];
  const notesPerBar = Math.round(beatsPerBar / eighthDur);
  return overBars(barCount, () =>
    Array.from({ length: notesPerBar }, (_, i) => ({
      pitch: cycle[i % cycle.length],
      duration: eighthDur,
    }))
  );
}

/**
 * Cadential V→i bass motion — the dominant for the first half of the bar, the
 * tonic for the second — in the SECTION's tonic, regardless of the chord
 * passed in. Placeholder for cadence approach; Session 5's cadence-formula
 * library refines this. With barCount > 1, earlier bars get root_fifth and the
 * final bar gets the V→i gesture.
 */
export function cadential_5_1(chord, mode, tonic, meter, barCount, params = {}) {
  const { beatsPerBar } = meterShape(meter);
  const dominant = degreeToPitch(mode, tonic, 5, octaveOf(params));
  const tonicPitch = degreeToPitch(mode, tonic, 1, octaveOf(params));
  const half = beatsPerBar / 2;

  return overBars(barCount, (bar) => {
    if (bar < barCount - 1) {
      return root_fifth(chord, mode, tonic, meter, 1, params);
    }
    return [
      { pitch: dominant, duration: half },
      { pitch: tonicPitch, duration: half },
    ];
  });
}

// Registry for name → function dispatch (Stage 6 reads the TexturePlan's
// pattern strings against this).
export const BASS_PATTERNS = {
  root_fifth,
  walking,
  pedal,
  arpeggio,
  cadential_5_1,
};
