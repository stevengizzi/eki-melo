/* =================================================================
   VERIFY-STAGE2 — exit-criterion check for the deterministic macro stage
   (buildplan Session 13). RUNS FULLY OFFLINE — Stage 2 makes NO network call, so
   there is nothing to mock; it is exercised directly.

   It confirms:
     a. generateMacroParams — for each of the ten mood labels (all hints "auto",
        intensity 0.5, default 32-beat budget) the chosen tonic / mode / form /
        tempo land in the expected slots, the sections tile the form and sum to
        total_bars, and the result passes validateMacroParams.
     b. THE 32-BEAT DOWNSIZE (§7.7) — an AABA-default mood downsizes to AB (binary)
        at the 32-beat budget (every section would be ≤2 bars) WITH a soft warning;
        a ternary mood does NOT; and the same AABA SURVIVES at a 64-beat budget
        (each section gets 4 bars).
     c. HINT HONORING — explicit tonic / mode / tempo / form hints override the
        mood defaults; the "AABB" hint resolves to binary with a note; a rondo hint
        under 48 beats is replaced with ternary with a note.
     d. deriveKnobs — intensity maps to the three-tier adventurousness knobs
        (tame / adventurous / wild), arrangement uses the raised two-level
        threshold, allow_modal_interchange tracks the harmonic level, and
        user_knobs_override returns the config untouched.
     e. validateMacroParams — a valid macro is ok; each documented HARD defect
        fails; the SOFT cases (total_bars < 4, tempo out of [60, 200]) warn.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT (the repo has no package.json by design):
     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-stage2.mjs
     rm js/jingle/package.json
   ================================================================= */
import {
  generateMacroParams,
  validateMacroParams,
  deriveKnobs,
} from '../pipeline/stage-2-macro.js';

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);

const expectOk = (scope, result) => {
  if (!result.ok) fail(scope, `expected ok:true, got errors: ${JSON.stringify(result.errors)}`);
};
const expectInvalid = (scope, result, keyword) => {
  if (result.ok) { fail(scope, 'expected ok:false, got ok:true'); return; }
  if (keyword && !result.errors.some((e) => e.toLowerCase().includes(keyword.toLowerCase()))) {
    fail(scope, `no error mentioned "${keyword}". Errors: ${JSON.stringify(result.errors)}`);
  }
};
const expectWarns = (scope, result, keyword) => {
  if (!result.ok) fail(scope, `expected ok:true (soft), got errors: ${JSON.stringify(result.errors)}`);
  if (!result.warnings.some((w) => w.toLowerCase().includes(keyword.toLowerCase()))) {
    fail(scope, `expected a warning mentioning "${keyword}", got ${JSON.stringify(result.warnings)}`);
  }
};

// A bare Aesthetic with everything deferred; override per case.
const aesthetic = (overrides = {}) => ({
  mood_label: 'triumphant', tonic_hint: 'auto', mode_hint: 'auto', tempo_hint: 'auto',
  register_hint: 'auto', form_hint: 'auto', intensity: 0.5, notes: '', ...overrides,
});

// Generate and capture any Stage-2 soft warning via onTrace.
function gen(aes, lengthBudget) {
  const warnings = [];
  const macro = generateMacroParams({ aesthetic: aes, lengthBudget, onTrace: (t) => warnings.push(...(t.warnings ?? [])) });
  return { macro, warnings };
}

const inBand = (n, [lo, hi]) => typeof n === 'number' && n >= lo && n <= hi;
const sum = (xs) => xs.reduce((t, x) => t + x, 0);

// =================================================================
// a. per-mood mapping (all-auto, intensity 0.5, default 32-beat budget)
// =================================================================
// At 32 beats AABA-default moods (triumphant/celebratory) DOWNSIZE to binary.
const EXPECT = {
  triumphant:  { tonic: 'C', mode: 'major',          form: 'binary',         tempo: [130, 150] },
  celebratory: { tonic: 'C', mode: 'major',          form: 'binary',         tempo: [130, 150] },
  playful:     { tonic: 'C', mode: 'major',          form: 'ternary',        tempo: [105, 125] },
  hopeful:     { tonic: 'D', mode: 'major',          form: 'ternary',        tempo: [105, 125] },
  mysterious:  { tonic: 'E', mode: 'harmonic_minor', form: 'ternary',        tempo: [105, 125] },
  dark:        { tonic: 'E', mode: 'phrygian',       form: 'ternary',        tempo: [105, 125] },
  calm:        { tonic: 'A', mode: 'dorian',         form: 'ternary',        tempo: [80, 100] },
  energetic:   { tonic: 'G', mode: 'mixolydian',     form: 'ternary_varied', tempo: [130, 150] },
  wistful:     { tonic: 'A', mode: 'aeolian',        form: 'ternary',        tempo: [80, 100] },
  intimate:    { tonic: 'F', mode: 'major',          form: 'binary',         tempo: [80, 100] },
};
for (const [mood, want] of Object.entries(EXPECT)) {
  const { macro } = gen(aesthetic({ mood_label: mood }));
  if (macro.tonic !== want.tonic) fail(`a:${mood}`, `tonic: got ${macro.tonic}, want ${want.tonic}`);
  if (macro.mode !== want.mode) fail(`a:${mood}`, `mode: got ${macro.mode}, want ${want.mode}`);
  if (macro.form !== want.form) fail(`a:${mood}`, `form: got ${macro.form}, want ${want.form}`);
  if (!inBand(macro.tempo, want.tempo)) fail(`a:${mood}`, `tempo ${macro.tempo} not in band ${JSON.stringify(want.tempo)}`);
  if (!Array.isArray(macro.sections) || macro.sections.length === 0) fail(`a:${mood}`, 'sections missing');
  else if (sum(macro.sections.map((s) => s.bars)) !== macro.total_bars) {
    fail(`a:${mood}`, `sections sum ${sum(macro.sections.map((s) => s.bars))} != total_bars ${macro.total_bars}`);
  }
  if (macro.total_bars !== 8) fail(`a:${mood}`, `default 32-beat budget should give 8 bars, got ${macro.total_bars}`);
  expectOk(`a:${mood}:valid`, validateMacroParams(macro));
}

