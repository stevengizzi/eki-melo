/* =================================================================
   STAGE 5b — TEXTURE CHOREOGRAPHY (buildplan Session 8 — FIRST LLM STAGE).

   This is the first stage where a language model makes creative decisions
   inside constraints we enforce. Sessions 1–7 built the deterministic
   back-half (Stages 6/7/8 + theory); Stage 5b begins the LLM-driven
   front-half. The patterns established here — prompt-building separated from
   the fetch, strict JSON-schema validation, validate-then-retry-once, a
   deterministic offline fallback for testing, and freedom-knob plumbing —
   are deliberately reusable by Sessions 9/10/11 (Stages 5a/4/3).

     generateTexturePlan({ macroParams, motifs, harmonicPlan, phrasePlan,
                           config, __mockResponse?, onTrace? }) → TexturePlan

   THE TWO SHAPES (and why they differ). The LLM emits — and validateTexturePlan
   checks — the WRAPPED envelope `{ sections: { <label>: { harmony, bass } } }`.
   A top-level `sections` key is clearer for the model and matches the Session-8
   response schema. But the canonical inter-stage TexturePlan (buildplan §3, what
   Stage 6 consumes, what the hand-supplied inspector cases use) is FLAT:
   `{ <label>: { harmony, bass } }`. So generateTexturePlan validates the wrapped
   envelope, then UNWRAPS `.sections` and returns the flat plan. The wrapped form
   is purely Stage 5b's LLM I/O envelope; the seam to the rest of the pipeline is
   the flat §3 TexturePlan. This keeps `input.texturePlan` one consistent shape
   whether hand-supplied or generated.

   OUTPUT (flat TexturePlan, exactly what Stage 6 already consumes):
     {
       <label>: {
         harmony: [{ mode: <texture_name>, bars: [start, end], params? }, …],
         bass:    [{ pattern: <bass_pattern_name>, bars: [start, end], params? }, …]
       },
       …
     }
   where `bars` are 1-indexed, section-relative, contiguous, and tile each
   section completely (no gaps, no overlaps) — enforced by validateTexturePlan.

   OFFLINE / DETERMINISTIC FALLBACK. Pass `__mockResponse` (a JSON string) to
   skip the network entirely and run that string through the SAME parse +
   validate path as a real model response. This is how verify-stage5b.mjs
   exercises the stage without an API call.

   API. Mimics the deployed generator's call shape (js/jingle/api.js): POST the
   Anthropic Messages body to API_ENDPOINT, force a JSON-only response by
   instruction (the Messages API has no response_format), then strip code fences
   and JSON.parse with a brace-match fallback. The model is pinned to the one the
   /api/generate allow-list permits, so both runtime modes (deployed Pages +
   Claude.ai artifact) work without touching the server.

   PORTABILITY. This is pipeline/ code: it may import theory/ and js/env.js. It
   does NOT modify api.js (read-only this session) — it mimics its patterns.
   ================================================================= */
import { postMessages } from './llm-call.js';
import { TEXTURE_REGISTRY } from '../theory/textures.js';
import { BASS_PATTERNS } from '../theory/bass-patterns.js';
import { computeSectionPlan } from './stage-6-voice.js';

// The /api/generate allow-list only permits this model (see
// functions/api/generate.js ALLOWED_MODELS); api.js uses the same one. Pinning
// it keeps the deployed proxy path AND the artifact direct path working without
// a server change. A model upgrade is a coordinated allow-list change (Session 12+).
const STAGE_5B_MODEL = 'claude-sonnet-4-20250514';
const STAGE_5B_MAX_TOKENS = 2000;

// =================================================================
// VOCABULARY — the strict choice sets, with one-line descriptions for the
// prompt. Built off the registries' own keys so the listing can never drift
// from what validation accepts.
// =================================================================

