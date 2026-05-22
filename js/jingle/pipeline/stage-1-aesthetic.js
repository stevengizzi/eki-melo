/* =================================================================
   STAGE 1 — AESTHETIC INTERPRETATION (buildplan Session 13 — the FIRST stage,
   the FIFTH worked LLM stage). The smallest LLM call in the build: it reads the
   guest's free-text vibe (and name) and returns one small JSON dict — the
   AESTHETIC — that Stage 2 turns into concrete macro parameters.

   THIS IS THE FRONT DOOR. Everything downstream (harmony, melody, arrangement,
   texture, voice realization) is conditioned on the choices made here, but Stage
   1 makes NONE of them concrete — it interprets the mood into a small set of
   HINTS (a mood label, and optional tonic/mode/tempo/register/form leanings) plus
   an intensity scalar. Where the mood gives a clear signal the LLM commits ("dark
   and mysterious" → mode_hint "phrygian"); where it doesn't, it defers with the
   "auto" sentinel and lets Stage 2's deterministic chooser decide. This keeps the
   soft semantic work (what does this vibe FEEL like) at the LLM seam and the hard
   structural work (which key, how many bars) deterministic in Stage 2.

     generateAesthetic({ mood, guestName?, config, __mockResponse?, onTrace? })
       → Aesthetic

   Architecturally this is the fifth worked instance of the LLM-stage template
   (sibling of Stage 3 / 4 / 5a / 5b): prompt-building separated from the fetch
   (so the inspector can show it and the verifier can assert on it), a WRAPPED LLM
   envelope `{ aesthetic: { … } }` unwrapped to the bare canonical dict at the
   seam, all-defects-in-one-pass validation, a validate-then-retry-once loop, and
   a `__mockResponse` offline fallback the verifier uses. The differentiator is
   the PROMPT (the mood-label vocabulary with definitions, the modal-character
   notes, the form bar-count ranges, the intensity guide, and the worked
   mood→aesthetic exemplars) and the validator's closed-set / range checks.

   OUTPUT (the bare Aesthetic dict Stage 2 consumes — buildplan §3 AestheticBrief,
   re-shaped for the deterministic Stage 2 chooser):
     {
       mood_label:    one of MOOD_LABELS,
       tonic_hint:    "A".."G" + optional accidental, or "auto",
       mode_hint:     a scales.json mode name (or the "natural_minor" alias), or "auto",
       tempo_hint:    integer BPM 80–160, or "auto",
       register_hint: "low" | "mid" | "high" | "auto",
       form_hint:     one of FORM_HINTS, or "auto",
       intensity:     0.0–1.0,
       notes:         free-text rationale (1–2 sentences, for human review)
     }
   The "auto" sentinels defer a field to Stage 2; mood_label and intensity never
   defer (they are the two signals Stage 2 always needs).

   OFFLINE / DETERMINISTIC FALLBACK. Pass `__mockResponse` (a JSON string) to skip
   the network and run that string through the SAME parse + validate + unwrap path
   as a real response — how verify-stage1.mjs exercises the stage offline.

   PORTABILITY. pipeline/ code: it may import theory/ + the shared transport. It
   does NOT modify api.js (read-only) — it mimics its patterns.
   ================================================================= */
import { postMessages } from './llm-call.js';
import scales from '../theory/scales.json' with { type: 'json' };

// The /api/generate allow-list only permits this model (functions/api/generate.js
// ALLOWED_MODELS); api.js + Stages 3/4/5a/5b use the same one. Pinning it keeps
// the deployed proxy path AND the artifact direct path working without a server
// change. Stage 1 needs little room — the response is one small object.
const STAGE_1_MODEL = 'claude-sonnet-4-20250514';
const STAGE_1_MAX_TOKENS = 700;

// =================================================================
// VOCABULARY — the closed sets the validator enforces and the prompt teaches.
// =================================================================

// The ten canonical mood labels. Stage 2 keys its deterministic tonic/mode/
// tempo/form defaults off this, so the set is closed and required (no "auto").
const MOOD_LABELS = [
  'triumphant', 'hopeful', 'mysterious', 'playful', 'calm',
  'energetic', 'wistful', 'dark', 'celebratory', 'intimate',
];

