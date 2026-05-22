/* =================================================================
   PIPELINE INSPECTOR — hand-written test cases (buildplan Session 4).

   A pure-data module (zero imports) of complete pipeline inputs, so both the
   debug page (pipeline-inspector.html) and the Node regression check
   (theory/verify-stage6.mjs) consume the same fixtures. Each case is a full
   { macroParams, motifs, harmonicPlan, phrasePlan, texturePlan } plus a title
   and mood passthrough — exactly the shape runPipeline expects this session.

   Coverage: one major (C major, AABA), one minor (D dorian, ABA), one exotic
   (E phrygian-dominant, ABA — with a chromatic passing tone to exercise the
   anomaly path). All in 4/4 to keep the audio legible at the human checkpoint;
   bass-patterns' 3/4 and 6/8 support is covered by the regression check, not by
   these listening fixtures. Between them the cases exercise all five bass
   patterns and three harmony textures (Session 6): the parallel_thirds_below
   default, oblique_held (Wanderer's B section, a held drone), and
   imitation_one_beat_delay (Desert Caravan's A' recap, a delayed canon).

   CADENCE COVERAGE (Session 5). The three cases between them declare all seven
   cadence types so Stage 8 is audibly exercised end-to-end:
     Sunrise Fanfare — A1 IAC, A2 deceptive, B half, A3 PAC
     Wanderer's Path — A modal_iv_i, B plagal, A' modal_iv_i
     Desert Caravan  — A phrygian_ii_i, B half, A' phrygian_ii_i
   Sunrise A3 should land a strong PAC (lead on C, bass V→I); Desert A/A' should
   end on the phrygian half-step descent (bass F→E under a lead F→E).

   Bar indices in phrasePlan/texturePlan are 1-indexed and SECTION-RELATIVE
   (bar 1 is the first bar of the section). Transforms are given as the
   "name@k=v" string form or the { name, params } object form interchangeably.

   SESSION 8. `CASES` (below) is the hand-supplied set, UNCHANGED — every prior
   verifier iterates over it and runs it synchronously, so it must keep its
   texturePlan. `GENERATED_CASES` (at the bottom) is a separate export: the same
   upstream context as Sunrise and Wanderer's but with the texturePlan OMITTED,
   so the inspector calls Stage 5b (the LLM) to choreograph one live. Kept out of
   `CASES` on purpose — a case with no texturePlan would crash the Stage-6/7/8
   verifiers, which trust the hand-supplied plan.

   SESSION 10. `GENERATED_CASES` gains the FULLY-LLM case "Sunrise Fanfare — fully
   LLM" (motifs + phrasePlan + texturePlan all omitted): the whole creative
   content is generated (Stage 4 → 5a → 5b), only macroParams + harmonicPlan are
   hand-supplied. This is the Session-10 human-checkpoint case.

   SESSION 11. `GENERATED_CASES` gains "Sunrise Fanfare — fully LLM (incl. harmony)"
   (harmonicPlan + motifs + phrasePlan + texturePlan ALL omitted): now the harmony
   itself is generated too (Stage 3 → 4 → 5a → 5b), only macroParams hand-supplied.
   This is the Session-11 human-checkpoint case, A/B'd against the Session-10
   fully-LLM case (hand-supplied harmony) to judge the generated harmony.
   ================================================================= */