const TEXTURE_DESCRIPTIONS = {
  parallel_thirds_below: 'shadows the melody a third below — sweet, conventional close harmony (the default)',
  parallel_thirds_above: 'a third above the melody — bright upper harmony',
  parallel_sixths_below: 'a sixth below the melody — warm and open',
  parallel_sixths_above: 'a sixth above the melody — high and shimmering',
  contrary_motion: 'moves opposite to the melody — independent, contrapuntal',
  oblique_held: "holds the chord's root (or fifth via params.degree=5) while the melody moves — a sustained pad",
  drone_on_1: 'holds the tonic across the passage — grounded, modal, folk-like',
  drone_on_5: 'holds the dominant (open fifth) — suspense, anticipation',
  imitation_one_beat_delay: 'echoes the melody one beat later — canon, call-and-response',
  voice_exchange: 'doubles the melody an octave below — reinforces the line, fuller',
  dropout: 'silent for the passage — breath, contrast, exposes the melody alone',
  chord_tones_pulse: 'pulses chord tones in steady eighth notes — rhythmic drive',
  heterophony: 'shadows the melody with added passing tones — ornamented, busier doubling',
};

const BASS_DESCRIPTIONS = {
  root_fifth: 'alternates the chord root and fifth — steady, foundational (the default)',
  walking: 'stepwise quarter-note line walking between chord roots — propulsive (4/4 only)',
  pedal: 'holds the tonic (or fifth via params.degree=5) under everything — static, suspenseful',
  arpeggio: 'broken chord (root-third-fifth) in eighths — energetic, lively',
  cadential_5_1: "a V→I bass at a section's end — cadential punctuation; idiomatic in the final bar",
};

const ADVENTUROUSNESS_DIRECTIVE = {
  tame:
    'Keep it simple — mostly parallel_thirds_below for harmony and root_fifth for bass throughout, '
    + 'with minimal variation. Favor the conventional choice.',
  adventurous:
    'Vary the texture per section and use contrast — e.g. a drone or oblique pad under a B section, '
    + 'imitation on a bridge, a dropout to let the melody breathe, a cadential_5_1 to close a section. '
    + 'Do not use the same texture everywhere; let each section have an identity.',
  wild:
    'Change texture often — roughly a different texture every 4–8 bars. Reach for the bolder textures '
    + '(contrary_motion, imitation_one_beat_delay, heterophony, voice_exchange, dropout) and lean into '
    + 'sharp contrast between sections. Surprise is welcome.',
};

const DEFAULT_ADVENTUROUSNESS = 'adventurous';

function adventurousnessOf(config) {
  const value = config?.knobs?.texture_adventurousness;
  return value in ADVENTUROUSNESS_DIRECTIVE ? value : DEFAULT_ADVENTUROUSNESS;
}

const vocabularyLines = (registry, descriptions) =>
  Object.keys(registry)
    .map((name) => `  - ${name}: ${descriptions[name] ?? ''}`)
    .join('\n');

// =================================================================
// PROMPT BUILDING — kept separate from the fetch so Sessions 9–11 can mimic
// the structure. Returns { system, user }.
// =================================================================

// "name@k=v" string form or { name, params } object form → a readable label.
function transformLabel(spec) {
  if (spec && typeof spec === 'object') {
    const params = spec.params && Object.keys(spec.params).length
      ? `(${Object.entries(spec.params).map(([k, v]) => `${k}=${v}`).join(',')})`
      : '';
    return `${spec.name}${params}`;
  }
  return String(spec ?? 'literal');
}

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
    return `- ${name}: degrees [${(m.degrees ?? []).join(', ')}], contour ${m.contour ?? '?'}, register ${m.register ?? '?'}${anomaly}`;
  });
  return ['MOTIFS (melodic cells, in scale degrees)', ...lines].join('\n');
}

function harmonySummary(harmonicPlan) {
  const sections = harmonicPlan?.sections ?? [];
  if (sections.length === 0) return 'HARMONIC PLAN\n- (none supplied)';
  const lines = sections.map(
    (s) => `- ${s.label}: ${(s.progression ?? []).join(' ')}  (cadence: ${s.cadence ?? 'none'})`
  );
  return ['HARMONIC PLAN (Roman numerals, per section)', ...lines].join('\n');
}

function phraseSummary(phrasePlan, plan) {
  const lines = plan.map((s) => {
    const sectionPlan = phrasePlan?.[s.label];
    if (!sectionPlan || !Array.isArray(sectionPlan.lead)) return `- ${s.label}: (no phrasing)`;
    const structure = sectionPlan.phrase_structure ? ` [${sectionPlan.phrase_structure}]` : '';
    const cells = sectionPlan.lead
      .map((a) => `${a.motif ?? '—'}/${transformLabel(a.transform)}@b${a.start_bar}`)
      .join(', ');
    return `- ${s.label}${structure}: ${cells}`;
  });
  return ['PHRASE PLAN (which motif lands where; bars are section-relative)', ...lines].join('\n');
}

