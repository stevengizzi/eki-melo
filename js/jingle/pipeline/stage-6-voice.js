/* =================================================================
   STAGE 6 — VOICE REALIZATION (buildplan Session 4).

   realizeVoices({ macroParams, motifs, harmonicPlan, phrasePlan,
                   texturePlan, config }) → VoiceTracks

   where VoiceTracks = { lead, harmony, bass }, each an array of
   { pitch, beat, duration } events SORTED BY BEAT (buildplan Session 5
   refactor). `pitch` is a Pitch object ({ letter, accidental, octave }); `beat`
   is the event's absolute start beat from the start of the piece; `duration` is
   in the meter's beat-unit (buildplan §7.3).

   BEAT-STAMPED, NOT YET SEQUENCED. Stage 6 used to flatten its events into a
   back-to-back { pitch, duration } sequence (with `null` rests for gaps) before
   returning. That flattening now happens ONCE in pipeline-runner.js, AFTER
   Stage 8 — because Stage 8 (cadence enforcement) needs the beat positions to
   know which events to overwrite. So Stages 6/7/8 all pass beat-stamped events;
   the runner calls `toSequence` (exported here) at the very end. NO synth
   strings are produced here — the Pitch → string conversion (toSynthString)
   happens once, in the runner, after sequencing.

   This is the deterministic heart of the pipeline: it takes mode-agnostic
   plans (motifs in scale degrees, a Roman-numeral progression, phrase/texture
   choreography) and realizes them into concrete pitches in the piece's mode.

   - LEAD walks the PhrasePlan: per section, per assignment, it applies the
     named transformation to the referenced motif, renders it to degree events
     at the assignment's bar, and resolves each degree to a Pitch via
     mode-engine. A chromatic_neighbor anomaly bends its flagged note a half
     step toward the adjacent note.
   - HARMONY walks the TexturePlan. For each assignment it gathers the lead
     events in the bar range plus a chord-per-bar map (from the HarmonicPlan via
     the Roman-numeral resolver) and dispatches the assignment's `mode` string
     against textures.js's TEXTURE_REGISTRY — the full Session-6 vocabulary
     (parallel/contrary/oblique/drone/imitation/heterophony/…). An unknown
     texture name throws loudly.
   - BASS walks the TexturePlan's bass assignments, resolves each bar's chord
     from the HarmonicPlan via the Session-4 Roman-numeral stub, and calls the
     named bass pattern.

   Mode and tonic are piece-global (from macroParams) this session — there is
   no per-section modulation yet.

   PORTABILITY NOTE. This is pipeline/ code, so it may import from theory/. It
   does not touch synth.js or any other existing file.
   ================================================================= */
import { degreeToPitch } from '../theory/mode-engine.js';
import { toMidi, pitchFromLetterAndAccidental } from '../theory/pitch.js';
import { renderMotifToDegreeEvents } from '../theory/motif.js';
import * as Transforms from '../theory/transformations.js';
import { getForm, distributeBars } from '../theory/form-engine.js';
import { resolveRoman } from '../theory/roman-numeral.js';
import { BASS_PATTERNS } from '../theory/bass-patterns.js';
import { TEXTURE_REGISTRY } from '../theory/textures.js';

const DEFAULT_LEAD_OCTAVE = 5;
const BASS_BASE_OCTAVE = 3;
const HARMONY_CHORD_OCTAVE = 4; // chords handed to textures sit near the harmony register
const EPSILON = 1e-9;

// Sharp-spelling table for the rare chromatic-anomaly fallback (see bendHalfStep).
const SHARP_SPELLING = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];

// --- meter / register helpers ---------------------------------------------

function beatsPerBarOf(meter) {
  return meter?.numerator ?? 4;
}

function leadOctaveOf(macroParams) {
  const center = macroParams.register_center;
  if (typeof center === 'string') {
    const match = center.match(/(-?\d+)$/);
    if (match) return parseInt(match[1], 10);
  }
  return DEFAULT_LEAD_OCTAVE;
}

/**
 * The ordered section plan for `macroParams` as [{ label, startBar, bars }],
 * where `startBar` is the 0-indexed bar offset of the section in the piece.
 * Prefers an explicit `macroParams.sections` ([{ label, bars }, …]); otherwise
 * derives labels from the form and bar counts from `macroParams.section_bars`
 * (or form-engine's distributeBars). Exported so the runner can build matching
 * section metadata without recomputing the logic.
 */