export const CASES = [
  // ---------------------------------------------------------------- major
  {
    id: 'c-major-aaba',
    title: 'Sunrise Fanfare',
    mood: 'triumphant',
    macroParams: {
      tempo: 132,
      meter: { numerator: 4, denominator: 4, grouping: [4] },
      tonic: 'C',
      mode: 'major',
      form: 'AABA',
      total_bars: 8,
      register_center: 'C5',
      harmonic_rhythm: [1, 1, 1, 1],
      sections: [
        { label: 'A1', bars: 2 },
        { label: 'A2', bars: 2 },
        { label: 'B', bars: 2 },
        { label: 'A3', bars: 2 },
      ],
    },
    motifs: {
      a: {
        degrees: [1, 3, 5, 3, 2, 1],
        rhythm: [0.5, 0.5, 1, 0.5, 0.5, 1],
        contour: 'peak_descend',
        register: 'mid',
        anomaly: null,
      },
      b: {
        degrees: [5, 4, 3, 2],
        rhythm: [1, 1, 1, 1],
        contour: 'falling_arc',
        register: 'mid',
        anomaly: null,
      },
    },
    harmonicPlan: {
      sections: [
        { label: 'A1', progression: ['I', 'V', 'vi', 'IV'], cadence: 'IAC', anomaly: null },
        { label: 'A2', progression: ['I', 'V', 'vi', 'IV'], cadence: 'deceptive', anomaly: null },
        { label: 'B', progression: ['IV', 'I', 'ii', 'V'], cadence: 'half', anomaly: null },
        { label: 'A3', progression: ['I', 'IV', 'V', 'I'], cadence: 'PAC', anomaly: null },
      ],
    },
    phrasePlan: {
      A1: {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
        ],
      },
      A2: {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: 'invert', start_bar: 2, length_bars: 1 },
        ],
      },
      B: {
        phrase_structure: 'sentence',
        lead: [
          { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'b', transform: 'sequence_down_step', start_bar: 2, length_bars: 1 },
        ],
      },
      A3: {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: { name: 'transpose_third', params: { direction: 'up' } }, start_bar: 2, length_bars: 1 },
        ],
      },
    },
    texturePlan: {
      A1: {
        harmony: [{ bars: [1, 2], mode: 'parallel_thirds_below' }],
        bass: [{ bars: [1, 2], pattern: 'root_fifth' }],
      },
      A2: {
        harmony: [{ bars: [1, 2], mode: 'parallel_thirds_below' }],
        bass: [{ bars: [1, 2], pattern: 'arpeggio' }],
      },
      B: {
        harmony: [{ bars: [1, 2], mode: 'parallel_thirds_below' }],
        bass: [{ bars: [1, 2], pattern: 'root_fifth' }],
      },
      A3: {
        harmony: [{ bars: [1, 2], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 1], pattern: 'walking' },
          { bars: [2, 2], pattern: 'cadential_5_1' },
        ],
      },
    },
  },

  // ---------------------------------------------------------------- minor (dorian)
  {
    id: 'd-dorian-aba',
    title: "Wanderer's Path",
    mood: 'hopeful',
    macroParams: {
      tempo: 120,
      meter: { numerator: 4, denominator: 4, grouping: [4] },
      tonic: 'D',
      mode: 'dorian',
      form: 'ternary',
      total_bars: 8,
      register_center: 'D5',
      harmonic_rhythm: [1, 1, 1, 1],
      sections: [
        { label: 'A', bars: 3 },
        { label: 'B', bars: 2 },
        { label: "A'", bars: 3 },
      ],
    },
    motifs: {
      a: {
        degrees: [1, 2, 3, 5, 3, 2],
        rhythm: [0.5, 0.5, 0.5, 1, 0.5, 1],
        contour: 'rising_arc',
        register: 'mid',
        anomaly: null,
      },
      b: {
        degrees: [5, 7, 8, 7, 5],
        rhythm: [0.5, 0.5, 1, 0.5, 1.5],
        contour: 'peak_descend',
        register: 'high',
        anomaly: null,
      },
    },
    harmonicPlan: {
      sections: [
        { label: 'A', progression: ['i', 'VII', 'IV', 'i'], cadence: 'modal_iv_i', anomaly: null },
        { label: 'B', progression: ['v', 'IV', 'VII', 'IV'], cadence: 'plagal', anomaly: null },
        { label: "A'", progression: ['i', 'IV', 'VII', 'i'], cadence: 'modal_iv_i', anomaly: null },
      ],
    },
    phrasePlan: {
      A: {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
          { motif: 'a', transform: { name: 'transpose_third', params: { direction: 'up' } }, start_bar: 3, length_bars: 1 },
        ],
      },
      B: {
        phrase_structure: 'sentence',
        lead: [
          { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'b', transform: 'invert', start_bar: 2, length_bars: 1 },
        ],
      },
      "A'": {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
          { motif: 'a', transform: 'ornament_lower_neighbor', start_bar: 3, length_bars: 1 },
        ],
      },
    },
    texturePlan: {
      A: {
        harmony: [{ bars: [1, 3], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 2], pattern: 'root_fifth' },
          { bars: [3, 3], pattern: 'walking' },
        ],
      },
      B: {
        // Session 6: a held drone over the B section (chord root, rearticulated
        // per bar) to audition oblique_held end-to-end through the pipeline.
        harmony: [{ bars: [1, 2], mode: 'oblique_held' }],
        bass: [{ bars: [1, 2], pattern: 'pedal', degree: 1 }],
      },
      "A'": {
        harmony: [{ bars: [1, 3], mode: 'parallel_thirds_below' }],
        bass: [{ bars: [1, 3], pattern: 'root_fifth' }],
      },
    },
  },

  // ---------------------------------------------------------------- exotic (phrygian dominant)
  {
    id: 'e-phrygian-dominant-aba',
    title: 'Desert Caravan',
    mood: 'mysterious',
    macroParams: {
      tempo: 126,
      meter: { numerator: 4, denominator: 4, grouping: [4] },
      tonic: 'E',
      mode: 'phrygian_dominant',
      form: 'ternary',
      total_bars: 8,
      register_center: 'E5',
      harmonic_rhythm: [1, 1, 1, 1],
      sections: [
        { label: 'A', bars: 3 },
        { label: 'B', bars: 2 },
        { label: "A'", bars: 3 },
      ],
    },
    motifs: {
      a: {
        degrees: [1, 2, 3, 2, 1],
        rhythm: [0.5, 0.5, 1, 0.5, 1.5],
        contour: 'peak_descend',
        register: 'mid',
        anomaly: null,
      },
      b: {
        degrees: [5, 4, 3, 2, 1],
        rhythm: [0.5, 0.5, 0.5, 0.5, 2],
        contour: 'falling_arc',
        register: 'mid',
        anomaly: null,
      },
    },
    harmonicPlan: {
      sections: [
        { label: 'A', progression: ['I', 'II', 'iv', 'I'], cadence: 'phrygian_ii_i', anomaly: null },
        { label: 'B', progression: ['iv', 'II', 'iv', 'I'], cadence: 'half', anomaly: null },
        { label: "A'", progression: ['I', 'iv', 'II', 'I'], cadence: 'phrygian_ii_i', anomaly: null },
      ],
    },
    phrasePlan: {
      A: {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
          { motif: 'a', transform: { name: 'transpose_third', params: { direction: 'up' } }, start_bar: 3, length_bars: 1 },
        ],
      },
      B: {
        phrase_structure: 'sentence',
        lead: [
          { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'b', transform: 'invert', start_bar: 2, length_bars: 1 },
        ],
      },
      "A'": {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: { name: 'ornament_chromatic_passing', params: { at_position: 1 } }, start_bar: 2, length_bars: 1 },
          { motif: 'a', transform: 'ornament_upper_neighbor', start_bar: 3, length_bars: 1 },
        ],
      },
    },
    texturePlan: {
      A: {
        harmony: [{ bars: [1, 3], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 2], pattern: 'root_fifth' },
          { bars: [3, 3], pattern: 'arpeggio' },
        ],
      },
      B: {
        harmony: [{ bars: [1, 2], mode: 'parallel_thirds_below' }],
        bass: [{ bars: [1, 2], pattern: 'pedal', degree: 1 }],
      },
      "A'": {
        // Session 6: a one-beat-delay canon over the recap, transposed to the
        // chord tone — auditions imitation_one_beat_delay end-to-end.
        harmony: [{ bars: [1, 3], mode: 'imitation_one_beat_delay' }],
        bass: [{ bars: [1, 3], pattern: 'root_fifth' }],
      },
    },
  },
];