// The exact JSON skeleton the model fills in, listing each section with its bar
// count so coverage lands correctly.
function schemaSkeleton(plan) {
  const sectionLines = plan
    .map(
      (s) =>
        `    ${JSON.stringify(s.label)}: { "harmony": [ /* tile bars 1..${s.bars} */ ], "bass": [ /* tile bars 1..${s.bars} */ ] }`
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
    '- For EVERY section, the "harmony" assignments must tile bars 1..N with NO gaps and NO overlaps '
      + '(N = that section\'s bar count shown above). The "bass" assignments must tile the same range, independently.',
    '- "bars" is [start, end], 1-indexed and inclusive: [1, 4] covers bars 1,2,3,4; [3, 3] covers only bar 3.',
    '- "mode" must be one of the harmony texture names; "pattern" must be one of the bass pattern names. Nothing else is accepted.',
    '- You MAY add an optional "params" object to an assignment (e.g. {"degree": 5} to voice oblique_held / a drone / pedal on the fifth).',
    '- Choose textures and bass patterns that suit each section\'s role, mood, and motif — this is a composerly decision, not a default fill.',
  ].join('\n');
}

/**
 * Build the Stage 5b prompt as { system, user }. Pure (no I/O), so the inspector
 * can display it and Sessions 9–11 can mimic the structure.
 */
export function buildTexturePlanPrompt({ macroParams, motifs, harmonicPlan, phrasePlan, config }) {
  const plan = computeSectionPlan(macroParams);
  const adventurousness = adventurousnessOf(config);

  const system =
    'You are a composer choosing textures and bass patterns to choreograph a chiptune piece. '
    + 'Your output is a strict JSON object matching the given schema; no commentary.';

  const user = [
    pieceSummary(macroParams, plan),
    motifsSummary(motifs),
    harmonySummary(harmonicPlan),
    phraseSummary(phrasePlan, plan),
    `AVAILABLE HARMONY TEXTURES (use ONLY these names for "mode"):\n${vocabularyLines(TEXTURE_REGISTRY, TEXTURE_DESCRIPTIONS)}`,
    `AVAILABLE BASS PATTERNS (use ONLY these names for "pattern"):\n${vocabularyLines(BASS_PATTERNS, BASS_DESCRIPTIONS)}`,
    `TEXTURE ADVENTUROUSNESS — ${adventurousness}:\n  ${ADVENTUROUSNESS_DIRECTIVE[adventurousness]}`,
    schemaBlock(plan),
  ].join('\n\n');

  return { system, user };
}

function buildRetryPrompt(errors) {
  return [
    'The JSON you returned did not pass validation. Fix these specific problems and return the '
      + 'corrected JSON object — the full TexturePlan, same schema, no commentary:',
    '',
    errors.map((e) => `- ${e}`).join('\n'),
    '',
    'Return ONLY the corrected JSON object.',
  ].join('\n');
}

// =================================================================
// LLM CALL — mimics js/jingle/api.js's fetch / headers / error-handling shape.
// =================================================================

async function callTextureLLM(system, messages) {
  return postMessages(
    { model: STAGE_5B_MODEL, max_tokens: STAGE_5B_MAX_TOKENS, system, messages },
    'Stage 5b'
  );
}

// Strip code fences (if the model wrapped the JSON) and parse, with a
// brace-match fallback. Logs the raw response and throws clearly on failure.
function parseTexturePlanResponse(raw) {
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
    console.error('Stage 5b: could not parse the model response as JSON. Raw response:\n', raw);
    throw new Error('Stage 5b: model response was not valid JSON (see console for the raw response).');
  }
}

// =================================================================
// VALIDATION — validateTexturePlan checks the WRAPPED LLM envelope. Exported so
// verify-stage5b.mjs can stress-test it on hand-crafted good/bad plans without
// re-deriving the logic. Collects ALL defects (does not stop at the first), so a
// retry can address them together.
// =================================================================

