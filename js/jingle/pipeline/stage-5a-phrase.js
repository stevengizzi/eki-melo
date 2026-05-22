/* =================================================================
   STAGE 5a — ARRANGEMENT (buildplan Session 12 — the phrase-motif rework, §7.7).

   THE RE-SCOPE. Sessions 9–11 made Stage 5a the DEVELOPMENT stage: it took 2–3
   micro-cells and developed them across a section's bars (sequence / invert /
   fragment / ornament), turning tiny cells into a phrased line. The phrase-motif
   rework moved melody authorship UPSTREAM: Stage 4 now writes ONE full PHRASE per
   section (filling the section, chord-aware by construction). So Stage 5a shrinks
   to ARRANGEMENT — for each section, decide whether to place its phrase LITERALLY
   (the default, which is usually right) or with a small VARIATION (a length-
   preserving transform for emphasis or colour). The Session-3 transform library
   survives intact as variation tooling; its ROLE demotes from required-for-
   development to optional-flavor.

     generatePhrasePlan({ macroParams, motifs, harmonicPlan, config,
                          __mockResponse?, onTrace? }) → PhrasePlan

   The LLM-stages-chained architecture is preserved (this stage still calls the
   model; it could go deterministic later if warranted). The OUTPUT SHAPE is
   UNCHANGED from Session 9 — Stage 5b / Stage 6 consume the same flat PhrasePlan:
     {
       <label>: {
         phrase_structure: <metadata only — optional now>,
         lead: [
           { motif: <section_label|null>, transform: <string|object>,
             start_bar: <1-indexed>, length_bars: <int> },
           …
         ]
       },
       …
     }
   In the phrase-motif model each section's `lead` is TYPICALLY ONE entry with
   start_bar=1, length_bars=section.bars, transform="literal" (or a chosen
   variation). The `motif` references a key in `input.motifs` — now a SECTION
   LABEL (the per-section phrase), where it used to be a short cell letter; the
   lookup mechanic is identical.

   THE TWO SHAPES. The LLM emits the WRAPPED envelope `{ sections: { <label>: {
   phrase_structure, lead } } }`; generatePhrasePlan validates it, then UNWRAPS
   `.sections` and returns the flat plan.

   THE NEW HARD CHECK — DETERMINISTIC BEAT-LENGTH / OVERFLOW. For each lead
   assignment, apply its transform to the referenced phrase, sum the realized
   rhythm, and assert it FILLS its bar-slot exactly (no overflow, no internal gap).
   This structurally closes the hollow-reprise + per-bar-gap findings (same root:
   short realized content in a bar-sized slot) — and, because Stage 4 authors each
   phrase to fill its whole section, it means a single literal assignment per
   section is the natural, correct shape.

   THE CHORD-FIT GUARD (Session 11) STAYS as a reduced-scope SAFETY NET: a
   TRANSPOSING variation that shifts the phrase entirely off its bar's chord is
   rejected. It fires rarely now (the phrase was authored chord-fit at Stage 4); it
   catches the case where Stage 5a's own variation transposes it off-chord.

   OFFLINE / DETERMINISTIC FALLBACK. `__mockResponse` (a JSON string) skips the
   network and runs the same parse + validate path — how verify-stage5a.mjs
   exercises the stage. PORTABILITY: pipeline/ code; may import theory/ + env.js.

   LEGACY. The Session-9/10/11 cell-development stage is preserved verbatim as
   stage-5a-development-LEGACY.js for the A/B audition (config.knobs.
   motif_architecture === 'cell'); see that file's banner + the Session-12 journal.
   ================================================================= */
import { postMessages } from './llm-call.js';
import * as Transforms from '../theory/transformations.js';
import { degreeToLinear } from '../theory/motif.js';
import { getForm, deriveSectionRelationships } from '../theory/form-engine.js';
import { computeSectionPlan } from './stage-6-voice.js';

