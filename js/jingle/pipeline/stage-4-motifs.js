/* =================================================================
   STAGE 4 — MOTIVIC MATERIAL (buildplan Session 10 — THIRD LLM STAGE,
   the melodic-DNA pressure point).

   This is the stage that writes the actual melodies. Sessions 1–9 built the
   deterministic back-half (Stages 6/7/8 + theory), the texture choreography
   (Stage 5b), and the phrase placement (Stage 5a) — all of which exist so
   the motifs THIS stage generates can shine through. Steven's standing
   aesthetic bar ("more creative / soulful / memorable melodies") is met or
   missed here. Architecturally this is the third worked instance of the
   LLM-stage template (sibling of Stage 5a / Stage 5b): prompt-building
   separated from the fetch, a wrapped LLM envelope unwrapped to the flat
   inter-stage shape at the seam, all-defects-in-one-pass validation, a
   validate-then-retry-once loop, and a `__mockResponse` offline fallback the
   verifier uses. The differentiator is entirely in the PROMPT — how it coaches
   the model toward shapes that read as melodic hooks rather than scale-walks —
   and in the validator's motif-integrity rules.

     generateMotifs({ macroParams, harmonicPlan, config,
                      __mockResponse?, onTrace? }) → motifs

   THE TWO SHAPES (and why they differ). The LLM emits — and validateMotifs
   checks — the WRAPPED envelope `{ motifs: { <name>: { … } } }`. A top-level
   `motifs` key is clearer for the model and matches the Session-8/9 envelope
   idiom. The canonical inter-stage Motifs map (buildplan §3, what Stages 4–9
   consume, what the hand-supplied inspector cases use) is FLAT:
   `{ <name>: { … } }`. So generateMotifs validates the wrapped envelope, then
   UNWRAPS `.motifs` and returns the flat map. `input.motifs` is one consistent
   shape whether hand-supplied or generated.

   OUTPUT (flat motifs map, exactly what Sessions 4–9 already consume):
     {
       <name>: {
         degrees:  [int, …],     // 4–8 entries, each in [1, 7]; NO octave here
         rhythm:   [number, …],  // same length; positive beats; sum 1.5–3.5
         contour:  one of CONTOURS (must match the degree trajectory),
         register: "low" | "mid" | "high",
         anomaly:  null | { type, at_position }   // ≤ 1 per motif
       },
       …
     }
   where <name> is a short letter (a, b, c, …) matching the letters used in the
   form's section labels (AABA → a + b; ABCA → a + b + c).

   ANOMALY KEY = `at_position` (NOT `position`). The Session-10 kickoff sketch
   wrote `position`, but its binding requirement is "exactly what Sessions 4–9
   already consume", and the actual consumer — Stage 6's realizeLeadAssignment
   (stage-6-voice.js) — reads `anomaly.at_position` to realize the chromatic
   bend, as do buildplan §3 and the Stage 5a/5b motif summaries. Emitting
   `position` would silently drop the anomaly at realization, defeating the
   point of declaring it. So Stage 4 emits `at_position` end to end.

   OFFLINE / DETERMINISTIC FALLBACK. Pass `__mockResponse` (a JSON string) to
   skip the network and run that string through the SAME parse + validate path
   as a real response. This is how verify-stage4.mjs exercises the stage
   without an API call.

   API. Same call shape as Stage 5a/5b / js/jingle/api.js: POST the Anthropic
   Messages body to API_ENDPOINT, force JSON-only by instruction, strip code
   fences, parse with a brace-match fallback. The model is pinned to the one
   the /api/generate allow-list permits, so both runtime modes work without a
   server change.

   PORTABILITY. This is pipeline/ code: it may import theory/ and js/env.js. It
   does NOT modify api.js (read-only this session) — it mimics its patterns.
   ================================================================= */
import { postMessages } from './llm-call.js';
import { CONTOURS, REGISTERS, degreeToLinear } from '../theory/motif.js';
import { computeSectionPlan } from './stage-6-voice.js';

// The /api/generate allow-list only permits this model (see
// functions/api/generate.js ALLOWED_MODELS); api.js + Stages 5a/5b use the
// same one. Pinning it keeps the deployed proxy path AND the artifact direct
// path working without a server change. A model upgrade is a coordinated
// allow-list change (Session 12+).
const STAGE_4_MODEL = 'claude-sonnet-4-20250514';
const STAGE_4_MAX_TOKENS = 2000;

const EPSILON = 1e-9;

// The motif's rhythm must sum into this window — a singable cell for the short
// (~32-beat) arrival-jingle context. Below it the motif is a fragment; above it
// the motif eats too much of the jingle. (See [[jingle-length-cap-32-beats]].)
const RHYTHM_SUM_MIN = 1.5;
const RHYTHM_SUM_MAX = 4.0; // one bar in 4/4 — the natural max for a motif placed per bar
const DEGREES_MIN = 4;
const DEGREES_MAX = 8;
// Degree VALUES use the buildplan §3 octave-displacement convention: 1–7 are
// in-octave; 8 is the tonic an OCTAVE above (9 the ninth above, …); negatives are
// below the tonic (−2 the leading tone below, −3 the sixth below). 0 is not a
// degree. Bounded so a motif stays singable and realizes in a sane register (~an
// octave below the tonic to ~a twelfth above). This restores the §3 range the
// Session-10 prompt wrongly narrowed to [1, 7] — the hand-supplied motifs (e.g.
// Wanderer's b = [5,7,8,7,5]) already reach the octave, so generated motifs were
// MORE restricted than the fixtures.
const DEGREE_VALUE_MIN = -8;
const DEGREE_VALUE_MAX = 14;

