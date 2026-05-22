/* =================================================================
   STAGE 4 — MELODIC PHRASES (buildplan Session 12 — the phrase-motif rework,
   §7.7). This stage WRITES THE MELODY, one PHRASE PER SECTION.

   THE ARCHITECTURAL PIVOT. Sessions 1–11 authored the melody as 2–3 tiny cells
   (≤ one bar, chord-blind to all but the section's first chord) that Stage 5a
   then DEVELOPED across the bars in degree-space. The listening evidence
   (Session 10 memorability gap + Session 11 cell-vs-moving-harmony coherence
   ceiling) showed that model caps BOTH memorability and harmonic coherence: a
   fixed cell can only fit the one chord it was written for, and richer harmony
   made the mismatch WORSE. So this session re-scopes Stage 4 to author ONE
   melodic PHRASE PER SECTION, directly over THAT section's full progression,
   so strong beats land on each bar's chord tones BY CONSTRUCTION. Stage 5a
   shrinks to ARRANGEMENT (place each phrase, optionally varied). The §3
   transform library survives as variation tooling; its role demotes from
   required-for-development to optional-flavor.

     generateMotifs({ macroParams, harmonicPlan, config,
                      __mockResponse?, onTrace? }) → phrases (flat, by section)

   THE TWO SHAPES (and why they differ). The LLM emits — and validateMotifs
   checks — the WRAPPED envelope `{ phrases: { <label>: { … } } }`. A top-level
   `phrases` key is clearer for the model and matches the Session-8/9/10/11
   envelope idiom. The canonical inter-stage map (what Stages 5a/5b/6 consume,
   what the hand-supplied inspector cases use) is FLAT: `{ <label>: { … } }`. So
   generateMotifs validates the wrapped envelope, then UNWRAPS `.phrases` and
   returns the flat map. `input.motifs` is one consistent shape whether
   hand-supplied or generated — the export NAMES (generateMotifs, validateMotifs,
   buildMotifsPrompt) are unchanged so importers don't move; only the CONTRACT
   changed.

   OUTPUT (flat phrase map — keyed by SECTION LABEL, not the old short letters):
     {
       <section_label>: {              // A1, A2, B, A3 — every section, one phrase
         degrees:  [int, …],           // 8–32 entries (a phrase, not a cell)
         rhythm:   [number, …],        // same length; positive beats; the sum
                                       //   EQUALS section.bars * beatsPerBar
                                       //   EXACTLY (the phrase fills the section)
         contour:  one of CONTOURS,
         register: "low" | "mid" | "high",
         anomaly:  null | { type, at_position }   // ≤ 1 per phrase
       },
       …
     }

   Stages 5a/5b/6/7/8 consume `{ degrees, rhythm, contour, register, anomaly }`
   dicts via name-keyed lookup — whether the name is "a" (old cell) or "A1"
   (phrase) is opaque to them, so the deterministic back-half is UNCHANGED.

   DEGREE VALUES use the §3 octave-displacement convention (1–7 in-octave; 8 the
   octave above; negatives below the tonic), range [-8, 14] (Session 10's restored
   range). ANOMALY KEY is `at_position` (the key Stage 6's realizeLeadAssignment
   reads), not `position`.

   OFFLINE / DETERMINISTIC FALLBACK. Pass `__mockResponse` (a JSON string) to skip
   the network and run that string through the SAME parse + validate path — how
   verify-stage4.mjs exercises the stage without an API call.

   API. Same call shape as Stages 3/5a/5b / js/jingle/api.js: POST the Anthropic
   Messages body, force JSON-only by instruction, strip code fences, parse with a
   brace-match fallback. The model is pinned to the one /api/generate's allow-list
   permits, so both runtime modes work without a server change.

   PORTABILITY. This is pipeline/ code: it may import theory/ and js/env.js. It
   does NOT modify api.js (read-only) — it mimics its patterns.

   LEGACY. The Session-10 cell stage is preserved verbatim as
   stage-4-cells-LEGACY.js for the A/B audition (config.knobs.motif_architecture
   === 'cell'); see that file's banner and the Session-12 journal entry.
   ================================================================= */
import { postMessages } from './llm-call.js';
import { CONTOURS, REGISTERS, degreeToLinear, contourOfDegrees } from '../theory/motif.js';
import { getForm, deriveSectionRelationships } from '../theory/form-engine.js';
import { computeSectionPlan } from './stage-6-voice.js';

// The /api/generate allow-list only permits this model (see
// functions/api/generate.js ALLOWED_MODELS); api.js + Stages 3/5a/5b use the
// same one. Pinning it keeps the deployed proxy path AND the artifact direct
// path working without a server change. A model upgrade is a coordinated
// allow-list change.
const STAGE_4_MODEL = 'claude-sonnet-4-20250514';
// Phrases are far larger than cells (up to 4 sections × ~32 notes), so the
// envelope needs more room than the Session-10 cell stage's 2000.
const STAGE_4_MAX_TOKENS = 3500;

// The phrase covers its section completely, so the rhythm sum must EQUAL the
// section's beat count. The check is hard (a short/long phrase breaks Stage 6's
// realization) with a small tolerance for float noise.
const RHYTHM_SUM_EPSILON = 0.01;

// A phrase is a melodic line, not a cell: enough notes to carry an arc, capped so
// it stays a phrase rather than a torrent of sixteenths.
const DEGREES_MIN = 8;
const DEGREES_MAX = 32;
// A phrase may include rests (null degrees) for phrasing, but it must remain a
// melody — at least this many SOUNDED notes, so it never collapses into silence.
const SOUNDED_NOTES_MIN = 5;

// Degree VALUES use the §3 octave-displacement convention (see motif.js): 1–7
// in-octave; 8 the tonic an octave up; negatives below the tonic. Bounded so a
// phrase realizes in a sane register (~an octave below the tonic to ~a twelfth
// above). Carried from Session 10's restored range.
const DEGREE_VALUE_MIN = -8;
const DEGREE_VALUE_MAX = 14;

// The three declared rule-breakers a phrase may carry (buildplan §3 anomaly
// slot). Kept as a Set so the prompt's listing and what validation accepts share
// one source.
const ANOMALY_TYPES = ['chromatic_neighbor', 'large_leap', 'rhythmic_displacement'];

// =================================================================
// ADVENTUROUSNESS — the freedom knob this stage reads
// (config.knobs.phrase_adventurousness ∈ {tame, adventurous, wild}). Repurposed
// from the Session-9 knob name to drive PHRASE-SHAPE choices (Session 12). Only
// the ACTIVE level's directive is printed, to keep the steer sharp.
// =================================================================

