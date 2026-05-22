/* =================================================================
   PIPELINE CONFIG — the freedom knobs (buildplan §3, Session 4).

   DEFAULT_CONFIG is the PipelineConfig object the pipeline threads through its
   stages. The knobs control how tightly the deterministic stages constrain the
   LLM's creative choices (max melodic leap, allowed cadences, whether modal
   interchange or secondary dominants are permitted, texture change rate, voice-
   leading strictness, per-motif/per-section anomaly budgets, an optional scale
   filter).

   SESSION 4 STATUS. None of these knobs gate behaviour yet — Stage 6 realizes
   whatever the hand-written plans say. The object ships now so the later stages
   that DO read it (Stage 7 voice leading reads voice_leading_strictness, the
   LLM stages read the cadence/interchange/anomaly knobs) have a stable shape to
   target. Presets bundle a set of knobs; individual knobs override the preset.

   SESSION 8 ADDITION. `texture_adventurousness` ({ tame | adventurous | wild })
   is the freedom knob the first LLM stage (Stage 5b texture choreography) reads.
   It is distinct from `texture_change_rate` (a hint reserved for the
   deterministic side); 5b honors texture_adventurousness directly in its prompt.
   Additive — no existing stage reads it.

   SESSION 9 ADDITION. `phrase_adventurousness` ({ tame | adventurous | wild }) —
   originally the Stage-5a (cell-development) knob. SESSION 12 REPURPOSED it to
   drive the phrase-motif Stage 4 (melodic PHRASES): how bold the phrase SHAPES
   themselves are (conjunct/stepwise vs. wide leaps, peak-descend hooks, colour
   degrees, chromatic anomalies). Same name, new scope — the phrase-motif rework
   moved melody authorship into Stage 4.

   SESSION 10 ADDITION. `motif_adventurousness` ({ tame | adventurous | wild }) —
   the Session-10 cell-shape knob. After the Session-12 phrase-motif pivot it is
   read ONLY by the LEGACY cell Stage 4 (stage-4-cells-LEGACY.js), reached for the
   A/B audition (motif_architecture === 'cell'). Kept so the cell path still
   honors a freedom knob; the default phrase path ignores it.

   SESSION 12 ADDITIONS (the phrase-motif rework). `arrangement_adventurousness`
   ({ tame | adventurous | wild }) is the knob the re-scoped Stage 5a (ARRANGEMENT)
   reads — whether each section's phrase is placed literally or with a small
   length-preserving variation. `motif_architecture` ({ phrase | cell }) selects
   the melody pipeline: 'phrase' (default) runs the new per-section phrase Stage 4
   + arrangement Stage 5a; 'cell' runs the preserved legacy cell+development pair
   for the A/B audition. Both additive.

   SESSION 11 ADDITION. `harmonic_adventurousness` ({ tame | adventurous | wild })
   is the knob the fourth LLM stage (Stage 3 harmonic plan) reads — how bold the
   PROGRESSIONS are (functional pop cells vs. modal interchange + non-PAC cadences
   vs. chromatic mediants + modal mixture). It mirrors the three knobs above. The
   existing `allow_modal_interchange` knob is now CONSUMED for the first time (by
   Stage 3's validator + prompt), so it is aligned to the harmonic level: OFF for
   tame (conservative), ON for adventurous/wild (balanced/adventurous/wild). That
   flips the `balanced` preset's `allow_modal_interchange` false→true — safe,
   because no stage read the flag before this session.
   ================================================================= */

// Preset knob bundles. `balanced` is the default; the others widen or narrow
// the creative latitude. Individual knobs in DEFAULT_CONFIG.knobs override
// whichever preset is active.
export const PRESETS = {
  conservative: {
    max_leap_degrees: 4,
    cadence_palette: ['PAC', 'half', 'plagal'],
    allow_modal_interchange: false,
    allow_secondary_dominants: false,
    texture_change_rate: 'low',
    texture_adventurousness: 'tame',
    phrase_adventurousness: 'tame',
    arrangement_adventurousness: 'tame',
    motif_adventurousness: 'tame',
    motif_architecture: 'phrase',
    harmonic_adventurousness: 'tame',
    voice_leading_strictness: 'cpp_strict',
    anomaly_budget_per_motif: 0,
    anomaly_budget_per_section: 0,
    scale_palette_filter: null,
  },
  balanced: {
    max_leap_degrees: 5,
    cadence_palette: ['PAC', 'modal_iv_i', 'half', 'deceptive'],
    allow_modal_interchange: true,
    allow_secondary_dominants: false,
    texture_change_rate: 'medium',
    texture_adventurousness: 'adventurous',
    phrase_adventurousness: 'adventurous',
    arrangement_adventurousness: 'adventurous',
    motif_adventurousness: 'adventurous',
    motif_architecture: 'phrase',
    harmonic_adventurousness: 'adventurous',
    voice_leading_strictness: 'chiptune_idiomatic',
    anomaly_budget_per_motif: 1,
    anomaly_budget_per_section: 1,
    scale_palette_filter: null,
  },
  adventurous: {
    max_leap_degrees: 7,
    cadence_palette: ['PAC', 'IAC', 'modal_iv_i', 'phrygian_ii_i', 'half', 'deceptive', 'plagal'],
    allow_modal_interchange: true,
    allow_secondary_dominants: true,
    texture_change_rate: 'high',
    texture_adventurousness: 'adventurous',
    phrase_adventurousness: 'adventurous',
    arrangement_adventurousness: 'adventurous',
    motif_adventurousness: 'adventurous',
    motif_architecture: 'phrase',
    harmonic_adventurousness: 'adventurous',
    voice_leading_strictness: 'chiptune_idiomatic',
    anomaly_budget_per_motif: 1,
    anomaly_budget_per_section: 2,
    scale_palette_filter: null,
  },
  wild: {
    max_leap_degrees: 9,
    cadence_palette: ['PAC', 'IAC', 'modal_iv_i', 'phrygian_ii_i', 'half', 'deceptive', 'plagal'],
    allow_modal_interchange: true,
    allow_secondary_dominants: true,
    texture_change_rate: 'high',
    texture_adventurousness: 'wild',
    phrase_adventurousness: 'wild',
    arrangement_adventurousness: 'wild',
    motif_adventurousness: 'wild',
    motif_architecture: 'phrase',
    harmonic_adventurousness: 'wild',
    voice_leading_strictness: 'chiptune_idiomatic',
    anomaly_budget_per_motif: 2,
    anomaly_budget_per_section: 3,
    scale_palette_filter: null,
  },
};

export const DEFAULT_CONFIG = {
  preset: 'balanced',
  knobs: { ...PRESETS.balanced },
};

/**
 * Build a config from a preset name plus optional knob overrides. Unknown
 * preset names throw. Returns a fresh object so callers cannot mutate PRESETS.
 */
export function configFromPreset(preset = 'balanced', overrides = {}) {
  if (!(preset in PRESETS)) {
    throw new Error(`Unknown config preset "${preset}". Available: ${Object.keys(PRESETS).join(', ')}.`);
  }
  return { preset, knobs: { ...PRESETS[preset], ...overrides } };
}
