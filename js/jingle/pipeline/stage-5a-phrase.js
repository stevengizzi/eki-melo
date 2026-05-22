/* =================================================================
   STAGE 5a — PHRASE STRUCTURE + MOTIF PLACEMENT (buildplan Session 9 —
   SECOND LLM STAGE).

   Sibling of Stage 5b (texture choreography, Session 8). Where 5b chooses
   textures and bass patterns, 5a chooses each section's phrase structure and
   shapes how the motifs develop across the bars: which motif lands where, under
   which transformation, for how long. It is the stage that turns 2–3 raw motifs
   into a phrased, developing line. The architecture is deliberately identical to
   5b — prompt-building separated from the fetch, a wrapped LLM envelope unwrapped
   to a flat plan at the seam, all-defects-in-one-pass validation, a
   validate-then-retry-once loop, and a `__mockResponse` offline fallback the
   verifier uses. The differences are the prompt content (musical, not textural)
   and the validator rules (music-theoretical, not geometric).

     generatePhrasePlan({ macroParams, motifs, harmonicPlan, config,
                          __mockResponse?, onTrace? }) → PhrasePlan

   THE TWO SHAPES (and why they differ). The LLM emits — and validatePhrasePlan
   checks — the WRAPPED envelope `{ sections: { <label>: { phrase_structure,
   lead } } }`. A top-level `sections` key is clearer for the model (and matches
   the Session-8 envelope). But the canonical inter-stage PhrasePlan (buildplan
   §3, what Stage 6 / Stage 5b consume, what the hand-supplied inspector cases
   use) is FLAT: `{ <label>: { phrase_structure, lead } }`. So generatePhrasePlan
   validates the wrapped envelope, then UNWRAPS `.sections` and returns the flat
   plan. The wrapped form is purely Stage 5a's LLM I/O envelope.

   OUTPUT (flat PhrasePlan, exactly what Sessions 4–8 already consume):
     {
       <label>: {
         phrase_structure: "period" | "sentence" | "phrase_group" | "hybrid",
         lead: [
           { motif: <name|null>, transform: <string|object>,
             start_bar: <1-indexed>, length_bars: <int> },
           …
         ]
       },
       …
     }
   where `start_bar` is 1-indexed and section-relative, `length_bars` is
   inclusive, ranges may have gaps (silences) but never overlaps, and `transform`
   is a key from theory/transformations.js, the reserved "cadential_gesture" slot
   (Stage 8 fills it), or a `{ name, params }` object for parameterized transforms.

   OFFLINE / DETERMINISTIC FALLBACK. Pass `__mockResponse` (a JSON string) to skip
   the network and run that string through the SAME parse + validate path as a real
   response. This is how verify-stage5a.mjs exercises the stage without an API call.

   API. Same call shape as Stage 5b / js/jingle/api.js: POST the Anthropic Messages
   body to API_ENDPOINT, force JSON-only by instruction, strip code fences, parse
   with a brace-match fallback. The model is pinned to the one /api/generate's
   allow-list permits, so both runtime modes work without a server change.

   PORTABILITY. This is pipeline/ code: it may import theory/ and js/env.js. It
   does NOT modify api.js (read-only this session) — it mimics its patterns.
   ================================================================= */
import { API_ENDPOINT } from '../../env.js';
import * as Transforms from '../theory/transformations.js';
import { getForm, deriveSectionRelationships } from '../theory/form-engine.js';
import { computeSectionPlan } from './stage-6-voice.js';

// The /api/generate allow-list only permits this model (see
// functions/api/generate.js ALLOWED_MODELS); api.js + Stage 5b use the same one.
// Pinning it keeps the deployed proxy path AND the artifact direct path working
// without a server change. A model upgrade is a coordinated allow-list change.
const STAGE_5A_MODEL = 'claude-sonnet-4-20250514';
const STAGE_5A_MAX_TOKENS = 2500;

// =================================================================
// VOCABULARY — the strict choice sets, with one-line descriptions for the
// prompt. The transform set is built off transformations.js's own exports so the
// listing (and what validation accepts) can never drift from the library.
// =================================================================