// The three declared rule-breakers a motif may carry (buildplan §3 anomaly
// slot). Kept as a Set so the listing the prompt shows and what validation
// accepts share one source.
const ANOMALY_TYPES = ['chromatic_neighbor', 'large_leap', 'rhythmic_displacement'];

// =================================================================
// ADVENTUROUSNESS — the freedom knob this stage reads (config.knobs.
// motif_adventurousness ∈ {tame, adventurous, wild}). Only the ACTIVE level's
// directive is printed, to keep the steer sharp. Modeled on Sessions 8/9.
// =================================================================

const MOTIF_ADVENTUROUSNESS_DIRECTIVE = {
  tame:
    'Write conjunct, stepwise motifs with simple, legible shapes — the kind a beginner would write: '
    + 'singable but predictable. Keep intervals small (mostly steps, the odd third); favor rising_arc or '
    + 'falling_arc. Use NO anomalies.',
  adventurous:
    'Use larger intervals — at least one real leap of a fourth or fifth somewhere in the set (this is good '
    + 'melodic writing, NOT an anomaly: leave anomaly null for it). At least one motif must have a clear arc '
    + '(rising_arc or peak_descend) with a genuine high point — reaching up to the octave (degree 8) or just beyond '
    + 'for a soaring peak is welcome. Do NOT let a motif be merely a triad arpeggiated up '
    + 'or down: give at least one a memorable hook — a stepwise non-chord passing tone between chord tones, a '
    + 'distinctive leap, or a syncopated rhythm. Differentiate the motifs in contour AND rhythm (do not reuse one '
    + 'rhythm for every motif). Anomalies are optional and at most ONE across the set — prefer none unless a '
    + 'chromatic_neighbor colour tone genuinely fits.',
  wild:
    'Reach for bolder shapes — wide leaps, byzantine flourishes, contour types deliberately NOT symmetric '
    + 'across the motifs. If the mode offers colour degrees (a b2, #4, raised 7, natural 6, …) lean on them. A '
    + 'chromatic_neighbor anomaly is encouraged; you may use up to one anomaly PER motif. Surprise is welcome — '
    + 'but every motif must still be a singable phrase with a clear identity, not a random scramble.',
};
const DEFAULT_MOTIF_ADVENTUROUSNESS = 'adventurous';

function motifAdventurousnessOf(config) {
  const value = config?.knobs?.motif_adventurousness;
  return value in MOTIF_ADVENTUROUSNESS_DIRECTIVE ? value : DEFAULT_MOTIF_ADVENTUROUSNESS;
}

// =================================================================
// REQUIRED MOTIFS — which letters the piece needs, derived from the form's
// section labels (AABA → a + b; ABCA → a + b + c; ternary_varied A/B/A' → a + b).
// computeSectionPlan is the single source of truth for the labels, exactly as
// Stages 5a/5b/6 use it — so "what sections exist" can't drift between stages.
// =================================================================

// The motif letter a section label maps to: its leading alphabetic run,
// lowercased ("A1" → a, "A'" → a, "B" → b, "C" → c).
function letterOfLabel(label) {
  const match = String(label).match(/^[A-Za-z]+/);
  return (match ? match[0] : String(label)).toLowerCase();
}

// The ordered, de-duplicated set of motif letters the form needs.
function requiredMotifLetters(macroParams) {
  const plan = computeSectionPlan(macroParams);
  const letters = [];
  for (const section of plan) {
    const letter = letterOfLabel(section.label);
    if (!letters.includes(letter)) letters.push(letter);
  }
  return letters;
}

// =================================================================
// PROMPT BUILDING — kept separate from the fetch (so the inspector can display
// it and the verifier can assert on it). Returns { system, user }.
//
// THE MUSICAL-QUALITY DIFFERENTIATOR lives here: the shape vocabulary, the seed
// exemplars (what "good" looks like for THIS project), and the explicit
// compositional guidance are the difference between a composed melody and a
// scale-walk at a random speed.
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
    `- MOOD: ${macroParams.mood ?? '(unspecified)'}  ← the single most important signal for the motifs' character`,
  ].join('\n');
}

function harmonySummary(harmonicPlan) {
  const sections = harmonicPlan?.sections ?? [];
  if (sections.length === 0) return 'HARMONIC PLAN\n- (none supplied)';
  const lines = sections.map(
    (s) => `  - ${s.label}: ${(s.progression ?? []).join(' ')}  (cadence: ${s.cadence ?? 'none'})`
  );
  return [
    'HARMONIC PLAN (Roman numerals per section — your motifs must FIT this harmony). A motif\'s opening '
      + 'should land on chord tones of its section\'s earlier harmony; its tail should be heading toward the '
      + 'section\'s cadence (the cadence itself is enforced over the final two beats downstream):',
    ...lines,
  ].join('\n');
}

function requiredMotifsSummary(letters, plan) {
  const byLetter = new Map(letters.map((l) => [l, []]));
  for (const section of plan) {
    const letter = letterOfLabel(section.label);
    if (byLetter.has(letter)) byLetter.get(letter).push(`${section.label} (${section.bars} bars)`);
  }
  const lines = letters.map((l) => `  - "${l}": stated/developed in ${byLetter.get(l).join(', ')}`);
  return [
    `REQUIRED MOTIFS — produce EXACTLY ${letters.length} motif(s) under these keys, one each:`,
    ...lines,
  ].join('\n');
}