// The /api/generate allow-list only permits this model; api.js + Stages 3/4/5b
// use the same one. Pinning it keeps both runtime modes working without a server
// change. A model upgrade is a coordinated allow-list change.
const STAGE_5A_MODEL = 'claude-sonnet-4-20250514';
const STAGE_5A_MAX_TOKENS = 2000;

const BEATS_EPSILON = 0.01;

// =================================================================
// VOCABULARY — the transform set, built off transformations.js's own exports so
// the listing (and what validation accepts) can never drift from the library.
// =================================================================

// The phrase-structure names, kept ONLY for back-compat metadata. The field is
// optional in the arrangement model; if present-and-unrecognized it warns (soft),
// never fails (it is descriptive metadata, consumed by nothing downstream).
const PHRASE_STRUCTURES = new Set(['period', 'sentence', 'phrase_group', 'hybrid']);

// One-line descriptions keyed by the transformation library's export names, at
// PHRASE scale. Length-preserving transforms suit a single full-section
// assignment; length-changing ones (augment/diminute/fragment) need a matching
// length_bars or the section split into sub-slots (the beat-length check enforces it).
const TRANSFORM_DESCRIPTIONS = {
  literal: 'play the phrase as written (the DEFAULT — usually right) — preserves length',
  transpose_step: 'transpose by params.steps scale steps — REQUIRED non-zero integer (+ up, − down) — preserves length',
  transpose_third: 'up or down a third (params.direction = "up" | "down", default "up") — preserves length',
  sequence_up_step: 'restate the phrase a step higher — preserves length',
  sequence_down_step: 'restate the phrase a step lower — preserves length',
  invert: 'mirror the contour around a pivot (params.pivot) — preserves length; rarely musical at full-phrase scale (discouraged)',
  retrograde: 'play the phrase backward — preserves length; rarely musical at full-phrase scale (discouraged)',
  augment_2x: 'DOUBLE the durations — DOUBLES total length (only valid in a slot twice the phrase\'s natural length)',
  diminute_2x: 'HALVE the durations — HALVES total length',
  fragment_head: 'keep only the first half of the notes — roughly HALVES length',
  fragment_tail: 'keep only the last half of the notes — roughly HALVES length',
  ornament_upper_neighbor: 'decorate a note with the step above (params.at_position; prefer an INTERIOR note) — preserves length',
  ornament_lower_neighbor: 'decorate a note with the step below (params.at_position; prefer an INTERIOR note) — preserves length',
  ornament_chromatic_passing: 'insert a chromatic passing tone (params.at_position) — preserves length; consumes the anomaly budget',
};

// The names validation accepts: every transformations.js export, plus the
// reserved cadential_gesture slot. Derived from the module so it can't drift.
const RECOGNIZED_TRANSFORMS = new Set(
  Object.keys(Transforms).filter((name) => typeof Transforms[name] === 'function')
);
const CADENTIAL_GESTURE = 'cadential_gesture';
const isRecognizedTransform = (name) => RECOGNIZED_TRANSFORMS.has(name) || name === CADENTIAL_GESTURE;

const ARRANGEMENT_ADVENTUROUSNESS_DIRECTIVE = {
  tame:
    'Every section is its phrase, LITERAL. The phrases themselves carry the piece; add no variation at the '
    + 'arrangement layer. (transform "literal", start_bar 1, length_bars = the section\'s bar count.)',
  adventurous:
    'Place the STATEMENT, any REPETITION, and the CONTRAST section LITERALLY. The REPRISE (the returning A '
    + 'section) MAY take a small LENGTH-PRESERVING variation for emphasis or colour — an ornament_* or a '
    + 'transpose_third — but only if it genuinely improves the closing restatement. Variation is per-section, not '
    + 'bar-by-bar.',
  wild:
    'Any A-type section may take a LENGTH-PRESERVING variation (transpose_third, sequence, ornament_*). B-type '
    + '(contrast) sections stay LITERAL — their contrast comes from the phrase itself, not from an applied '
    + 'transform. Keep it musical: a variation should serve the restatement, not just decorate for its own sake.',
};
const DEFAULT_ARRANGEMENT_ADVENTUROUSNESS = 'tame';