// ---------------------------------------------------------------- Session 8
// Generated cases: the same macroParams / motifs / harmonicPlan / phrasePlan as
// the matching hand-supplied case, but with `texturePlan` OMITTED so the
// inspector calls Stage 5b (generateTexturePlan) to produce one via the LLM.
// `generated: true` lets the inspector route these through the async path and
// the Stage-5b debug panel. Kept OUT of `CASES` so the prior verifiers (which
// trust a hand-supplied texturePlan) are unaffected.
function withoutTexturePlan(base, overrides) {
  const { texturePlan, ...rest } = base;
  return { ...rest, generated: true, ...overrides };
}

// ---------------------------------------------------------------- Session 9
// Fully-generated case: the same upstream context as the matching hand-supplied
// case, but with BOTH `phrasePlan` AND `texturePlan` OMITTED. The inspector calls
// Stage 5a (generatePhrasePlan) to shape the motifs, then Stage 5b
// (generateTexturePlan) to choreograph textures over that phrasePlan — both via
// the live LLM. This is the case the Session-9 human checkpoint A/Bs against the
// hand-supplied and Stage-5b-only-generated twins. `generated: true` still routes
// the texture path; the absent phrasePlan triggers the Stage-5a path.
function withoutPhraseAndTexturePlan(base, overrides) {
  const { phrasePlan, texturePlan, ...rest } = base;
  return { ...rest, generated: true, ...overrides };
}