// One-line definitions so the LLM picks consistently across runs.
const MOOD_DEFINITIONS = {
  triumphant: 'victory, arrival, a hero entering — bright and major-keyed',
  hopeful: 'forward-looking, gently rising, optimistic but not yet arrived',
  mysterious: 'curious, unresolved, a question mark — modal colour, not gloom',
  playful: 'light, bouncy, mischievous — quick and grinning',
  calm: 'settled, unhurried, serene — slow and spacious',
  energetic: 'driving, kinetic, high-motion — fast and forward',
  wistful: 'bittersweet, nostalgic, longing — minor-tinged and tender',
  dark: 'ominous, heavy, shadowed — low and dissonant-leaning',
  celebratory: 'festive, joyous, party-bright — major and exuberant',
  intimate: 'close, quiet, personal — small and warm',
};

// The "auto"-allowed enum fields. Stage 2 fills any that defer.
const REGISTER_HINTS = ['low', 'mid', 'high', 'auto'];
const FORM_HINTS = ['AABA', 'ABA', 'AB', 'AABB', 'ternary', 'ternary_varied', 'rondo', 'auto'];

// Mode hints the validator accepts: every scale in the library, plus the
// "natural_minor" alias (the prompt names it that; scales.json calls it
// "aeolian" — Stage 2 normalizes the alias), plus "auto".
const MODE_ALIASES = { natural_minor: 'aeolian' };
const VALID_MODE_HINTS = new Set([...Object.keys(scales), ...Object.keys(MODE_ALIASES), 'auto']);