// intimate at high intensity flips to aeolian.
{
  const { macro } = gen(aesthetic({ mood_label: 'intimate', intensity: 0.8 }));
  if (macro.mode !== 'aeolian') fail('a:intimate-hot', `intimate@0.8 should be aeolian, got ${macro.mode}`);
}

// =================================================================
// b. the 32-beat downsize
// =================================================================
{
  const { macro, warnings } = gen(aesthetic({ mood_label: 'triumphant' })); // AABA default
  if (macro.form !== 'binary') fail('b:downsize-form', `triumphant@32 should downsize to binary, got ${macro.form}`);
  if (macro.sections.length !== 2) fail('b:downsize-sections', `expected 2 sections, got ${macro.sections.length}`);
  if (!warnings.some((w) => w.toLowerCase().includes('downsized'))) fail('b:downsize-warn', `expected a downsize warning, got ${JSON.stringify(warnings)}`);
}
{
  const { warnings } = gen(aesthetic({ mood_label: 'hopeful' })); // ternary — no downsize
  if (warnings.some((w) => w.toLowerCase().includes('downsized'))) fail('b:no-downsize', `ternary should not downsize, got ${JSON.stringify(warnings)}`);
}
{
  // AABA survives at a 64-beat (16-bar) budget — each section gets 4 bars.
  const { macro, warnings } = gen(aesthetic({ mood_label: 'triumphant' }), 64);
  if (macro.form !== 'AABA') fail('b:aaba-survives', `triumphant@64 should keep AABA, got ${macro.form}`);
  if (macro.total_bars !== 16) fail('b:aaba-bars', `64-beat budget should give 16 bars, got ${macro.total_bars}`);
  if (macro.sections.some((s) => s.bars < 3)) fail('b:aaba-section-size', `AABA@16 sections should be ≥3 bars, got ${JSON.stringify(macro.sections)}`);
  if (warnings.some((w) => w.toLowerCase().includes('downsized'))) fail('b:aaba-nowarn', 'AABA@64 should not downsize');
}

// =================================================================
// c. hint honoring
// =================================================================
{
  const { macro } = gen(aesthetic({ mood_label: 'calm', tonic_hint: 'Bb', mode_hint: 'lydian', tempo_hint: 100, form_hint: 'AB' }));
  if (macro.tonic !== 'Bb') fail('c:tonic-hint', `tonic hint ignored, got ${macro.tonic}`);
  if (macro.mode !== 'lydian') fail('c:mode-hint', `mode hint ignored, got ${macro.mode}`);
  if (macro.tempo !== 100) fail('c:tempo-hint', `tempo hint ignored, got ${macro.tempo}`);
  if (macro.form !== 'binary') fail('c:form-hint', `AB hint should map to binary, got ${macro.form}`);
}
{
  const { macro, warnings } = gen(aesthetic({ mood_label: 'playful', form_hint: 'AABB' }));
  if (macro.form !== 'binary') fail('c:aabb', `AABB hint should resolve to binary, got ${macro.form}`);
  if (!warnings.some((w) => w.toLowerCase().includes('aabb'))) fail('c:aabb-warn', `expected an AABB resolution note, got ${JSON.stringify(warnings)}`);
}
{
  const { macro, warnings } = gen(aesthetic({ mood_label: 'energetic', form_hint: 'rondo' })); // 32 beats < 48
  if (macro.form !== 'ternary') fail('c:rondo', `rondo under 48 beats should become ternary, got ${macro.form}`);
  if (!warnings.some((w) => w.toLowerCase().includes('rondo'))) fail('c:rondo-warn', `expected a rondo substitution note, got ${JSON.stringify(warnings)}`);
}
{
  // natural_minor mode hint normalizes to the scales.json key aeolian.
  const { macro } = gen(aesthetic({ mood_label: 'wistful', mode_hint: 'natural_minor' }));
  if (macro.mode !== 'aeolian') fail('c:nm-alias', `natural_minor hint should normalize to aeolian, got ${macro.mode}`);
}