function arrangementAdventurousnessOf(config) {
  const value = config?.knobs?.arrangement_adventurousness;
  return value in ARRANGEMENT_ADVENTUROUSNESS_DIRECTIVE ? value : DEFAULT_ARRANGEMENT_ADVENTUROUSNESS;
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

// Catch a transform whose params would crash the theory-layer realization, so the
// defect is caught at the seam (and fed to the retry) instead of blowing up in
// Stage 6. Returns an error string, or null when the params are fine.
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

function beatsPerBarOf(meter) {
  return meter?.numerator ?? 4;
}

// =================================================================
// REALIZED-BEATS — apply a transform to the referenced phrase and sum the
// resulting rhythm. This is the SAME realization-math the transforms encode (it
// applies the real transform fn), so the beat-length check matches what Stage 6
// will lay down. Returns null when it can't be computed (so the check skips
// rather than throwing): a null motif / cadential_gesture realizes nothing, and a
// throwing transform can't be measured here.
// =================================================================

function realizedBeatsOf(motif, name, params) {
  if (!motif || !Array.isArray(motif.rhythm)) return null;
  if (name === CADENTIAL_GESTURE) return null;
  const fn = Transforms[name];
  if (typeof fn !== 'function') return null;
  let transformed;
  try {
    transformed = fn(motif, params ?? {});
  } catch {
    return null;
  }
  if (!transformed || !Array.isArray(transformed.rhythm)) return null;
  return transformed.rhythm.reduce((total, b) => total + (typeof b === 'number' && Number.isFinite(b) ? b : 0), 0);
}

// =================================================================
// CHORD-FIT GUARD HELPERS (Session 11, reduced scope). The transforms that shift
// the WHOLE phrase by a constant interval, so a phrase that fit its chords can
// land off a bar's chord. literal/retrograde/fragment/invert/ornament/augment/
// diminute keep the phrase on/near its authored pitches, so they're exempt.
// =================================================================

const TRANSPOSING_TRANSFORMS = new Set([
  'sequence_up_step', 'sequence_down_step', 'transpose_step', 'transpose_third',
]);

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

const inOctaveDegree = (degree) => (((degreeToLinear(degree) % 7) + 7) % 7) + 1;

// How many of a transformed phrase's notes are chord tones of `roman`. Returns
// null when it can't be computed (unparseable chord, bad phrase, throwing transform).
function chordToneHitCount(motif, name, params, roman) {
  const tones = chordToneDegreesOf(roman);
  if (!tones || !motif || !Array.isArray(motif.degrees) || motif.degrees.length === 0) return null;
  const fn = Transforms[name];
  if (typeof fn !== 'function') return null;
  let transformed;
  try {
    transformed = fn(motif, params ?? {});
  } catch {
    return null;
  }
  if (!transformed || !Array.isArray(transformed.degrees)) return null;
  const toneSet = new Set(tones);
  return transformed.degrees.reduce(
    (count, d) => (Number.isInteger(d) && d !== 0 && toneSet.has(inOctaveDegree(d)) ? count + 1 : count),
    0
  );
}

// =================================================================
// SECTION RELATIONSHIPS — prefer the curated form metadata remapped onto the
// actual labels by position; fall back to deriving from the label letter-pattern.
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
  return [
    'PIECE',
    `- key: ${String(macroParams.tonic)} ${macroParams.mode}`,
    `- form: ${macroParams.form ?? 'n/a'}`,
    `- tempo: ${macroParams.tempo ?? 'n/a'} BPM, meter ${meter.numerator}/${meter.denominator}`,
    `- sections in order: ${sectionList}`,
    `- MOOD: ${macroParams.mood ?? '(unspecified)'}`,
  ].join('\n');
}

