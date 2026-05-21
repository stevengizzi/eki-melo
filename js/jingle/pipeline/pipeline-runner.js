/* =================================================================
   PIPELINE RUNNER (buildplan Session 4).

   runPipeline(input, config) threads the back half of the composition
   pipeline and emits a FinalJingle in the JSON shape the existing synth.js
   already consumes ([pitchString, duration] events per voice plus metadata).

   For Session 4 the `input` is a complete hand-written plan:
     { macroParams, motifs, harmonicPlan, phrasePlan, texturePlan,
       title?, mood? }
   The upstream LLM/rule stages (1–5b) that will eventually produce this are
   built in later sessions; here they are pre-supplied.

   Flow:
     1. Stage 6  — realizeVoices → VoiceTracks of beat-stamped { pitch, beat,
                   duration } events (Pitch objects throughout).
     2. Stage 7  — applyVoiceLeading (identity stub until Session 7).
     3. Stage 8  — enforceCadences  — overwrites each section's closing beats
                   with its declared cadence (Session 5).
     4. Sequence — collapse each voice's beat-stamped events into the synth's
                   contiguous order, inserting `null` rests for gaps and padding
                   to the full length (toSequence). This single pass runs here,
                   AFTER Stage 8, so cadence enforcement can work in beat space.
     5. Render   — collapse each event's Pitch to a synth string via
                   toSynthString, choosing sharp/flat from the tonic. This is
                   the ONLY place Pitch → string conversion happens.
     6. Assemble — the FinalJingle metadata (title, tempo, key, mood, form,
                   section markers) around the rendered tracks.

   DEC/portability: this is pipeline/ code and may import theory/. It does not
   modify any existing file; the deployed generator keeps working alongside it.
   ================================================================= */
import { toSynthString } from '../theory/synth-rendering.js';
import { realizeVoices, computeSectionPlan, toSequence, pieceTotalBeats } from './stage-6-voice.js';
import { applyVoiceLeading } from './stage-7-leading.js';
import { enforceCadences } from './stage-8-cadence.js';
import { DEFAULT_CONFIG } from './pipeline-config.js';

// Sharp-side vs flat-side of the circle of fifths, from the tonic. Flat for an
// explicitly flat tonic (or F, whose key signature is flat); sharp otherwise
// (C is neutral and defaults to sharp). Only affects how black keys are named —
// the sounding pitch is identical either way.
function accidentalPreferenceForTonic(tonic) {
  let letter;
  let accidental;
  if (tonic && typeof tonic === 'object') {
    letter = tonic.letter;
    accidental = tonic.accidental;
  } else {
    const name = String(tonic);
    letter = name[0];
    accidental = name.includes('#') ? 1 : name.slice(1).includes('b') ? -1 : 0;
  }
  if (accidental < 0) return 'flat';
  if (accidental > 0) return 'sharp';
  return letter === 'F' ? 'flat' : 'sharp';
}

function tonicName(tonic) {
  if (tonic && typeof tonic === 'object') {
    const glyph = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' }[String(tonic.accidental)] ?? '';
    return tonic.letter + glyph;
  }
  return String(tonic);
}

// Collapse a sequenced voice ({ pitch, duration }, rests as pitch === null)
// into the synth's [pitchString, duration] tuples.
function renderTrack(track, preference) {
  return track.map((event) => [
    event.pitch === null ? 'rest' : toSynthString(event.pitch, preference),
    event.duration,
  ]);
}

// Section markers for the piano-roll renderer: { label, start } with start in
// beats, derived from the same section plan Stage 6 uses.
function sectionMarkers(macroParams) {
  const beatsPerBar = macroParams.meter?.numerator ?? 4;
  return computeSectionPlan(macroParams).map((section) => ({
    label: section.label,
    start: section.startBar * beatsPerBar,
  }));
}

/**
 * Run the Session-4 pipeline (Stage 6 → 7-stub → 8-stub → synth render) on a
 * complete hand-written `input`, returning a FinalJingle. `config` defaults to
 * DEFAULT_CONFIG; it is threaded to the stages but does not gate behaviour yet
 * (Session 4 status — see pipeline-config.js).
 */
export function runPipeline(input, config = DEFAULT_CONFIG) {
  const { macroParams } = input;

  let voiceTracks = realizeVoices({ ...input, config });
  voiceTracks = applyVoiceLeading(voiceTracks, config);
  voiceTracks = enforceCadences(voiceTracks, input.harmonicPlan, macroParams, config);

  // Sequence each beat-stamped voice into the synth's contiguous shape (rests
  // for gaps, padded to the full length) — the single collapse, after Stage 8.
  const totalBeats = pieceTotalBeats(macroParams);
  const sequenced = {
    lead: toSequence(voiceTracks.lead, totalBeats),
    harmony: toSequence(voiceTracks.harmony, totalBeats),
    bass: toSequence(voiceTracks.bass, totalBeats),
  };

  const preference = accidentalPreferenceForTonic(macroParams.tonic);

  return {
    title: input.title ?? 'Untitled Jingle',
    tempo: macroParams.tempo ?? 140,
    key: `${tonicName(macroParams.tonic)} ${macroParams.mode}`,
    mood: input.mood ?? 'neutral',
    form: macroParams.form ?? null,
    sections: sectionMarkers(macroParams),
    lead: renderTrack(sequenced.lead, preference),
    harmony: renderTrack(sequenced.harmony, preference),
    bass: renderTrack(sequenced.bass, preference),
  };
}