const PHRASE_ADVENTUROUSNESS_DIRECTIVE = {
  tame:
    'Write conjunct, stepwise phrases with simple, legible shapes — singable but predictable. Keep intervals '
    + 'small (mostly steps, the odd third). Use NO anomalies. For a PAC-type section, favor a clear '
    + 'antecedent–consequent (question/answer) shape.',
  adventurous:
    'Larger intervals are welcome — at least one real leap of a fourth or fifth somewhere. At least ONE phrase '
    + 'should have a clear PEAK-DESCEND shape with its peak around 60–75% of the way through — that peak is the '
    + '"hook" moment, the most memorable point. RHYTHM: do NOT write a phrase of all quarter notes — that is '
    + 'rhythmically inert. Every phrase must mix durations (eighths 0.5, quarters 1, a dotted 1.5 or held 2) AND '
    + 'include at least one interior rest for breath. Differentiate the phrases in contour AND rhythm; do not reuse '
    + 'one rhythm for every phrase. Anomalies stay optional and rare (prefer none).',
  wild:
    'Reach for bolder intervals and contour variety across the phrases. A chromatic_neighbor anomaly is '
    + 'encouraged SOMEWHERE (at most one per phrase, rare overall). If the mode offers a colour degree (a b2, #4, '
    + 'raised or natural 6, …) lean on it. Surprise is welcome — but every phrase must still be a singable line '
    + 'with a clear arc whose strong beats sit on chord tones, not a random scramble.',
};
const DEFAULT_PHRASE_ADVENTUROUSNESS = 'adventurous';

function phraseAdventurousnessOf(config) {
  const value = config?.knobs?.phrase_adventurousness;
  return value in PHRASE_ADVENTUROUSNESS_DIRECTIVE ? value : DEFAULT_PHRASE_ADVENTUROUSNESS;
}

// =================================================================
// SECTION + HARMONY HELPERS
// =================================================================

function beatsPerBarOf(meter) {
  return meter?.numerator ?? 4;
}

// The number of beats a section spans — bars × beats-per-bar. This is exactly
// what each section's phrase rhythm must sum to.
function sectionBeats(section, beatsPerBar) {
  return section.bars * beatsPerBar;
}