// Validate one voice's assignment list: each assignment well-formed and from the
// allowed registry, every bar range in [1, bars], and the ranges tiling [1, bars]
// contiguously with no gaps or overlaps.
function validateVoice(assignments, voice, label, bars, registry, nameKey, kind, push) {
  if (!Array.isArray(assignments)) {
    push(`Section "${label}" ${voice} must be an array of assignments.`);
    return;
  }
  if (assignments.length === 0) {
    push(`Section "${label}" ${voice} is empty — it must cover bars 1..${bars}.`);
    return;
  }

  const ranges = [];
  assignments.forEach((assignment, i) => {
    if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
      push(`Section "${label}" ${voice} assignment ${i} must be an object.`);
      return;
    }
    const name = assignment[nameKey];
    if (typeof name !== 'string' || !(name in registry)) {
      push(
        `Section "${label}" ${voice} assignment ${i}: unknown ${kind} ${JSON.stringify(name)}. `
          + `Allowed: ${Object.keys(registry).join(', ')}.`
      );
    }
    if (
      assignment.params !== undefined
      && (typeof assignment.params !== 'object' || assignment.params === null || Array.isArray(assignment.params))
    ) {
      push(`Section "${label}" ${voice} assignment ${i}: "params" must be an object when present.`);
    }
    const range = assignment.bars;
    if (
      !Array.isArray(range)
      || range.length !== 2
      || !Number.isInteger(range[0])
      || !Number.isInteger(range[1])
    ) {
      push(
        `Section "${label}" ${voice} assignment ${i}: "bars" must be a [start, end] tuple of integers, got ${JSON.stringify(range)}.`
      );
      return;
    }
    const [start, end] = range;
    if (start < 1 || end > bars || start > end) {
      push(
        `Section "${label}" ${voice} assignment ${i}: bars [${start}, ${end}] out of range — must be within [1, ${bars}] with start <= end.`
      );
      return;
    }
    ranges.push([start, end]);
  });

  if (ranges.length === 0) return; // every assignment was malformed; already flagged

  // Coverage: walk the ranges in start order, tracking the next bar that must be
  // covered. A jump past it is a gap; a start before it is an overlap.
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let expectedNext = 1;
  for (const [start, end] of sorted) {
    if (start > expectedNext) {
      push(`Section "${label}" ${voice} coverage gap: bars ${expectedNext}..${start - 1} are uncovered.`);
    } else if (start < expectedNext) {
      push(`Section "${label}" ${voice} coverage overlap at bar ${start} (already covered through bar ${expectedNext - 1}).`);
    }
    expectedNext = Math.max(expectedNext, end + 1);
  }
  if (expectedNext - 1 < bars) {
    push(`Section "${label}" ${voice} coverage gap: bars ${expectedNext}..${bars} are uncovered (section has ${bars} bars).`);
  }
}

/**
 * Validate the WRAPPED TexturePlan envelope `{ sections: { <label>: { harmony,
 * bass } } }` against `macroParams`. Returns { ok, errors: [] }; `ok` is true
 * only when `errors` is empty.
 */
export function validateTexturePlan(texturePlan, macroParams) {
  const errors = [];
  const push = (message) => errors.push(message);

  if (!texturePlan || typeof texturePlan !== 'object' || Array.isArray(texturePlan)) {
    return { ok: false, errors: ['TexturePlan must be a JSON object.'] };
  }
  const sections = texturePlan.sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return { ok: false, errors: ['TexturePlan.sections must be an object keyed by section label.'] };
  }

  let plan;
  try {
    plan = computeSectionPlan(macroParams);
  } catch (error) {
    return { ok: false, errors: [`Could not derive the section plan from macroParams: ${error.message}`] };
  }
  const expectedLabels = plan.map((s) => s.label);
  const barsByLabel = new Map(plan.map((s) => [s.label, s.bars]));

  // (a) the section-label set must match exactly — none missing, none extra.
  for (const label of expectedLabels) {
    if (!Object.prototype.hasOwnProperty.call(sections, label)) {
      push(`Missing section "${label}" in the texture plan (expected sections: ${expectedLabels.join(', ')}).`);
    }
  }
  for (const label of Object.keys(sections)) {
    if (!barsByLabel.has(label)) {
      push(`Unexpected section "${label}" in the texture plan — not a section in macroParams (expected: ${expectedLabels.join(', ')}).`);
    }
  }

  // (b)-(e) per known section: well-formed assignments, valid names, in-range
  // bars, full contiguous coverage, object-or-absent params.
  for (const label of Object.keys(sections)) {
    if (!barsByLabel.has(label)) continue; // already flagged as unexpected
    const bars = barsByLabel.get(label);
    const sectionPlan = sections[label];
    if (!sectionPlan || typeof sectionPlan !== 'object' || Array.isArray(sectionPlan)) {
      push(`Section "${label}" must be an object with "harmony" and "bass" arrays.`);
      continue;
    }
    validateVoice(sectionPlan.harmony, 'harmony', label, bars, TEXTURE_REGISTRY, 'mode', 'harmony texture', push);
    validateVoice(sectionPlan.bass, 'bass', label, bars, BASS_PATTERNS, 'pattern', 'bass pattern', push);
  }

  return { ok: errors.length === 0, errors };
}