// tonic_hint: a letter A–G, an optional single/double accidental, or "auto".
const TONIC_HINT_PATTERN = /^[A-G](#{1,2}|b{1,2})?$/;

const TEMPO_MIN = 80;
const TEMPO_MAX = 160;

// =================================================================
// PROMPT BUILDING — kept separate from the fetch (so the inspector can display
// it and the verifier can assert on it). Returns { system, user }.
// =================================================================

function moodLabelGuide() {
  return [
    'MOOD LABELS — pick the ONE that best fits the vibe (this is the strongest downstream signal):',
    ...MOOD_LABELS.map((label) => `  - ${label}: ${MOOD_DEFINITIONS[label]}`),
  ].join('\n');
}

function modeGuide() {
  return [
    'MODE HINT — name a mode ONLY if the vibe clearly implies one; otherwise write "auto" and let the '
      + 'deterministic chooser pick from the mood label. Modal characters:',
    '  - major: bright, triumphant, resolved',
    '  - dorian: hopeful, folkish, minor-but-not-sad',
    '  - phrygian: dark, tense, Spanish/flamenco half-step colour',
    '  - phrygian_dominant: middle-eastern, exotic, a major chord over a dark scale',
    '  - harmonic_minor: mysterious, dramatic, the augmented-second leap',
    '  - mixolydian: bluesy, laid-back, dominant-flavoured rock/folk',
    '  - natural_minor: melancholic, plain sad-minor (a.k.a. aeolian)',
    '  - major_pentatonic / minor_pentatonic: open, folky, gapped and uncluttered',
  ].join('\n');
}

function formGuide() {
  return [
    'FORM HINT — suggest a shape ONLY if the vibe implies one; otherwise "auto". Typical bar counts in '
      + 'parentheses (the jingle is short — ≈8 bars at 4/4):',
    '  - AABA (8–32 bars): statement, repeat, contrast, return — the pop/anthem default',
    '  - ABA / ternary (6–24 bars): statement, contrast, return — balanced, classic',
    '  - AB (4–16 bars): statement then contrast — short and simple',
    '  - AABB (8–24 bars): doubled statement, doubled contrast',
    '  - ternary_varied (6–24 bars): ABA with the return ornamented',
    '  - rondo (≥12, really ≥48 bars to breathe): a refrain alternating with episodes — rarely fits a jingle',
  ].join('\n');
}

function intensityGuide() {
  return [
    'INTENSITY (0.0–1.0) — how hard the piece should HIT:',
    '  - 0.0–0.35: gentle, ambient, background — soft dynamics, slow, sparse',
    '  - 0.35–0.65: moderate — a normal, present arrival theme',
    '  - 0.65–1.0: hard-hitting — bold, loud, fast, in-your-face. 0.85 = "this should land like a fanfare".',
    'Intensity also drives how adventurous the harmony / melody / texture are downstream, so be deliberate.',
  ].join('\n');
}

function workedExamples() {
  return [
    'WORKED EXAMPLES (mood → aesthetic) — match this judgement, not these exact values:',
    '  1. "energetic triumphant fanfare, loves to make an entrance" →',
    '     { "mood_label": "triumphant", "tonic_hint": "C", "mode_hint": "major", "tempo_hint": 144, '
      + '"register_hint": "high", "form_hint": "AABA", "intensity": 0.9, '
      + '"notes": "A bold major fanfare — high, fast, anthemic." }',
    '  2. "dark and mysterious, into horror films and long silences" →',
    '     { "mood_label": "dark", "tonic_hint": "auto", "mode_hint": "phrygian", "tempo_hint": 92, '
      + '"register_hint": "low", "form_hint": "ABA", "intensity": 0.5, '
      + '"notes": "Phrygian half-step menace, low and unhurried." }',
    '  3. "mellow and dreamy, loves shoegaze and houseplants, walks slowly" →',
    '     { "mood_label": "calm", "tonic_hint": "auto", "mode_hint": "dorian", "tempo_hint": 84, '
      + '"register_hint": "mid", "form_hint": "auto", "intensity": 0.25, '
      + '"notes": "Slow, soft, a little wistful — dorian keeps it from being plain sad." }',
    '  4. "goofy prankster, always grinning, never sits still" →',
    '     { "mood_label": "playful", "tonic_hint": "G", "mode_hint": "major_pentatonic", "tempo_hint": 132, '
      + '"register_hint": "high", "form_hint": "AB", "intensity": 0.7, '
      + '"notes": "Bouncy pentatonic, quick and grinning." }',
    '  5. "quiet, warm, the friend you tell secrets to" →',
    '     { "mood_label": "intimate", "tonic_hint": "F", "mode_hint": "auto", "tempo_hint": 88, '
      + '"register_hint": "mid", "form_hint": "AB", "intensity": 0.3, '
      + '"notes": "Small and tender — short, soft, close." }',
  ].join('\n');
}

function schemaBlock() {
  return [
    'RESPOND WITH ONLY THIS JSON OBJECT — no markdown fences, no commentary before or after:',
    '',
    '{',
    '  "aesthetic": {',
    `    "mood_label": one of ${MOOD_LABELS.map((m) => JSON.stringify(m)).join(' | ')},`,
    '    "tonic_hint": "C" (a letter A–G with an optional accidental like "Bb" or "F#") or "auto",',
    '    "mode_hint": a mode name (e.g. "major", "dorian", "phrygian", "harmonic_minor", "natural_minor") or "auto",',
    `    "tempo_hint": an integer BPM ${TEMPO_MIN}–${TEMPO_MAX}, or "auto",`,
    '    "register_hint": "low" | "mid" | "high" | "auto",',
    `    "form_hint": one of ${FORM_HINTS.map((f) => JSON.stringify(f)).join(' | ')},`,
    '    "intensity": a number 0.0–1.0,',
    '    "notes": "1–2 sentences explaining the choices, for a human reviewer"',
    '  }',
    '}',
    '',
    'REQUIREMENTS:',
    '- "mood_label" and "intensity" are REQUIRED and never "auto" — they always carry signal.',
    '- For every other field, COMMIT to a value when the vibe clearly implies one, and write "auto" when it '
      + 'does not (do not force a guess — "auto" defers to a sensible default).',
    '- Keep "notes" short — it is for a human, not the machine.',
  ].join('\n');
}

/**
 * Build the Stage 1 prompt as { system, user }. Pure (no I/O), so the inspector
 * can display it and the verifier can assert on it. `guestName` is woven into the
 * brief as flavour (a name sometimes suggests a feel); `config` is accepted for
 * signature-parity with the sibling stages (Stage 1 reads no knob from it today).
 */
export function buildAestheticPrompt({ mood, guestName, config } = {}) {
  void config; // Stage 1 reads no freedom knob; accepted for sibling-parity.
  const system =
    'You are the aesthetic interpreter for a chiptune arrival-theme generator. You read a party guest\'s '
    + 'free-text vibe and translate it into a small set of musical HINTS plus an intensity, as strict JSON. '
    + 'You do NOT compose — you set the mood. No commentary, only the JSON object.';

  const nameLine = guestName && String(guestName).trim()
    ? `GUEST NAME: ${String(guestName).trim()}  (a name can hint at a feel — use it lightly, the vibe leads)`
    : 'GUEST NAME: (none given)';

  const user = [
    'Interpret this guest\'s vibe into an aesthetic for their arrival theme.',
    nameLine,
    `VIBE: ${mood && String(mood).trim() ? String(mood).trim() : '(none given — choose a pleasant neutral aesthetic)'}`,
    moodLabelGuide(),
    modeGuide(),
    formGuide(),
    intensityGuide(),
    workedExamples(),
    schemaBlock(),
  ].join('\n\n');

  return { system, user };
}

function buildRetryPrompt(errors) {
  return [
    'The JSON you returned did not pass validation. Fix these specific problems and return the '
      + 'corrected JSON object — same schema, no commentary:',
    '',
    errors.map((e) => `- ${e}`).join('\n'),
    '',
    'Return ONLY the corrected JSON object.',
  ].join('\n');
}

// =================================================================
// LLM CALL — mimics js/jingle/api.js's shape, via the shared transport.
// =================================================================

async function callAestheticLLM(system, messages) {
  return postMessages(
    { model: STAGE_1_MODEL, max_tokens: STAGE_1_MAX_TOKENS, system, messages },
    'Stage 1'
  );
}

// Strip code fences (if the model wrapped the JSON) and parse, with a brace-match
// fallback. Logs the raw response and throws clearly on failure. (Identical idiom
// to Stages 3/4/5a/5b's parse helpers.)
function parseAestheticResponse(raw) {
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
    console.error('Stage 1: could not parse the model response as JSON. Raw response:\n', raw);
    throw new Error('Stage 1: model response was not valid JSON (see console for the raw response).');
  }
}