// The three chord-tone scale degrees (1..7) of a Roman numeral, stacked in
// diatonic thirds from its root degree (root, root+2, root+4 mod 7). Exact for
// diatonic triads (the common case) and a good-enough hint for borrows. Shared
// with Stage 5a's chord-fit logic in spirit; reimplemented here to keep the
// stages independent.
const ROMAN_DEGREE = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };
function chordToneDegreesOf(roman) {
  if (typeof roman !== 'string') return null;
  const core = roman.replace(/^[b#]+/, '').match(/^[ivxIVX]+/);
  if (!core) return null;
  const root = ROMAN_DEGREE[core[0].toLowerCase()];
  if (!root) return null;
  const wrap = (step) => (((step - 1) % 7) + 7) % 7 + 1;
  return [wrap(root), wrap(root + 2), wrap(root + 4)];
}

// The Roman numeral governing bar `barRel` (1-indexed, section-relative), one
// chord per bar, cycling the progression if it is shorter than the section —
// exactly Stage 6's romanForBar so the prompt's per-bar chords match what gets
// realized.
function romanForBar(progression, barRel) {
  if (!Array.isArray(progression) || progression.length === 0) return null;
  return progression[(barRel - 1) % progression.length];
}

// Fold any degree (octave displacement / negatives) to its in-octave 1..7 class,
// matching the realizer (degree 8 → tonic, −3 → the sixth, …).
const inOctaveDegree = (degree) => (((degreeToLinear(degree) % 7) + 7) % 7) + 1;

// The degree of the note SOUNDING at section-relative beat `offset` of a phrase —
// the note whose [onset, onset+duration) window covers it. Returns null when the
// phrase is malformed or the offset is past its end. Used by the strong-beat
// chord-fit soft check.
function degreeSoundingAt(phrase, offset) {
  if (!phrase || !Array.isArray(phrase.degrees) || !Array.isArray(phrase.rhythm)) return null;
  let onset = 0;
  for (let i = 0; i < phrase.degrees.length; i++) {
    const duration = phrase.rhythm[i];
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null;
    if (offset < onset + duration - 1e-9) return phrase.degrees[i];
    onset += duration;
  }
  return null;
}

// =================================================================
// SECTION RELATIONSHIPS — which sections are statement / repetition / contrast /
// reprise, so the cross-section conditioning (in the prompt) and the relationship
// soft checks (in the validator) share one source. Prefers the curated form
// metadata (getForm(...).relationships) remapped onto the actual labels by
// position; falls back to deriving from the label letter-pattern. Mirrors
// Stage 5a's helper.
// =================================================================

function sectionRelationshipsForPlan(macroParams, plan) {
  const labels = plan.map((s) => s.label);
  if (typeof macroParams.form === 'string') {
    try {
      const form = getForm(macroParams.form);
      const formLabels = form.section_labels;
      const formRel = form.relationships ?? {};
      if (Array.isArray(formLabels) && formLabels.length === labels.length) {
        const formToActual = new Map(formLabels.map((formLabel, i) => [formLabel, labels[i]]));
        const remapLabel = (ref) => (ref != null && formToActual.has(ref) ? formToActual.get(ref) : ref ?? null);
        const out = {};
        labels.forEach((label, i) => {
          const rel = formRel[formLabels[i]] ?? {};
          out[label] = {
            role: rel.role ?? null,
            of: remapLabel(rel.of),
            variation: rel.variation ?? null,
            contrast_from: remapLabel(rel.contrast_from),
          };
        });
        return out;
      }
    } catch (error) {
      /* unknown form — fall through to label-pattern derivation */
    }
  }
  return deriveSectionRelationships(labels);
}

// The leading alphabetic run of a section label, uppercased ("A1"→"A", "B"→"B").
function sectionLetter(label) {
  const match = String(label).match(/^[A-Za-z]+/);
  return (match ? match[0] : String(label)).toUpperCase();
}

// =================================================================
// PROMPT BUILDING — kept separate from the fetch (so the inspector can display
// it and the verifier can assert on it). Returns { system, user }.
//
// THE MUSICAL-QUALITY DIFFERENTIATOR lives here: the harmony-aware per-bar
// chord-tone block, the cross-section conditioning, the phrase-scale seed
// exemplars, and the explicit compositional guidance are the difference between
// a memorable composed line and three disconnected scale-walks.
// =================================================================

function pieceSummary(macroParams, plan) {
  const meter = macroParams.meter ?? { numerator: 4, denominator: 4 };
  const sectionList = plan.map((s) => `${s.label} (${s.bars} bars)`).join(', ');
  const harmonicRhythm = Array.isArray(macroParams.harmonic_rhythm)
    ? macroParams.harmonic_rhythm.join(', ')
    : String(macroParams.harmonic_rhythm ?? 1);
  return [
    'PIECE',
    `- key: ${String(macroParams.tonic)} ${macroParams.mode}`,
    `- form: ${macroParams.form ?? 'n/a'}`,
    `- tempo: ${macroParams.tempo ?? 'n/a'} BPM, meter ${meter.numerator}/${meter.denominator}`,
    `- register center: ${macroParams.register_center ?? 'n/a'}`,
    `- harmonic rhythm: ${harmonicRhythm} chord(s) per bar`,
    `- sections in order: ${sectionList}`,
    `- MOOD: ${macroParams.mood ?? '(unspecified)'}  ← the single most important signal for the phrases' character`,
  ].join('\n');
}

// The harmony block, formatted PER SECTION with PER-BAR chord-tone degrees, so
// the model writes phrases whose strong beats land on chord tones bar-by-bar.
// The final bar carries a "(cadence approach)" annotation: Stage 8 overwrites
// only that bar's LAST TWO BEATS with the cadence voicing, so the phrase's first
// beats of the final bar should LEAD TOWARD the resolution.
function harmonicPlanWithBarChords(harmonicPlan, plan, beatsPerBar) {
  const progressionByLabel = new Map((harmonicPlan?.sections ?? []).map((s) => [s.label, s.progression]));
  const cadenceByLabel = new Map((harmonicPlan?.sections ?? []).map((s) => [s.label, s.cadence]));
  const blocks = plan.map((section) => {
    const progression = progressionByLabel.get(section.label) ?? [];
    const cadence = cadenceByLabel.get(section.label) ?? 'none';
    const header = `Section ${section.label} (${section.bars} bars, ${section.bars * beatsPerBar} beats`
      + `${cadence && cadence !== 'none' ? `, ends with ${cadence} cadence` : ''}):`;
    const barLines = [];
    for (let bar = 1; bar <= section.bars; bar++) {
      const roman = romanForBar(progression, bar);
      if (roman == null) {
        barLines.push(`  bar ${bar}: (no chord supplied)`);
        continue;
      }
      const tones = chordToneDegreesOf(roman);
      const toneStr = tones ? `chord tones at degrees ${tones.join(', ')}` : 'chord tones n/a';
      const tail = bar === section.bars ? '  (cadence approach — see below)' : '';
      barLines.push(`  bar ${bar}: ${roman}  — ${toneStr}${tail}`);
    }
    return [header, ...barLines].join('\n');
  });
  return [
    'HARMONY PER SECTION — write each phrase OVER these chords. A bar\'s STRONG BEATS (the downbeat, and beat 3 '
      + 'in 4/4) should land on that bar\'s CHORD TONES (the degrees listed); passing / neighbor tones go on the '
      + 'weak beats. The FINAL bar of each section is marked "(cadence approach)": Stage 8 will overwrite that '
      + 'bar\'s LAST TWO BEATS with the cadence, so write the first beats of the final bar to LEAD TOWARD the '
      + 'resolution (for a PAC, step down toward degree 1; for a half cadence, step toward 2 or 7; for a phrygian '
      + 'cadence, descend b2 → 1).',
    ...blocks,
  ].join('\n\n');
}

// The role each section plays relative to the others, rendered as compositional
// intent (NOT hard constraints) — the cross-section conditioning that guards
// against the "three disconnected phrases stitched together" failure mode.
function crossSectionRelationships(relationships, plan) {
  const homeLabel = plan.length ? plan[0].label : null;
  const lines = plan.map((s) => {
    const rel = relationships[s.label] ?? {};
    const of = rel.of;
    switch (rel.role) {
      case 'exposition':
        return `${s.label}: STATEMENT — the home identity. Write this phrase FIRST; it sets the piece's character.`;
      case 'repetition':
        return `${s.label}: REPETITION of ${of} — restate ${of} literally or near-literally. Small variations are `
          + `welcome, but the listener should clearly recognize ${of} returning.`;
      case 'contrast':
        return `${s.label}: CONTRAST to ${rel.contrast_from ?? homeLabel ?? 'the A material'} — a different shape, `
          + 'possibly a different register or rhythmic feel. This is the release from the A material; make it '
          + 'clearly distinct.';
      case 'reprise':
        return `${s.label}: REPRISE of ${of} with final closure — restate ${of}'s character, but adapt the tail `
          + 'toward the final cadence. This is the "you remember the opening, and now the piece resolves" moment.';
      case 'varied_reprise':
        return `${s.label}: VARIED REPRISE of ${of} — bring ${of} back, recognizably, but with ornament/variation `
          + 'and a tail that closes the piece.';
      default:
        return `${s.label}: a section — give it a clear, singable identity.`;
    }
  });
  return [
    'CROSS-SECTION INTENT — these phrases are ONE PIECE, not three islands. Honor these relationships as '
      + 'compositional intent (they are not hard-validated, but they are what makes the piece cohere):',
    ...lines,
    'So: write the STATEMENT first as the identity; write any REPETITION to clearly echo it; write the CONTRAST '
      + 'to clearly differ; write the REPRISE to restate the opening with an adapted, closing tail.',
  ].join('\n');
}

function shapeVocabulary() {
  return [
    'SHAPE VOCABULARY — "contour" labels the phrase\'s overall arc. Choose the one that fits; examples are at '
      + 'PHRASE scale (8–16 notes), not cell scale:',
    '  - rising_arc:    starts low, climbs through the phrase to a peak near the end '
      + '(e.g. [1,3,2,4,3,5,4,6,5,7,6,8] across 4 bars).',
    '  - falling_arc:   peak at the start, descends through the phrase.',
    '  - peak_descend:  rises to an interior peak (around 50–70% through), then descends to a low resolution — '
      + 'the most "memorable hook" shape; the peak is the hook moment.',
    '  - valley_ascend: drops to an interior trough, then climbs above it.',
    '  - static:        revolves around a small range — works only for short or repetition-heavy sections.',
    '  - wandering:     no clear single direction — use SPARINGLY; it sounds aimless as a primary shape.',
  ].join('\n');
}

function anomalyVocabulary() {
  return [
    'ANOMALY TYPES — "anomaly" is null, or ONE object {"type": …, "at_position": <index into degrees>}, at most '
      + 'one PER PHRASE and rare overall:',
    '  - chromatic_neighbor: a chromatic passing tone at at_position — genuinely out of the mode; it survives the '
      + 'deterministic chiptune voice-leading pass (a DECLARED anomaly, not a stray accidental). This is the one '
      + 'with real audible effect.',
    '  - large_leap: marks an unusually WIDE leap (a sixth or seventh — adjacent degrees differing by 5+ scale '
      + 'steps). A fourth/fifth leap is ordinary good melody, NOT a large_leap. Cosmetic metadata; use rarely.',
    '  - rhythmic_displacement: marks a syncopation (a note onset off the beat). Cosmetic metadata; use rarely.',
  ].join('\n');
}

// Three PHRASE-scale seed exemplars (4 bars each in 4/4 → rhythm sums to 16).
// Their VALUE is the shape + chord-tone alignment, NOT the literal pitches: each
// exemplar's strong beats sit on the bar's chord tones, with passing/colour tones
// on the weak beats, and the final bar leads into the cadence. Reconciled to the
// hard rhythm-sum rule (every exemplar fills its 4 bars exactly). The model
// writes phrases of comparable IDENTITY in the piece's own mode/length — not copies.
function seedExemplars() {
  return [
    'SEED EXEMPLARS — concrete examples of the kind of PHRASE this project considers good. Note how each one\'s '
      + 'STRONG BEATS (downbeat + beat 3) sit on the bar\'s chord tones, colour tones fall on weak beats, and the '
      + 'final bar leads into the cadence. Write phrases of comparable identity and craft; do NOT copy these.',
    '  • bright major, 4 bars over I–vi–IV–V (a rising arc with a hook):',
    '      degrees: [1,3,5,3, 6,8,3,1, 4,6,8,6, 5,4,3,2]',
    '      rhythm:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1]   (sum 16 = 4 bars)',
    '      contour "rising_arc" — strong beats are chord tones (1/5 over I, 6/3 over vi, 4/8 over IV); the final '
      + 'bar steps 5-4-3-2 down toward the PAC resolution.',
    '  • D dorian, 4 bars over i–VII–IV–i (a peak-descend with the modal colour):',
    '      degrees: [1,2,3,5, 4,5,6,7, 6,5,3,4, 3,2,1,1]',
    '      rhythm:  [0.5,0.5,1,2, 0.5,0.5,1,2, 0.5,0.5,1,2, 1,1,1,1]   (sum 16)',
    '      contour "peak_descend" — the peak is the natural 7 in bar 2 (the dorian colour); the line descends '
      + 'through bars 3–4 to land on the tonic. Note the rhythmic variety (eighths + a held beat-3 note per bar).',
    '  • E phrygian-dominant, 4 bars over I–II–iv–I (the byzantine flavour):',
    '      degrees: [1,2,3,5, 6,8,6,4, 6,5,4,1, 3,2,1,1]',
    '      rhythm:  [0.5,0.5,1,2, 0.5,0.5,1,2, 0.5,0.5,1,2, 1,1,1,1]   (sum 16)',
    '      contour "peak_descend" — the b2 (degree 2) on weak beats in bar 1 is the phrygian-dominant flavour; the '
      + 'peak is the octave (8) in bar 2; the descent through bars 3–4 leads b2 → 1 into the phrygian cadence.',
  ].join('\n');
}

// Rests are PHRASING, not gaps — the punctuation between sub-statements. The
// model decides WHERE they breathe; this block teaches the musical logic so they
// are deliberate, never random (a Session-12 checkpoint finding from Steven).
function restGuidance() {
  return [
    'RESTS — silence is part of phrasing, not empty space, and a phrase that never breathes sounds breathless. '
      + 'MOST phrases should include ONE OR TWO rests. Write a rest as `null` in the "degrees" array (it still takes '
      + 'a duration in "rhythm", like any slot). Place rests the way PUNCTUATION works in a sentence — never randomly:',
    '  - a LONGER rest is a PERIOD / SEMICOLON between sub-statements: make a melodic point, breathe, then make '
      + 'the next (a phrase can be a 4-line "paragraph" — state, rest, answer, rest).',
    '  - a SHORTER rest is a COMMA separating items in a SEQUENCE: a small figure transposed each time, "A, B, C". '
      + 'E.g. a descending sequence with a comma-rest between fragments: degrees [5,4,3, null, 4,3,2, null, 3,2,1, '
      + 'null, …], each fragment a step lower, each null a quick breath.',
    'CRITICAL — put rests in the INTERIOR of the phrase, BETWEEN sub-statements (e.g. after bar 1 or 2, mid-phrase). '
      + 'Do NOT place a rest at the very END of the phrase: the cadence overwrites the final bar\'s last beats, so an '
      + 'end-of-phrase rest is silently replaced and wasted — it is never heard. The breath has to come EARLIER.',
    'Keep it a melody: never mostly silence, and let the first downbeat SOUND. Use rests for shape and '
      + 'memorability, not to pad — but most phrases genuinely want at least one interior breath.',
  ].join('\n');
}

function compositionalGuidance() {
  return [
    'COMPOSITIONAL GUIDANCE — this is the difference between a memorable melody and a scale-walk. Follow it:',
    '  1. EACH PHRASE NEEDS A CLEAR ARC — a beginning, a development, a PEAK (or trough) at an interior point, and '
      + 'a resolution. Peak placement matters: too early and the phrase loses energy; too late and there\'s no room '
      + 'to resolve. A peak around 50–70% through is the "memorable hook" sweet spot.',
    '  2. STRONG BEATS LAND ON CHORD TONES. The bar\'s downbeat MUST be a chord tone of that bar\'s chord; beat 3 '
      + '(in 4/4) should be too where possible. Off-beats may be passing or neighbor tones — colour, not structure. '
      + 'TENDENCY TONES RESOLVE: the leading tone (degree 7) pulls UP to the tonic and the 4th pulls DOWN to the 3rd — '
      + 'do not leave a 7 exposed as an unresolved high peak; if you reach it, resolve it (7→8/1) rather than hanging on it.',
    '  3. THE FINAL BAR\'s first beats are yours; its last two beats get overwritten by the cadence formula. Use '
      + 'the first beats to LEAD INTO the resolution (descend toward ^1 for a PAC; step into ^2/^7 for a half '
      + 'cadence; descend b2 → 1 for a phrygian cadence).',
    '  4. RHYTHMIC VARIETY IS PART OF MEMORABILITY. A phrase of all equal notes is rhythmically inert. Mix '
      + 'durations — eighths (0.5), quarters (1), dotted quarters (1.5), occasional halves (2) — and let one note '
      + 'breathe, ideally on the peak. The phrase\'s rhythm MUST sum to the section\'s exact beat count.',
    '  5. CROSS-SECTION IDENTITY. The phrases are ONE PIECE (see CROSS-SECTION INTENT). The contrast section '
      + 'differs; the repeated/reprised sections clearly echo the statement. Avoid three self-contained islands.',
  ].join('\n');
}

// The JSON skeleton the model fills in, listing each section label + its exact
// required rhythm-sum (so the model targets the right phrase length).
function schemaSkeleton(plan, beatsPerBar) {
  const lines = plan
    .map(
      (s) =>
        `    ${JSON.stringify(s.label)}: { "degrees": [ … ], "rhythm": [ … sum = ${sectionBeats(s, beatsPerBar)} … ], `
        + '"contour": "…", "register": "…", "anomaly": null }'
    )
    .join(',\n');
  return `{\n  "phrases": {\n${lines}\n  }\n}`;
}

function schemaBlock(plan, beatsPerBar) {
  const labelList = plan.map((s) => JSON.stringify(s.label)).join(', ');
  const sumList = plan.map((s) => `${s.label}=${sectionBeats(s, beatsPerBar)}`).join(', ');
  return [
    'RESPOND WITH ONLY THIS JSON OBJECT — no markdown fences, no commentary before or after:',
    '',
    schemaSkeleton(plan, beatsPerBar),
    '',
    'REQUIREMENTS:',
    `- Use these EXACT keys under "phrases": ${labelList} — one phrase object each, nothing more, nothing less.`,
    `- "degrees": an array of ${DEGREES_MIN}–${DEGREES_MAX} entries. A SOUNDED note is a non-zero integer scale `
      + 'degree (1–7 in-octave; 8 the tonic an OCTAVE above, 9 the ninth, …; NEGATIVE degrees below the tonic), '
      + `within [${DEGREE_VALUE_MIN}, ${DEGREE_VALUE_MAX}]. A REST is \`null\`. Keep at least ${SOUNDED_NOTES_MIN} sounded `
      + 'notes — the phrase is a melody, not silence.',
    '- "rhythm": an array of positive numbers (beats), the SAME LENGTH as "degrees". Its sum MUST EXACTLY equal '
      + `the section's beat count: ${sumList}. The phrase fills its section — no gaps inside it.`,
    '- "contour": one of the six shape names.',
    '- "register": "low" | "mid" | "high" (a placement hint for the realizer).',
    `- "anomaly": null, or {"type": one of ${ANOMALY_TYPES.join(' | ')}, "at_position": an integer index into `
      + '"degrees"}. At most one per phrase, rare overall.',
  ].join('\n');
}

/**
 * Build the Stage 4 prompt as { system, user }. Pure (no I/O), so the inspector
 * can display it and the verifier can assert on it.
 */
export function buildMotifsPrompt({ macroParams, harmonicPlan, config }) {
  const plan = computeSectionPlan(macroParams);
  const beatsPerBar = beatsPerBarOf(macroParams.meter);
  const relationships = sectionRelationshipsForPlan(macroParams, plan);
  const adventurousness = phraseAdventurousnessOf(config);

  const system =
    'You are a composer writing the melodic phrases for a chiptune jingle. You write ONE phrase per section, each '
    + 'authored directly over that section\'s harmonic progression so that strong beats land on chord tones. Your '
    + 'output is a strict JSON object matching the given schema; no commentary.';

  const user = [
    pieceSummary(macroParams, plan),
    harmonicPlanWithBarChords(harmonicPlan, plan, beatsPerBar),
    crossSectionRelationships(relationships, plan),
    shapeVocabulary(),
    anomalyVocabulary(),
    seedExemplars(),
    compositionalGuidance(),
    restGuidance(),
    `PHRASE ADVENTUROUSNESS — ${adventurousness}:\n  ${PHRASE_ADVENTUROUSNESS_DIRECTIVE[adventurousness]}`,
    schemaBlock(plan, beatsPerBar),
  ].join('\n\n');

  return { system, user };
}

function buildRetryPrompt(errors) {
  return [
    'The JSON you returned did not pass validation. Fix these specific problems and return the corrected JSON '
      + 'object — the full phrases object, same schema, no commentary:',
    '',
    errors.map((e) => `- ${e}`).join('\n'),
    '',
    'Return ONLY the corrected JSON object.',
  ].join('\n');
}

// =================================================================
// LLM CALL — mimics js/jingle/api.js's fetch / headers / error-handling shape.
// =================================================================

async function callPhrasesLLM(system, messages) {
  return postMessages(
    { model: STAGE_4_MODEL, max_tokens: STAGE_4_MAX_TOKENS, system, messages },
    'Stage 4'
  );
}

// Strip code fences (if the model wrapped the JSON) and parse, with a brace-match
// fallback. Logs the raw response and throws clearly on failure.
function parsePhrasesResponse(raw) {
  const cleaned = String(raw)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (secondError) {
        /* fall through to the throw below */
      }
    }
    console.error('Stage 4: could not parse the model response as JSON. Raw response:\n', raw);
    throw new Error('Stage 4: model response was not valid JSON (see console for the raw response).');
  }
}

