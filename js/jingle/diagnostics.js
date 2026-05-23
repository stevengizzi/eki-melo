/* =================================================================
   DIAGNOSTICS — the structured "how this jingle was made" bundle (Session 14).

   A diagnostic is a single JSON object capturing the prompts + artifacts that
   produced one jingle, for compositional iteration discussion ("which STAGE made
   this take feel uninspired?"). It is the home for:
     - the bundle SCHEMA (versioned semver so we can evolve it), and
     - the two BUILDERS — `buildLiveDiagnostic` (assembled from data captured
       AS a jingle generates) and `reconstructDiagnostic` (rebuilt after the fact
       from a stored jingle, re-running the DETERMINISTIC pieces) — plus
       `validateDiagnostic` (a loaded bundle is checked, not trusted) and
       `serializeDiagnostic` (stable, byte-deterministic pretty JSON for download).

   LIVE vs RECONSTRUCTED — what's recoverable, and the honest gaps.
     · LIVE bundles are built at generation time, when the actual LLM round-trips
       are in hand: every per-stage `raw_response_text` is the real model output,
       and `provenance` is "live". (For v1 the raw text is NOT exposed by api.js's
       contract — see below — so it carries an honest sentinel.)
     · RECONSTRUCTED bundles are best-effort. The LLM raw responses were never
       stored, so they are irrecoverable (`raw_response_text: null`). Everything
       DETERMINISTIC is re-derived from the stored artifacts: the prompts (by
       re-running each stage's exported `build*Prompt`), Stage 2's rule trace (by
       re-running `generateMacroParams` with a trace hook), each stage's soft
       warnings (by re-running its `validate*`), and the Stage 6→8 realization (by
       re-running the deterministic sync core). A field that genuinely can't be
       recovered is marked `"provenance": "unknown"` rather than guessed.

   THE C-REPLAY TARGET. The realization tracks (Stage 6→8) and the prompts are
   deterministic functions of the stored artifacts, so a reconstructed bundle's
   `final` + `stages_6_through_8_realization` reproduce the original jingle. The
   LLM stages are NOT re-run (no network, and the model is stochastic) — but their
   VALIDATED artifacts ARE the model's output to the validator's tolerance, so the
   stored artifact is the faithful record of what the LLM produced.

   PORTABILITY. jingle/ code: imports the read-only api/composition prompt source,
   the pipeline stages' pure builders/validators, and the deterministic back-half.
   No network, no DOM. Works in both runtime contexts.
   ================================================================= */
import { JINGLE_SYSTEM_PROMPT } from './composition.js';
import { DEFAULT_CONFIG } from './pipeline/pipeline-config.js';
import { runPipeline } from './pipeline/pipeline-runner.js';
import { toSynthString } from './theory/synth-rendering.js';
import { realizeVoices } from './pipeline/stage-6-voice.js';
import { applyVoiceLeading } from './pipeline/stage-7-leading.js';
import { enforceCadences } from './pipeline/stage-8-cadence.js';
import { buildAestheticPrompt, validateAesthetic } from './pipeline/stage-1-aesthetic.js';
import { generateMacroParams, validateMacroParams, deriveKnobs } from './pipeline/stage-2-macro.js';
import { buildHarmonicPlanPrompt, validateHarmonicPlan } from './pipeline/stage-3-harmony.js';
import { buildMotifsPrompt, validateMotifs } from './pipeline/stage-4-motifs.js';
import { buildPhrasePlanPrompt, validatePhrasePlan } from './pipeline/stage-5a-phrase.js';
import { buildTexturePlanPrompt, validateTexturePlan } from './pipeline/stage-5b-texture.js';

// The bundle schema version (semver). MAJOR bumps are breaking; validateDiagnostic
// accepts any bundle whose MAJOR equals this one's.
export const DIAGNOSTIC_SCHEMA_VERSION = '1.0.0';

// The app version stamped into every bundle (kept in step with CHANGELOG.md).
const APP_VERSION = 'v2.1.0';

const PIPELINE_STAGE_KEYS = [
  'stage_1_aesthetic',
  'stage_2_macro',
  'stage_3_harmony',
  'stage_4_motifs',
  'stage_5a_arrangement',
  'stage_5b_texture',
  'stages_6_through_8_realization',
];