// =================================================================
// VALIDATION — validateAesthetic checks the WRAPPED `{ aesthetic: { … } }`
// envelope. Exported so verify-stage1.mjs can stress-test it without re-deriving
// the logic. Collects ALL hard defects in one pass (so the retry sees them
// together) and accumulates SOFT warnings separately (diagnostics, not failures).
//
// HARD (errors): wrong envelope shape, missing/bad mood_label, missing/non-number
// intensity, enum violations on register_hint / form_hint, mode_hint not a known
// mode (or "auto"), tonic_hint not letter+accidental (or "auto"), tempo_hint not
// an integer (or "auto").
// SOFT (warnings): intensity out of [0,1], tempo_hint outside [80,160] (the
// "absurd tempo" case — Stage 2 clamps it), notes missing/empty.
// =================================================================

/**
 * Validate the wrapped `{ aesthetic: {...} }` envelope. Returns
 * { ok, errors, warnings }; `ok` is true only when `errors` is empty.
 */
export function validateAesthetic(wrapped) {
  const errors = [];
  const warnings = [];
  const push = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) {
    return { ok: false, errors: ['Aesthetic response must be a JSON object.'], warnings };
  }
  const a = wrapped.aesthetic;
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    return { ok: false, errors: ['Response must have an "aesthetic" object: { "aesthetic": { … } }.'], warnings };
  }

  // mood_label — required closed set, never "auto".
  if (!MOOD_LABELS.includes(a.mood_label)) {
    push(`"mood_label" ${JSON.stringify(a.mood_label)} is not one of: ${MOOD_LABELS.join(', ')}.`);
  }

  // intensity — required number; range is soft (Stage 2 clamps).
  if (typeof a.intensity !== 'number' || Number.isNaN(a.intensity)) {
    push(`"intensity" must be a number 0.0–1.0, got ${JSON.stringify(a.intensity)}.`);
  } else if (a.intensity < 0 || a.intensity > 1) {
    warn(`intensity ${a.intensity} is outside [0, 1] — Stage 2 will clamp it.`);
  }

  // tonic_hint — letter A–G + optional accidental, or "auto".
  if (a.tonic_hint !== 'auto' && (typeof a.tonic_hint !== 'string' || !TONIC_HINT_PATTERN.test(a.tonic_hint))) {
    push(`"tonic_hint" must be a letter A–G with an optional accidental (e.g. "C", "Bb", "F#") or "auto", got ${JSON.stringify(a.tonic_hint)}.`);
  }

  // mode_hint — a known mode (or the natural_minor alias), or "auto".
  if (typeof a.mode_hint !== 'string' || !VALID_MODE_HINTS.has(a.mode_hint)) {
    push(`"mode_hint" must be a known mode name or "auto", got ${JSON.stringify(a.mode_hint)}.`);
  }

  // tempo_hint — integer, or "auto". Out-of-band is soft (Stage 2 clamps).
  if (a.tempo_hint !== 'auto') {
    if (typeof a.tempo_hint !== 'number' || !Number.isInteger(a.tempo_hint)) {
      push(`"tempo_hint" must be an integer BPM ${TEMPO_MIN}–${TEMPO_MAX}, or "auto", got ${JSON.stringify(a.tempo_hint)}.`);
    } else if (a.tempo_hint < TEMPO_MIN || a.tempo_hint > TEMPO_MAX) {
      warn(`tempo_hint ${a.tempo_hint} is outside ${TEMPO_MIN}–${TEMPO_MAX} BPM — Stage 2 will clamp it.`);
    }
  }

  // register_hint / form_hint — closed sets including "auto".
  if (!REGISTER_HINTS.includes(a.register_hint)) {
    push(`"register_hint" must be one of: ${REGISTER_HINTS.join(', ')}, got ${JSON.stringify(a.register_hint)}.`);
  }
  if (!FORM_HINTS.includes(a.form_hint)) {
    push(`"form_hint" must be one of: ${FORM_HINTS.join(', ')}, got ${JSON.stringify(a.form_hint)}.`);
  }

  // notes — soft (free text, for humans).
  if (typeof a.notes !== 'string' || a.notes.trim().length === 0) {
    warn('notes is missing or empty — a 1–2 sentence rationale helps human review.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// =================================================================
// UNWRAP — the validated wrapped envelope → the bare canonical Aesthetic Stage 2
// consumes. Normalizes the "natural_minor" mode alias to the scales.json key
// "aeolian", and clamps the soft-out-of-range numerics (intensity to [0,1],
// tempo_hint to the band) so Stage 2 always receives sane values.
// =================================================================

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function unwrapAesthetic(wrapped) {
  const a = wrapped.aesthetic;
  const mode_hint = a.mode_hint in MODE_ALIASES ? MODE_ALIASES[a.mode_hint] : a.mode_hint;
  const tempo_hint = a.tempo_hint === 'auto' ? 'auto' : clamp(a.tempo_hint, TEMPO_MIN, TEMPO_MAX);
  return {
    mood_label: a.mood_label,
    tonic_hint: a.tonic_hint,
    mode_hint,
    tempo_hint,
    register_hint: a.register_hint,
    form_hint: a.form_hint,
    intensity: clamp(a.intensity, 0, 1),
    notes: typeof a.notes === 'string' ? a.notes : '',
  };
}

// =================================================================
// THE STAGE — generateAesthetic
// =================================================================

/**
 * Generate the Aesthetic for a guest's free-text vibe. Returns the bare canonical
 * Aesthetic dict Stage 2 consumes.
 *
 * Modes:
 *   - Live: builds the prompt, calls the LLM, validates; on failure retries ONCE
 *     with the specific errors fed back, then throws if still invalid.
 *   - Offline: pass `__mockResponse` (a JSON string) to skip the network and run
 *     it through the same parse + validate + unwrap path — how verify-stage1.mjs
 *     exercises the stage without an API call.
 *
 * `onTrace`, if supplied, is called once per round-trip (or the mock) with
 * `{ attempt, raw, ok, errors }`, and once more with `{ attempt: 'soft-note',
 * warnings }` after a successful result IF any soft warnings fired. Never required.
 */
export async function generateAesthetic({
  mood,
  guestName,
  config,
  __mockResponse,
  onTrace,
} = {}) {
  const { system, user } = buildAestheticPrompt({ mood, guestName, config });
  const trace = typeof onTrace === 'function' ? onTrace : () => {};

  const emitSoftWarnings = (warnings) => {
    if (warnings && warnings.length > 0) {
      trace({ attempt: 'soft-note', raw: null, ok: true, errors: [], warnings });
      for (const warning of warnings) console.warn(`Stage 1 (soft): ${warning}`);
    }
  };

  // --- Offline / deterministic fallback: same parse + validate, no network. ---
  if (__mockResponse !== undefined) {
    const parsed = parseAestheticResponse(__mockResponse); // throws clearly on bad JSON
    const result = validateAesthetic(parsed);
    trace({ attempt: 0, raw: __mockResponse, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 1: mock response failed validation. Raw:\n', __mockResponse);
      throw new Error(`Stage 1: mock aesthetic is invalid:\n  - ${result.errors.join('\n  - ')}`);
    }
    emitSoftWarnings(result.warnings);
    return unwrapAesthetic(parsed);
  }

  // --- Live path: call, validate, retry once with the errors fed back. ---
  const messages = [{ role: 'user', content: user }];
  let raw = await callAestheticLLM(system, messages);
  let result;
  let parsed;
  try {
    parsed = parseAestheticResponse(raw);
    result = validateAesthetic(parsed);
  } catch (parseError) {
    result = { ok: false, errors: [parseError.message], warnings: [] };
  }
  trace({ attempt: 1, raw, ok: result.ok, errors: result.errors });

  if (!result.ok) {
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: buildRetryPrompt(result.errors) });
    raw = await callAestheticLLM(system, messages);
    parsed = parseAestheticResponse(raw); // throws clearly if still unparseable
    result = validateAesthetic(parsed);
    trace({ attempt: 2, raw, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 1: aesthetic failed validation after one retry. Raw:\n', raw);
      throw new Error(`Stage 1: aesthetic is invalid after one retry:\n  - ${result.errors.join('\n  - ')}`);
    }
  }

  emitSoftWarnings(result.warnings);
  return unwrapAesthetic(parsed);
}
