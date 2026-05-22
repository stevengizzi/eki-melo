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

   TWO ENTRY POINTS (Session 8, extended Sessions 9 + 10 + 11 + 13). `runPipeline`
   is SYNCHRONOUS and requires `input.macroParams`, `input.harmonicPlan`,
   `input.motifs`, `input.phrasePlan`, AND `input.texturePlan` — the Session 4–7
   hand-supplied path, bit-for-bit unchanged (every existing verifier + the
   inspector's hand-supplied cases call it synchronously). `runPipelineGenerating`
   is its ASYNC sibling: it fills any absent upstream artifact via its stage, in
   dependency order, then delegates to the synchronous core. As of Session 13 it
   threads ALL SEVEN upstream stages, so a bare `{ mood, guestName }` runs end to
   end:
     1. no aesthetic   → Stage 1 (`generateAesthetic`) reads the free-text mood +
        name and returns the small Aesthetic dict (LLM).
     2. no macroParams → Stage 2 (`generateMacroParams`) turns the Aesthetic into
        concrete MacroParams (key/mode/form/bars/tempo) — DETERMINISTIC, no LLM —
        and `deriveKnobs` overlays intensity-derived freedom knobs onto the config
        threaded downstream (unless config.user_knobs_override).
     3. no harmonicPlan → Stage 3 (`generateHarmonicPlan`) writes the chords.
     4. no motifs     → Stage 4  (`generateMotifs`) writes one melodic PHRASE per
        section over that section's harmony (Session-12 phrase-motif rework),
        receiving the (now-resolved) harmonicPlan as upstream context.
     5. no phrasePlan → Stage 5a (`generatePhrasePlan`) ARRANGES those phrases
        across the form (place literal, or vary), receiving harmonicPlan + motifs.
     (config.knobs.motif_architecture === 'cell' swaps steps 4+5 for the preserved
      legacy cell+development pair — the A/B audition path; see motifStagesFor.)
     6. no texturePlan → Stage 5b (`generateTexturePlan`) choreographs textures,
        receiving the (now-resolved) harmonicPlan + motifs + phrasePlan.
   Present-supplied input always wins; otherwise the stage runs. Keeping the core
   synchronous means adding a stage never changes the calling convention of the
   deterministic back-half. Stage 2's deterministic chooser also sets the effective
   config (intensity → knobs); a hand-supplied macroParams skips both Stage 1 and 2
   and uses the passed-in config unchanged.

   Flow:
     1. Stage 6  — realizeVoices → VoiceTracks of beat-stamped { pitch, beat,
                   duration } events (Pitch objects throughout).
     2. Stage 7  — applyVoiceLeading — runs the configured voice-leading rule
                   set (config.knobs.voice_leading_strictness; Session 7).
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
import { generateHarmonicPlan } from './stage-3-harmony.js';
import { generateMotifs } from './stage-4-motifs.js';
import { generatePhrasePlan } from './stage-5a-phrase.js';
// LEGACY cell+development pair, reached only for the A/B audition
// (config.knobs.motif_architecture === 'cell'). Temporary debt — see the
// Session-12 journal + the files' banners.
import { generateMotifs as generateCellMotifs } from './stage-4-cells-LEGACY.js';
import { generatePhrasePlan as generateCellPhrasePlan } from './stage-5a-development-LEGACY.js';
import { generateTexturePlan } from './stage-5b-texture.js';
import { generateAesthetic } from './stage-1-aesthetic.js';
import { generateMacroParams, deriveKnobs } from './stage-2-macro.js';
import { DEFAULT_CONFIG } from './pipeline-config.js';

// The melody architecture the runner generates with. Default 'phrase' (the
// Session-12 per-section phrase Stage 4 + arrangement Stage 5a); 'cell' selects
// the preserved legacy cell+development pair for Steven's A/B audition. Only
// matters when motifs / phrasePlan are GENERATED — a present-supplied artifact
// always wins regardless of architecture.
function motifStagesFor(config) {
  return config?.knobs?.motif_architecture === 'cell'
    ? { generateMotifs: generateCellMotifs, generatePhrasePlan: generateCellPhrasePlan }
    : { generateMotifs, generatePhrasePlan };
}

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

  if (!input.harmonicPlan) {
    throw new Error(
      'runPipeline requires input.harmonicPlan. To generate one via the Stage 3 LLM call, '
        + 'use runPipelineGenerating (async) instead.'
    );
  }
  if (!input.motifs) {
    throw new Error(
      'runPipeline requires input.motifs. To generate them via the Stage 4 LLM call, '
        + 'use runPipelineGenerating (async) instead.'
    );
  }
  if (!input.phrasePlan) {
    throw new Error(
      'runPipeline requires input.phrasePlan. To generate one via the Stage 5a LLM call, '
        + 'use runPipelineGenerating (async) instead.'
    );
  }
  if (!input.texturePlan) {
    throw new Error(
      'runPipeline requires input.texturePlan. To generate one via the Stage 5b LLM call, '
        + 'use runPipelineGenerating (async) instead.'
    );
  }

  let voiceTracks = realizeVoices({ ...input, config });
  voiceTracks = applyVoiceLeading(voiceTracks, config, macroParams);
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

/**
 * Async sibling of `runPipeline` (Session 8, extended Sessions 9 + 10 + 11 + 13).
 * Any upstream artifact that is present is trusted; any that is absent is
 * generated by its stage, in dependency order, before delegating to the
 * synchronous core:
 *   1. no `input.aesthetic` (and no `input.macroParams`) → Stage 1
 *      (`generateAesthetic`) reads `input.mood` + `input.guestName` (LLM).
 *   2. no `input.macroParams` → Stage 2 (`generateMacroParams`) turns the
 *      aesthetic into MacroParams (DETERMINISTIC); `deriveKnobs` overlays
 *      intensity-derived freedom knobs onto the config used downstream (unless
 *      `config.user_knobs_override`). `input.lengthBudget` (beats, default 32 in
 *      Stage 2) bounds the piece.
 *   3. no `input.harmonicPlan` → Stage 3 (`generateHarmonicPlan`), honoring
 *      `knobs.harmonic_adventurousness` + `allow_modal_interchange`.
 *   4. no `input.motifs` → Stage 4 (`generateMotifs`), honoring
 *      `knobs.phrase_adventurousness` and receiving the now-resolved harmonicPlan.
 *   5. no `input.phrasePlan` → Stage 5a (`generatePhrasePlan`), honoring
 *      `knobs.arrangement_adventurousness` and receiving harmonicPlan + motifs.
 *   6. no `input.texturePlan` → Stage 5b (`generateTexturePlan`), honoring
 *      `knobs.texture_adventurousness` and receiving harmonicPlan + motifs + phrasePlan.
 * When everything from `macroParams` down is supplied the output is identical to
 * `runPipeline` (Stage 1 + 2 are skipped and the passed `config` is used as-is).
 *
 * Offline / debug hooks (never required):
 *   - `input.__mockAestheticResponse` / `__mockHarmonyResponse` /
 *     `__mockMotifResponse` / `__mockPhraseResponse` / `__mockResponse` (JSON
 *     strings) route Stage 1 / 3 / 4 / 5a / 5b through their deterministic-fallback
 *     path instead of the network — the only way to exercise generation without an
 *     API call. (`__mockResponse` stays the TEXTURE channel for back-compat.)
 *     Stage 2 has no mock (it makes no network call); pass a literal
 *     `input.macroParams` to skip it.
 *   - `input.onAestheticTrace` / `onHarmonyTrace` / `onMotifTrace` /
 *     `onPhraseTrace` / `onTrace` are forwarded to Stage 1 / 3 / 4 / 5a / 5b;
 *     `input.onMacroTrace` is forwarded to Stage 2's soft-warning channel.
 *   - `input.onArtifacts({ aesthetic, macroParams, harmonicPlan, motifs,
 *     phrasePlan, texturePlan })` is called once with every resolved upstream
 *     artifact just before the deterministic back-half runs (engines.js uses it
 *     for pipelineMetadata).
 */
export async function runPipelineGenerating(input, config = DEFAULT_CONFIG) {
  // --- Stage 1 + 2: aesthetic → macroParams + the effective (knob-derived) config.
  // Both are skipped when a literal macroParams is supplied (the hand-supplied
  // path); then the passed-in config is used unchanged. The aesthetic is only
  // needed to BUILD macroParams, so it too is skipped when macroParams is present.
  let macroParams = input.macroParams;
  let effectiveConfig = config;
  let aesthetic = input.aesthetic;
  if (!macroParams) {
    if (!aesthetic) {
      aesthetic = await generateAesthetic({
        mood: input.mood,
        guestName: input.guestName,
        config,
        __mockResponse: input.__mockAestheticResponse,
        onTrace: input.onAestheticTrace,
      });
    }
    effectiveConfig = deriveKnobs({ aesthetic, config });
    macroParams = generateMacroParams({
      aesthetic,
      lengthBudget: input.lengthBudget,
      config: effectiveConfig,
      onTrace: input.onMacroTrace,
    });
  }

  // Pick the melody stage pair (phrase-motif by default; legacy cells for the
  // A/B audition). Only consulted when motifs / phrasePlan are generated.
  const { generateMotifs: genMotifs, generatePhrasePlan: genPhrasePlan } = motifStagesFor(effectiveConfig);

  let harmonicPlan = input.harmonicPlan;
  if (!harmonicPlan) {
    harmonicPlan = await generateHarmonicPlan({
      macroParams,
      config: effectiveConfig,
      __mockResponse: input.__mockHarmonyResponse,
      onTrace: input.onHarmonyTrace,
    });
  }

  let motifs = input.motifs;
  if (!motifs) {
    motifs = await genMotifs({
      macroParams,
      harmonicPlan,
      config: effectiveConfig,
      __mockResponse: input.__mockMotifResponse,
      onTrace: input.onMotifTrace,
    });
  }

  let phrasePlan = input.phrasePlan;
  if (!phrasePlan) {
    phrasePlan = await genPhrasePlan({
      macroParams,
      motifs,
      harmonicPlan,
      config: effectiveConfig,
      __mockResponse: input.__mockPhraseResponse,
      onTrace: input.onPhraseTrace,
    });
  }

  let texturePlan = input.texturePlan;
  if (!texturePlan) {
    texturePlan = await generateTexturePlan({
      macroParams,
      motifs,
      harmonicPlan,
      phrasePlan,
      config: effectiveConfig,
      __mockResponse: input.__mockResponse,
      onTrace: input.onTrace,
    });
  }

  // Inspection hook (never required): hand the fully-resolved upstream artifacts
  // to the caller before the deterministic back-half runs. The dual-engine
  // dispatcher (engines.js) uses this to attach pipelineMetadata to its result;
  // the inspector could use it to show every stage's output.
  if (typeof input.onArtifacts === 'function') {
    input.onArtifacts({ aesthetic, macroParams, harmonicPlan, motifs, phrasePlan, texturePlan });
  }

  return runPipeline(
    { ...input, macroParams, harmonicPlan, motifs, phrasePlan, texturePlan },
    effectiveConfig
  );
}