// =================================================================
// CONTOUR CONSISTENCY (net-directional, length-agnostic) — used only for SOFT
// warnings. Contour is descriptive metadata (Stage 6 realizes the degrees, not
// the label), so a mislabel is cosmetic; this returns an error string or null.
// The rules allow wiggles on the way up/down (a phrase is not a strict monotone).
// =================================================================

function contourConsistencyError(degrees, contour, label) {
  const first = degrees[0];
  const last = degrees[degrees.length - 1];
  const heights = degrees.map(degreeToLinear);
  const maxH = Math.max(...heights);
  const minH = Math.min(...heights);
  const firstH = degreeToLinear(first);
  const lastH = degreeToLinear(last);

  switch (contour) {
    case 'rising_arc':
      if (!(lastH > firstH)) {
        return `Phrase "${label}" is labeled rising_arc but its last degree (${last}) does not rise above its first (${first}).`;
      }
      return null;
    case 'falling_arc':
      if (!(lastH < firstH)) {
        return `Phrase "${label}" is labeled falling_arc but its last degree (${last}) is not below its first (${first}).`;
      }
      return null;
    case 'peak_descend': {
      const peakIdx = heights.indexOf(maxH);
      if (!(peakIdx > 0 && peakIdx < heights.length - 1)) {
        return `Phrase "${label}" is labeled peak_descend but its highest point is not at an interior position.`;
      }
      if (!(firstH < maxH && lastH < maxH)) {
        return `Phrase "${label}" is labeled peak_descend but it does not both rise to its peak and end below it.`;
      }
      return null;
    }
    case 'valley_ascend': {
      const valleyIdx = heights.indexOf(minH);
      if (!(valleyIdx > 0 && valleyIdx < heights.length - 1)) {
        return `Phrase "${label}" is labeled valley_ascend but its lowest point is not at an interior position.`;
      }
      if (!(firstH > minH && lastH > minH)) {
        return `Phrase "${label}" is labeled valley_ascend but it does not both fall to its trough and end above it.`;
      }
      return null;
    }
    case 'static':
      if (maxH - minH > 2) {
        return `Phrase "${label}" is labeled static but its range spans more than 3 consecutive degrees.`;
      }
      return null;
    case 'wandering':
    default:
      return null;
  }
}

