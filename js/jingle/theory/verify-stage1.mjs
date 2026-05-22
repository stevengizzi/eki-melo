/* =================================================================
   VERIFY-STAGE1 — exit-criterion check for the aesthetic interpreter, the FIRST
   stage / FIFTH LLM stage (buildplan Session 13). RUNS FULLY OFFLINE — no live
   API calls. Stage 1 is exercised through its `__mockResponse` deterministic-
   fallback path.

   It confirms:
     a. validateAesthetic — a valid wrapped aesthetic returns { ok:true,
        errors:[] }; each documented HARD defect returns { ok:false } with a clear,
        retry-actionable message (envelope shape, mood_label, intensity type,
        tonic/mode/tempo/register/form enum or range); the SOFT cases (intensity
        out of [0,1], absurd tempo_hint, missing notes) EMIT a warning WITHOUT
        failing; the "auto" sentinels are accepted on every deferrable field.
     b. generateAesthetic(__mockResponse) — a VALID mock for four representative
        moods (triumphant / dark / calm / playful) parses + validates and returns
        the BARE canonical Aesthetic; the natural_minor→aeolian alias and the
        intensity / tempo clamps are applied at unwrap; a malformed mock (bad JSON)
        throws; a semantically-invalid mock (bad mood_label) throws.
     c. buildAestheticPrompt is a pure { system, user } builder naming the mood-
        label vocabulary, the modal-character notes, the intensity guide, the
        worked examples, the JSON schema, and the guest name when supplied.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT (the repo has no package.json by design):
     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage1.mjs
     rm js/jingle/package.json
   ================================================================= */
import {
  validateAesthetic,
  generateAesthetic,
  buildAestheticPrompt,
} from '../pipeline/stage-1-aesthetic.js';

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);
const clone = (value) => JSON.parse(JSON.stringify(value));

const expectOk = (scope, result) => {
  if (!result.ok) fail(scope, `expected ok:true, got errors: ${JSON.stringify(result.errors)}`);
  if (result.errors.length !== 0) fail(scope, `expected empty errors, got ${JSON.stringify(result.errors)}`);
};
const expectInvalid = (scope, result, keyword) => {
  if (result.ok) { fail(scope, 'expected ok:false, got ok:true'); return; }
  if (result.errors.length === 0) fail(scope, 'expected at least one error message, got none');
  if (keyword && !result.errors.some((e) => e.toLowerCase().includes(keyword.toLowerCase()))) {
    fail(scope, `no error mentioned "${keyword}". Errors: ${JSON.stringify(result.errors)}`);
  }
};
const expectWarns = (scope, result, keyword) => {
  if (!result.ok) fail(scope, `expected ok:true (soft warning, not failure), got errors: ${JSON.stringify(result.errors)}`);
  if (!result.warnings.some((w) => w.toLowerCase().includes(keyword.toLowerCase()))) {
    fail(scope, `expected a soft warning mentioning "${keyword}", got ${JSON.stringify(result.warnings)}`);
  }
};
const expectThrows = async (scope, thunk) => {
  try { await thunk(); fail(scope, 'expected a throw/rejection, but it resolved'); }
  catch { /* expected */ }
};

// =================================================================
// Fixtures
// =================================================================
const GOOD = {
  aesthetic: {
    mood_label: 'triumphant',
    tonic_hint: 'C',
    mode_hint: 'major',
    tempo_hint: 144,
    register_hint: 'high',
    form_hint: 'AABA',
    intensity: 0.9,
    notes: 'A bold major fanfare — high, fast, anthemic.',
  },
};
const wrap = (aesthetic) => ({ aesthetic });

// =================================================================
// a. validateAesthetic
// =================================================================
expectOk('a:valid', validateAesthetic(GOOD));

// All deferrable fields set to "auto" is valid.
expectOk('a:all-auto', validateAesthetic(wrap({
  mood_label: 'calm', tonic_hint: 'auto', mode_hint: 'auto', tempo_hint: 'auto',
  register_hint: 'auto', form_hint: 'auto', intensity: 0.3, notes: 'gentle',
})));