// Each section's PHRASE, summarized one line: enough to recognize it (first few
// degrees + length + contour), not the whole array. The phrases were written by
// Stage 4; the arranger places them.
function phrasesSummary(motifs) {
  if (!motifs || Object.keys(motifs).length === 0) return 'PHRASES\n- (none supplied)';
  const lines = Object.entries(motifs).map(([label, m]) => {
    const degrees = Array.isArray(m.degrees) ? m.degrees : [];
    const head = degrees.slice(0, 6).join(', ');
    const tail = degrees.length > 6 ? ', …' : '';
    return `- ${label}: degrees [${head}${tail}] (${degrees.length} notes), contour ${m.contour ?? '?'}, register ${m.register ?? '?'}`;
  });
  return [
    'PHRASES (one per section, already written — keyed by section label). Each phrase FILLS its section. You '
      + 'place each one; you do not rewrite them:',
    ...lines,
  ].join('\n');
}

function formMetadataSummary(relationships, plan) {
  const lines = plan.map((s) => {
    const rel = relationships[s.label] ?? {};
    const parts = [rel.role ?? 'section'];
    if (rel.of) parts.push(`of ${rel.of}`);
    if (rel.variation) parts.push(`(${rel.variation})`);
    if (rel.contrast_from) parts.push(`vs ${rel.contrast_from}`);
    return `- ${s.label}: ${parts.join(' ')}`;
  });
  return ['FORM ROLES (how each section relates — informs whether a variation suits it)', ...lines].join('\n');
}

function transformVocabulary() {
  const lines = [...RECOGNIZED_TRANSFORMS].map((name) => `  - ${name}: ${TRANSFORM_DESCRIPTIONS[name] ?? ''}`);
  return [
    'TRANSFORMS (use ONLY these names for "transform"; "literal" is the default and the right choice for most '
      + 'sections):',
    ...lines,
    'NOTE: a phrase already fills its whole section, so a LENGTH-PRESERVING transform on a single full-section '
      + 'assignment is the safe choice. The LENGTH-CHANGING transforms (augment_2x, diminute_2x, fragment_head, '
      + 'fragment_tail) only fit if you also size length_bars to the realized length (or split the section into '
      + 'matching sub-assignments) — otherwise the arrangement leaves a gap or overflows and is rejected.',
  ].join('\n');
}

function placementRules(plan) {
  const example = plan.length ? plan[0] : { label: 'A1', bars: 4 };
  return [
    'PLACEMENT RULES (enforced — a plan that breaks them is rejected):',
    '- Each section\'s `lead` assignments together must COVER bars 1..section.bars with NO gaps and NO overlaps.',
    '- The TYPICAL section is ONE assignment: { "motif": "<that section\'s label>", "transform": "literal", '
      + `"start_bar": 1, "length_bars": <the section's bar count> } (e.g. ${example.label} → length_bars ${example.bars}).`,
    '- A placed phrase\'s REALIZED length (after the transform) must fill its bar-slot exactly — not shorter (a '
      + 'gap) and not longer (an overflow).',
    '- Use each section\'s OWN phrase as its material (motif = the section\'s label). You MAY reference another '
      + 'section\'s phrase to literally restate it (e.g. a repetition section replaying the statement\'s phrase).',
  ].join('\n');
}

function schemaSkeleton(plan) {
  const sectionLines = plan
    .map(
      (s) =>
        `    ${JSON.stringify(s.label)}: { "lead": [ { "motif": ${JSON.stringify(s.label)}, "transform": "literal", `
        + `"start_bar": 1, "length_bars": ${s.bars} } ] }`
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
    '- Each section is { "lead": [ assignments ] } (an optional "phrase_structure" string may be included but is '
      + 'ignored).',
    '- Each assignment is { "motif": <a section label or null>, "transform": <a transform name, or a '
      + '{"name": …, "params": {…}} object>, "start_bar": <1-indexed>, "length_bars": <integer >= 1> }.',
    '- Cover every bar of each section; do not overlap. When in doubt, ONE literal assignment per section is correct.',
  ].join('\n');
}

/**
 * Build the Stage 5a prompt as { system, user }. Pure (no I/O), so the inspector
 * can display it and the verifier can assert on it.
 */