// =================================================================
// d. deriveKnobs — intensity → knobs
// =================================================================
function knobsAt(intensity, config) {
  return deriveKnobs({ aesthetic: aesthetic({ intensity }), config }).knobs;
}
{
  const k = knobsAt(0.2);
  if (k.harmonic_adventurousness !== 'tame') fail('d:low-harmonic', `0.2 harmonic should be tame, got ${k.harmonic_adventurousness}`);
  if (k.arrangement_adventurousness !== 'tame') fail('d:low-arrangement', `0.2 arrangement should be tame, got ${k.arrangement_adventurousness}`);
  if (k.allow_modal_interchange !== false) fail('d:low-mi', '0.2 should leave modal interchange OFF');
  if (k.motif_architecture !== 'phrase') fail('d:low-arch', `motif_architecture should be phrase, got ${k.motif_architecture}`);
}
{
  const k = knobsAt(0.5);
  if (k.harmonic_adventurousness !== 'adventurous') fail('d:mid-harmonic', `0.5 harmonic should be adventurous, got ${k.harmonic_adventurousness}`);
  if (k.arrangement_adventurousness !== 'tame') fail('d:mid-arrangement', `0.5 arrangement (<0.6) should be tame, got ${k.arrangement_adventurousness}`);
  if (k.allow_modal_interchange !== true) fail('d:mid-mi', '0.5 should turn modal interchange ON');
}
{
  const k = knobsAt(0.8);
  if (k.harmonic_adventurousness !== 'wild') fail('d:high-harmonic', `0.8 harmonic should be wild, got ${k.harmonic_adventurousness}`);
  if (k.phrase_adventurousness !== 'wild') fail('d:high-phrase', `0.8 phrase should be wild, got ${k.phrase_adventurousness}`);
  if (k.texture_adventurousness !== 'wild') fail('d:high-texture', `0.8 texture should be wild, got ${k.texture_adventurousness}`);
  if (k.arrangement_adventurousness !== 'adventurous') fail('d:high-arrangement', `0.8 arrangement (≥0.6) should be adventurous, got ${k.arrangement_adventurousness}`);
}
{
  // user_knobs_override returns the config untouched (the user's explicit knobs win).
  const config = { preset: 'custom', user_knobs_override: true, knobs: { harmonic_adventurousness: 'tame', phrase_adventurousness: 'tame' } };
  const out = deriveKnobs({ aesthetic: aesthetic({ intensity: 0.95 }), config });
  if (out !== config) fail('d:override', 'user_knobs_override should return the config object unchanged');
  if (out.knobs.harmonic_adventurousness !== 'tame') fail('d:override-knobs', 'override should keep the user knobs');
}

// =================================================================
// e. validateMacroParams
// =================================================================
const { macro: GOOD } = gen(aesthetic({ mood_label: 'hopeful' }));
expectOk('e:valid', validateMacroParams(GOOD));
expectInvalid('e:not-object', validateMacroParams(null), 'object');
expectInvalid('e:bad-tonic', validateMacroParams({ ...GOOD, tonic: 'H' }), 'tonic');
expectInvalid('e:bad-mode', validateMacroParams({ ...GOOD, mode: 'klingon' }), 'mode');
expectInvalid('e:total-not-int', validateMacroParams({ ...GOOD, total_bars: 8.5 }), 'total_bars');
expectInvalid('e:sections-sum', validateMacroParams({ ...GOOD, sections: [{ label: 'A', bars: 99 }] }), 'sum');
expectInvalid('e:bad-meter', validateMacroParams({ ...GOOD, meter: { numerator: 'four' } }), 'meter');
// SOFT: short total_bars (kept consistent so only the soft check fires).
expectWarns('e:short', validateMacroParams({ ...GOOD, total_bars: 2, sections: [{ label: 'A', bars: 1 }, { label: 'B', bars: 1 }] }), 'short');
// SOFT: absurd tempo.
expectWarns('e:tempo', validateMacroParams({ ...GOOD, tempo: 400 }), '60');

// =================================================================
// report
// =================================================================
if (failures.length > 0) {
  console.error(`verify-stage2 FAILED with ${failures.length} issue(s):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(
  'verify-stage2 PASSED — generateMacroParams maps all ten moods to the expected tonic/mode/form/tempo with '
    + 'sections that tile and sum to total_bars; the 32-beat AABA→AB downsize fires (and AABA survives at 64 '
    + 'beats); explicit hints (tonic/mode/tempo/form, AABB→binary, rondo→ternary, natural_minor→aeolian) are '
    + 'honored; deriveKnobs maps intensity to the adventurousness knobs (and user_knobs_override is respected); '
    + 'validateMacroParams catches the hard defects and warns on the soft ones.'
);