// Descriptions express each structure's internal SHAPE as proportions, not fixed
// bar counts, so the model can fit one to a section of any length (a 4-bar
// section compresses an 8-bar model). See phraseStructureVocabulary().
const PHRASE_STRUCTURE_DESCRIPTIONS = {
  period: 'antecedent–consequent (a 1:1 split): an opening phrase that ends open, answered by a parallel phrase that closes',
  sentence: 'statement → varied repetition → continuation (a 1:1:2 feel): short ideas that accelerate into the cadence',
  phrase_group: 'two complementary phrases of roughly equal length (a 1:1 split), not strict antecedent–consequent',
  hybrid: 'a sentence-like opening (short, accelerating ideas) closed by a period-like cadence',
};
const PHRASE_STRUCTURES = new Set(Object.keys(PHRASE_STRUCTURE_DESCRIPTIONS));

// One-line descriptions keyed by the transformation library's export names.
// cadential_gesture is the reserved end-slot, NOT a transformations.js export.
const TRANSFORM_DESCRIPTIONS = {
  literal: 'play the motif as written',
  transpose_step: 'transpose by params.steps scale steps — REQUIRED non-zero integer (+ up, − down); for ±1 prefer sequence_up_step / sequence_down_step',
  transpose_third: 'up or down a third (params.direction = "up" | "down", default "up")',
  sequence_up_step: 'repeat the motif a step higher — a typical phrase-extension move',
  sequence_down_step: 'repeat the motif a step lower',
  invert: "mirror the motif's contour around a pivot (params.pivot = a degree 1–7)",
  retrograde: 'play the motif backward',
  augment_2x: 'double the durations (twice as slow)',
  diminute_2x: 'halve the durations (twice as fast)',
  fragment_head: 'keep only the first half',
  fragment_tail: 'keep only the last half',
  ornament_upper_neighbor: 'decorate a note with the scale step above it',
  ornament_lower_neighbor: 'decorate a note with the scale step below it',
  ornament_chromatic_passing: 'insert a chromatic passing tone (CONSUMES the anomaly budget — use sparingly)',
};

// The names validation accepts: every transformations.js export, plus the
// reserved cadential_gesture slot. Derived from the module so it can't drift.
const RECOGNIZED_TRANSFORMS = new Set(
  Object.keys(Transforms).filter((name) => typeof Transforms[name] === 'function')
);
const CADENTIAL_GESTURE = 'cadential_gesture';
const isRecognizedTransform = (name) => RECOGNIZED_TRANSFORMS.has(name) || name === CADENTIAL_GESTURE;

const PHRASE_ADVENTUROUSNESS_DIRECTIVE = {
  tame:
    'Keep development conservative and legible — mostly literal statements with step/third sequences. '
    + 'Favor period structures. Use ornaments rarely; avoid retrograde and inversion.',
  adventurous:
    'Give each section a distinct developmental identity. Bring retrograde and inversion into the contrast '
    + '(B/C) sections, use fragmentation to build momentum toward cadences, and ornament tastefully. Do not '
    + 'just sequence the same motif everywhere.',
  wild:
    'Develop boldly throughout. In addition, EXACTLY ONE section should reach for a striking gesture — at '
    + 'least one ornament_chromatic_passing, retrograde, or invert (the anomaly slot) that the other sections '
    + 'do not match; the rest of the piece stays otherwise adventurous. Surprise is welcome.',
};
const DEFAULT_PHRASE_ADVENTUROUSNESS = 'adventurous';

function phraseAdventurousnessOf(config) {
  const value = config?.knobs?.phrase_adventurousness;
  return value in PHRASE_ADVENTUROUSNESS_DIRECTIVE ? value : DEFAULT_PHRASE_ADVENTUROUSNESS;
}

// =================================================================
// TRANSFORM SPEC PARSING — accepts the "name@k=v" string form, a bare name
// string, or the { name, params } object form (mirrors Stage 6's parseTransform).
// =================================================================