export function buildPhrasePlanPrompt({ macroParams, motifs, harmonicPlan, config }) {
  const plan = computeSectionPlan(macroParams);
  const relationships = sectionRelationshipsForPlan(macroParams, plan);
  const adventurousness = arrangementAdventurousnessOf(config);

  const system =
    'You are arranging melodic phrases across the form of a chiptune piece. You decide whether each section '
    + 'plays its phrase literally or with a small variation. Your output is a strict JSON object matching the '
    + 'given schema; no commentary.';

  const user = [
    pieceSummary(macroParams, plan),
    phrasesSummary(motifs),
    formMetadataSummary(relationships, plan),
    transformVocabulary(),
    placementRules(plan),
    `ARRANGEMENT ADVENTUROUSNESS — ${adventurousness}:\n  ${ARRANGEMENT_ADVENTUROUSNESS_DIRECTIVE[adventurousness]}`,
    schemaBlock(plan),
  ].join('\n\n');

  return { system, user };
}

function buildRetryPrompt(errors) {
  return [
    'The JSON you returned did not pass validation. Fix these specific problems and return the corrected JSON '
      + 'object — the full PhrasePlan, same schema, no commentary:',
    '',
    errors.map((e) => `- ${e}`).join('\n'),
    '',
    'Return ONLY the corrected JSON object.',
  ].join('\n');
}

// =================================================================
// LLM CALL
// =================================================================

async function callPhraseLLM(system, messages) {
  return postMessages(
    { model: STAGE_5A_MODEL, max_tokens: STAGE_5A_MAX_TOKENS, system, messages },
    'Stage 5a'
  );
}

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
// VALIDATION — validatePhrasePlan checks the WRAPPED LLM envelope. Returns
// { ok, errors, warnings }; ok is true only when errors is empty. Collects ALL
// hard defects in one pass so the single retry sees them together.
// =================================================================

/**
 * Validate one section's `lead` array: each assignment well-formed, the bar
 * ranges cover the section with no gaps/overlaps (HARD), each placed phrase's
 * REALIZED length fills its slot (HARD), and the chord-fit guard (HARD). Pushes
 * every defect via `push`, soft notes via `warn`, and returns
 * `{ usedNonLiteral }` for the knob-alignment soft check.
 */