export function computeSectionPlan(macroParams) {
  let labelled;
  if (Array.isArray(macroParams.sections)) {
    labelled = macroParams.sections.map((s) => ({ label: s.label, bars: s.bars }));
  } else {
    const form = getForm(macroParams.form);
    const counts = Array.isArray(macroParams.section_bars)
      ? macroParams.section_bars
      : distributeBars(macroParams.form, macroParams.total_bars);
    labelled = form.section_labels.map((label, i) => ({ label, bars: counts[i] }));
  }
  let startBar = 0;
  return labelled.map(({ label, bars }) => {
    const entry = { label, startBar, bars };
    startBar += bars;
    return entry;
  });
}

// --- transform parsing -----------------------------------------------------

// Parse a transform spec into { name, params }. Accepts an object
// ({ name, params }), a bare name string ("sequence_up_step"), or the
// "name@k=v,k2=v2" string form ("invert@pivot=3"). Numeric values parse to
// numbers; everything else stays a string.
function parseTransform(spec) {
  if (spec && typeof spec === 'object') {
    return { name: spec.name, params: spec.params ?? {} };
  }
  if (typeof spec !== 'string' || spec.length === 0) {
    return { name: 'literal', params: {} };
  }
  const [name, paramString] = spec.split('@');
  const params = {};
  if (paramString) {
    for (const pair of paramString.split(',')) {
      const [key, value] = pair.split('=');
      const asNumber = Number(value);
      params[key] = value !== '' && Number.isFinite(asNumber) ? asNumber : value;
    }
  }
  return { name, params };
}

// Apply a transform to a motif, returning the transformed motif — or null when
// the assignment is a non-motivic slot (a null motif, or the cadential_gesture
// placeholder Session 5 will fill in).
function applyTransform(motif, spec) {
  if (!motif) return null;
  const { name, params } = parseTransform(spec);
  if (name === 'cadential_gesture') return null;
  const fn = Transforms[name];
  if (typeof fn !== 'function') {
    throw new Error(`Unknown transform "${name}". See theory/transformations.js for the available transforms.`);
  }
  return fn(motif, params);
}

// --- pitch helpers ---------------------------------------------------------

function midiToPitch(midi) {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const [letter, accidental] = SHARP_SPELLING[pitchClass];
  return pitchFromLetterAndAccidental(letter, accidental, octave);
}

// Bend a pitch a half step in `direction` (+1 up, -1 down). Preferred spelling
// nudges the accidental of the original letter; if that would exceed a double
// accidental, fall back to a clean MIDI respelling.
function bendHalfStep(pitch, direction) {
  const adjusted = pitch.accidental + direction;
  if (adjusted >= -2 && adjusted <= 2) {
    return pitchFromLetterAndAccidental(pitch.letter, adjusted, pitch.octave);
  }
  return midiToPitch(toMidi(pitch) + direction);
}

// --- lead ------------------------------------------------------------------

// Realize a single placed motif into lead events carrying both the Pitch and
// the originating degree/octave (the latter so harmony can derive a third
// below). Reads the transformed motif's chromatic_neighbor anomaly to bend the
// flagged note.
function realizeLeadAssignment(transformed, startBeat, mode, tonic, leadOctave) {
  const degreeEvents = renderMotifToDegreeEvents(transformed, startBeat);
  const anomaly = transformed.anomaly;
  const chromaticAt =
    anomaly && anomaly.type === 'chromatic_neighbor' ? anomaly.at_position : -1;

  const pitchAt = (event) =>
    degreeToPitch(mode, tonic, event.degree, leadOctave + event.octave_offset);

  return degreeEvents.map((event, i) => {
    let pitch = pitchAt(event);
    if (i === chromaticAt) {
      const neighborIndex = i + 1 < degreeEvents.length ? i + 1 : i - 1;
      if (neighborIndex >= 0) {
        const neighbor = pitchAt(degreeEvents[neighborIndex]);
        const direction = Math.sign(toMidi(neighbor) - toMidi(pitch)) || 1;
        pitch = bendHalfStep(pitch, direction);
      }
    }
    return {
      pitch,
      beat: event.beat,
      duration: event.duration,
      degree: event.degree,
      octave_offset: event.octave_offset,
    };
  });
}