function shapeVocabulary() {
  return [
    'SHAPE VOCABULARY — "contour" MUST be one of these six AND must match the actual degree trajectory '
      + '(the validator recomputes it from your degrees):',
    '  - rising_arc:    net-rises — the last degree is higher than the first (e.g. [1, 3, 5, 4] in major)',
    '  - falling_arc:   net-falls — the last degree is lower than the first (e.g. [5, 4, 3, 1])',
    '  - peak_descend:  rises to an interior peak, then descends below it (e.g. [1, 5, 4, 2, 1])',
    '  - valley_ascend: falls to an interior trough, then climbs above it (e.g. [5, 3, 1, 3, 5])',
    '  - static:        revolves around one or two pitches; total range ≤ 3 degrees (e.g. [3, 3, 4, 3])',
    '  - wandering:     no clear single arc — use SPARINGLY; it tends to sound aimless',
  ].join('\n');
}

function anomalyVocabulary() {
  return [
    'ANOMALY TYPES — "anomaly" is null, or ONE object {"type": …, "at_position": <index into degrees>}:',
    '  - chromatic_neighbor: a chromatic passing tone at at_position — genuinely out of the mode; it survives '
      + 'the deterministic chiptune voice-leading pass (a DECLARED anomaly, not a stray accidental).',
    '  - large_leap: marks an unusually WIDE leap — a sixth or seventh (the note and an adjacent note differ by 5+ '
      + 'scale steps, e.g. degree 1 next to 6 or 7). A fourth or fifth leap is ordinary good melody, NOT a '
      + 'large_leap — leave anomaly null for those. Optional and rare.',
    '  - rhythmic_displacement: marks a syncopation — a note whose onset lands OFF the beat (give an earlier note '
      + 'a 0.5 or 1.5 duration so this one starts off the beat).',
    'At most ONE anomaly per motif, and most motifs need NONE. The one with real audible effect is '
      + 'chromatic_neighbor (a genuine out-of-mode colour tone); large_leap and rhythmic_displacement only label '
      + 'what the degrees / rhythm already do, so use them sparingly and only when accurate. An anomaly is FLAVOR, '
      + 'not structure (see MOTIF ADVENTUROUSNESS below).',
  ].join('\n');
}

// The four seed exemplars (buildplan Session 6 "bolder demo motifs"). Their
// VALUE is the degree shape + contour identity — what a good hook looks like for
// this project. Two reconciliations vs. the kickoff text, both deliberate:
//   - rhythms are trimmed so each sums to ≤ 3.5 beats (the validator's cap; the
//     Session-6 originals were 4.0-beat one-bar cells). Degrees + contour are
//     preserved; only the last note's duration shortened.
//   - the anomaly uses `at_position` (the key Stage 6 actually reads), not the
//     kickoff sketch's `position`.
// The model is told to write motifs of COMPARABLE identity, not to copy these.
function seedExemplars() {
  return [
    'SEED EXEMPLARS — concrete examples of the kind of shape THIS PROJECT considers good. Write motifs of '
      + 'comparable identity and craft; do NOT copy these verbatim. (Each is shown in its own example mode; you '
      + 'write in the piece\'s mode above.)',
    '  • bright_arpeggio (C major): degrees [1,3,5,4,3,1], rhythm [0.5,0.5,1,0.5,0.5,0.5], contour "peak_descend", '
      + 'register "mid", anomaly null — a classic shape: arpeggio up to the fifth, then stepwise back down.',
    '  • dorian_call (D dorian): degrees [1,3,4,6,5,3], rhythm [0.5,0.5,0.5,1,0.5,0.5], contour "rising_arc", '
      + 'register "mid", anomaly null — reaches the natural 6, the dorian signature, then settles higher than it began.',
    '  • wide_leaps_major (C major): degrees [1,5,3,6,4,1], rhythm [1,0.5,0.5,0.5,0.5,0.5], contour "wandering", '
      + 'register "mid", anomaly null — consonant-but-bold leaps that still outline the triad.',
    '  • byzantine_flourish (E phrygian_dominant): degrees [1,2,3,5,4,2,1], rhythm [0.25,0.25,0.5,0.5,0.5,0.5,1], '
      + 'contour "peak_descend", register "mid", anomaly {"type":"chromatic_neighbor","at_position":2} — the b2-to-3 '
      + 'phrygian-dominant flavor, with one chromatic anomaly.',
  ].join('\n');
}