function parseTransformSpec(spec) {
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    return { name: spec.name, params: spec.params ?? {} };
  }
  if (typeof spec === 'string' && spec.length > 0) {
    const [name, paramString] = spec.split('@');
    const params = {};
    if (paramString) {
      for (const pair of paramString.split(',')) {
        const [key, value] = pair.split('=');
        const asNumber = Number(value);
        params[key] = value !== '' && value !== undefined && Number.isFinite(asNumber) ? asNumber : value;
      }
    }
    return { name, params };
  }
  return { name: undefined, params: {} };
}

// A readable "name(k=v)" label for error messages.
function transformLabel({ name, params }) {
  const keys = Object.keys(params ?? {});
  if (keys.length === 0) return String(name);
  return `${name}(${keys.map((k) => `${k}=${params[k]}`).join(',')})`;
}

// A stable canonical key (sorted params) for adjacency-equality comparison.
function transformCanonical({ name, params }) {
  const keys = Object.keys(params ?? {}).sort();
  if (keys.length === 0) return String(name);
  return `${name}@${keys.map((k) => `${k}=${params[k]}`).join(',')}`;
}

// Catch a transform whose params would crash the theory-layer realization
// (theory/transformations.js validates them at apply time and throws), so the
// defect is caught at the seam — and fed to the retry — instead of blowing up in
// Stage 6. Returns an error string, or null when the params are fine. Only the
// params that are REQUIRED or type-constrained are checked; everything optional
// with a sensible default (pivot, count, at_position) is validated for type only.
function transformParamError(name, params = {}) {
  switch (name) {
    case 'transpose_step':
      if (!Number.isInteger(params.steps)) {
        return 'transform "transpose_step" requires an integer "steps" param '
          + '(e.g. {"name":"transpose_step","params":{"steps":2}}); for ±1 use sequence_up_step / sequence_down_step.';
      }
      if (params.steps === 0) return 'transform "transpose_step" "steps" must be a non-zero integer.';
      return null;
    case 'transpose_third':
      if (params.direction !== undefined && params.direction !== 'up' && params.direction !== 'down') {
        return 'transform "transpose_third" "direction" must be "up" or "down" when present.';
      }
      return null;
    case 'invert':
      if (params.pivot !== undefined && (!Number.isInteger(params.pivot) || params.pivot === 0)) {
        return 'transform "invert" "pivot" must be a non-zero integer scale degree when present.';
      }
      return null;
    case 'fragment_head':
    case 'fragment_tail':
      if (params.count !== undefined && (!Number.isInteger(params.count) || params.count < 1)) {
        return `transform "${name}" "count" must be a positive integer when present.`;
      }
      return null;
    case 'ornament_upper_neighbor':
    case 'ornament_lower_neighbor':
    case 'ornament_chromatic_passing':
      if (params.at_position !== undefined && (!Number.isInteger(params.at_position) || params.at_position < 0)) {
        return `transform "${name}" "at_position" must be a non-negative integer when present.`;
      }
      return null;
    default:
      return null;
  }
}

const motifDisplay = (motif) => (motif === null ? 'null' : `"${motif}"`);

// =================================================================
// SECTION RELATIONSHIPS — which sections are contrast / reprise, so the
// development rules can be enforced. Prefers the curated form metadata
// (getForm(...).relationships) remapped onto the actual section labels by
// position; falls back to deriving from the label letter-pattern when there is
// no matching form (e.g. a piece that overrode the form's labels). The fallback
// helper lives in form-engine.js.
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

// =================================================================
// PROMPT BUILDING — kept separate from the fetch (so the inspector can display
// it and the verifier can assert on it). Returns { system, user }.
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
  ].join('\n');
}

function motifsSummary(motifs) {
  if (!motifs || Object.keys(motifs).length === 0) return 'MOTIFS\n- (none supplied)';
  const lines = Object.entries(motifs).map(([name, m]) => {
    const anomaly = m.anomaly
      ? `, anomaly: ${m.anomaly.type}${m.anomaly.at_position != null ? `@${m.anomaly.at_position}` : ''}`
      : '';
    return (
      `- ${name}: degrees [${(m.degrees ?? []).join(', ')}], rhythm [${(m.rhythm ?? []).join(', ')}], `
      + `contour ${m.contour ?? '?'}, register ${m.register ?? '?'}${anomaly}`
    );
  });
  return ['MOTIFS (melodic cells, in scale degrees — reference each by its name)', ...lines].join('\n');
}