function buildLead(macroParams, motifs, phrasePlan, sections, mode, tonic, leadOctave) {
  const beatsPerBar = beatsPerBarOf(macroParams.meter);
  const events = [];
  for (const section of sections) {
    const plan = phrasePlan[section.label];
    if (!plan || !Array.isArray(plan.lead)) continue;
    for (const assignment of plan.lead) {
      const motif = assignment.motif == null ? null : motifs[assignment.motif];
      if (assignment.motif != null && !motif) {
        throw new Error(`PhrasePlan section "${section.label}" references unknown motif "${assignment.motif}".`);
      }
      const transformed = applyTransform(motif, assignment.transform);
      if (!transformed) continue;
      const absBar = section.startBar + (assignment.start_bar - 1);
      const startBeat = absBar * beatsPerBar;
      events.push(...realizeLeadAssignment(transformed, startBeat, mode, tonic, leadOctave));
    }
  }
  return events;
}

// --- harmony ---------------------------------------------------------------

// The chord-per-bar map a texture reads, keyed by ABSOLUTE bar index over the
// assignment's bar range. One chord per bar, cycling the section's progression
// (romanForBar). An empty progression yields an empty map — chord-needing
// textures (drones, oblique, pulse, imitation) then return [] gracefully, while
// the parallel/contrary textures ignore it.
function chordsForBarRange(progression, mode, tonic, sectionStartBar, absStartBar, absEndBar) {
  const chords = new Map();
  for (let bar = absStartBar; bar <= absEndBar; bar++) {
    const roman = romanForBar(progression, bar - sectionStartBar + 1);
    if (roman == null) continue;
    chords.set(bar, resolveRoman(roman, mode, tonic, HARMONY_CHORD_OCTAVE));
  }
  return chords;
}

// Walk the TexturePlan's harmony assignments and dispatch each `mode` string to
// the matching texture in TEXTURE_REGISTRY, gathering the lead events and a
// chord-per-bar map for the assignment's bar range. An unknown texture name
// throws loudly. Texture-specific knobs ride in `params` (assignment.params,
// plus a bare `degree` shorthand for drones/oblique).
function buildHarmony(macroParams, harmonicPlan, texturePlan, sections, leadEvents, mode, tonic, leadOctave) {
  const beatsPerBar = beatsPerBarOf(macroParams.meter);
  const meter = macroParams.meter ?? { numerator: 4, denominator: 4 };
  const sectionProgressions = new Map(
    (harmonicPlan.sections ?? []).map((s) => [s.label, s.progression])
  );
  const events = [];

  for (const section of sections) {
    const plan = texturePlan[section.label];
    if (!plan || !Array.isArray(plan.harmony)) continue;
    const progression = sectionProgressions.get(section.label) ?? [];

    for (const assignment of plan.harmony) {
      const texture = TEXTURE_REGISTRY[assignment.mode];
      if (typeof texture !== 'function') {
        throw new Error(
          `Unknown harmony texture "${assignment.mode}". ` +
            `See theory/textures.js TEXTURE_REGISTRY for the available textures.`
        );
      }
      const [startRel, endRel] = assignment.bars;
      const absStartBar = section.startBar + (startRel - 1);
      const absEndBar = section.startBar + (endRel - 1);
      const beatStart = absStartBar * beatsPerBar;
      const beatEnd = (absEndBar + 1) * beatsPerBar; // exclusive

      const leadEventsInRange = leadEvents.filter(
        (e) => e.beat >= beatStart - EPSILON && e.beat < beatEnd - EPSILON
      );
      const chordsByAbsBar = chordsForBarRange(
        progression, mode, tonic, section.startBar, absStartBar, absEndBar
      );
      const params = {
        ...(assignment.params ?? {}),
        ...(assignment.degree !== undefined ? { degree: assignment.degree } : {}),
      };

      events.push(
        ...texture(leadEventsInRange, chordsByAbsBar, mode, tonic, leadOctave, meter, params)
      );
    }
  }
  return events;
}

// --- bass ------------------------------------------------------------------

// The Roman numeral governing bar `barRel` (1-indexed, section-relative) of a
// section, one chord per bar, cycling the progression if it is shorter than
// the section. Returns null past the section's progression when there is none.
function romanForBar(progression, barRel) {
  if (!Array.isArray(progression) || progression.length === 0) return null;
  return progression[(barRel - 1) % progression.length];
}