// =================================================================
// VALIDATION — validateMotifs checks the WRAPPED phrases envelope. Exported so
// verify-stage4.mjs can stress-test it without re-deriving the logic. Collects
// ALL defects in one pass so the single retry sees them together. Returns
// { ok, errors, warnings }: HARD defects → errors (retry-triggering); SOFT notes
// → warnings (emitted via onTrace, never a failure).
//
// `harmonicPlan` (optional 3rd arg) enables the SOFT strong-beat chord-fit check;
// absent it (the 2-arg form), that check is skipped — back-compatible.
// =================================================================

// Validate one phrase object. Pushes every HARD defect via `push`; returns
// { degrees, rhythm, shapeComplete } so the caller's soft checks can skip
// malformed entries (already flagged) instead of operating on `undefined`s.
function validateOnePhrase(phrase, label, expectedBeats, push) {
  const blank = { degrees: undefined, rhythm: undefined, shapeComplete: false };
  if (!phrase || typeof phrase !== 'object' || Array.isArray(phrase)) {
    push(`Phrase "${label}" must be an object with degrees, rhythm, contour, register, anomaly.`);
    return blank;
  }

  const { degrees, rhythm, contour, register, anomaly } = phrase;

  // degrees — array of 8..32 SLOTS (a sounded note is a non-zero int in [-8, 14];
  // `null` is a rest). The phrase must still be a melody, not mostly silence.
  if (!Array.isArray(degrees) || degrees.length < DEGREES_MIN || degrees.length > DEGREES_MAX) {
    push(
      `Phrase "${label}" degrees must be an array of ${DEGREES_MIN}–${DEGREES_MAX} entries (a phrase, not a cell), `
        + `got ${Array.isArray(degrees) ? `length ${degrees.length}` : JSON.stringify(degrees)}.`
    );
  } else {
    degrees.forEach((d, i) => {
      if (d !== null && (!Number.isInteger(d) || d === 0 || d < DEGREE_VALUE_MIN || d > DEGREE_VALUE_MAX)) {
        push(
          `Phrase "${label}" degrees[${i}] must be null (a rest) or a non-zero integer in [${DEGREE_VALUE_MIN}, `
            + `${DEGREE_VALUE_MAX}] (1–7 in-octave; 8 the octave above the tonic, negatives below it), got ${JSON.stringify(d)}.`
        );
      }
    });
    const sounded = degrees.filter((d) => d !== null).length;
    if (sounded < SOUNDED_NOTES_MIN) {
      push(
        `Phrase "${label}" has only ${sounded} sounded note(s) — a phrase must be mostly notes, not silence `
          + `(at least ${SOUNDED_NOTES_MIN}). Rests (null) are punctuation between sub-statements, not the substance.`
      );
    }
  }

  // rhythm — same length as degrees, positive numbers, SUM EQUALS expectedBeats
  let rhythmOk = true;
  if (!Array.isArray(rhythm)) {
    push(`Phrase "${label}" rhythm must be an array of positive beat values.`);
    rhythmOk = false;
  } else {
    if (Array.isArray(degrees) && rhythm.length !== degrees.length) {
      push(
        `Phrase "${label}" rhythm length (${rhythm.length}) must equal degrees length (${degrees.length}) — one duration per note.`
      );
      rhythmOk = false;
    }
    rhythm.forEach((b, i) => {
      if (typeof b !== 'number' || !Number.isFinite(b) || b <= 0) {
        push(`Phrase "${label}" rhythm[${i}] must be a positive number of beats, got ${JSON.stringify(b)}.`);
        rhythmOk = false;
      }
    });
    if (rhythmOk) {
      const sum = rhythm.reduce((total, b) => total + b, 0);
      if (Math.abs(sum - expectedBeats) > RHYTHM_SUM_EPSILON) {
        push(
          `Phrase "${label}" rhythm sums to ${Number(sum.toFixed(3))} beats but its section is ${expectedBeats} beats `
            + '— the phrase must fill its section exactly (sum the rhythm to the section\'s beat count).'
        );
      }
    }
  }

  // contour — must be one of CONTOURS (schema, hard). Whether the LABEL matches
  // the trajectory is a SOFT warning (the degrees are the melody; the label is a hint).
  if (!CONTOURS.includes(contour)) {
    push(`Phrase "${label}" contour ${JSON.stringify(contour)} is not one of: ${CONTOURS.join(', ')}.`);
  }

  // register — one of REGISTERS
  if (!REGISTERS.includes(register)) {
    push(`Phrase "${label}" register ${JSON.stringify(register)} is not one of: ${REGISTERS.join(', ')}.`);
  }

  // anomaly — null, or { type ∈ ANOMALY_TYPES, at_position ∈ [0, degrees.length-1] }. SCHEMA only.
  if (anomaly === undefined) {
    push(`Phrase "${label}" must include an "anomaly" field (use null when there is no anomaly).`);
  } else if (anomaly !== null) {
    if (typeof anomaly !== 'object' || Array.isArray(anomaly)) {
      push(`Phrase "${label}" anomaly must be null or an object {"type", "at_position"}.`);
    } else {
      if (!ANOMALY_TYPES.includes(anomaly.type)) {
        push(`Phrase "${label}" anomaly.type ${JSON.stringify(anomaly.type)} is not one of: ${ANOMALY_TYPES.join(', ')}.`);
      }
      const maxIndex = Array.isArray(degrees) && degrees.length > 0 ? degrees.length - 1 : 0;
      const pos = anomaly.at_position;
      if (!Number.isInteger(pos) || pos < 0 || (Array.isArray(degrees) && pos > maxIndex)) {
        push(
          `Phrase "${label}" anomaly.at_position must be an integer index into degrees, in [0, ${maxIndex}], got ${JSON.stringify(pos)}.`
        );
      }
    }
  }

  return {
    degrees,
    rhythm,
    shapeComplete: Array.isArray(degrees) && Array.isArray(rhythm) && degrees.length === rhythm.length,
  };
}

