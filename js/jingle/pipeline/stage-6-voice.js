/* =================================================================
   STAGE 6 — VOICE REALIZATION (buildplan Session 4).

   realizeVoices({ macroParams, motifs, harmonicPlan, phrasePlan,
                   texturePlan, config }) → VoiceTracks

   where VoiceTracks = { lead, harmony, bass }, each an array of
   { pitch, duration } events in playback order. `pitch` is a Pitch object
   ({ letter, accidental, octave }) for a sounding note, or `null` for a rest
   (a gap between placed motifs, or a bar with no texture assigned). Durations
   are in the meter's beat-unit (buildplan §7.3). NO synth strings are produced
   here — the Stage 6 → synth conversion (toSynthString) happens once, in
   pipeline-runner.js.

   This is the deterministic heart of the pipeline: it takes mode-agnostic
   plans (motifs in scale degrees, a Roman-numeral progression, phrase/texture
   choreography) and realizes them into concrete pitches in the piece's mode.

   - LEAD walks the PhrasePlan: per section, per assignment, it applies the
     named transformation to the referenced motif, renders it to degree events
     at the assignment's bar, and resolves each degree to a Pitch via
     mode-engine. A chromatic_neighbor anomaly bends its flagged note a half
     step toward the adjacent note.
   - HARMONY walks the TexturePlan. Session 4 implements only
     `parallel_thirds_below` (a placeholder); every other texture name throws,
     so a PhrasePlan that reaches for an unbuilt texture is caught loudly. The
     full vocabulary arrives in Session 6.
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
import { resolveRoman } from '../theory/roman-numeral-stub.js';
import { BASS_PATTERNS } from '../theory/bass-patterns.js';

const DEFAULT_LEAD_OCTAVE = 5;
const BASS_BASE_OCTAVE = 3;
const HARMONY_LOW_MIDI = 60; // C4
const HARMONY_HIGH_MIDI = 83; // B5
const DEGREES_PER_OCTAVE = 7;
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

// Octave-displace a pitch until it sits within [lowMidi, highMidi]. The window
// is two octaves wide, so any pitch class fits and the loop terminates.
function clampToRange(pitch, lowMidi, highMidi) {
  let result = pitch;
  let guard = 0;
  while (toMidi(result) < lowMidi && guard++ < 12) {
    result = { ...result, octave: result.octave + 1 };
  }
  while (toMidi(result) > highMidi && guard++ < 12) {
    result = { ...result, octave: result.octave - 1 };
  }
  return result;
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

// The scale degree a third (two scale steps) below `leadEvent`, realized as a
// Pitch and clamped into the harmony register. Works in linear degree space so
// octave bookkeeping stays consistent with mode-engine.
function thirdBelow(leadEvent, mode, tonic, leadOctave) {
  const leadLinear = (leadEvent.degree - 1) + leadEvent.octave_offset * DEGREES_PER_OCTAVE;
  const harmonyLinear = leadLinear - 2;
  const octaveShift = Math.floor(harmonyLinear / DEGREES_PER_OCTAVE);
  const index = ((harmonyLinear % DEGREES_PER_OCTAVE) + DEGREES_PER_OCTAVE) % DEGREES_PER_OCTAVE;
  const pitch = degreeToPitch(mode, tonic, index + 1, leadOctave + octaveShift);
  return clampToRange(pitch, HARMONY_LOW_MIDI, HARMONY_HIGH_MIDI);
}

function buildHarmony(macroParams, texturePlan, sections, leadEvents, mode, tonic, leadOctave) {
  const beatsPerBar = beatsPerBarOf(macroParams.meter);
  const events = [];
  for (const section of sections) {
    const plan = texturePlan[section.label];
    if (!plan || !Array.isArray(plan.harmony)) continue;
    for (const assignment of plan.harmony) {
      if (assignment.mode !== 'parallel_thirds_below') {
        throw new Error(
          `Texture mode "${assignment.mode}" not implemented in Session 4; ` +
            `full vocabulary in Session 6.`
        );
      }
      const [startRel, endRel] = assignment.bars;
      const beatStart = (section.startBar + (startRel - 1)) * beatsPerBar;
      const beatEnd = (section.startBar + endRel) * beatsPerBar; // exclusive
      for (const leadEvent of leadEvents) {
        if (leadEvent.beat < beatStart - EPSILON || leadEvent.beat >= beatEnd - EPSILON) continue;
        events.push({
          pitch: thirdBelow(leadEvent, mode, tonic, leadOctave),
          beat: leadEvent.beat,
          duration: leadEvent.duration,
        });
      }
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

// Flatten beat-stamped events into a back-to-back { pitch, duration } sequence
// (the shape the synth consumes after string conversion), inserting rests for
// gaps and padding to `totalBeats`. Assumes authored events do not overlap.
function toSequence(events, totalBeats) {
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
 * Realize hand-written (Session 4) or upstream plans into VoiceTracks. See the
 * module header for the algorithm and the VoiceTracks shape.
 */
export function realizeVoices({ macroParams, motifs, harmonicPlan, phrasePlan, texturePlan }) {
  const mode = macroParams.mode;
  const tonic = macroParams.tonic;
  const leadOctave = leadOctaveOf(macroParams);
  const beatsPerBar = beatsPerBarOf(macroParams.meter);

  const sections = computeSectionPlan(macroParams);
  const totalBars =
    macroParams.total_bars ?? sections.reduce((sum, s) => sum + s.bars, 0);
  const totalBeats = totalBars * beatsPerBar;

  const leadEvents = buildLead(macroParams, motifs, phrasePlan, sections, mode, tonic, leadOctave);
  const harmonyEvents = buildHarmony(macroParams, texturePlan, sections, leadEvents, mode, tonic, leadOctave);
  const bassEvents = buildBass(macroParams, harmonicPlan, texturePlan, sections, mode, tonic);

  return {
    lead: toSequence(leadEvents, totalBeats),
    harmony: toSequence(harmonyEvents, totalBeats),
    bass: toSequence(bassEvents, totalBeats),
  };
}