// Unwrap the validated envelope into the flat §3 TexturePlan Stage 6 consumes.
function unwrapTexturePlan(wrapped) {
  return wrapped.sections;
}

// =================================================================
// THE STAGE — generateTexturePlan
// =================================================================

/**
 * Generate a TexturePlan for the supplied upstream context. Returns the flat
 * `{ <label>: { harmony, bass } }` plan Stage 6 consumes.
 *
 * Modes:
 *   - Live: builds the prompt, calls the LLM, validates; on validation failure
 *     it retries ONCE with the specific errors fed back, then throws if still
 *     invalid. (Two tries is the documented ceiling — the errors are specific
 *     enough that a competent model corrects in one or two passes.)
 *   - Offline: pass `__mockResponse` (a JSON string) to skip the network and run
 *     that string through the same parse + validate path. The only way the
 *     verifier exercises this stage without an API call.
 *
 * `onTrace`, if supplied, is called once per model round-trip (or the mock) with
 * `{ attempt, raw, ok, errors }` — used by the inspector to show the raw
 * response(s). It is never required.
 */
export async function generateTexturePlan({
  macroParams,
  motifs,
  harmonicPlan,
  phrasePlan,
  config,
  __mockResponse,
  onTrace,
} = {}) {
  if (!macroParams) throw new Error('generateTexturePlan requires macroParams.');

  const { system, user } = buildTexturePlanPrompt({ macroParams, motifs, harmonicPlan, phrasePlan, config });
  const trace = typeof onTrace === 'function' ? onTrace : () => {};

  // --- Offline / deterministic fallback: same parse + validate, no network. ---
  if (__mockResponse !== undefined) {
    const parsed = parseTexturePlanResponse(__mockResponse); // throws clearly on bad JSON
    const result = validateTexturePlan(parsed, macroParams);
    trace({ attempt: 0, raw: __mockResponse, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 5b: mock response failed validation. Raw:\n', __mockResponse);
      throw new Error(`Stage 5b: mock TexturePlan is invalid:\n  - ${result.errors.join('\n  - ')}`);
    }
    return unwrapTexturePlan(parsed);
  }

  // --- Live path: call, validate, retry once with the errors fed back. ---
  const messages = [{ role: 'user', content: user }];
  let raw = await callTextureLLM(system, messages);
  let result;
  let parsed;
  try {
    parsed = parseTexturePlanResponse(raw);
    result = validateTexturePlan(parsed, macroParams);
  } catch (parseError) {
    // Treat an unparseable first response like a validation failure so the
    // single retry gets a chance to return clean JSON.
    result = { ok: false, errors: [parseError.message] };
  }
  trace({ attempt: 1, raw, ok: result.ok, errors: result.errors });

  if (!result.ok) {
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: buildRetryPrompt(result.errors) });
    raw = await callTextureLLM(system, messages);
    parsed = parseTexturePlanResponse(raw); // throws clearly if still unparseable
    result = validateTexturePlan(parsed, macroParams);
    trace({ attempt: 2, raw, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 5b: TexturePlan failed validation after one retry. Raw:\n', raw);
      throw new Error(`Stage 5b: TexturePlan is invalid after one retry:\n  - ${result.errors.join('\n  - ')}`);
    }
  }

  return unwrapTexturePlan(parsed);
}