/**
 * Validate the WRAPPED phrases envelope `{ phrases: { <label>: { … } } }` against
 * `macroParams` (and, optionally, `harmonicPlan` for the soft chord-fit check).
 * Returns { ok, errors, warnings }; `ok` is true only when `errors` is empty.
 * Collects ALL hard defects in one pass so the single retry sees them together.
 */
export function validateMotifs(wrapped, macroParams, harmonicPlan = undefined) {
  const errors = [];
  const warnings = [];
  const push = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) {
    return { ok: false, errors: ['Phrases must be a JSON object.'], warnings };
  }
  const phrases = wrapped.phrases;
  if (!phrases || typeof phrases !== 'object' || Array.isArray(phrases)) {
    return { ok: false, errors: ['Phrases.phrases must be an object keyed by section label.'], warnings };
  }

  let plan;
  try {
    plan = computeSectionPlan(macroParams);
  } catch (error) {
    return { ok: false, errors: [`Could not derive the section plan from macroParams: ${error.message}`], warnings };
  }
  const beatsPerBar = beatsPerBarOf(macroParams.meter);
  const labels = plan.map((s) => s.label);
  const beatsByLabel = new Map(plan.map((s) => [s.label, sectionBeats(s, beatsPerBar)]));
  const expected = new Set(labels);

  // (b) Cross-section coverage (HARD) — exactly one phrase per section, no extras.
  for (const label of labels) {
    if (!Object.prototype.hasOwnProperty.call(phrases, label)) {
      push(`Missing phrase for section "${label}" (this form needs a phrase for each of: ${labels.join(', ')}).`);
    }
  }
  for (const name of Object.keys(phrases)) {
    if (!expected.has(name)) {
      push(`Unexpected phrase "${name}" — not a section in this form (expected: ${labels.join(', ')}).`);
    }
  }

  // (a) Per-phrase schema + rhythm-sum (HARD). Keep the shape-complete phrases for the soft passes.
  const complete = new Map();
  for (const label of labels) {
    if (!Object.prototype.hasOwnProperty.call(phrases, label)) continue; // already flagged as missing
    const summary = validateOnePhrase(phrases[label], label, beatsByLabel.get(label), push);
    if (summary.shapeComplete) complete.set(label, phrases[label]);
  }

  // (e) Contour consistency + (f) anomaly accuracy — SOFT. Contour is the shape of
  // the SOUNDED notes, so rests (null) are filtered out first.
  for (const [label, phrase] of complete) {
    const sounded = phrase.degrees.filter((d) => d !== null);
    if (CONTOURS.includes(phrase.contour) && sounded.length >= 2 && sounded.every((d) => Number.isInteger(d) && d !== 0)) {
      const message = contourConsistencyError(sounded, phrase.contour, label);
      if (message) warn(`${message} (soft note — the degrees are the melody; the label is only a hint.)`);
    }
    anomalyRealityWarning(phrase, label, warn);
  }

  // (c) Cross-section relationships — SOFT.
  crossSectionRelationshipWarnings(complete, plan, warn);

  // (d) Strong-beat chord-fit — SOFT (only when a harmonicPlan is supplied).
  if (harmonicPlan) {
    chordFitWarnings(complete, plan, beatsPerBar, harmonicPlan, warn);
  }

  return { ok: errors.length === 0, errors, warnings };
}