function compositionalGuidance() {
  return [
    'COMPOSITIONAL GUIDANCE — this is the difference between a melody and a scale-walk. Follow it:',
    '  1. CLEAR CONTOUR. Each motif needs a beginning, a peak or trough, and an ending. Make rising_arc / '
      + 'peak_descend / valley_ascend the PRIMARY shapes; static and wandering are contrast colours, not the default.',
    '  2. END ON A CHORD TONE. End each motif on degree 1, 3, or 5 of its section\'s starting chord so it sits '
      + 'naturally over the harmony. The cadence is enforced over the section\'s final two beats downstream, so the '
      + 'motif\'s tail should head TOWARD the cadence\'s approach — land on a chord tone, not a leading tone left hanging.',
    '  3. DISTINCT MOTIFS MUST SOUND DISTINCT. If motif "a" is a rising_arc starting on degree 1, motif "b" must '
      + 'NOT also be a rising_arc starting on degree 1. Differentiate by contour, register, AND rhythm — do NOT '
      + 'reuse the same rhythm array across motifs.',
    '  4. RHYTHM MATTERS AS MUCH AS PITCH. A motif of all equal notes is rhythmically inert. Mix durations — '
      + 'eighths (0.5), quarters (1), dotted quarters (1.5) — and let one note breathe. Syncopation (the '
      + 'rhythmic_displacement anomaly) is one tool; a well-placed long note is another.',
    '  5. ANOMALIES ARE SCARCE. At most one per motif; under "tame" use none. An anomaly is a single deliberate '
      + 'surprise, never the substance of the motif.',
  ].join('\n');
}

// The JSON skeleton the model fills in, listing each required motif key.
function schemaSkeleton(letters) {
  const lines = letters
    .map(
      (l) =>
        `    ${JSON.stringify(l)}: { "degrees": [ … ], "rhythm": [ … ], "contour": "…", "register": "…", "anomaly": null }`
    )
    .join(',\n');
  return `{\n  "motifs": {\n${lines}\n  }\n}`;
}

function schemaBlock(letters) {
  const keyList = letters.map((l) => JSON.stringify(l)).join(', ');
  return [
    'RESPOND WITH ONLY THIS JSON OBJECT — no markdown fences, no commentary before or after:',
    '',
    schemaSkeleton(letters),
    '',
    'REQUIREMENTS:',
    `- Use these EXACT keys under "motifs": ${keyList} — one motif object each, nothing more, nothing less.`,
    `- "degrees": an array of ${DEGREES_MIN}–${DEGREES_MAX} non-zero integers (scale degrees). 1–7 are in-octave; `
      + '8 is the tonic an OCTAVE above (9 the ninth above, …); NEGATIVE degrees are below the tonic (−2 the leading '
      + 'tone below, −3 the sixth below). Reaching up to the octave (8) or just beyond — or dipping below the tonic — '
      + `is welcome for a soaring or expansive hook. Stay within [${DEGREE_VALUE_MIN}, ${DEGREE_VALUE_MAX}].`,
    `- "rhythm": an array of positive numbers (beats), the SAME LENGTH as "degrees". Its sum MUST be between `
      + `${RHYTHM_SUM_MIN} and ${RHYTHM_SUM_MAX} beats (a singable motif for a short ~32-beat jingle).`,
    '- "contour": one of the six shape names — and it MUST match the degree trajectory.',
    '- "register": "low" | "mid" | "high" (a placement hint for the realizer).',
    `- "anomaly": null, or {"type": one of ${ANOMALY_TYPES.join(' | ')}, "at_position": an integer index into `
      + '"degrees"}. At most one per motif.',
    '- DISTINCT motifs must differ in at least one of {degrees, rhythm, contour}.',
  ].join('\n');
}

/**
 * Build the Stage 4 prompt as { system, user }. Pure (no I/O), so the inspector
 * can display it and the verifier can assert on it.
 */
export function buildMotifsPrompt({ macroParams, harmonicPlan, config }) {
  const plan = computeSectionPlan(macroParams);
  const letters = requiredMotifLetters(macroParams);
  const adventurousness = motifAdventurousnessOf(config);

  const system =
    'You are a composer writing memorable melodic hooks for a chiptune jingle. Each motif you write must work '
    + 'as a singable phrase with a clear shape and a recognizable identity. Your output is a strict JSON object '
    + 'matching the given schema; no commentary.';

  const user = [
    pieceSummary(macroParams, plan),
    harmonySummary(harmonicPlan),
    requiredMotifsSummary(letters, plan),
    shapeVocabulary(),
    anomalyVocabulary(),
    seedExemplars(),
    compositionalGuidance(),
    `MOTIF ADVENTUROUSNESS — ${adventurousness}:\n  ${MOTIF_ADVENTUROUSNESS_DIRECTIVE[adventurousness]}`,
    schemaBlock(letters),
  ].join('\n\n');

  return { system, user };
}

function buildRetryPrompt(errors) {
  return [
    'The JSON you returned did not pass validation. Fix these specific problems and return the '
      + 'corrected JSON object — the full motifs object, same schema, no commentary:',
    '',
    errors.map((e) => `- ${e}`).join('\n'),
    '',
    'Return ONLY the corrected JSON object.',
  ].join('\n');
}

// =================================================================
// LLM CALL — mimics js/jingle/api.js's fetch / headers / error-handling shape.
// =================================================================

async function callMotifsLLM(system, messages) {
  return postMessages(
    { model: STAGE_4_MODEL, max_tokens: STAGE_4_MAX_TOKENS, system, messages },
    'Stage 4'
  );
}