function buildBass(macroParams, harmonicPlan, texturePlan, sections, mode, tonic) {
  const beatsPerBar = beatsPerBarOf(macroParams.meter);
  const meter = macroParams.meter ?? { numerator: 4, denominator: 4 };
  const sectionProgressions = new Map(
    (harmonicPlan.sections ?? []).map((s) => [s.label, s.progression])
  );
  const events = [];

  for (const section of sections) {
    const plan = texturePlan[section.label];
    if (!plan || !Array.isArray(plan.bass)) continue;
    const progression = sectionProgressions.get(section.label);
    if (!progression) {
      throw new Error(`HarmonicPlan has no progression for section "${section.label}".`);
    }

    for (const assignment of plan.bass) {
      const patternFn = BASS_PATTERNS[assignment.pattern];
      if (typeof patternFn !== 'function') {
        throw new Error(
          `Unknown bass pattern "${assignment.pattern}". See theory/bass-patterns.js.`
        );
      }
      const [startRel, endRel] = assignment.bars;
      for (let barRel = startRel; barRel <= endRel; barRel++) {
        const roman = romanForBar(progression, barRel);
        const nextRoman = barRel < endRel ? romanForBar(progression, barRel + 1) : null;
        const chord = resolveRoman(roman, mode, tonic, BASS_BASE_OCTAVE);
        const nextChord = nextRoman ? resolveRoman(nextRoman, mode, tonic, BASS_BASE_OCTAVE) : null;
        const params = {
          octave: BASS_BASE_OCTAVE,
          nextChord,
          degree: assignment.degree,
          ...(assignment.params ?? {}),
        };
        const barEvents = patternFn(chord, mode, tonic, meter, 1, params);

        let beat = (section.startBar + (barRel - 1)) * beatsPerBar;
        for (const ev of barEvents) {
          events.push({ pitch: ev.pitch, beat, duration: ev.duration });
          beat += ev.duration;
        }
      }
    }
  }
  return events;
}

// --- sequencing ------------------------------------------------------------

/**
 * Flatten beat-stamped events into a back-to-back { pitch, duration } sequence
 * (the shape the synth consumes after string conversion), inserting `null`
 * rests for gaps and padding to `totalBeats`. Assumes events do not overlap.
 * Exported because pipeline-runner.js calls it AFTER Stage 8 (see the module
 * header) — Stages 6/7/8 work in beat-stamped events; this is the single
 * collapse to a contiguous sequence.
 */
export function toSequence(events, totalBeats) {
  const sorted = [...events].sort((a, b) => a.beat - b.beat);
  const sequence = [];
  let cursor = 0;
  for (const event of sorted) {
    if (event.beat - cursor > EPSILON) {
      sequence.push({ pitch: null, duration: event.beat - cursor });
    }
    sequence.push({ pitch: event.pitch, duration: event.duration });
    cursor = event.beat + event.duration;
  }
  if (totalBeats - cursor > EPSILON) {
    sequence.push({ pitch: null, duration: totalBeats - cursor });
  }
  return sequence;
}

/**
 * Total length of the piece in beats — `total_bars` (or the summed section
 * bars) times the meter's beats-per-bar. Exported so the runner can pad each
 * voice to the full length when it sequences, after Stage 8.
 */
export function pieceTotalBeats(macroParams) {
  const beatsPerBar = beatsPerBarOf(macroParams.meter);
  const totalBars =
    macroParams.total_bars ?? computeSectionPlan(macroParams).reduce((sum, s) => sum + s.bars, 0);
  return totalBars * beatsPerBar;
}

// Strip a voice's events down to the { pitch, beat, duration } VoiceTracks
// shape (lead events also carry degree/octave_offset internally, for harmony)
// and sort by beat.
function asTrack(events) {
  return events
    .map(({ pitch, beat, duration }) => ({ pitch, beat, duration }))
    .sort((a, b) => a.beat - b.beat);
}

/**
 * Realize hand-written (Session 4) or upstream plans into VoiceTracks of
 * beat-stamped { pitch, beat, duration } events (sorted by beat). The runner
 * sequences these to the synth's contiguous shape after Stage 8 — see the
 * module header and `toSequence`.
 */
export function realizeVoices({ macroParams, motifs, harmonicPlan, phrasePlan, texturePlan }) {
  const mode = macroParams.mode;
  const tonic = macroParams.tonic;
  const leadOctave = leadOctaveOf(macroParams);

  const sections = computeSectionPlan(macroParams);

  const leadEvents = buildLead(macroParams, motifs, phrasePlan, sections, mode, tonic, leadOctave);
  const harmonyEvents = buildHarmony(macroParams, harmonicPlan, texturePlan, sections, leadEvents, mode, tonic, leadOctave);
  const bassEvents = buildBass(macroParams, harmonicPlan, texturePlan, sections, mode, tonic);

  return {
    lead: asTrack(leadEvents),
    harmony: asTrack(harmonyEvents),
    bass: asTrack(bassEvents),
  };
}