// SOFT: a declared large_leap / rhythmic_displacement that isn't real ("anomaly
// theater"). These two types have no audible realization downstream (only
// chromatic_neighbor bends a note), so a mislabel is cosmetic — flag it, never reject.
function anomalyRealityWarning(phrase, label, warn) {
  const anomaly = phrase?.anomaly;
  if (!anomaly || typeof anomaly !== 'object') return;
  const pos = anomaly.at_position;
  if (!Number.isInteger(pos)) return;
  const { degrees, rhythm } = phrase;

  if (anomaly.type === 'large_leap' && Array.isArray(degrees) && pos >= 0 && pos < degrees.length && degrees[pos] !== null) {
    const adjacent = [];
    if (pos - 1 >= 0 && degrees[pos - 1] !== null) adjacent.push(Math.abs(degreeToLinear(degrees[pos]) - degreeToLinear(degrees[pos - 1])));
    if (pos + 1 < degrees.length && degrees[pos + 1] !== null) adjacent.push(Math.abs(degreeToLinear(degrees[pos]) - degreeToLinear(degrees[pos + 1])));
    const widest = adjacent.length ? Math.max(...adjacent) : 0;
    if (widest < 5) {
      warn(
        `phrase "${label}" labels a large_leap at position ${pos}, but the widest interval there is only `
          + `${widest} scale step(s) — a 4th/5th leap is good melody, not a large_leap anomaly (soft note).`
      );
    }
  }
  if (
    anomaly.type === 'rhythmic_displacement' && Array.isArray(rhythm) && pos >= 0 && pos < rhythm.length
    && rhythm.slice(0, pos).every((b) => typeof b === 'number' && Number.isFinite(b))
  ) {
    const onset = rhythm.slice(0, pos).reduce((total, b) => total + b, 0);
    if (Math.abs(onset - Math.round(onset)) < 1e-9) {
      warn(
        `phrase "${label}" labels a rhythmic_displacement at position ${pos}, but that note's onset (beat `
          + `${Number(onset.toFixed(3))}) is on the beat — not actually syncopated (soft note).`
      );
    }
  }
}

// SOFT: cross-section relationship checks (the cross-section conditioning is a
// soft net, not a hard gate per the schema-hard / style-soft discipline).
//   - two SAME-letter sections (A1/A2, A1/A3) whose phrases differ at every
//     compared position → "labeled related but share no degrees" warning.
//   - two DIFFERENT-letter sections (A1/B) with IDENTICAL degree sequences →
//     "labeled contrasting but identical" warning.
function crossSectionRelationshipWarnings(complete, plan, warn) {
  const labels = plan.map((s) => s.label).filter((l) => complete.has(l));
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = complete.get(labels[i]);
      const b = complete.get(labels[j]);
      const sameLetter = sectionLetter(labels[i]) === sectionLetter(labels[j]);
      const n = Math.min(a.degrees.length, b.degrees.length);
      if (sameLetter) {
        let shared = 0;
        for (let k = 0; k < n; k++) if (a.degrees[k] === b.degrees[k]) shared++;
        if (n > 0 && shared === 0) {
          warn(
            `sections "${labels[i]}" and "${labels[j]}" are labeled as related (same letter) but their phrases `
              + 'share no degrees in common — consider making the later one echo the earlier (soft note).'
          );
        }
      } else if (JSON.stringify(a.degrees) === JSON.stringify(b.degrees)) {
        warn(
          `sections "${labels[i]}" and "${labels[j]}" are labeled as contrasting but have identical phrases — `
            + 'the contrast section should differ (soft note).'
        );
      }
    }
  }
}

// SOFT: per-bar strong-beat chord-fit. For each bar's downbeat (and beat 3 in
// 4/4), check whether the sounding degree is a chord tone of that bar's chord.
// The final bar's beat 3 is skipped (the cadence overwrites that window). A soft
// nudge: the LLM does its best in-prompt, Stage 5a's guard catches the gross
// placement case, and appoggiaturas on strong beats are legitimate — hard-failing
// every occurrence caused systematic retry-burn in Session 11.
function chordFitWarnings(complete, plan, beatsPerBar, harmonicPlan, warn) {
  const progressionByLabel = new Map((harmonicPlan?.sections ?? []).map((s) => [s.label, s.progression]));
  for (const section of plan) {
    const phrase = complete.get(section.label);
    if (!phrase) continue;
    const progression = progressionByLabel.get(section.label);
    if (!Array.isArray(progression) || progression.length === 0) continue;

    for (let bar = 1; bar <= section.bars; bar++) {
      const roman = romanForBar(progression, bar);
      const tones = chordToneDegreesOf(roman);
      if (!tones) continue;
      const toneSet = new Set(tones);
      const isFinalBar = bar === section.bars;
      const barStart = (bar - 1) * beatsPerBar;

      // Downbeat (every bar).
      const strongOffsets = [barStart];
      // Beat 3 (in 4/4) of every bar EXCEPT the final bar (its second half is the
      // cadence window, overwritten downstream).
      if (beatsPerBar === 4 && !isFinalBar) strongOffsets.push(barStart + 2);

      for (const offset of strongOffsets) {
        const degree = degreeSoundingAt(phrase, offset);
        if (degree == null) continue;
        if (!toneSet.has(inOctaveDegree(degree))) {
          const which = offset === barStart ? 'downbeat' : 'beat 3';
          warn(
            `phrase "${section.label}" bar ${bar} ${which} is degree ${degree} over a ${roman} chord `
              + `(chord tones ${tones.join(', ')}) — a strong beat should be a chord tone (soft note).`
          );
        }
      }
    }
  }
}

// =================================================================
// COUNTING-SLIP FIXUP — the rhythm-sum rule is HARD (a phrase that doesn't fill
// its section breaks Stage 6), but the LLM occasionally miscounts by a beat or so
// and REPEATS the slip on retry, throwing away the whole 3-call run over one beat.
// So a SMALL miss is snapped deterministically to the exact section length by
// adjusting the FINAL note's duration — the phrase's last beats are overwritten by
// the cadence formula anyway, so lengthening/trimming the final note is musically
// harmless. A GROSS miss (the model misread the section length) still fails
// validation. Same spirit as Stage 3's single-bar [n] normalization. Mutates the
// parsed object in place (it is local to the call) and returns soft notes.
// =================================================================