// Strip code fences (if the model wrapped the JSON) and parse, with a brace-match
// fallback. Logs the raw response and throws clearly on failure.
function parseMotifsResponse(raw) {
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
// VALIDATION — validateMotifs checks the WRAPPED LLM envelope. Exported so
// verify-stage4.mjs can stress-test it without re-deriving the logic. Collects
// ALL defects (does not stop at the first), so a retry can address them together.
//
// HARD checks live here (schema, degree range, rhythm length/sum, contour
// consistency, exact key set, distinctness). The SOFT end-on-chord-tone check is
// NOT here — it needs the harmonicPlan, which validateMotifs does not receive;
// it lives in generateMotifs (a warning, never a failure). See chordToneWarnings.
// =================================================================

// Whether a labeled contour is consistent with the degree trajectory. Returns an
// error string, or null when consistent. These are the buildplan Session-10
// rules (b), defined over the raw in-octave degrees (all positive, 1..7, so they
// order monotonically with pitch — no linear conversion needed).
function contourConsistencyError(degrees, contour, name) {
  const first = degrees[0];
  const last = degrees[degrees.length - 1];
  const max = Math.max(...degrees);
  const min = Math.min(...degrees);

  switch (contour) {
    case 'rising_arc':
      if (!(last > first)) {
        return `Motif "${name}" is labeled rising_arc but its last degree (${last}) does not rise above its first (${first}) — a rising_arc must net-rise.`;
      }
      return null;
    case 'falling_arc':
      if (!(last < first)) {
        return `Motif "${name}" is labeled falling_arc but its last degree (${last}) is not below its first (${first}) — a falling_arc must net-fall.`;
      }
      return null;
    case 'peak_descend': {
      // Net shape: rises to an interior peak, then ends below it. Wiggles on the
      // way up or down are allowed — a melody is not a strict monotone, and the
      // prompt itself only says "rises to an interior peak, then descends below
      // it". The validator just checks the label isn't wildly wrong.
      const peakIdx = degrees.indexOf(max);
      if (!(peakIdx > 0 && peakIdx < degrees.length - 1)) {
        return `Motif "${name}" is labeled peak_descend but its highest degree (${max}) is not at an interior position — a peak_descend rises to a peak, then falls back below it.`;
      }
      if (!(first < max && last < max)) {
        return `Motif "${name}" is labeled peak_descend but it does not both rise to its peak (${max}) and end below it (starts ${first}, ends ${last}).`;
      }
      return null;
    }
    case 'valley_ascend': {
      // Net shape: falls to an interior trough, then ends above it. Wiggles are
      // allowed (see peak_descend).
      const valleyIdx = degrees.indexOf(min);
      if (!(valleyIdx > 0 && valleyIdx < degrees.length - 1)) {
        return `Motif "${name}" is labeled valley_ascend but its lowest degree (${min}) is not at an interior position — a valley_ascend falls to a trough, then climbs back above it.`;
      }
      if (!(first > min && last > min)) {
        return `Motif "${name}" is labeled valley_ascend but it does not both fall to its trough (${min}) and end above it (starts ${first}, ends ${last}).`;
      }
      return null;
    }
    case 'static':
      if (max - min > 2) {
        return `Motif "${name}" is labeled static but its range (${min}..${max}) spans more than 3 consecutive degrees.`;
      }
      return null;
    case 'wandering':
      return null;
    default:
      return null; // contour value already flagged elsewhere
  }
}

// Validate one motif object. Pushes every defect via `push`; returns the motif's
// { degrees, rhythm, contour } triple plus a `shapeComplete` flag (degrees +
// rhythm are both arrays) so the cross-motif distinctness check can skip
// malformed entries (already flagged) instead of comparing `undefined`s.
function validateOneMotif(motif, name, push) {
  const blank = { degrees: undefined, rhythm: undefined, contour: undefined, shapeComplete: false };
  if (!motif || typeof motif !== 'object' || Array.isArray(motif)) {
    push(`Motif "${name}" must be an object with degrees, rhythm, contour, register, anomaly.`);
    return blank;
  }

  const { degrees, rhythm, contour, register, anomaly } = motif;

  // degrees — array of 4..8 integers, each in [1, 7]
  let degreesOk = true;
  if (!Array.isArray(degrees) || degrees.length < DEGREES_MIN || degrees.length > DEGREES_MAX) {
    push(
      `Motif "${name}" degrees must be an array of ${DEGREES_MIN}–${DEGREES_MAX} integers, got `
        + `${Array.isArray(degrees) ? `length ${degrees.length}` : JSON.stringify(degrees)}.`
    );
    degreesOk = false;
  } else {
    degrees.forEach((d, i) => {
      if (!Number.isInteger(d) || d === 0 || d < DEGREE_VALUE_MIN || d > DEGREE_VALUE_MAX) {
        push(
          `Motif "${name}" degrees[${i}] must be a non-zero integer in [${DEGREE_VALUE_MIN}, ${DEGREE_VALUE_MAX}] `
            + `(1–7 in-octave; 8 the octave above the tonic, negatives below it), got ${JSON.stringify(d)}.`
        );
        degreesOk = false;
      }
    });
  }

  // rhythm — same length as degrees, positive numbers, sum in [1.5, 3.5]
  let rhythmOk = true;
  if (!Array.isArray(rhythm)) {
    push(`Motif "${name}" rhythm must be an array of positive beat values.`);
    rhythmOk = false;
  } else {
    if (Array.isArray(degrees) && rhythm.length !== degrees.length) {
      push(
        `Motif "${name}" rhythm length (${rhythm.length}) must equal degrees length (${degrees.length}) — one duration per note.`
      );
      rhythmOk = false;
    }
    rhythm.forEach((b, i) => {
      if (typeof b !== 'number' || !Number.isFinite(b) || b <= 0) {
        push(`Motif "${name}" rhythm[${i}] must be a positive number of beats, got ${JSON.stringify(b)}.`);
        rhythmOk = false;
      }
    });
    if (rhythmOk) {
      const sum = rhythm.reduce((total, b) => total + b, 0);
      if (sum < RHYTHM_SUM_MIN - EPSILON || sum > RHYTHM_SUM_MAX + EPSILON) {
        push(
          `Motif "${name}" rhythm sums to ${Number(sum.toFixed(3))} beats — must be between ${RHYTHM_SUM_MIN} `
            + `and ${RHYTHM_SUM_MAX} (a singable motif length for a short jingle).`
        );
      }
    }
  }

  // contour — must be one of CONTOURS (schema, hard). Whether the LABEL matches the
  // degree trajectory is a SOFT warning (contourMismatchWarnings): contour is
  // descriptive metadata — Stage 6 realizes pitches from the degrees, not the label
  // — so a mislabel is cosmetic and must not abort a run.
  if (!CONTOURS.includes(contour)) {
    push(`Motif "${name}" contour ${JSON.stringify(contour)} is not one of: ${CONTOURS.join(', ')}.`);
  }

  // register — one of REGISTERS
  if (!REGISTERS.includes(register)) {
    push(`Motif "${name}" register ${JSON.stringify(register)} is not one of: ${REGISTERS.join(', ')}.`);
  }

  // anomaly — null, or { type ∈ ANOMALY_TYPES, at_position ∈ [0, degrees.length-1] }.
  // SCHEMA only here. Whether a declared large_leap / rhythmic_displacement is REAL
  // is a SOFT warning (anomalyRealityWarnings), not a hard failure: those two have
  // no audible realization downstream (only chromatic_neighbor bends a note), so a
  // mislabel is cosmetic and must never abort a run.
  if (anomaly === undefined) {
    push(`Motif "${name}" must include an "anomaly" field (use null when there is no anomaly).`);
  } else if (anomaly !== null) {
    if (typeof anomaly !== 'object' || Array.isArray(anomaly)) {
      push(`Motif "${name}" anomaly must be null or an object {"type", "at_position"}.`);
    } else {
      if (!ANOMALY_TYPES.includes(anomaly.type)) {
        push(`Motif "${name}" anomaly.type ${JSON.stringify(anomaly.type)} is not one of: ${ANOMALY_TYPES.join(', ')}.`);
      }
      const maxIndex = Array.isArray(degrees) && degrees.length > 0 ? degrees.length - 1 : 0;
      const pos = anomaly.at_position;
      if (!Number.isInteger(pos) || pos < 0 || (Array.isArray(degrees) && pos > maxIndex)) {
        push(
          `Motif "${name}" anomaly.at_position must be an integer index into degrees, in [0, ${maxIndex}], got ${JSON.stringify(pos)}.`
        );
      }
    }
  }

  return {
    degrees,
    rhythm,
    contour,
    shapeComplete: Array.isArray(degrees) && Array.isArray(rhythm),
  };
}

/**
 * Validate the WRAPPED motifs envelope `{ motifs: { <name>: { … } } }` against
 * `macroParams`. Returns { ok, errors: [] }; `ok` is true only when `errors` is
 * empty. Collects ALL defects in one pass so the single retry sees them together.
 */
export function validateMotifs(wrapped, macroParams) {
  const errors = [];
  const push = (message) => errors.push(message);

  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) {
    return { ok: false, errors: ['Motifs must be a JSON object.'] };
  }
  const motifs = wrapped.motifs;
  if (!motifs || typeof motifs !== 'object' || Array.isArray(motifs)) {
    return { ok: false, errors: ['Motifs.motifs must be an object keyed by motif letter.'] };
  }

  let letters;
  try {
    letters = requiredMotifLetters(macroParams);
  } catch (error) {
    return { ok: false, errors: [`Could not derive the required motifs from macroParams: ${error.message}`] };
  }
  const expected = new Set(letters);

  // Exact key set — none missing, none extra.
  for (const letter of letters) {
    if (!Object.prototype.hasOwnProperty.call(motifs, letter)) {
      push(`Missing motif "${letter}" (this form requires motifs: ${letters.join(', ')}).`);
    }
  }
  for (const name of Object.keys(motifs)) {
    if (!expected.has(name)) {
      push(`Unexpected motif "${name}" — not required by this form (required: ${letters.join(', ')}).`);
    }
  }

  // Per-motif schema + contour consistency. Keep the triples of the required,
  // shape-complete motifs for the distinctness pass.
  const triples = new Map();
  for (const name of Object.keys(motifs)) {
    if (!expected.has(name)) continue; // already flagged as unexpected
    const summary = validateOneMotif(motifs[name], name, push);
    if (summary.shapeComplete) triples.set(name, summary);
  }

  // Distinctness (multi-motif sets only): no two may share the exact same
  // { degrees, rhythm, contour } triple.
  if (letters.length > 1) {
    const present = [...triples.entries()];
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const [nameA, a] = present[i];
        const [nameB, b] = present[j];
        const identical =
          JSON.stringify(a.degrees) === JSON.stringify(b.degrees)
          && JSON.stringify(a.rhythm) === JSON.stringify(b.rhythm)
          && a.contour === b.contour;
        if (identical) {
          push(
            `Motifs "${nameA}" and "${nameB}" are identical in degrees, rhythm, AND contour — distinct motifs must `
              + 'differ in at least one of these.'
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// =================================================================
// SOFT END-ON-CHORD-TONE CHECK — a warning, never a failure (the composer-knob
// exists; we respect the LLM's choice). Lives in generateMotifs because it needs
// the harmonicPlan. Heuristic: a motif's last degree should be the root, third,
// or fifth (degree-space) of its section's STARTING chord. Parses only the
// chord's root degree from the Roman numeral — enough for a soft diagnostic
// without dragging the full roman-numeral resolver into this stage.
// =================================================================

const ROMAN_TO_DEGREE = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

// The scale degree (1..7) a Roman numeral is rooted on, ignoring quality,
// accidentals, and extensions. Returns null if it can't parse one.
function chordRootDegree(roman) {
  if (typeof roman !== 'string') return null;
  const core = roman.replace(/^[b#]+/, '').match(/^[ivxIVX]+/);
  if (!core) return null;
  return ROMAN_TO_DEGREE[core[0].toLowerCase()] ?? null;
}

// The root / third / fifth of a triad on `root`, as in-octave degrees (1..7).
function chordToneDegrees(root) {
  const wrap = (step) => ((step % 7) + 7) % 7 + 1; // 0-based step → 1..7 degree
  return [wrap(root - 1), wrap(root + 1), wrap(root + 3)];
}

// Fold any degree (incl. octave displacement / negatives) to its in-octave 1..7,
// so the chord-tone check treats degree 8 (the octave) as the tonic, −3 as the
// sixth, etc.
const inOctaveDegree = (degree) => (((degreeToLinear(degree) % 7) + 7) % 7) + 1;

// Soft warnings when a declared large_leap / rhythmic_displacement isn't real —
// "anomaly theater," a label on ordinary material. These two anomaly types have no
// audible realization (Stage 6 only bends a chromatic_neighbor), so a mislabel is
// cosmetic: flag it, never reject it. A 4th/5th leap is good melody, not a
// large_leap (which is a 6th+: adjacent degrees differing by 5 scale steps).
function anomalyRealityWarnings(flatMotifs) {
  const warnings = [];
  for (const [name, motif] of Object.entries(flatMotifs)) {
    const anomaly = motif?.anomaly;
    if (!anomaly || typeof anomaly !== 'object') continue;
    const pos = anomaly.at_position;
    if (!Number.isInteger(pos)) continue;
    const { degrees, rhythm } = motif;

    if (anomaly.type === 'large_leap' && Array.isArray(degrees) && pos >= 0 && pos < degrees.length) {
      const adjacent = [];
      if (pos - 1 >= 0) adjacent.push(Math.abs(degrees[pos] - degrees[pos - 1]));
      if (pos + 1 < degrees.length) adjacent.push(Math.abs(degrees[pos] - degrees[pos + 1]));
      const widest = adjacent.length ? Math.max(...adjacent) : 0;
      if (widest < 5) {
        warnings.push(
          `motif "${name}" labels a large_leap at position ${pos}, but the widest interval there is only `
            + `${widest} scale step(s) — a 4th/5th leap is good melody, not a large_leap anomaly (soft note).`
        );
      }
    }
    if (
      anomaly.type === 'rhythmic_displacement' && Array.isArray(rhythm) && pos >= 0 && pos < rhythm.length
      && rhythm.slice(0, pos).every((b) => typeof b === 'number' && Number.isFinite(b))
    ) {
      const onset = rhythm.slice(0, pos).reduce((total, b) => total + b, 0);
      if (Math.abs(onset - Math.round(onset)) < EPSILON) {
        warnings.push(
          `motif "${name}" labels a rhythmic_displacement at position ${pos}, but that note's onset (beat `
            + `${Number(onset.toFixed(3))}) is on the beat — not actually syncopated (soft note).`
        );
      }
    }
  }
  return warnings;
}

// Soft warnings when a motif's contour LABEL doesn't match its degree trajectory.
// Contour is descriptive metadata (Stage 6 realizes pitches from the degrees, not
// the label), so a mismatch is cosmetic — flag it, never reject it. Reuses the same
// net-directional shape rules as contourConsistencyError.
function contourMismatchWarnings(flatMotifs) {
  const warnings = [];
  for (const [name, motif] of Object.entries(flatMotifs)) {
    if (!CONTOURS.includes(motif?.contour) || !Array.isArray(motif.degrees)) continue;
    if (!motif.degrees.every((d) => Number.isInteger(d) && d !== 0)) continue;
    const message = contourConsistencyError(motif.degrees, motif.contour, name);
    if (message) warnings.push(`${message} (soft note — the degrees are the melody; the label is only a hint.)`);
  }
  return warnings;
}

// A soft warning when 2+ motifs share the exact same rhythm array. Distinct
// rhythms are what let two motifs read as different ideas rather than the same
// idea re-pitched (the spec allows shared rhythm, so this is a note, not a
// failure). Surfaced in the inspector + console alongside the chord-tone notes.
function rhythmSamenessWarnings(flatMotifs) {
  const names = Object.keys(flatMotifs);
  if (names.length < 2) return [];
  const byRhythm = new Map();
  for (const name of names) {
    const rhythm = flatMotifs[name]?.rhythm;
    if (!Array.isArray(rhythm)) continue;
    const key = JSON.stringify(rhythm);
    if (!byRhythm.has(key)) byRhythm.set(key, []);
    byRhythm.get(key).push(name);
  }
  const warnings = [];
  for (const [key, group] of byRhythm) {
    if (group.length >= 2) {
      warnings.push(
        `motifs ${group.map((g) => `"${g}"`).join(' and ')} share the identical rhythm ${key} — distinct rhythms `
          + 'make motifs more memorable (soft note, not a failure).'
      );
    }
  }
  return warnings;
}

// One soft warning per motif whose last degree is not a chord tone of its
// section's starting chord. Returns [] when the harmony or section plan is
// unavailable (the check simply doesn't run).
function chordToneWarnings(flatMotifs, macroParams, harmonicPlan) {
  const warnings = [];
  let plan;
  try {
    plan = computeSectionPlan(macroParams);
  } catch (error) {
    return warnings;
  }
  const progressionByLabel = new Map((harmonicPlan?.sections ?? []).map((s) => [s.label, s.progression]));
  const checked = new Set();

  for (const section of plan) {
    const letter = letterOfLabel(section.label);
    if (checked.has(letter)) continue; // first section that uses each motif
    const motif = flatMotifs[letter];
    if (!motif || !Array.isArray(motif.degrees) || motif.degrees.length === 0) continue;
    checked.add(letter);

    const progression = progressionByLabel.get(section.label);
    const root = Array.isArray(progression) && progression.length ? chordRootDegree(progression[0]) : null;
    if (root == null) continue;

    const tones = chordToneDegrees(root);
    const rawLast = motif.degrees[motif.degrees.length - 1];
    const lastDegree = inOctaveDegree(rawLast);
    if (!tones.includes(lastDegree)) {
      warnings.push(
        `motif "${letter}" ends on degree ${rawLast}, not a chord tone (${tones.join('/')}) of section `
          + `"${section.label}"'s starting chord ${progression[0]} — it may sit oddly over the harmony `
          + '(soft note, not a failure).'
      );
    }
  }
  return warnings;
}

// Unwrap the validated envelope into the flat §3 motifs map the rest of the
// pipeline consumes.
function unwrapMotifs(wrapped) {
  return wrapped.motifs;
}

// =================================================================
// THE STAGE — generateMotifs
// =================================================================

/**
 * Generate the motif set for the supplied upstream context. Returns the flat
 * `{ <name>: { degrees, rhythm, contour, register, anomaly } }` map Stages 5a /
 * 5b / 6 consume.
 *
 * Modes:
 *   - Live: builds the prompt, calls the LLM, validates; on validation failure
 *     it retries ONCE with the specific errors fed back, then throws if still
 *     invalid.
 *   - Offline: pass `__mockResponse` (a JSON string) to skip the network and run
 *     that string through the same parse + validate path — how verify-stage4.mjs
 *     exercises the stage without an API call.
 *
 * `onTrace`, if supplied, is called once per model round-trip (or the mock) with
 * `{ attempt, raw, ok, errors }`, and once more after a successful result with
 * `{ attempt: 'chord-tone', warnings }` IF any soft end-on-chord-tone warnings
 * fired (those are diagnostics, not failures). It is never required.
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

  // Emit (and log) the soft notes for a validated motif set — end-on-chord-tone
  // mismatches and shared-rhythm sameness. Diagnostics, never failures.
  const emitSoftWarnings = (flatMotifs) => {
    const warnings = [
      ...chordToneWarnings(flatMotifs, macroParams, harmonicPlan),
      ...rhythmSamenessWarnings(flatMotifs),
      ...anomalyRealityWarnings(flatMotifs),
      ...contourMismatchWarnings(flatMotifs),
    ];
    if (warnings.length > 0) {
      trace({ attempt: 'soft-note', raw: null, ok: true, errors: [], warnings });
      for (const warning of warnings) console.warn(`Stage 4 (soft): ${warning}`);
    }
    return flatMotifs;
  };

  // --- Offline / deterministic fallback: same parse + validate, no network. ---
  if (__mockResponse !== undefined) {
    const parsed = parseMotifsResponse(__mockResponse); // throws clearly on bad JSON
    const result = validateMotifs(parsed, macroParams);
    trace({ attempt: 0, raw: __mockResponse, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 4: mock response failed validation. Raw:\n', __mockResponse);
      throw new Error(`Stage 4: mock motifs are invalid:\n  - ${result.errors.join('\n  - ')}`);
    }
    return emitSoftWarnings(unwrapMotifs(parsed));
  }

  // --- Live path: call, validate, retry once with the errors fed back. ---
  const messages = [{ role: 'user', content: user }];
  let raw = await callMotifsLLM(system, messages);
  let result;
  let parsed;
  try {
    parsed = parseMotifsResponse(raw);
    result = validateMotifs(parsed, macroParams);
  } catch (parseError) {
    // Treat an unparseable first response like a validation failure so the single
    // retry gets a chance to return clean JSON.
    result = { ok: false, errors: [parseError.message] };
  }
  trace({ attempt: 1, raw, ok: result.ok, errors: result.errors });

  if (!result.ok) {
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: buildRetryPrompt(result.errors) });
    raw = await callMotifsLLM(system, messages);
    parsed = parseMotifsResponse(raw); // throws clearly if still unparseable
    result = validateMotifs(parsed, macroParams);
    trace({ attempt: 2, raw, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 4: motifs failed validation after one retry. Raw:\n', raw);
      throw new Error(`Stage 4: motifs are invalid after one retry:\n  - ${result.errors.join('\n  - ')}`);
    }
  }

  return emitSoftWarnings(unwrapMotifs(parsed));
}