// Accidental tonic hints + the natural_minor alias parse.
expectOk('a:accidental-tonic', validateAesthetic(wrap({ ...GOOD.aesthetic, tonic_hint: 'Bb' })));
expectOk('a:natural-minor-alias', validateAesthetic(wrap({ ...GOOD.aesthetic, mode_hint: 'natural_minor' })));

// --- envelope shape ---
expectInvalid('a:not-object', validateAesthetic(null), 'object');
expectInvalid('a:no-aesthetic-key', validateAesthetic({ mood_label: 'calm' }), 'aesthetic');

// --- mood_label (required, closed set, no auto) ---
expectInvalid('a:bad-mood', validateAesthetic(wrap({ ...GOOD.aesthetic, mood_label: 'spooky' })), 'mood_label');
expectInvalid('a:mood-auto', validateAesthetic(wrap({ ...GOOD.aesthetic, mood_label: 'auto' })), 'mood_label');

// --- intensity (required number) ---
expectInvalid('a:intensity-type', validateAesthetic(wrap({ ...GOOD.aesthetic, intensity: 'high' })), 'intensity');

// --- tonic / mode / tempo / register / form enums ---
expectInvalid('a:bad-tonic', validateAesthetic(wrap({ ...GOOD.aesthetic, tonic_hint: 'H' })), 'tonic_hint');
expectInvalid('a:bad-mode', validateAesthetic(wrap({ ...GOOD.aesthetic, mode_hint: 'klingon' })), 'mode_hint');
expectInvalid('a:bad-tempo-type', validateAesthetic(wrap({ ...GOOD.aesthetic, tempo_hint: 'fast' })), 'tempo_hint');
expectInvalid('a:bad-tempo-float', validateAesthetic(wrap({ ...GOOD.aesthetic, tempo_hint: 120.5 })), 'tempo_hint');
expectInvalid('a:bad-register', validateAesthetic(wrap({ ...GOOD.aesthetic, register_hint: 'middle' })), 'register_hint');
expectInvalid('a:bad-form', validateAesthetic(wrap({ ...GOOD.aesthetic, form_hint: 'sonata' })), 'form_hint');

// --- soft warnings emit without failing ---
expectWarns('a:soft-intensity', validateAesthetic(wrap({ ...GOOD.aesthetic, intensity: 1.5 })), 'clamp');
expectWarns('a:soft-tempo', validateAesthetic(wrap({ ...GOOD.aesthetic, tempo_hint: 300 })), 'clamp');
const noNotes = clone(GOOD); delete noNotes.aesthetic.notes;
expectWarns('a:soft-notes', validateAesthetic(noNotes), 'notes');

// =================================================================
// c. buildAestheticPrompt — pure { system, user }
// =================================================================
const prompt = buildAestheticPrompt({ mood: 'dark and mysterious, loves horror', guestName: 'Mortimer' });
if (typeof prompt.system !== 'string' || prompt.system.length === 0) fail('c:system', 'system prompt missing');
for (const needle of [
  'MOOD LABELS', 'triumphant', 'mysterious',     // the label vocabulary
  'phrygian', 'natural_minor',                   // modal-character notes
  'FORM HINT', 'AABA',                           // form vocabulary + ranges
  'INTENSITY', '0.85',                           // intensity guide
  'WORKED EXAMPLES',                             // exemplars
  'mood_label', 'intensity',                     // schema fields
  'Mortimer',                                    // the guest name woven in
  'dark and mysterious',                         // the vibe text
]) {
  if (!prompt.user.includes(needle)) fail('c:user', `user prompt does not mention ${needle}`);
}
// Name-less prompt is still well-formed and says so.
const noName = buildAestheticPrompt({ mood: 'cheery' });
if (!noName.user.includes('(none given)')) fail('c:noname', 'name-less prompt should note no name given');