function harmonySummary(harmonicPlan) {
  const sections = harmonicPlan?.sections ?? [];
  if (sections.length === 0) return 'HARMONIC PLAN\n- (none supplied)';
  const lines = sections.map(
    (s) => `- ${s.label}: ${(s.progression ?? []).join(' ')}  (cadence: ${s.cadence ?? 'none'})`
  );
  return ['HARMONIC PLAN (Roman numerals, per section — informs phrase choices + cadences)', ...lines].join('\n');
}

// Per-section role / reprise-source / contrast, so the model honors the
// development rules the validator enforces.
function formMetadataSummary(relationships, plan) {
  const lines = plan.map((s) => {
    const rel = relationships[s.label] ?? {};
    const parts = [rel.role ?? 'section'];
    if (rel.of) parts.push(`of ${rel.of}`);
    if (rel.variation) parts.push(`(${rel.variation})`);
    if (rel.contrast_from) parts.push(`vs ${rel.contrast_from}`);
    let note = '';
    if (rel.role === 'contrast' || rel.role === 'variation') {
      note = ' — MUST contain non-literal motivic development';
    } else if (rel.role === 'reprise' || rel.role === 'varied_reprise') {
      note = `${rel.of ? ` — MUST bring back a motif from ${rel.of}` : ''}`;
    }
    return `- ${s.label}: ${parts.join(' ')}${note}`;
  });
  return ['FORM ROLES (how each section relates — honor these in your development)', ...lines].join('\n');
}

function phraseStructureVocabulary() {
  const lines = Object.entries(PHRASE_STRUCTURE_DESCRIPTIONS).map(([name, desc]) => `  - ${name}: ${desc}`);
  return [
    'PHRASE STRUCTURES (choose one per section for "phrase_structure"). These name the section\'s '
      + 'internal SHAPE as proportions, not fixed bar counts — they scale to the section\'s length, so a '
      + 'short (e.g. 4-bar) section compresses the model (a period becomes 2+2, a sentence 1+1+2). Pick the '
      + 'shape that best fits the section\'s bar count and role:',
    ...lines,
  ].join('\n');
}

function transformVocabulary() {
  const lines = [...RECOGNIZED_TRANSFORMS].map((name) => `  - ${name}: ${TRANSFORM_DESCRIPTIONS[name] ?? ''}`);
  lines.push(
    `  - ${CADENTIAL_GESTURE}: an OPTIONAL reserved end-slot (with motif null) — a rest into the cadence. Use it `
    + 'only when you want the melody to pause before a section\'s close; otherwise let a motif lead into the '
    + 'cadence (see below).'
  );
  return [`TRANSFORMS (use ONLY these names for "transform"):`, ...lines].join('\n');
}

function developmentRules() {
  return [
    'DEVELOPMENT RULES (these are enforced — a plan that breaks them is rejected):',
    '- A contrast section (role "contrast"/"variation") must contain at least one non-literal motivic '
      + 'transform (not just "literal").',
    '- A reprise section (role "reprise") must bring back at least one motif used by the section it reprises.',
    '- No two ADJACENT assignments in a section may be the identical { motif, transform } pair.',
    '- Assignments within a section may NOT overlap (a gap/rest is fine); none may run past the section\'s last bar.',
    'CADENCES: a section that declares a cadence (see HARMONIC PLAN) closes with one — but Stage 8 enforces only '
      + 'the section\'s final TWO BEATS. So you may let a motif occupy the FINAL bar and lead INTO the cadence '
      + '(its tail resolves into the close) — that is the preferred, more melodic choice — OR use the reserved '
      + `"${CADENTIAL_GESTURE}" slot if you want the melody to rest into the cadence. Either is valid.`,
  ].join('\n');
}

// The JSON skeleton the model fills in, listing each section with its bar count
// so placements land in range.
function schemaSkeleton(plan) {
  const sectionLines = plan
    .map(
      (s) =>
        `    ${JSON.stringify(s.label)}: { "phrase_structure": "…", "lead": [ /* place motifs across bars 1..${s.bars} */ ] }`
    )
    .join(',\n');
  return `{\n  "sections": {\n${sectionLines}\n  }\n}`;
}

