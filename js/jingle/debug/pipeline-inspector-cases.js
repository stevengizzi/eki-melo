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
   patterns and the parallel_thirds_below harmony texture.

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
      total_bars: 16,
      register_center: 'C5',
      harmonic_rhythm: [1, 1, 1, 1],
      sections: [
        { label: 'A1', bars: 4 },
        { label: 'A2', bars: 4 },
        { label: 'B', bars: 4 },
        { label: 'A3', bars: 4 },
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
          { motif: 'a', transform: { name: 'transpose_third', params: { direction: 'up' } }, start_bar: 3, length_bars: 1 },
          { motif: 'a', transform: 'fragment_tail', start_bar: 4, length_bars: 1 },
        ],
      },
      A2: {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
          { motif: 'a', transform: 'invert', start_bar: 3, length_bars: 1 },
          { motif: 'a', transform: 'fragment_head', start_bar: 4, length_bars: 1 },
        ],
      },
      B: {
        phrase_structure: 'sentence',
        lead: [
          { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'b', transform: 'sequence_down_step', start_bar: 2, length_bars: 1 },
          { motif: 'b', transform: { name: 'transpose_third', params: { direction: 'up' } }, start_bar: 3, length_bars: 1 },
          { motif: 'b', transform: 'retrograde', start_bar: 4, length_bars: 1 },
        ],
      },
      A3: {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
          { motif: 'a', transform: { name: 'transpose_third', params: { direction: 'up' } }, start_bar: 3, length_bars: 1 },
          { motif: 'a', transform: 'ornament_upper_neighbor', start_bar: 4, length_bars: 1 },
        ],
      },
    },
    texturePlan: {
      A1: {
        harmony: [{ bars: [1, 4], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 3], pattern: 'root_fifth' },
          { bars: [4, 4], pattern: 'cadential_5_1' },
        ],
      },
      A2: {
        harmony: [{ bars: [1, 4], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 2], pattern: 'arpeggio' },
          { bars: [3, 4], pattern: 'walking' },
        ],
      },
      B: {
        harmony: [{ bars: [1, 4], mode: 'parallel_thirds_below' }],
        bass: [{ bars: [1, 4], pattern: 'root_fifth' }],
      },
      A3: {
        harmony: [{ bars: [1, 3], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 3], pattern: 'walking' },
          { bars: [4, 4], pattern: 'cadential_5_1' },
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
      total_bars: 12,
      register_center: 'D5',
      harmonic_rhythm: [1, 1, 1, 1],
      sections: [
        { label: 'A', bars: 4 },
        { label: 'B', bars: 4 },
        { label: "A'", bars: 4 },
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
          { motif: 'a', transform: 'fragment_tail', start_bar: 4, length_bars: 1 },
        ],
      },
      B: {
        phrase_structure: 'sentence',
        lead: [
          { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'b', transform: 'invert', start_bar: 2, length_bars: 1 },
          { motif: 'b', transform: 'sequence_down_step', start_bar: 3, length_bars: 1 },
          { motif: 'b', transform: 'retrograde', start_bar: 4, length_bars: 1 },
        ],
      },
      "A'": {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: 'sequence_up_step', start_bar: 2, length_bars: 1 },
          { motif: 'a', transform: 'ornament_lower_neighbor', start_bar: 3, length_bars: 1 },
          { motif: 'a', transform: 'fragment_head', start_bar: 4, length_bars: 1 },
        ],
      },
    },
    texturePlan: {
      A: {
        harmony: [{ bars: [1, 4], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 2], pattern: 'root_fifth' },
          { bars: [3, 4], pattern: 'walking' },
        ],
      },
      B: {
        harmony: [{ bars: [1, 4], mode: 'parallel_thirds_below' }],
        bass: [{ bars: [1, 4], pattern: 'pedal', degree: 1 }],
      },
      "A'": {
        harmony: [{ bars: [1, 3], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 3], pattern: 'root_fifth' },
          { bars: [4, 4], pattern: 'cadential_5_1' },
        ],
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
      total_bars: 12,
      register_center: 'E5',
      harmonic_rhythm: [1, 1, 1, 1],
      sections: [
        { label: 'A', bars: 4 },
        { label: 'B', bars: 4 },
        { label: "A'", bars: 4 },
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
          { motif: 'a', transform: 'fragment_tail', start_bar: 4, length_bars: 1 },
        ],
      },
      B: {
        phrase_structure: 'sentence',
        lead: [
          { motif: 'b', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'b', transform: 'invert', start_bar: 2, length_bars: 1 },
          { motif: 'b', transform: 'sequence_down_step', start_bar: 3, length_bars: 1 },
          { motif: 'b', transform: 'retrograde', start_bar: 4, length_bars: 1 },
        ],
      },
      "A'": {
        phrase_structure: 'period',
        lead: [
          { motif: 'a', transform: 'literal', start_bar: 1, length_bars: 1 },
          { motif: 'a', transform: { name: 'ornament_chromatic_passing', params: { at_position: 1 } }, start_bar: 2, length_bars: 1 },
          { motif: 'a', transform: 'ornament_upper_neighbor', start_bar: 3, length_bars: 1 },
          { motif: 'a', transform: 'fragment_head', start_bar: 4, length_bars: 1 },
        ],
      },
    },
    texturePlan: {
      A: {
        harmony: [{ bars: [1, 4], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 2], pattern: 'root_fifth' },
          { bars: [3, 4], pattern: 'arpeggio' },
        ],
      },
      B: {
        harmony: [{ bars: [1, 4], mode: 'parallel_thirds_below' }],
        bass: [{ bars: [1, 4], pattern: 'pedal', degree: 1 }],
      },
      "A'": {
        harmony: [{ bars: [1, 3], mode: 'parallel_thirds_below' }],
        bass: [
          { bars: [1, 3], pattern: 'root_fifth' },
          { bars: [4, 4], pattern: 'cadential_5_1' },
        ],
      },
    },
  },
];