// ---------------------------------------------------------------- Session 10
// FULLY-LLM case: the same macroParams + harmonicPlan as the matching hand-
// supplied case, but with motifs, phrasePlan, AND texturePlan all OMITTED. The
// inspector calls Stage 4 (generateMotifs) to write the melodic cells, then
// Stage 5a (generatePhrasePlan) to shape their development, then Stage 5b
// (generateTexturePlan) to choreograph textures — the ENTIRE creative content is
// LLM-generated; only the macro params and the harmonic progression are hand-
// supplied. This is the case the Session-10 human checkpoint A/Bs against the
// hand-supplied Sunrise and the partial-generated twins.
//
// Stage 4 reads `macroParams.mood` (its single most important shape signal), so
// the case's mood is surfaced INTO macroParams (forward-looking: Stage 2 will set
// it from the AestheticBrief). The top-level `mood` is kept for FinalJingle
// metadata, exactly as the runner reads it.
function fullyLLMCase(base, overrides) {
  const { motifs, phrasePlan, texturePlan, ...rest } = base;
  return {
    ...rest,
    macroParams: { ...rest.macroParams, mood: base.mood },
    generated: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------- Session 11
// FULLY-LLM-INCLUDING-HARMONY case: the same macroParams as the matching hand-
// supplied case, but with harmonicPlan, motifs, phrasePlan, AND texturePlan all
// OMITTED. The inspector calls Stage 3 (generateHarmonicPlan) to write the chords
// + cadences, then Stage 4 (motifs), Stage 5a (phrase), Stage 5b (texture) — the
// ENTIRE creative content, harmony included, is LLM-generated; only the macro
// params are hand-supplied. This is the case the Session-11 human checkpoint A/Bs
// against the Session-10 fully-LLM case (which had hand-supplied harmony), to hear
// whether the generated harmony reads as functionally clearer / more memorable.
//
// Stage 3 reads `macroParams.mood` (its strongest harmonic-language signal) — and
// Stages 4/5a/5b read it downstream — so the case's mood is surfaced INTO
// macroParams (forward-looking: Stage 2 will set it from the AestheticBrief). The
// top-level `mood` is kept for FinalJingle metadata, exactly as the runner reads it.
function fullyLLMWithHarmonyCase(base, overrides) {
  const { harmonicPlan, motifs, phrasePlan, texturePlan, ...rest } = base;
  return {
    ...rest,
    macroParams: { ...rest.macroParams, mood: base.mood },
    generated: true,
    ...overrides,
  };
}

export const GENERATED_CASES = [
  withoutTexturePlan(CASES[0], {
    id: 'sunrise-generated',
    title: 'Sunrise Fanfare — generated',
  }),
  withoutTexturePlan(CASES[1], {
    id: 'wanderer-generated',
    title: "Wanderer's Path — generated",
  }),
  withoutPhraseAndTexturePlan(CASES[1], {
    id: 'wanderer-fully-generated',
    title: "Wanderer's Path — fully generated",
  }),
  fullyLLMCase(CASES[0], {
    id: 'sunrise-fully-llm',
    title: 'Sunrise Fanfare — fully LLM',
  }),
  fullyLLMWithHarmonyCase(CASES[0], {
    id: 'sunrise-fully-llm-harmony',
    title: 'Sunrise Fanfare — fully LLM (incl. harmony)',
  }),
];