// =================================================================
// V1 PROMPT TEMPLATE — a synced copy of js/jingle/api.js's user-prompt template.
// api.js is read-only by design, so the template is duplicated here.
// MUST stay in sync with api.js's user-prompt template (api.js is read-only).
// =================================================================
function buildV1UserPrompt(name, description) {
  return `Compose an arrival theme for this guest:

NAME: ${name}
DESCRIPTION: ${description}

Translate their personality into musical choices, then construct a piece with clear sections and motivic development so the piece feels composed, not just strung together. Make it instantly memorable.`;
}

// =================================================================
// SMALL UTILITIES
// =================================================================

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nowISO = () => new Date().toISOString();

// A ms timestamp (or anything Date accepts) → ISO string; null when unusable.
function toISO(value) {
  if (value === undefined || value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Best-effort split of a v1 "C major" / "Bb dorian" key string into { tonic, mode }.
function parseKeyString(key) {
  const match = typeof key === 'string' ? key.trim().match(/^([A-G](?:#{1,2}|b{1,2})?)\s+(.+)$/) : null;
  return match ? { tonic: match[1], mode: match[2] } : { tonic: null, mode: null };
}

function beatsPerBarOf(macroParams) {
  return macroParams?.meter?.numerator ?? 4;
}

// Sharp-side vs flat-side naming for the synth string render — the same rule the
// pipeline-runner uses at its output boundary (kept in step so reconstructed
// realization tracks spell pitches identically to the shipped jingle).
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

// =================================================================
// EFFECTIVE CONFIG — the knob-derived config the live pipeline ran under. Stored
// going forward as pipelineMetadata.config_used; for an old jingle (no stored
// config) it is re-derived from the stored aesthetic exactly as the live runner
// did (deriveKnobs), so it is reproducible, not a guess.
// =================================================================
function effectiveConfigFor({ storedConfig, aesthetic }) {
  if (isObject(storedConfig) && isObject(storedConfig.knobs)) return storedConfig;
  if (aesthetic) {
    try {
      return deriveKnobs({ aesthetic, config: DEFAULT_CONFIG });
    } catch {
      /* fall through to the default */
    }
  }
  return DEFAULT_CONFIG;
}

// The fixture-replay knob snapshot (buildplan target C). Pulls the knobs the
// downstream stages actually read + the realized length budget.
function configSnapshotOf(config, macroParams) {
  const knobs = isObject(config?.knobs) ? config.knobs : {};
  const beatsPerBar = beatsPerBarOf(macroParams);
  const totalBars = Number.isInteger(macroParams?.total_bars) ? macroParams.total_bars : null;
  return {
    harmonic_adventurousness: knobs.harmonic_adventurousness ?? null,
    phrase_adventurousness: knobs.phrase_adventurousness ?? null,
    arrangement_adventurousness: knobs.arrangement_adventurousness ?? null,
    texture_adventurousness: knobs.texture_adventurousness ?? null,
    motif_architecture: knobs.motif_architecture ?? null,
    voice_leading_strictness: knobs.voice_leading_strictness ?? null,
    allow_modal_interchange: knobs.allow_modal_interchange ?? null,
    length_budget_beats: totalBars != null ? totalBars * beatsPerBar : null,
  };
}

// A compact view of the knobs a given stage reads — embedded in each stage's
// `input` so a reader sees which freedom settings shaped that stage's prompt.
function configSubsetFor(stage, config) {
  const knobs = isObject(config?.knobs) ? config.knobs : {};
  switch (stage) {
    case 'stage_3_harmony':
      return { harmonic_adventurousness: knobs.harmonic_adventurousness ?? null, allow_modal_interchange: knobs.allow_modal_interchange ?? null };
    case 'stage_4_motifs':
      return { phrase_adventurousness: knobs.phrase_adventurousness ?? null };
    case 'stage_5a_arrangement':
      return { arrangement_adventurousness: knobs.arrangement_adventurousness ?? null };
    case 'stage_5b_texture':
      return { texture_adventurousness: knobs.texture_adventurousness ?? null };
    default:
      return {};
  }
}

// =================================================================
// SOFT-WARNING RE-DERIVATION — re-run each stage's validator on the STORED
// (unwrapped) artifact to recover its soft warnings. The validators check the
// stage's WRAPPED LLM envelope, so each stored artifact is re-wrapped first.
// Best-effort: any failure yields [] (a missing diagnostic field beats a wrong one).
// =================================================================

// §3 array HarmonicPlan → the wrapped `{ sections: { label: { progression:
// [{roman, bars:[i,i]}], cadence } } }` validateHarmonicPlan expects. Each per-bar
// Roman string becomes a single-bar [i,i] entry (tiles the section exactly).
function rewrapHarmonicPlan(harmonicPlan) {
  const sections = {};
  for (const section of harmonicPlan?.sections ?? []) {
    const progression = Array.isArray(section.progression) ? section.progression : [];
    sections[section.label] = {
      progression: progression.map((roman, i) => ({ roman, bars: [i + 1, i + 1] })),
      cadence: section.cadence,
    };
  }
  return { sections };
}

function warningsOf(result) {
  return Array.isArray(result?.warnings) ? result.warnings : [];
}

function aestheticWarnings(aesthetic) {
  try {
    return warningsOf(validateAesthetic({ aesthetic }));
  } catch {
    return [];
  }
}
function macroWarnings(macroParams) {
  try {
    return warningsOf(validateMacroParams(macroParams));
  } catch {
    return [];
  }
}
function harmonicWarnings(harmonicPlan, macroParams, config) {
  try {
    return warningsOf(validateHarmonicPlan(rewrapHarmonicPlan(harmonicPlan), macroParams, config));
  } catch {
    return [];
  }
}
function motifWarnings(motifs, macroParams, harmonicPlan) {
  try {
    return warningsOf(validateMotifs({ phrases: motifs }, macroParams, harmonicPlan));
  } catch {
    return [];
  }
}
function phraseWarnings(phrasePlan, macroParams, motifs, harmonicPlan) {
  try {
    return warningsOf(validatePhrasePlan({ sections: phrasePlan }, macroParams, motifs, harmonicPlan));
  } catch {
    return [];
  }
}
// validateTexturePlan returns no warnings channel — texture soft warnings are
// always [] (kept for shape parity with the other stages).
function textureWarnings() {
  return [];
}

// =================================================================
// STAGE 2 RULE TRACE — re-run generateMacroParams with a trace hook (it emits one
// trace event per rule firing as of Session 14) and append the knob derivation.
// Deterministic; safe to re-derive for both live + reconstructed bundles.
// =================================================================
function macroDeterministicTrace(aesthetic, config, lengthBudget) {
  const trace = [];
  try {
    generateMacroParams({
      aesthetic,
      lengthBudget,
      config,
      onTrace: (events) => {
        if (Array.isArray(events)) trace.push(...events);
      },
    });
  } catch {
    /* leave whatever fired before the throw */
  }
  // The knobs decision lives on deriveKnobs (a separate concern from §3
  // MacroParams), so append it from the effective config.
  trace.push({
    decision: 'knobs',
    rule: 'deriveKnobs(intensity) → the four adventurousness knobs + motif_architecture (config.user_knobs_override bypasses).',
    value: isObject(config?.knobs)
      ? {
          harmonic_adventurousness: config.knobs.harmonic_adventurousness ?? null,
          phrase_adventurousness: config.knobs.phrase_adventurousness ?? null,
          arrangement_adventurousness: config.knobs.arrangement_adventurousness ?? null,
          texture_adventurousness: config.knobs.texture_adventurousness ?? null,
          motif_architecture: config.knobs.motif_architecture ?? null,
          allow_modal_interchange: config.knobs.allow_modal_interchange ?? null,
        }
      : null,
  });
  return trace;
}

// =================================================================
// REALIZATION — re-run the deterministic Stage 6→7→8 core on the stored artifacts
// to capture beat-stamped events, and runPipeline for the final synth tracks.
// Both wrapped in try/catch: a shape we don't recognize (e.g. an artifact written
// under a different schema) yields { ok: false } and the caller marks it unknown.
// =================================================================
function realizeBeatStamped(artifacts, config) {
  try {
    const { macroParams, harmonicPlan, motifs, phrasePlan, texturePlan } = artifacts;
    let tracks = realizeVoices({ macroParams, motifs, harmonicPlan, phrasePlan, texturePlan, config });
    tracks = applyVoiceLeading(tracks, config, macroParams);
    tracks = enforceCadences(tracks, harmonicPlan, macroParams, config);
    const preference = accidentalPreferenceForTonic(macroParams.tonic);
    const render = (track) =>
      track.map((event) => ({
        pitch: event.pitch === null ? 'rest' : toSynthString(event.pitch, preference),
        beat: event.beat,
        duration: event.duration,
      }));
    return { ok: true, lead: render(tracks.lead), harmony: render(tracks.harmony), bass: render(tracks.bass) };
  } catch {
    return { ok: false };
  }
}

function realizeFinal(artifacts, config) {
  try {
    const { macroParams, harmonicPlan, motifs, phrasePlan, texturePlan, title } = artifacts;
    const jingle = runPipeline({ macroParams, harmonicPlan, motifs, phrasePlan, texturePlan, title }, config);
    return {
      lead: jingle.lead,
      harmony: jingle.harmony,
      bass: jingle.bass,
      tempo: jingle.tempo,
      key: jingle.key,
      sections: jingle.sections,
    };
  } catch {
    return null;
  }
}

// =================================================================
// PIPELINE STAGES — assemble the seven stage entries of a pipeline bundle. `live`
// carries captured raw responses + soft warnings when present (live build);
// otherwise the soft warnings are re-derived and raw responses are null
// (reconstructed). `provenance` is the per-stage marker ("live" | "reconstructed").
// =================================================================
function buildPipelineStages({ artifacts, config, provenance, captures }) {
  const { aesthetic, macroParams, harmonicPlan, motifs, phrasePlan, texturePlan } = artifacts;
  const cap = captures ?? {};
  const live = provenance === 'live';
  const lengthBudget = configSnapshotOf(config, macroParams).length_budget_beats ?? undefined;

  // Each LLM stage's prompt is rebuilt deterministically from the resolved inputs
  // via its exported build*Prompt — identical to the prompt the stage used, and
  // recoverable for an old jingle that never stored its prompt text.
  const promptOrNull = (builder, args) => {
    try {
      return builder(args);
    } catch {
      return null;
    }
  };

  const rawFor = (key) => (live && cap[key] && typeof cap[key].raw === 'string' ? cap[key].raw : null);
  const warningsFor = (key, fallback) => (live && cap[key] && Array.isArray(cap[key].warnings) ? cap[key].warnings : fallback);

  const realization = realizeBeatStamped(artifacts, config);

  return {
    stage_1_aesthetic: {
      provenance,
      input: { mood: cap.mood ?? null, guest_name: cap.guestName ?? null, config_subset: configSubsetFor('stage_1_aesthetic', config) },
      prompt: promptOrNull(buildAestheticPrompt, { mood: cap.mood, guestName: cap.guestName, config }),
      raw_response_text: rawFor('aesthetic'),
      artifact: aesthetic ?? null,
      soft_warnings: warningsFor('aesthetic', aestheticWarnings(aesthetic)),
    },
    stage_2_macro: {
      provenance,
      input: { aesthetic: aesthetic ?? null },
      deterministic_trace: macroDeterministicTrace(aesthetic, config, lengthBudget),
      artifact: macroParams ?? null,
      soft_warnings: warningsFor('macro', macroWarnings(macroParams)),
    },
    stage_3_harmony: {
      provenance,
      input: { macroParams: macroParams ?? null, config_subset: configSubsetFor('stage_3_harmony', config) },
      prompt: promptOrNull(buildHarmonicPlanPrompt, { macroParams, config }),
      raw_response_text: rawFor('harmony'),
      artifact: harmonicPlan ?? null,
      soft_warnings: warningsFor('harmony', harmonicWarnings(harmonicPlan, macroParams, config)),
    },
    stage_4_motifs: {
      provenance,
      input: { macroParams: macroParams ?? null, harmonicPlan: harmonicPlan ?? null, config_subset: configSubsetFor('stage_4_motifs', config) },
      prompt: promptOrNull(buildMotifsPrompt, { macroParams, harmonicPlan, config }),
      raw_response_text: rawFor('motifs'),
      artifact: motifs ?? null,
      soft_warnings: warningsFor('motifs', motifWarnings(motifs, macroParams, harmonicPlan)),
    },
    stage_5a_arrangement: {
      provenance,
      input: { macroParams: macroParams ?? null, motifs: motifs ?? null, harmonicPlan: harmonicPlan ?? null, config_subset: configSubsetFor('stage_5a_arrangement', config) },
      prompt: promptOrNull(buildPhrasePlanPrompt, { macroParams, motifs, harmonicPlan, config }),
      raw_response_text: rawFor('phrase'),
      artifact: phrasePlan ?? null,
      soft_warnings: warningsFor('phrase', phraseWarnings(phrasePlan, macroParams, motifs, harmonicPlan)),
    },
    stage_5b_texture: {
      provenance,
      input: { macroParams: macroParams ?? null, motifs: motifs ?? null, harmonicPlan: harmonicPlan ?? null, phrasePlan: phrasePlan ?? null, config_subset: configSubsetFor('stage_5b_texture', config) },
      prompt: promptOrNull(buildTexturePlanPrompt, { macroParams, motifs, harmonicPlan, phrasePlan, config }),
      raw_response_text: rawFor('texture'),
      artifact: texturePlan ?? null,
      soft_warnings: warningsFor('texture', textureWarnings()),
    },
    stages_6_through_8_realization: realization.ok
      ? { provenance: live ? 'live' : 'reconstructed', lead: realization.lead, harmony: realization.harmony, bass: realization.bass }
      : { provenance: 'unknown', lead: [], harmony: [], bass: [] },
  };
}

// The piece summary, from the resolved artifacts (pipeline) or stored fields (v1).
function pipelineSummary({ guestName, guestDescription, jingle, macroParams }) {
  const beatsPerBar = beatsPerBarOf(macroParams);
  return {
    guest_name: guestName ?? null,
    guest_description: guestDescription ?? null,
    title: jingle?.title ?? null,
    mood_label: macroParams?.mood ?? jingle?.mood ?? null,
    tonic: macroParams?.tonic ?? null,
    mode: macroParams?.mode ?? null,
    tempo: macroParams?.tempo ?? jingle?.tempo ?? null,
    form: macroParams?.form ?? jingle?.form ?? null,
    total_bars: Number.isInteger(macroParams?.total_bars) ? macroParams.total_bars : null,
    section_labels: Array.isArray(macroParams?.sections) ? macroParams.sections.map((s) => s.label) : [],
    beats_per_bar: beatsPerBar,
  };
}

function v1Summary({ guestName, guestDescription, jingle }) {
  const { tonic, mode } = parseKeyString(jingle?.key);
  const sections = Array.isArray(jingle?.sections) ? jingle.sections : [];
  const totalBeats = sections.reduce((sum, s) => sum + (Number(s.length) || 0), 0);
  return {
    guest_name: guestName ?? null,
    guest_description: guestDescription ?? null,
    title: jingle?.title ?? null,
    mood_label: jingle?.mood ?? null,
    tonic,
    mode,
    tempo: Number(jingle?.tempo) || null,
    form: jingle?.form ?? null,
    total_bars: totalBeats > 0 ? Math.round(totalBeats / 4) : null,
    section_labels: sections.map((s) => s.label),
  };
}

// The `final` block — the actual realized synth tracks (always live data).
function finalBlock(jingle) {
  return {
    lead: Array.isArray(jingle?.lead) ? jingle.lead : [],
    harmony: Array.isArray(jingle?.harmony) ? jingle.harmony : [],
    bass: Array.isArray(jingle?.bass) ? jingle.bass : [],
    tempo: Number(jingle?.tempo) || null,
    key: jingle?.key ?? null,
    sections: Array.isArray(jingle?.sections) ? jingle.sections : [],
  };
}

// =================================================================
// LIVE BUILDER — assemble a bundle from data captured AS the jingle generated.
//
//   buildLiveDiagnostic({ engine, input, output, captures })
//     engine   'v1' | 'pipeline'
//     input    { guestName, mood } — the raw generation inputs
//     output   the engine's playback-shaped jingle (for pipeline it carries
//              pipelineMetadata; createdAt is the generation timestamp)
//     captures { config, aesthetic|harmony|motifs|phrase|texture: { raw, warnings } }
//              — per-stage raw responses + soft warnings collected via the engine's
//              trace hooks (pipeline only; absent/ignored for v1)
// =================================================================
export function buildLiveDiagnostic({ engine, input = {}, output = {}, captures = {} } = {}) {
  const capturedAt = nowISO();
  const generatedAt = toISO(output.createdAt) ?? capturedAt;
  const base = {
    diagnostic_version: DIAGNOSTIC_SCHEMA_VERSION,
    diagnostic_type: 'live',
    generated_at: generatedAt,
    captured_at: capturedAt,
    app_version: APP_VERSION,
    engine,
  };

  if (engine === 'v1') {
    return {
      ...base,
      summary: v1Summary({ guestName: input.guestName, guestDescription: input.mood, jingle: output }),
      v1: {
        provenance: 'live',
        // Prefer the prompts the engine actually emitted (its onDiagnostic capture);
        // fall back to rebuilding them (identical — both are deterministic).
        system_prompt: typeof captures.system_prompt === 'string' ? captures.system_prompt : JINGLE_SYSTEM_PROMPT,
        user_prompt: typeof captures.user_prompt === 'string'
          ? captures.user_prompt
          : buildV1UserPrompt(input.guestName ?? '', input.mood ?? ''),
        // api.js's contract returns the PARSED jingle only — the raw text isn't
        // available to the caller, so we are honest about the gap rather than guess.
        raw_response_text: typeof captures.raw_response_text === 'string'
          ? captures.raw_response_text
          : "(not captured — api.js's contract returns the parsed jingle only)",
        parsed_jingle: output,
      },
      final: finalBlock(output),
    };
  }

  // pipeline
  const metadata = isObject(output.pipelineMetadata) ? output.pipelineMetadata : {};
  const config = effectiveConfigFor({ storedConfig: captures.config ?? metadata.config_used, aesthetic: metadata.aesthetic });
  const artifacts = {
    aesthetic: metadata.aesthetic ?? null,
    macroParams: metadata.macroParams ?? null,
    harmonicPlan: metadata.harmonicPlan ?? null,
    motifs: metadata.motifs ?? null,
    phrasePlan: metadata.phrasePlan ?? null,
    texturePlan: metadata.texturePlan ?? null,
    title: output.title,
  };
  return {
    ...base,
    summary: pipelineSummary({
      guestName: input.guestName,
      guestDescription: input.mood,
      jingle: output,
      macroParams: artifacts.macroParams,
    }),
    pipeline: {
      config_snapshot: configSnapshotOf(config, artifacts.macroParams),
      stages: buildPipelineStages({
        artifacts,
        config,
        provenance: 'live',
        captures: { ...captures, mood: input.mood, guestName: input.guestName },
      }),
    },
    final: finalBlock(output),
  };
}

// =================================================================
// RECONSTRUCTED BUILDER — rebuild a bundle from a stored guest + jingle, re-running
// the deterministic pieces. Best-effort; irrecoverable fields are null /
// provenance "unknown". Async only for signature parity with a future store read.
//
//   reconstructDiagnostic({ guest, jingle })
// =================================================================
export async function reconstructDiagnostic({ guest, jingle } = {}) {
  if (!isObject(jingle)) throw new Error('reconstructDiagnostic requires a jingle object.');
  const capturedAt = nowISO();
  const generatedAt = toISO(jingle.createdAt) ?? capturedAt;
  const engine = jingle.engine === 'pipeline' ? 'pipeline' : 'v1';
  const guestName = guest?.name ?? null;
  const guestDescription = guest?.description ?? null;
  const base = {
    diagnostic_version: DIAGNOSTIC_SCHEMA_VERSION,
    diagnostic_type: 'reconstructed',
    generated_at: generatedAt,
    captured_at: capturedAt,
    app_version: APP_VERSION,
    engine,
  };

  if (engine === 'v1') {
    return {
      ...base,
      summary: v1Summary({ guestName, guestDescription, jingle }),
      v1: {
        provenance: 'reconstructed',
        // The system prompt is the CURRENT JINGLE_SYSTEM_PROMPT; if composition.js
        // evolved since this jingle, this reflects today's brief (flagged in the journal).
        system_prompt: JINGLE_SYSTEM_PROMPT,
        user_prompt: buildV1UserPrompt(guestName ?? '', guestDescription ?? ''),
        raw_response_text: null, // not stored for old runs — irrecoverable
        parsed_jingle: jingle,
      },
      final: finalBlock(jingle),
    };
  }

  // pipeline — derive everything from the stored pipelineMetadata.
  const metadata = isObject(jingle.pipelineMetadata) ? jingle.pipelineMetadata : {};
  const config = effectiveConfigFor({ storedConfig: metadata.config_used, aesthetic: metadata.aesthetic });
  const artifacts = {
    aesthetic: metadata.aesthetic ?? null,
    macroParams: metadata.macroParams ?? null,
    harmonicPlan: metadata.harmonicPlan ?? null,
    motifs: metadata.motifs ?? null,
    phrasePlan: metadata.phrasePlan ?? null,
    texturePlan: metadata.texturePlan ?? null,
    title: jingle.title,
  };

  // Prefer the stored realized tracks for `final` (they ARE the played jingle);
  // re-realize from artifacts only if the stored tracks are somehow absent.
  let final;
  if (Array.isArray(jingle.lead) && jingle.lead.length > 0) {
    final = finalBlock(jingle);
  } else {
    const rerun = realizeFinal(artifacts, config);
    final = finalBlock(rerun ? { ...rerun, key: rerun.key } : jingle);
  }

  return {
    ...base,
    summary: pipelineSummary({ guestName, guestDescription, jingle, macroParams: artifacts.macroParams }),
    pipeline: {
      config_snapshot: configSnapshotOf(config, artifacts.macroParams),
      stages: buildPipelineStages({ artifacts, config, provenance: 'reconstructed', captures: { mood: guestDescription, guestName } }),
    },
    final,
  };
}

// =================================================================
// VALIDATION — a loaded bundle (from sidecar storage or a backup import) flows
// through this so a corrupt bundle is detected, not silently malformed. Collects
// ALL defects in one pass. Returns { ok, errors }.
// =================================================================
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
const VALID_TYPES = ['live', 'reconstructed'];
const VALID_ENGINES = ['v1', 'pipeline'];
const VALID_PROVENANCE = ['live', 'reconstructed', 'unknown'];

export function validateDiagnostic(bundle) {
  const errors = [];
  const push = (m) => errors.push(m);

  if (!isObject(bundle)) return { ok: false, errors: ['Diagnostic must be a JSON object.'] };

  // version — present, semver, MAJOR-compatible with this schema.
  if (typeof bundle.diagnostic_version !== 'string' || !SEMVER_PATTERN.test(bundle.diagnostic_version)) {
    push(`diagnostic_version must be a semver string (e.g. "1.0.0"), got ${JSON.stringify(bundle.diagnostic_version)}.`);
  } else if (bundle.diagnostic_version.split('.')[0] !== DIAGNOSTIC_SCHEMA_VERSION.split('.')[0]) {
    push(`diagnostic_version ${bundle.diagnostic_version} is a different MAJOR than the supported ${DIAGNOSTIC_SCHEMA_VERSION} — incompatible.`);
  }

  if (!VALID_TYPES.includes(bundle.diagnostic_type)) {
    push(`diagnostic_type must be one of ${VALID_TYPES.join(' | ')}, got ${JSON.stringify(bundle.diagnostic_type)}.`);
  }
  for (const field of ['generated_at', 'captured_at', 'app_version']) {
    if (typeof bundle[field] !== 'string' || bundle[field].length === 0) {
      push(`${field} must be a non-empty string, got ${JSON.stringify(bundle[field])}.`);
    }
  }
  if (!VALID_ENGINES.includes(bundle.engine)) {
    push(`engine must be one of ${VALID_ENGINES.join(' | ')}, got ${JSON.stringify(bundle.engine)}.`);
  }

  // summary — required object with a guest_name + title.
  if (!isObject(bundle.summary)) {
    push('summary must be an object.');
  } else {
    if (!('guest_name' in bundle.summary)) push('summary.guest_name is missing.');
    if (!('title' in bundle.summary)) push('summary.title is missing.');
  }

  // final — required object with lead/harmony/bass arrays.
  if (!isObject(bundle.final)) {
    push('final must be an object with lead/harmony/bass arrays.');
  } else {
    for (const voice of ['lead', 'harmony', 'bass']) {
      if (!Array.isArray(bundle.final[voice])) push(`final.${voice} must be an array.`);
    }
  }

  // engine-specific block.
  if (bundle.engine === 'v1') {
    if (!isObject(bundle.v1)) {
      push('a v1 diagnostic must have a "v1" object.');
    } else {
      for (const field of ['system_prompt', 'user_prompt']) {
        if (typeof bundle.v1[field] !== 'string' || bundle.v1[field].length === 0) {
          push(`v1.${field} must be a non-empty string.`);
        }
      }
      if (!('raw_response_text' in bundle.v1)) push('v1.raw_response_text is missing (use null when not captured).');
      if (!isObject(bundle.v1.parsed_jingle)) push('v1.parsed_jingle must be an object.');
      if (!VALID_PROVENANCE.includes(bundle.v1.provenance)) {
        push(`v1.provenance must be one of ${VALID_PROVENANCE.join(' | ')}, got ${JSON.stringify(bundle.v1.provenance)}.`);
      }
    }
  } else if (bundle.engine === 'pipeline') {
    if (!isObject(bundle.pipeline)) {
      push('a pipeline diagnostic must have a "pipeline" object.');
    } else {
      if (!isObject(bundle.pipeline.config_snapshot)) push('pipeline.config_snapshot must be an object.');
      if (!isObject(bundle.pipeline.stages)) {
        push('pipeline.stages must be an object keyed by stage.');
      } else {
        for (const key of PIPELINE_STAGE_KEYS) {
          const stage = bundle.pipeline.stages[key];
          if (!isObject(stage)) {
            push(`pipeline.stages.${key} is missing or malformed.`);
            continue;
          }
          if (!VALID_PROVENANCE.includes(stage.provenance)) {
            push(`pipeline.stages.${key}.provenance must be one of ${VALID_PROVENANCE.join(' | ')}, got ${JSON.stringify(stage.provenance)}.`);
          }
          if (key === 'stages_6_through_8_realization') {
            for (const voice of ['lead', 'harmony', 'bass']) {
              if (!Array.isArray(stage[voice])) push(`pipeline.stages.${key}.${voice} must be an array.`);
            }
          } else if (key === 'stage_2_macro') {
            if (!Array.isArray(stage.deterministic_trace)) push('pipeline.stages.stage_2_macro.deterministic_trace must be an array.');
            if (!('artifact' in stage)) push('pipeline.stages.stage_2_macro.artifact is missing.');
          } else {
            if (!('artifact' in stage)) push(`pipeline.stages.${key}.artifact is missing.`);
            if (!('raw_response_text' in stage)) push(`pipeline.stages.${key}.raw_response_text is missing (use null when not captured).`);
            if (!Array.isArray(stage.soft_warnings)) push(`pipeline.stages.${key}.soft_warnings must be an array.`);
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// =================================================================
// SERIALIZE — stable, byte-deterministic pretty JSON for download. Keys are
// emitted in a fixed priority order (then alphabetical) so the SAME bundle always
// serializes to the SAME string, regardless of object construction order.
// 2-space indent, trailing newline.
// =================================================================
const KEY_PRIORITY = [
  'diagnostic_version', 'diagnostic_type', 'generated_at', 'captured_at', 'app_version', 'engine',
  'summary', 'pipeline', 'v1', 'final',
  'guest_name', 'guest_description', 'title', 'mood_label', 'tonic', 'mode', 'tempo', 'form',
  'total_bars', 'section_labels', 'beats_per_bar',
  'config_snapshot', 'stages',
  'stage_1_aesthetic', 'stage_2_macro', 'stage_3_harmony', 'stage_4_motifs',
  'stage_5a_arrangement', 'stage_5b_texture', 'stages_6_through_8_realization',
  'provenance', 'input', 'prompt', 'deterministic_trace', 'raw_response_text', 'artifact', 'soft_warnings',
  'system', 'user', 'config_subset',
  'decision', 'rule', 'value',
  'system_prompt', 'user_prompt', 'parsed_jingle',
  'harmonic_adventurousness', 'phrase_adventurousness', 'arrangement_adventurousness',
  'texture_adventurousness', 'motif_architecture', 'voice_leading_strictness',
  'allow_modal_interchange', 'length_budget_beats',
  'lead', 'harmony', 'bass', 'key', 'sections',
  'pitch', 'beat', 'duration', 'label', 'start',
];
const KEY_RANK = new Map(KEY_PRIORITY.map((key, i) => [key, i]));
const rankOf = (key) => (KEY_RANK.has(key) ? KEY_RANK.get(key) : KEY_PRIORITY.length);

function reorderKeys(value) {
  if (Array.isArray(value)) return value.map(reorderKeys);
  if (isObject(value)) {
    const keys = Object.keys(value).sort((a, b) => {
      const byRank = rankOf(a) - rankOf(b);
      return byRank !== 0 ? byRank : a < b ? -1 : a > b ? 1 : 0;
    });
    const out = {};
    for (const key of keys) out[key] = reorderKeys(value[key]);
    return out;
  }
  return value;
}

export function serializeDiagnostic(bundle) {
  return `${JSON.stringify(reorderKeys(bundle), null, 2)}\n`;
}