function validateLead(lead, label, bars, beatsPerBar, motifs, motifNames, push, warn, harmonyContext) {
  const summary = { usedNonLiteral: false };
  if (!Array.isArray(lead)) {
    push(`Section "${label}" "lead" must be an array of assignments.`);
    return summary;
  }
  if (lead.length === 0) {
    push(`Section "${label}" "lead" is empty — it must place at least one phrase assignment.`);
    return summary;
  }

  const placed = []; // { start, length, motif, name, label, key }
  lead.forEach((assignment, i) => {
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
      push(`Section "${label}" lead assignment ${i} must be an object.`);
      return;
    }

    // motif: null or a known phrase key (a section label)
    const motif = assignment.motif === undefined ? undefined : assignment.motif;
    const motifValid = motif === null || (typeof motif === 'string' && motifNames.has(motif));
    if (!motifValid) {
      push(
        `Section "${label}" lead assignment ${i}: motif ${JSON.stringify(motif)} is not null or a known phrase `
          + `(${[...motifNames].join(', ') || 'none'}).`
      );
    }

    // transform: a recognized name (transformations.js export) or cadential_gesture,
    // and — if recognized — params that won't crash the realization.
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

      // THE DETERMINISTIC BEAT-LENGTH / OVERFLOW CHECK (HARD). Apply the transform
      // to the referenced phrase, sum the realized rhythm, and assert it fills the
      // bar-slot exactly — no overflow (runs past the next assignment / section
      // end) and no internal gap (the phrase doesn't fill its slot). This closes
      // the hollow-reprise + per-bar-gap findings at the source.
      const slotBeats = length * beatsPerBar;
      if (motif === null || parsed.name === CADENTIAL_GESTURE) {
        // A rest assignment realizes nothing — it cannot fill a bar-slot.
        push(
          `Section "${label}" lead assignment ${i} (motif ${motifDisplay(motif)}, transform "${transformLabel(parsed)}") `
            + `realizes to 0.0 beats but its length_bars=${length} expects ${slotBeats.toFixed(1)} beats. This leaves a `
            + `${slotBeats.toFixed(1)}-beat gap — place the section's phrase here instead of a rest.`
        );
      } else if (typeof motif === 'string' && motifs[motif]) {
        const realized = realizedBeatsOf(motifs[motif], parsed.name, parsed.params);
        if (realized != null) {
          if (realized > slotBeats + BEATS_EPSILON) {
            push(
              `Section "${label}" lead assignment ${i} (motif "${motif}", transform "${transformLabel(parsed)}") `
                + `realizes to ${realized.toFixed(1)} beats but its length_bars=${length} only allows `
                + `${slotBeats.toFixed(1)} beats — it overflows by ${(realized - slotBeats).toFixed(1)}. Use a `
                + 'length-preserving transform (literal/transpose_step/sequence_*) or give it more bars.'
            );
          } else if (realized < slotBeats - BEATS_EPSILON) {
            push(
              `Section "${label}" lead assignment ${i} (motif "${motif}", transform "${transformLabel(parsed)}") `
                + `realizes to ${realized.toFixed(1)} beats but its length_bars=${length} expects `
                + `${slotBeats.toFixed(1)} beats. This leaves a ${(slotBeats - realized).toFixed(1)}-beat internal gap. `
                + 'Either choose a transform that preserves length (literal/transpose_step/sequence_*) or split the '
                + 'section into multiple assignments.'
            );
          }
        }
      }
    }

    // CHORD-FIT GUARD (Session 11, reduced scope — a SAFETY NET). A TRANSPOSING
    // transform that shifts the phrase ENTIRELY off its bar's chord (zero chord
    // tones) is a wholesale clash; reject it. Fires rarely now (the phrase was
    // authored chord-fit upstream) — it catches a variation that transposes
    // off-chord. Checked against the assignment's START bar's chord.
    if (
      harmonyContext
      && rangeOk
      && TRANSPOSING_TRANSFORMS.has(parsed.name)
      && typeof motif === 'string'
      && harmonyContext.motifs?.[motif]
    ) {
      const roman = harmonyContext.progression?.[start - 1];
      const hits = chordToneHitCount(harmonyContext.motifs[motif], parsed.name, parsed.params, roman);
      if (hits === 0) {
        push(
          `Section "${label}" bar ${start}: ${transformLabel(parsed)} shifts phrase "${motif}" entirely off bar `
            + `${start}'s chord ${roman} (chord tones: degrees ${chordToneDegreesOf(roman).join(', ')}) — none of the `
            + 'transposed notes are chord tones, a wholesale clash. Use "literal" or a different variation.'
        );
      }
    }

    if (typeof motif === 'string' && motifNames.has(motif)) {
      if (isRecognizedTransform(parsed.name) && parsed.name !== 'literal' && parsed.name !== CADENTIAL_GESTURE) {
        summary.usedNonLiteral = true;
      }
    }
  });

  if (placed.length === 0) return summary; // every assignment was malformed; already flagged

  const sorted = [...placed].sort((a, b) => a.start - b.start);

  // Adjacent-identical { motif, transform } pair — SOFT (Session-11 discipline).
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].key === sorted[k - 1].key) {
      warn(
        `section "${label}" repeats the identical assignment at bars ${sorted[k - 1].start} and `
          + `${sorted[k].start}: motif ${motifDisplay(sorted[k].motif)} with transform "${sorted[k].label}" `
          + '(back-to-back repeat — soft note, not a failure).'
      );
    }
  }

  // COVERAGE (HARD): bars must be covered 1..bars with no gaps, no overlaps.
  if (sorted[0].start !== 1) {
    push(`Section "${label}" lead does not start at bar 1 (first assignment starts at bar ${sorted[0].start}).`);
  }
  for (let k = 1; k < sorted.length; k++) {
    const prevEnd = sorted[k - 1].start + sorted[k - 1].length; // first free bar after prev
    if (prevEnd > sorted[k].start) {
      push(
        `Section "${label}" lead has overlapping assignments: bars [${sorted[k - 1].start}..${prevEnd - 1}] `
          + `overlaps the assignment starting at bar ${sorted[k].start}.`
      );
    } else if (prevEnd < sorted[k].start) {
      push(
        `Section "${label}" lead has an uncovered gap: bars [${prevEnd}..${sorted[k].start - 1}] have no phrase. `
          + 'Every bar of the section must be covered.'
      );
    }
  }
  const last = sorted[sorted.length - 1];
  const coveredThrough = last.start + last.length - 1;
  if (coveredThrough > bars) {
    push(
      `Section "${label}" lead overflows the section: an assignment runs to bar ${coveredThrough} but the section `
        + `has only ${bars} bars.`
    );
  } else if (coveredThrough < bars) {
    push(
      `Section "${label}" lead leaves bars [${coveredThrough + 1}..${bars}] uncovered — the phrase must fill the `
        + 'whole section.'
    );
  }

  return summary;
}