const MAX_RHYTHM_FIXUP = 2; // beats — a counting slip, not a structural misread

function normalizePhraseSums(parsed, plan, beatsPerBar) {
  const notes = [];
  if (!parsed || typeof parsed !== 'object' || !parsed.phrases || typeof parsed.phrases !== 'object') {
    return notes;
  }
  for (const section of plan) {
    const phrase = parsed.phrases[section.label];
    if (!phrase || typeof phrase !== 'object' || !Array.isArray(phrase.rhythm) || phrase.rhythm.length === 0) continue;
    if (!phrase.rhythm.every((b) => typeof b === 'number' && Number.isFinite(b) && b > 0)) continue;
    const target = sectionBeats(section, beatsPerBar);
    const sum = phrase.rhythm.reduce((total, b) => total + b, 0);
    const miss = target - sum; // > 0 too short; < 0 too long
    if (Math.abs(miss) <= RHYTHM_SUM_EPSILON) continue; // already exact
    if (Math.abs(miss) > MAX_RHYTHM_FIXUP) continue; // gross misread — let validation fail
    const newRhythm = [...phrase.rhythm];
    const lastIdx = newRhythm.length - 1;
    // Prefer adjusting the FINAL note (the cadence overwrites its tail). If that
    // can't absorb the change (an over-shoot bigger than the final note, e.g. a
    // [1,1,2,1,1,1,1,1] = 9 over an 8-beat section), trim the LONGEST note instead.
    if (newRhythm[lastIdx] + miss > 0) {
      newRhythm[lastIdx] = Number((newRhythm[lastIdx] + miss).toFixed(6));
    } else {
      let longestIdx = 0;
      for (let i = 1; i < newRhythm.length; i++) if (newRhythm[i] > newRhythm[longestIdx]) longestIdx = i;
      if (newRhythm[longestIdx] + miss <= 0) continue; // even the longest can't absorb it — let validation fail
      newRhythm[longestIdx] = Number((newRhythm[longestIdx] + miss).toFixed(6));
    }
    parsed.phrases[section.label] = { ...phrase, rhythm: newRhythm };
    notes.push(
      `phrase "${section.label}" rhythm summed to ${Number(sum.toFixed(3))} beats; snapped to the section's ${target} `
        + 'by adjusting one note (a counting-slip fixup, not a retry).'
    );
  }
  return notes;
}

// Unwrap the validated envelope into the flat §3 phrase map the pipeline consumes.
function unwrapPhrases(wrapped) {
  return wrapped.phrases;
}

// =================================================================
// THE STAGE — generateMotifs
// =================================================================

/**
 * Generate the per-section phrase map for the supplied upstream context. Returns
 * the flat `{ <section_label>: { degrees, rhythm, contour, register, anomaly } }`
 * map Stages 5a / 5b / 6 consume.
 *
 * Modes:
 *   - Live: builds the prompt, calls the LLM, validates; on validation failure it
 *     retries ONCE with the specific errors fed back, then throws if still invalid.
 *   - Offline: pass `__mockResponse` (a JSON string) to skip the network and run
 *     that string through the same parse + validate path — how verify-stage4.mjs
 *     exercises the stage without an API call.
 *
 * `onTrace`, if supplied, is called once per model round-trip (or the mock) with
 * `{ attempt, raw, ok, errors }`, and once more after a successful result with
 * `{ attempt: 'soft-note', warnings }` IF any soft warnings fired (chord-fit,
 * cross-section, contour, anomaly). Diagnostics, not failures; never required.
 */
export async function generateMotifs({
  macroParams,
  harmonicPlan,
  config,
  __mockResponse,
  onTrace,
} = {}) {
  if (!macroParams) throw new Error('generateMotifs requires macroParams.');

  const { system, user } = buildMotifsPrompt({ macroParams, harmonicPlan, config });
  const trace = typeof onTrace === 'function' ? onTrace : () => {};

  // The section plan + meter for the counting-slip fixup (skip the fixup if
  // macroParams can't produce a plan — validateMotifs will report that defect).
  let plan = null;
  let beatsPerBar = beatsPerBarOf(macroParams.meter);
  try {
    plan = computeSectionPlan(macroParams);
  } catch (error) {
    plan = null;
  }
  // Parse, then snap any small rhythm-sum miss to exact (returns soft notes).
  const parseAndFix = (raw, fixupNotes) => {
    const parsed = parsePhrasesResponse(raw); // throws clearly on bad JSON
    if (plan) fixupNotes.push(...normalizePhraseSums(parsed, plan, beatsPerBar));
    return parsed;
  };

  const emitSoftWarnings = (warns) => {
    if (warns && warns.length > 0) {
      trace({ attempt: 'soft-note', raw: null, ok: true, errors: [], warnings: warns });
      for (const warning of warns) console.warn(`Stage 4 (soft): ${warning}`);
    }
  };

  // --- Offline / deterministic fallback: same parse + fixup + validate, no network. ---
  if (__mockResponse !== undefined) {
    const fixupNotes = [];
    const parsed = parseAndFix(__mockResponse, fixupNotes);
    const result = validateMotifs(parsed, macroParams, harmonicPlan);
    trace({ attempt: 0, raw: __mockResponse, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 4: mock response failed validation. Raw:\n', __mockResponse);
      throw new Error(`Stage 4: mock phrases are invalid:\n  - ${result.errors.join('\n  - ')}`);
    }
    emitSoftWarnings([...fixupNotes, ...result.warnings]);
    return unwrapPhrases(parsed);
  }

  // --- Live path: call, fix up, validate, retry once with the errors fed back. ---
  const messages = [{ role: 'user', content: user }];
  const fixupNotes = [];
  let raw = await callPhrasesLLM(system, messages);
  let result;
  let parsed;
  try {
    parsed = parseAndFix(raw, fixupNotes);
    result = validateMotifs(parsed, macroParams, harmonicPlan);
  } catch (parseError) {
    result = { ok: false, errors: [parseError.message], warnings: [] };
  }
  trace({ attempt: 1, raw, ok: result.ok, errors: result.errors });

  if (!result.ok) {
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: buildRetryPrompt(result.errors) });
    raw = await callPhrasesLLM(system, messages);
    parsed = parseAndFix(raw, fixupNotes); // throws clearly if still unparseable
    result = validateMotifs(parsed, macroParams, harmonicPlan);
    trace({ attempt: 2, raw, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 4: phrases failed validation after one retry. Raw:\n', raw);
      throw new Error(`Stage 4: phrases are invalid after one retry:\n  - ${result.errors.join('\n  - ')}`);
    }
  }

  emitSoftWarnings([...fixupNotes, ...result.warnings]);
  return unwrapPhrases(parsed);
}