function schemaBlock(plan) {
  const labels = plan.map((s) => JSON.stringify(s.label)).join(', ');
  return [
    'RESPOND WITH ONLY THIS JSON OBJECT — no markdown fences, no commentary before or after:',
    '',
    schemaSkeleton(plan),
    '',
    'REQUIREMENTS:',
    `- Use these EXACT section labels as the keys of "sections": ${labels}.`,
    '- Each section is { "phrase_structure": one of the four names, "lead": [ assignments ] }.',
    '- Each assignment is { "motif": <a motif name or null>, "transform": <a transform name, or a '
      + '{"name": …, "params": {…}} object for parameterized transforms>, "start_bar": <1-indexed, '
      + 'section-relative>, "length_bars": <integer >= 1, inclusive> }.',
    '- A bar is one assignment by default; make an assignment longer only when a motif genuinely spans more '
      + 'than one bar. Leaving bars empty (a rest/breath) is allowed; overlaps are NOT.',
    '- Choose motif placements and transforms that READ AS COMPOSITION — develop the material, do not just '
      + 'tile literal copies. Obey the DEVELOPMENT RULES above.',
  ].join('\n');
}

/**
 * Build the Stage 5a prompt as { system, user }. Pure (no I/O), so the inspector
 * can display it and the verifier can assert on it.
 */
export function buildPhrasePlanPrompt({ macroParams, motifs, harmonicPlan, config }) {
  const plan = computeSectionPlan(macroParams);
  const relationships = sectionRelationshipsForPlan(macroParams, plan);
  const adventurousness = phraseAdventurousnessOf(config);

  const system =
    'You are a composer choosing phrase structure and shaping motivic development for a chiptune piece. '
    + 'Your output is a strict JSON object matching the given schema; no commentary.';

  const user = [
    pieceSummary(macroParams, plan),
    motifsSummary(motifs),
    harmonySummary(harmonicPlan),
    formMetadataSummary(relationships, plan),
    phraseStructureVocabulary(),
    transformVocabulary(),
    developmentRules(),
    `PHRASE ADVENTUROUSNESS — ${adventurousness}:\n  ${PHRASE_ADVENTUROUSNESS_DIRECTIVE[adventurousness]}`,
    schemaBlock(plan),
  ].join('\n\n');

  return { system, user };
}

function buildRetryPrompt(errors) {
  return [
    'The JSON you returned did not pass validation. Fix these specific problems and return the '
      + 'corrected JSON object — the full PhrasePlan, same schema, no commentary:',
    '',
    errors.map((e) => `- ${e}`).join('\n'),
    '',
    'Return ONLY the corrected JSON object.',
  ].join('\n');
}

// =================================================================
// LLM CALL — mimics js/jingle/api.js's fetch / headers / error-handling shape.
// =================================================================