/**
 * Validate the WRAPPED PhrasePlan envelope `{ sections: { <label>: {
 * phrase_structure?, lead } } }` against `macroParams` + `motifs` (the per-section
 * phrase map). Returns { ok, errors, warnings }.
 *
 * `harmonicPlan` (optional, the §3 array) enables the chord-fit guard. Absent it
 * (the 3-arg form), the guard is skipped — back-compatible.
 */
export function validatePhrasePlan(wrappedPlan, macroParams, motifs, harmonicPlan = undefined) {
  const errors = [];
  const warnings = [];
  const push = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  if (!wrappedPlan || typeof wrappedPlan !== 'object' || Array.isArray(wrappedPlan)) {
    return { ok: false, errors: ['PhrasePlan must be a JSON object.'], warnings };
  }
  const sections = wrappedPlan.sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return { ok: false, errors: ['PhrasePlan.sections must be an object keyed by section label.'], warnings };
  }

  let plan;
  try {
    plan = computeSectionPlan(macroParams);
  } catch (error) {
    return { ok: false, errors: [`Could not derive the section plan from macroParams: ${error.message}`], warnings };
  }
  const beatsPerBar = beatsPerBarOf(macroParams.meter);
  const expectedLabels = plan.map((s) => s.label);
  const barsByLabel = new Map(plan.map((s) => [s.label, s.bars]));
  const motifMap = motifs && typeof motifs === 'object' ? motifs : {};
  const motifNames = new Set(Object.keys(motifMap));
  const progressionByLabel = new Map((harmonicPlan?.sections ?? []).map((s) => [s.label, s.progression]));

  // The section-label set must match exactly — none missing, none extra.
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

  // Per known section: optional phrase_structure (soft) + lead (schema/coverage/
  // beat-length/chord-fit). Track whether the arrangement used any non-literal.
  let anyNonLiteral = false;
  for (const label of Object.keys(sections)) {
    if (!barsByLabel.has(label)) continue; // already flagged as unexpected
    const bars = barsByLabel.get(label);
    const sectionPlan = sections[label];
    if (!sectionPlan || typeof sectionPlan !== 'object' || Array.isArray(sectionPlan)) {
      push(`Section "${label}" must be an object with a "lead" array.`);
      continue;
    }
    // phrase_structure is OPTIONAL metadata now — if present and unrecognized, warn (never fail).
    if (sectionPlan.phrase_structure !== undefined && !PHRASE_STRUCTURES.has(sectionPlan.phrase_structure)) {
      warn(
        `section "${label}" phrase_structure ${JSON.stringify(sectionPlan.phrase_structure)} is not a recognized `
          + 'structure name — it is ignored metadata, so this is a soft note.'
      );
    }
    const harmonyContext = harmonicPlan
      ? { motifs: motifMap, progression: progressionByLabel.get(label) }
      : null;
    const summary = validateLead(sectionPlan.lead, label, bars, beatsPerBar, motifMap, motifNames, push, warn, harmonyContext);
    if (summary.usedNonLiteral) anyNonLiteral = true;
  }

  // `anyNonLiteral` lets generatePhrasePlan emit the knob-alignment soft note (a
  // "wild"-knob arrangement that placed everything literally added no variation).
  // It lives there because the knob rides on `config`, which the validator — kept
  // pure over (plan, macroParams, motifs, harmonicPlan) — does not receive.
  return { ok: errors.length === 0, errors, warnings, anyNonLiteral };
}