// =================================================================
// b. generateAesthetic(__mockResponse) — offline parse/validate/unwrap, 4 moods
// =================================================================
const MOCKS = {
  triumphant: wrap({ mood_label: 'triumphant', tonic_hint: 'C', mode_hint: 'major', tempo_hint: 144, register_hint: 'high', form_hint: 'AABA', intensity: 0.9, notes: 'fanfare' }),
  dark: wrap({ mood_label: 'dark', tonic_hint: 'auto', mode_hint: 'phrygian', tempo_hint: 92, register_hint: 'low', form_hint: 'ABA', intensity: 0.5, notes: 'menace' }),
  calm: wrap({ mood_label: 'calm', tonic_hint: 'auto', mode_hint: 'dorian', tempo_hint: 84, register_hint: 'mid', form_hint: 'auto', intensity: 0.25, notes: 'soft' }),
  playful: wrap({ mood_label: 'playful', tonic_hint: 'G', mode_hint: 'major_pentatonic', tempo_hint: 132, register_hint: 'high', form_hint: 'AB', intensity: 0.7, notes: 'bouncy' }),
};
for (const [mood, mock] of Object.entries(MOCKS)) {
  const a = await generateAesthetic({ mood, __mockResponse: JSON.stringify(mock) });
  if (a.mood_label !== mock.aesthetic.mood_label) fail(`b:${mood}`, `mood_label round-trip: got ${a.mood_label}`);
  if (typeof a.intensity !== 'number') fail(`b:${mood}`, 'intensity missing from unwrapped aesthetic');
  // unwrapped is the BARE dict (no .aesthetic wrapper)
  if ('aesthetic' in a) fail(`b:${mood}`, 'unwrapped result should be the bare Aesthetic, not the wrapped envelope');
}

// natural_minor alias normalizes to the scales.json key "aeolian" on unwrap.
const aliased = await generateAesthetic({
  mood: 'wistful', __mockResponse: JSON.stringify(wrap({ ...MOCKS.calm.aesthetic, mood_label: 'wistful', mode_hint: 'natural_minor' })),
});
if (aliased.mode_hint !== 'aeolian') fail('b:alias', `natural_minor should normalize to aeolian, got ${aliased.mode_hint}`);

// soft-out-of-range numerics are clamped on unwrap.
const clamped = await generateAesthetic({
  mood: 'energetic', __mockResponse: JSON.stringify(wrap({ ...MOCKS.triumphant.aesthetic, mood_label: 'energetic', intensity: 1.5, tempo_hint: 300 })),
});
if (clamped.intensity !== 1) fail('b:clamp-intensity', `intensity 1.5 should clamp to 1, got ${clamped.intensity}`);
if (clamped.tempo_hint !== 160) fail('b:clamp-tempo', `tempo_hint 300 should clamp to 160, got ${clamped.tempo_hint}`);

// soft warning surfaces via onTrace without failing.
const softTraces = [];
await generateAesthetic({ mood: 'calm', __mockResponse: JSON.stringify(wrap({ ...MOCKS.calm.aesthetic, intensity: 1.5 })), onTrace: (t) => softTraces.push(t) });
if (!softTraces.flatMap((t) => t.warnings ?? []).some((w) => w.toLowerCase().includes('clamp'))) {
  fail('b:soft-trace', 'expected a clamp soft warning via onTrace');
}

// malformed mock (bad JSON) → throws; semantically invalid mock → throws.
await expectThrows('b:bad-json', () => generateAesthetic({ mood: 'x', __mockResponse: 'not json {{{' }));
await expectThrows('b:invalid', () => generateAesthetic({ mood: 'x', __mockResponse: JSON.stringify(wrap({ ...GOOD.aesthetic, mood_label: 'nope' })) }));

// =================================================================
// report
// =================================================================
if (failures.length > 0) {
  console.error(`verify-stage1 FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  'verify-stage1 PASSED — validateAesthetic catches every documented defect (envelope, mood_label, '
    + 'intensity, tonic/mode/tempo/register/form enums) and emits the soft warnings (intensity/tempo clamp, '
    + 'missing notes) without failing; "auto" sentinels accepted; generateAesthetic(__mockResponse) parses/'
    + 'validates four moods offline, normalizes the natural_minor alias, clamps out-of-range numerics, and '
    + 'throws on malformed/invalid mocks; buildAestheticPrompt names the vocabulary, guide, examples, schema, '
    + 'and guest name.'
);