async function callPhraseLLM(system, messages) {
  const response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: STAGE_5A_MODEL,
      max_tokens: STAGE_5A_MAX_TOKENS,
      system,
      messages,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Stage 5a LLM call failed: API ${response.status}: ${errText.slice(0, 160)}`);
  }

  const data = await response.json();
  return (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text || '')
    .join('')
    .trim();
}

// Strip code fences (if the model wrapped the JSON) and parse, with a brace-match
// fallback. Logs the raw response and throws clearly on failure.
function parsePhrasePlanResponse(raw) {
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
    console.error('Stage 5a: could not parse the model response as JSON. Raw response:\n', raw);
    throw new Error('Stage 5a: model response was not valid JSON (see console for the raw response).');
  }
}

// =================================================================
// VALIDATION — validatePhrasePlan checks the WRAPPED LLM envelope. Exported so
// verify-stage5a.mjs can stress-test it without re-deriving the logic. Collects
// ALL defects (does not stop at the first) so a retry can address them together.
// =================================================================

/**
 * Validate one section's `lead` array: each assignment well-formed (rule f),
 * no adjacent-identical pair (c), and no overlap / no overflow (d). Pushes every
 * defect via `push` and returns `{ motifSet, hasDevelopment }` for the
 * cross-section rules (a)/(b).
 *
 * NOTE: there is intentionally no "final bar must be cadential_gesture" rule.
 * Stage 8 now enforces only a section's final two beats, so a motif may occupy
 * the final bar and lead INTO the cadence (only its tail resolves) — that is a
 * valid, preferred shape, not a defect.
 */
function validateLead(lead, label, bars, motifNames, push) {
  const summary = { motifSet: new Set(), hasDevelopment: false };
  if (!Array.isArray(lead)) {
    push(`Section "${label}" "lead" must be an array of assignments.`);
    return summary;
  }
  if (lead.length === 0) {
    push(`Section "${label}" "lead" is empty — it must place at least one motif assignment.`);
    return summary;
  }

  const placed = []; // { start, length, motif, name, label: <readable>, key }
  lead.forEach((assignment, i) => {
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
      push(`Section "${label}" lead assignment ${i} must be an object.`);
      return;
    }

    // motif: null or a known motif name
    const motif = assignment.motif === undefined ? undefined : assignment.motif;
    const motifValid = motif === null || (typeof motif === 'string' && motifNames.has(motif));
    if (!motifValid) {
      push(
        `Section "${label}" lead assignment ${i}: motif ${JSON.stringify(motif)} is not null or a known motif `
          + `(${[...motifNames].join(', ') || 'none'}).`
      );
    }

    // transform: a recognized name (transformations.js export) or cadential_gesture,
    // and — if recognized — params that won't crash the theory-layer realization.
    const parsed = parseTransformSpec(assignment.transform);
    if (!isRecognizedTransform(parsed.name)) {
      const shown = parsed.name !== undefined ? JSON.stringify(parsed.name) : JSON.stringify(assignment.transform);
      push(
        `Section "${label}" lead assignment ${i}: unknown transform ${shown}. Allowed: `
          + `${[...RECOGNIZED_TRANSFORMS].join(', ')}, ${CADENTIAL_GESTURE}.`
      );
    } else {
      const paramError = transformParamError(parsed.name, parsed.params);
      if (paramError) push(`Section "${label}" lead assignment ${i}: ${paramError}`);
    }
    if (
      assignment.transform
      && typeof assignment.transform === 'object'
      && !Array.isArray(assignment.transform)
      && assignment.transform.params !== undefined
      && (typeof assignment.transform.params !== 'object'
        || assignment.transform.params === null
        || Array.isArray(assignment.transform.params))
    ) {
      push(`Section "${label}" lead assignment ${i}: transform "params" must be an object when present.`);
    }

    // bar placement
    const { start_bar: start, length_bars: length } = assignment;
    let rangeOk = true;
    if (!Number.isInteger(start) || start < 1 || start > bars) {
      push(
        `Section "${label}" lead assignment ${i}: start_bar ${JSON.stringify(start)} out of range — `
          + `must be an integer in [1, ${bars}].`
      );
      rangeOk = false;
    }
    if (!Number.isInteger(length) || length < 1) {
      push(`Section "${label}" lead assignment ${i}: length_bars ${JSON.stringify(length)} must be an integer >= 1.`);
      rangeOk = false;
    }

    if (rangeOk) {
      placed.push({
        start,
        length,
        motif,
        name: parsed.name,
        label: transformLabel(parsed),
        key: `${motif === null ? 'null' : motif}|${transformCanonical(parsed)}`,
      });
    }

    if (typeof motif === 'string' && motifNames.has(motif)) {
      summary.motifSet.add(motif);
      if (isRecognizedTransform(parsed.name) && parsed.name !== 'literal' && parsed.name !== CADENTIAL_GESTURE) {
        summary.hasDevelopment = true;
      }
    }
  });

  if (placed.length === 0) return summary; // every assignment was malformed; already flagged

  const sorted = [...placed].sort((a, b) => a.start - b.start);

  // (c) no two ADJACENT (by start_bar) assignments share the same { motif, transform } pair.
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].key === sorted[k - 1].key) {
      push(
        `Section "${label}" has adjacent identical assignments at bars ${sorted[k - 1].start} and `
          + `${sorted[k].start}: motif ${motifDisplay(sorted[k].motif)} with transform "${sorted[k].label}" repeated.`
      );
    }
  }

  // (d) no overlaps (gaps allowed), and the last assignment may not run past the section.
  for (let k = 1; k < sorted.length; k++) {
    const prevEnd = sorted[k - 1].start + sorted[k - 1].length; // first free bar after prev
    if (prevEnd > sorted[k].start) {
      push(
        `Section "${label}" lead has overlapping assignments: bars [${sorted[k - 1].start}..`
          + `${prevEnd - 1}] overlaps the assignment starting at bar ${sorted[k].start}.`
      );
    }
  }
  const last = sorted[sorted.length - 1];
  if (last.start + last.length > bars + 1) {
    push(
      `Section "${label}" lead overflows the section: an assignment runs to bar ${last.start + last.length - 1} `
        + `but the section has only ${bars} bars.`
    );
  }

  return summary;
}

/**
 * Validate the WRAPPED PhrasePlan envelope `{ sections: { <label>: {
 * phrase_structure, lead } } }` against `macroParams` + `motifs`. Returns
 * { ok, errors: [] }; `ok` is true only when `errors` is empty.
 */
export function validatePhrasePlan(wrappedPlan, macroParams, motifs) {
  const errors = [];
  const push = (message) => errors.push(message);

  if (!wrappedPlan || typeof wrappedPlan !== 'object' || Array.isArray(wrappedPlan)) {
    return { ok: false, errors: ['PhrasePlan must be a JSON object.'] };
  }
  const sections = wrappedPlan.sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return { ok: false, errors: ['PhrasePlan.sections must be an object keyed by section label.'] };
  }

  let plan;
  try {
    plan = computeSectionPlan(macroParams);
  } catch (error) {
    return { ok: false, errors: [`Could not derive the section plan from macroParams: ${error.message}`] };
  }
  const expectedLabels = plan.map((s) => s.label);
  const barsByLabel = new Map(plan.map((s) => [s.label, s.bars]));
  const motifNames = motifs && typeof motifs === 'object' ? new Set(Object.keys(motifs)) : new Set();
  const relationships = sectionRelationshipsForPlan(macroParams, plan);

  // (f) the section-label set must match exactly — none missing, none extra.
  for (const label of expectedLabels) {
    if (!Object.prototype.hasOwnProperty.call(sections, label)) {
      push(`Missing section "${label}" in the phrase plan (expected sections: ${expectedLabels.join(', ')}).`);
    }
  }
  for (const label of Object.keys(sections)) {
    if (!barsByLabel.has(label)) {
      push(
        `Unexpected section "${label}" in the phrase plan — not a section in macroParams `
          + `(expected: ${expectedLabels.join(', ')}).`
      );
    }
  }

  // Per known section: phrase_structure + lead (schema/adjacency/coverage/cadence).
  // Collect each section's motif set + whether it developed, for the cross-section rules.
  const summaryByLabel = new Map();
  for (const label of Object.keys(sections)) {
    if (!barsByLabel.has(label)) continue; // already flagged as unexpected
    const bars = barsByLabel.get(label);
    const sectionPlan = sections[label];
    if (!sectionPlan || typeof sectionPlan !== 'object' || Array.isArray(sectionPlan)) {
      push(`Section "${label}" must be an object with "phrase_structure" and "lead".`);
      continue;
    }
    if (!PHRASE_STRUCTURES.has(sectionPlan.phrase_structure)) {
      push(
        `Section "${label}" phrase_structure ${JSON.stringify(sectionPlan.phrase_structure)} is not one of: `
          + `${[...PHRASE_STRUCTURES].join(', ')}.`
      );
    }
    const summary = validateLead(sectionPlan.lead, label, bars, motifNames, push);
    summaryByLabel.set(label, summary);
  }

  // (a)/(b) cross-section development rules, using the curated/derived relationships.
  for (const label of Object.keys(sections)) {
    if (!barsByLabel.has(label)) continue;
    const here = summaryByLabel.get(label);
    if (!here) continue; // section object was malformed
    const rel = relationships[label] ?? {};

    // (a) contrast / variation sections must show non-literal development.
    if ((rel.role === 'contrast' || rel.role === 'variation') && !here.hasDevelopment) {
      push(
        `Section "${label}" must contain non-literal motivic development (currently every assignment is "literal").`
      );
    }

    // (b) reprise sections must bring back a motif from the section they reprise.
    if (rel.role === 'reprise' || rel.role === 'varied_reprise') {
      const source = rel.of;
      const sourceSummary = source != null ? summaryByLabel.get(source) : null;
      if (sourceSummary && sourceSummary.motifSet.size > 0) {
        const shares = [...here.motifSet].some((m) => sourceSummary.motifSet.has(m));
        if (!shares) {
          const sourceMotif = [...sourceSummary.motifSet][0];
          push(`Section "${label}" is a reprise of "${source}" but does not contain motif "${sourceMotif}".`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

// Unwrap the validated envelope into the flat §3 PhrasePlan the rest of the
// pipeline consumes.
function unwrapPhrasePlan(wrapped) {
  return wrapped.sections;
}

// =================================================================
// THE STAGE — generatePhrasePlan
// =================================================================

/**
 * Generate a PhrasePlan for the supplied upstream context. Returns the flat
 * `{ <label>: { phrase_structure, lead } }` plan Stage 5b / Stage 6 consume.
 *
 * Modes:
 *   - Live: builds the prompt, calls the LLM, validates; on validation failure it
 *     retries ONCE with the specific errors fed back, then throws if still invalid.
 *   - Offline: pass `__mockResponse` (a JSON string) to skip the network and run
 *     that string through the same parse + validate path — how verify-stage5a.mjs
 *     exercises the stage without an API call.
 *
 * `onTrace`, if supplied, is called once per model round-trip (or the mock) with
 * `{ attempt, raw, ok, errors }` — used by the inspector to show the raw
 * response(s). It is never required.
 */
export async function generatePhrasePlan({
  macroParams,
  motifs,
  harmonicPlan,
  config,
  __mockResponse,
  onTrace,
} = {}) {
  if (!macroParams) throw new Error('generatePhrasePlan requires macroParams.');

  const { system, user } = buildPhrasePlanPrompt({ macroParams, motifs, harmonicPlan, config });
  const trace = typeof onTrace === 'function' ? onTrace : () => {};

  // --- Offline / deterministic fallback: same parse + validate, no network. ---
  if (__mockResponse !== undefined) {
    const parsed = parsePhrasePlanResponse(__mockResponse); // throws clearly on bad JSON
    const result = validatePhrasePlan(parsed, macroParams, motifs);
    trace({ attempt: 0, raw: __mockResponse, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 5a: mock response failed validation. Raw:\n', __mockResponse);
      throw new Error(`Stage 5a: mock PhrasePlan is invalid:\n  - ${result.errors.join('\n  - ')}`);
    }
    return unwrapPhrasePlan(parsed);
  }

  // --- Live path: call, validate, retry once with the errors fed back. ---
  const messages = [{ role: 'user', content: user }];
  let raw = await callPhraseLLM(system, messages);
  let result;
  let parsed;
  try {
    parsed = parsePhrasePlanResponse(raw);
    result = validatePhrasePlan(parsed, macroParams, motifs);
  } catch (parseError) {
    // Treat an unparseable first response like a validation failure so the single
    // retry gets a chance to return clean JSON.
    result = { ok: false, errors: [parseError.message] };
  }
  trace({ attempt: 1, raw, ok: result.ok, errors: result.errors });

  if (!result.ok) {
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: buildRetryPrompt(result.errors) });
    raw = await callPhraseLLM(system, messages);
    parsed = parsePhrasePlanResponse(raw); // throws clearly if still unparseable
    result = validatePhrasePlan(parsed, macroParams, motifs);
    trace({ attempt: 2, raw, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 5a: PhrasePlan failed validation after one retry. Raw:\n', raw);
      throw new Error(`Stage 5a: PhrasePlan is invalid after one retry:\n  - ${result.errors.join('\n  - ')}`);
    }
  }

  return unwrapPhrasePlan(parsed);
}
