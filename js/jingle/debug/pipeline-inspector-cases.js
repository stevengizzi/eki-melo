/* =================================================================
   PIPELINE INSPECTOR — hand-written test cases (buildplan Session 4;
   rewritten to PHRASE-SHAPE in Session 12).

   A pure-data module (zero imports) of complete pipeline inputs, so both the
   debug page (pipeline-inspector.html) and the Node regression checks
   (theory/verify-stage6/7/8.mjs) consume the same fixtures. Each case is a full
   { macroParams, motifs, harmonicPlan, phrasePlan, texturePlan } plus a title
   and mood passthrough — exactly the shape runPipeline expects.

   SESSION 12 — THE PHRASE-MOTIF SHAPE. The cell-shape fixtures are gone. Each
   case's `motifs` is now keyed by SECTION LABEL (A1/A2/B/A3, or A/B/A'), and each
   value is a full PHRASE that FILLS its section: its rhythm sums to exactly
   section.bars × beatsPerBar, and its strong beats (downbeat + beat 3 in 4/4)
   sit on that bar's chord tones. The `phrasePlan` is correspondingly simple —
   ONE literal assignment per section placing that section's phrase across all its
   bars. The macroParams + harmonicPlan + texturePlan are UNCHANGED from the
   Session-4–11 cell fixtures (the brief's instruction: preserve the case
   identities so verify-stage6/7/8's pins are disturbed as little as possible —
   only the melody content changed).

   Anomaly coverage. The chromatic-passing-tone path is exercised by the
   verifiers' OWN inline fixtures (verify-stage6 §3, verify-stage7 §c, verify-stage8),
   not by these listening cases — so the hand-supplied phrases stay clean (no
   anomaly), keeping the chiptune_idiomatic zero-repair gate predictable.

   Coverage: one major (C major, AABA), one minor (D dorian, ABA), one exotic
   (E phrygian-dominant, ABA). All 4/4. Between them the cases exercise the five
   bass patterns and three harmony textures (parallel_thirds_below default,
   oblique_held drone, imitation_one_beat_delay canon).

   CADENCE COVERAGE (Session 5). The three cases between them declare all seven
   cadence types so Stage 8 is audibly exercised end-to-end:
     Sunrise Fanfare — A1 IAC, A2 deceptive, B half, A3 PAC
     Wanderer's Path — A modal_iv_i, B plagal, A' modal_iv_i
     Desert Caravan  — A phrygian_ii_i, B half, A' phrygian_ii_i

   Bar indices in phrasePlan/texturePlan are 1-indexed and SECTION-RELATIVE.
   Transforms are given as the "name@k=v" string form or the { name, params }
   object form interchangeably.

   GENERATED_CASES (at the bottom) is a separate export of cases that OMIT one or
   more upstream artifacts so the inspector calls the live LLM for them. The ids
   are stable (the verifiers find cases by id):
     - sunrise-generated / wanderer-generated     — texture only (Stage 5b)
     - wanderer-fully-generated                   — arrangement + texture (5a + 5b)
     - sunrise-fully-llm                          — phrases + arrangement + texture
                                                    (Stage 4 phrases + 5a + 5b)
     - sunrise-fully-llm-harmony                  — harmony + everything (Stage 3→5b)
     - sunrise-16bar-fully-llm-harmony            — the 16-bar harmony-room diagnostic
   Kept OUT of `CASES` so the synchronous Stage-6/7/8 verifiers (which trust a
   complete hand-supplied plan) are unaffected.
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
    // Per-section phrases (each fills its 2-bar / 8-beat section). Strong beats
    // land on chord tones: A1/A2 over I→V, B over IV→I, A3 over I→IV (PAC).
    // A2 echoes A1 (a repetition); B contrasts (high, falling); A3 reprises A1's
    // opening and steps down toward the PAC.
    motifs: {
      A1: { degrees: [1, 3, 5, 3, 5, 4, 3, 2], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
      A2: { degrees: [1, 3, 5, 3, 5, 4, 3, 1], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
      B: { degrees: [8, 6, 4, 6, 5, 3, 2, 1], rhythm: [1, 1, 1, 1, 1, 1, 1, 1], contour: 'falling_arc', register: 'high', anomaly: null },
      A3: { degrees: [1, 3, 5, 3, 4, 3, 2, 1], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
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
      A1: { phrase_structure: 'period', lead: [{ motif: 'A1', transform: 'literal', start_bar: 1, length_bars: 2 }] },
      A2: { phrase_structure: 'period', lead: [{ motif: 'A2', transform: 'literal', start_bar: 1, length_bars: 2 }] },
      B: { phrase_structure: 'period', lead: [{ motif: 'B', transform: 'literal', start_bar: 1, length_bars: 2 }] },
      A3: { phrase_structure: 'period', lead: [{ motif: 'A3', transform: 'literal', start_bar: 1, length_bars: 2 }] },
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
    // A (12 beats) climbs to the dorian natural 7 then settles; B (8 beats) is the
    // high contrast; A' (12 beats) reprises A's opening and adapts its tail toward
    // the modal cadence. Strong beats fit i/VII/IV (A), v/IV (B), i/IV/VII (A').
    motifs: {
      A: { degrees: [1, 2, 3, 5, 4, 6, 7, 4, 6, 5, 4, 1], rhythm: [1, 0.5, 0.5, 2, 1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
      B: { degrees: [5, 7, 8, 7, 6, 5, 4, 6], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'high', anomaly: null },
      "A'": { degrees: [1, 2, 3, 5, 6, 5, 4, 6, 4, 3, 2, 1], rhythm: [1, 0.5, 0.5, 2, 1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
    },
    harmonicPlan: {
      sections: [
        { label: 'A', progression: ['i', 'VII', 'IV', 'i'], cadence: 'modal_iv_i', anomaly: null },
        { label: 'B', progression: ['v', 'IV', 'VII', 'IV'], cadence: 'plagal', anomaly: null },
        { label: "A'", progression: ['i', 'IV', 'VII', 'i'], cadence: 'modal_iv_i', anomaly: null },
      ],
    },
    phrasePlan: {
      A: { phrase_structure: 'period', lead: [{ motif: 'A', transform: 'literal', start_bar: 1, length_bars: 3 }] },
      B: { phrase_structure: 'sentence', lead: [{ motif: 'B', transform: 'literal', start_bar: 1, length_bars: 2 }] },
      "A'": { phrase_structure: 'period', lead: [{ motif: "A'", transform: 'literal', start_bar: 1, length_bars: 3 }] },
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
        // A held drone over the B section (chord root, rearticulated per bar) to
        // audition oblique_held end-to-end through the pipeline.
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
    // The b2 (degree 2 = F) on weak beats is the phrygian-dominant colour. A (12)
    // over I→II→iv leads b2→1 into the phrygian cadence; B (8) is the lower
    // contrast over iv→II; A' (12) reprises A's head over I→iv→II. Strong beats
    // fit each bar's chord (I {1,3,5}, II {2,4,6}, iv {4,6,1}).
    motifs: {
      A: { degrees: [1, 2, 3, 5, 4, 5, 6, 4, 6, 4, 2, 1], rhythm: [1, 0.5, 0.5, 2, 1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
      B: { degrees: [6, 5, 4, 1, 4, 6, 4, 2], rhythm: [1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'falling_arc', register: 'low', anomaly: null },
      "A'": { degrees: [1, 2, 3, 5, 6, 5, 4, 6, 4, 6, 2, 1], rhythm: [1, 0.5, 0.5, 2, 1, 0.5, 0.5, 2, 1, 1, 1, 1], contour: 'peak_descend', register: 'mid', anomaly: null },
    },
    harmonicPlan: {
      sections: [
        { label: 'A', progression: ['I', 'II', 'iv', 'I'], cadence: 'phrygian_ii_i', anomaly: null },
        { label: 'B', progression: ['iv', 'II', 'iv', 'I'], cadence: 'half', anomaly: null },
        { label: "A'", progression: ['I', 'iv', 'II', 'I'], cadence: 'phrygian_ii_i', anomaly: null },
      ],
    },
    phrasePlan: {
      A: { phrase_structure: 'period', lead: [{ motif: 'A', transform: 'literal', start_bar: 1, length_bars: 3 }] },
      B: { phrase_structure: 'sentence', lead: [{ motif: 'B', transform: 'literal', start_bar: 1, length_bars: 2 }] },
      "A'": { phrase_structure: 'period', lead: [{ motif: "A'", transform: 'literal', start_bar: 1, length_bars: 3 }] },
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
        // A one-beat-delay canon over the recap, transposed to the chord tone —
        // auditions imitation_one_beat_delay end-to-end.
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
// `generated: true` routes these through the async path. Kept OUT of `CASES`.
function withoutTexturePlan(base, overrides) {
  const { texturePlan, ...rest } = base;
  return { ...rest, generated: true, ...overrides };
}

// ---------------------------------------------------------------- Session 9
// Fully-generated case: the matching hand-supplied case with BOTH `phrasePlan`
// AND `texturePlan` OMITTED. The inspector calls Stage 5a (now ARRANGEMENT — it
// places the hand-supplied per-section phrases) then Stage 5b, both live.
function withoutPhraseAndTexturePlan(base, overrides) {
  const { phrasePlan, texturePlan, ...rest } = base;
  return { ...rest, generated: true, ...overrides };
}

// ---------------------------------------------------------------- Session 10/12
// FULLY-LLM case: motifs, phrasePlan, AND texturePlan all OMITTED. After the
// Session-12 phrase-motif pivot, omitting motifs means Stage 4 generates the
// per-section PHRASES (not cells); Stage 5a then arranges them and Stage 5b
// choreographs textures — the ENTIRE creative content is LLM-generated; only
// macroParams + harmonicPlan are hand-supplied. The headline A/B audition case.
//
// Stage 4 reads `macroParams.mood` (its strongest shape signal), so the case's
// mood is surfaced INTO macroParams (forward-looking: Stage 2 will set it from the
// AestheticBrief). The top-level `mood` is kept for FinalJingle metadata.
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
// FULLY-LLM-INCLUDING-HARMONY case: harmonicPlan, motifs, phrasePlan, AND
// texturePlan all OMITTED. The inspector calls Stage 3 (harmony) → Stage 4
// (phrases) → Stage 5a (arrangement) → Stage 5b (texture) — the entire creative
// content, harmony included, is LLM-generated; only the macro params are
// hand-supplied. Stage 3/4/5a/5b read `macroParams.mood`, so it is surfaced in.
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
    title: 'Sunrise Fanfare — generated texture',
  }),
  withoutTexturePlan(CASES[1], {
    id: 'wanderer-generated',
    title: "Wanderer's Path — generated texture",
  }),
  withoutPhraseAndTexturePlan(CASES[1], {
    id: 'wanderer-fully-generated',
    title: "Wanderer's Path — generated arrangement + texture",
  }),
  fullyLLMCase(CASES[0], {
    id: 'sunrise-fully-llm',
    title: 'Sunrise Fanfare — fully LLM (phrases + arrangement + texture)',
  }),
  fullyLLMWithHarmonyCase(CASES[0], {
    id: 'sunrise-fully-llm-harmony',
    title: 'Sunrise Fanfare — fully LLM (incl. harmony)',
  }),
  // ---------------------------------------------------------------- Session 11
  // HARMONY-ROOM DIAGNOSTIC: a 16-bar AABA with 4-bar sections (vs. the 8-bar
  // case's 2-bar sections), fully LLM incl. harmony. With 4 bars per section
  // Stage 3 has room for richer progressions AND Stage 4 has room for a longer
  // phrase arc. NOTE: 16 bars (64 beats) deliberately EXCEEDS the ~32-beat
  // arrival-jingle cap ([[jingle-length-cap-32-beats]]); it is a diagnostic, not
  // a production length.
  {
    id: 'sunrise-16bar-fully-llm-harmony',
    title: 'Sunrise (16-bar, 4-bar sections) — fully LLM (incl. harmony)',
    mood: 'triumphant',
    generated: true,
    macroParams: {
      tempo: 132,
      meter: { numerator: 4, denominator: 4, grouping: [4] },
      tonic: 'C',
      mode: 'major',
      form: 'AABA',
      total_bars: 16,
      register_center: 'C5',
      harmonic_rhythm: [1, 1, 1, 1],
      mood: 'triumphant',
      sections: [
        { label: 'A1', bars: 4 },
        { label: 'A2', bars: 4 },
        { label: 'B', bars: 4 },
        { label: 'A3', bars: 4 },
      ],
    },
  },
];