// Unwrap the validated envelope into the flat §3 PhrasePlan the pipeline consumes.
function unwrapPhrasePlan(wrapped) {
  return wrapped.sections;
}

// =================================================================
// THE STAGE — generatePhrasePlan
// =================================================================

/**
 * Generate a PhrasePlan (arrangement) for the supplied upstream context. Returns
 * the flat `{ <label>: { lead } }` plan Stage 5b / Stage 6 consume.
 *
 * Modes:
 *   - Live: builds the prompt, calls the LLM, validates; on validation failure it
 *     retries ONCE with the specific errors fed back, then throws if still invalid.
 *   - Offline: pass `__mockResponse` (a JSON string) to skip the network.
 *
 * `onTrace`, if supplied, is called per model round-trip and once more with
 * `{ attempt: 'soft-note', warnings }` if any soft notes fired. Never required.
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
  const adventurousness = arrangementAdventurousnessOf(config);

  // Collect a validated plan's soft notes, plus the knob-alignment note (a
  // "wild"-knob arrangement that placed everything literally added no variation).
  const emitSoftWarnings = (result) => {
    const warns = [...(result.warnings ?? [])];
    if (adventurousness === 'wild' && result.anyNonLiteral === false) {
      warns.push(
        'arrangement_adventurousness is "wild" but every section was placed literally — the arrangement layer '
          + 'added no variation (soft note; the phrases may still carry the piece).'
      );
    }
    if (warns.length > 0) {
      trace({ attempt: 'soft-note', raw: null, ok: true, errors: [], warnings: warns });
      for (const warning of warns) console.warn(`Stage 5a (soft): ${warning}`);
    }
  };

  // --- Offline / deterministic fallback: same parse + validate, no network. ---
  if (__mockResponse !== undefined) {
    const parsed = parsePhrasePlanResponse(__mockResponse); // throws clearly on bad JSON
    const result = validatePhrasePlan(parsed, macroParams, motifs, harmonicPlan);
    trace({ attempt: 0, raw: __mockResponse, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 5a: mock response failed validation. Raw:\n', __mockResponse);
      throw new Error(`Stage 5a: mock PhrasePlan is invalid:\n  - ${result.errors.join('\n  - ')}`);
    }
    emitSoftWarnings(result);
    return unwrapPhrasePlan(parsed);
  }

  // --- Live path: call, validate, retry once with the errors fed back. ---
  const messages = [{ role: 'user', content: user }];
  let raw = await callPhraseLLM(system, messages);
  let result;
  let parsed;
  try {
    parsed = parsePhrasePlanResponse(raw);
    result = validatePhrasePlan(parsed, macroParams, motifs, harmonicPlan);
  } catch (parseError) {
    result = { ok: false, errors: [parseError.message], warnings: [] };
  }
  trace({ attempt: 1, raw, ok: result.ok, errors: result.errors });

  if (!result.ok) {
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: buildRetryPrompt(result.errors) });
    raw = await callPhraseLLM(system, messages);
    parsed = parsePhrasePlanResponse(raw); // throws clearly if still unparseable
    result = validatePhrasePlan(parsed, macroParams, motifs, harmonicPlan);
    trace({ attempt: 2, raw, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 5a: PhrasePlan failed validation after one retry. Raw:\n', raw);
      throw new Error(`Stage 5a: PhrasePlan is invalid after one retry:\n  - ${result.errors.join('\n  - ')}`);
    }
  }

  emitSoftWarnings(result);
  return unwrapPhrasePlan(parsed);
}
