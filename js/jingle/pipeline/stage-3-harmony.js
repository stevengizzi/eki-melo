/* =================================================================
   STAGE 3 — HARMONIC PLAN (buildplan Session 11 — FOURTH LLM STAGE).

   This is the stage that writes the chords: a per-section Roman-numeral
   progression plus a cadence type, under the active mode's grammar. It is the
   harmonic ground the motifs (Stage 4) land on, the phrases (Stage 5a) develop
   over, and the textures (Stage 5b) choreograph — until now it was hand-supplied
   to those stages; Stage 3 generates it. Architecturally this is the FOURTH
   worked instance of the LLM-stage template (sibling of Stage 4 / 5a / 5b):
   prompt-building separated from the fetch, a wrapped LLM envelope unwrapped to
   the canonical inter-stage shape at the seam, all-defects-in-one-pass
   validation, a validate-then-retry-once loop, and a `__mockResponse` offline
   fallback the verifier uses. The differentiator is entirely in (a) the PROMPT —
   the available-chords listing, the cadence/mode compatibility table, the
   memorable-progression exemplars, and the explicit function/harmonic-rhythm
   coaching — and (b) the validator's music-theory rules (Roman-numeral validity,
   cadence/final-chord compatibility, mode/cadence compatibility), all leaning on
   theory/roman-numeral.js for ground truth.

     generateHarmonicPlan({ macroParams, config, __mockResponse?, onTrace? })
       → HarmonicPlan

   THE TWO SHAPES (and why they differ). The LLM emits — and validateHarmonicPlan
   checks — a WRAPPED envelope `{ sections: { <label>: { progression, cadence } } }`
   whose per-section `progression` is a list of `{ roman, bars: [start, end] }`
   entries that TILE the section's bars (the same coverage rule Stage 5b uses for
   textures). The bar ranges let the model express HARMONIC RHYTHM — a chord held
   across two bars (slow) vs. a chord per bar (fast) — and let the validator check
   that the harmony covers the whole section.

   The canonical inter-stage HarmonicPlan that Stages 4 / 5a / 5b / 6 / 8 ALREADY
   consume (buildplan §3; what the hand-supplied inspector cases use; what
   `harmonySummary` reads and what Stage 6's `romanForBar` indexes) is DIFFERENT:
     { sections: [ { label, progression: [<roman string>, …], cadence }, … ] }
   — an ARRAY of sections, each `progression` a flat array of Roman-numeral
   STRINGS, realized ONE CHORD PER BAR (`romanForBar(progression, barRel)` =
   `progression[(barRel-1) % progression.length]`). So generateHarmonicPlan
   validates the wrapped `{roman, bars}` envelope, then UNWRAPS by EXPANDING each
   `{ roman, bars:[s,e] }` into (e−s+1) copies of `roman`, producing a per-bar
   string array of length `section.bars`, in the array-of-sections shape. A chord
   spanning bars [1,2] becomes `["I","I"]`; a chord at [3,3] becomes `["vi"]`. So
   `input.harmonicPlan` is one consistent shape (the §3 array form) whether
   hand-supplied or generated. (The kickoff sketch wrote the unwrapped OUTPUT as a
   flat `{ <label>: { progression:[{roman,bars}] } }` map, but its binding
   requirement is "exactly what Sessions 4–10 already consume" — and that is the
   `{ sections: [ {progression:[strings]} ] }` array Stage 6 actually indexes, so
   we resolve the inconsistency in favor of the downstream consumer + §3, exactly
   as Session 10 resolved `position` → `at_position`.)

   ONE CHORD PER BAR. The integer `bars` ranges (and Stage 6's `romanForBar`) mean
   the realizable harmonic rhythm is one chord per bar, or one chord held across N
   bars — NOT two chords within one bar. The prompt's harmonic-rhythm guidance is
   phrased accordingly (slow = a chord across two bars; fast = a chord per bar).

   OFFLINE / DETERMINISTIC FALLBACK. Pass `__mockResponse` (a JSON string) to skip
   the network and run that string through the SAME parse + validate + unwrap path
   as a real response. This is how verify-stage3.mjs exercises the stage offline.

   API. Same call shape as Stage 4 / 5a / 5b / js/jingle/api.js, via the shared
   transport in llm-call.js: POST the Anthropic Messages body, force JSON-only by
   instruction, strip code fences, parse with a brace-match fallback. The model is
   pinned to the one the /api/generate allow-list permits, so both runtime modes
   work without a server change.

   PORTABILITY. This is pipeline/ code: it may import theory/ and js/env.js. It
   does NOT modify api.js (read-only) — it mimics its patterns.
   ================================================================= */
import { postMessages } from './llm-call.js';
import {
  resolveRoman,
  parseRoman,
  isValidInMode,
  listAvailableChords,
} from '../theory/roman-numeral.js';
import { degreeToPitch } from '../theory/mode-engine.js';
import { toMidi } from '../theory/pitch.js';
import { computeSectionPlan } from './stage-6-voice.js';

// The /api/generate allow-list only permits this model (see
// functions/api/generate.js ALLOWED_MODELS); api.js + Stages 4/5a/5b use the same
// one. Pinning it keeps the deployed proxy path AND the artifact direct path
// working without a server change. A model upgrade is a coordinated allow-list
// change (Session 12+).
const STAGE_3_MODEL = 'claude-sonnet-4-20250514';
const STAGE_3_MAX_TOKENS = 2000;

// The seven cadence types (buildplan §3 vocabulary). Their resolution lands at
// the section's last bar; Stage 8 overwrites the section's final two beats with
// the matching formula in theory/cadence-formulas.js.
const CADENCE_TYPES = ['PAC', 'IAC', 'half', 'deceptive', 'plagal', 'modal_iv_i', 'phrygian_ii_i'];

// Score-notation accidental glyphs for naming a chord root pitch class.
const ACCIDENTAL_GLYPH = { '-2': 'bb', '-1': 'b', '0': '', '1': '#', '2': '##' };

// =================================================================
// ADVENTUROUSNESS — the freedom knob this stage reads (config.knobs.
// harmonic_adventurousness ∈ {tame, adventurous, wild}). Only the ACTIVE level's
// directive is printed, to keep the steer sharp. Modeled on Sessions 8/9/10.
// =================================================================

const HARMONIC_ADVENTUROUSNESS_DIRECTIVE = {
  tame:
    'Use functional progressions only — strong tonal motion built from the standard pop/classical cells: '
    + 'I–IV–V–I, ii–V–I, I–vi–IV–V, I–V–vi–IV, vi–IV–I–V (and their minor equivalents: i–iv–V–i, i–VI–III–VII). '
    + 'Stay strictly diatonic. Standard cadences only (PAC, half). Every section should feel resolved and '
    + 'predictable — the harmonic equivalent of a clean, by-the-book progression.',
  adventurous:
    'Reach past the textbook. Modal interchange is welcome (borrow the conventional chords — see below). '
    + 'Use surprise: a deceptive cadence, a ii°–V in minor, a secondary-dominant colour written as a plain '
    + 'chromatic numeral. AT LEAST ONE section must end on a NON-PAC cadence (half, deceptive, modal_iv_i, or '
    + 'plagal). Give each section a progression with a real identity — not a random walk through diatonic chords.',
  wild:
    'Be bold but coherent. Reach for chromatic mediants (bIII / bVI in major), modal mixture that shifts a '
    + 'section\'s colour, and the phrygian_ii_i cadence somewhere if the mode allows a flat-2. You may place ONE '
    + 'deliberately strange chord in EXACTLY ONE section (an anomaly slot — e.g. a chromatic mediant resolving '
    + 'unexpectedly); the rest of the piece stays coherent. The whole must still read as ONE piece — surprise, '
    + 'not chaos.',
};
const DEFAULT_HARMONIC_ADVENTUROUSNESS = 'adventurous';

function harmonicAdventurousnessOf(config) {
  const value = config?.knobs?.harmonic_adventurousness;
  return value in HARMONIC_ADVENTUROUSNESS_DIRECTIVE ? value : DEFAULT_HARMONIC_ADVENTUROUSNESS;
}

// Whether borrowed / chromatic chords are permitted this run. The validator reads
// this to decide whether an out-of-mode chord is a hard error (off) or an accepted
// borrow with a soft warning (on); the prompt reads it to decide whether to invite
// borrowings. Defaults OFF when the knob is absent, matching isValidInMode's own
// default-off convention. The presets set it ON for adventurous + wild, OFF for
// tame (see pipeline-config.js).
function allowsModalInterchange(config) {
  return config?.knobs?.allow_modal_interchange === true;
}

// =================================================================
// MODE / CHORD HELPERS — thin wrappers over theory/roman-numeral.js +
// mode-engine.js so the prompt and the validator share one source of truth.
// =================================================================

// "C", "Bb", "F#" — the chord root's pitch class, octave dropped.
function pitchClassName(pitch) {
  return pitch.letter + (ACCIDENTAL_GLYPH[String(pitch.accidental)] ?? '');
}

// The quality of the tonic triad in `mode` ('major' | 'minor' | 'diminished' |
// 'augmented'), used by the modal_iv_i mode-compatibility check.
function tonicTriadQuality(mode, tonic) {
  try {
    return resolveRoman('I', mode, tonic).quality;
  } catch {
    return null;
  }
}

// True when `mode` names degree 2 as a flat-2 (a minor second above the tonic) —
// phrygian, phrygian_dominant, locrian, neapolitan, … — which is what the
// phrygian_ii_i cadence needs to sit in harmonic context.
function modeHasFlatTwo(mode, tonic) {
  try {
    const tonicMidi = toMidi(degreeToPitch(mode, tonic, 1));
    const secondMidi = toMidi(degreeToPitch(mode, tonic, 2));
    return secondMidi - tonicMidi === 1;
  } catch {
    return false;
  }
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
    `- harmonic rhythm hint: ${harmonicRhythm} chord(s) per bar`,
    `- sections in order: ${sectionList}`,
    `- MOOD: ${macroParams.mood ?? '(unspecified)'}  ← the strongest signal for the harmonic language (bright/dark, tense/calm, simple/colourful)`,
  ].join('\n');
}

// The diatonic chord vocabulary for the active mode, each with its concrete root
// pitch + quality, so the model sees exactly what it has to work with. Built off
// roman-numeral.js's listAvailableChords + resolveRoman — single source of truth.
function availableChordsForMode(mode, tonic) {
  const lines = listAvailableChords(mode).map((roman) => {
    try {
      const { root, quality } = resolveRoman(roman, mode, tonic);
      return `  - ${roman} (${pitchClassName(root)} ${quality})`;
    } catch {
      return `  - ${roman}`;
    }
  });
  return [
    `AVAILABLE DIATONIC CHORDS in ${tonic} ${mode} (one per scale degree — these are your primary vocabulary):`,
    ...lines,
  ].join('\n');
}

// The modal-interchange invitation, conditional on the actual config flag so the
// prompt is honest in every config. When on it names the conventional borrowings;
// when off it tells the model to stay strictly diatonic.
function modalInterchangeGuidance(mode, allowMI) {
  if (!allowMI) {
    return [
      'MODAL INTERCHANGE: OFF. Use ONLY the diatonic chords listed above. Do not borrow chords from '
        + 'other modes or write chromatic numerals (no bVII, bVI, secondary dominants, etc.).',
    ].join('\n');
  }
  // The borrowing vocabulary is mode-relative (tonic-independent), so probe the
  // tonic-triad quality on a neutral 'C'.
  const isMinorish = ['minor', 'diminished'].includes(tonicTriadQuality(mode, 'C'));
  const borrowings = isMinorish
    ? 'In a minor-ish mode the conventional borrowings are V (a raised-leading-tone dominant), VII (the major '
      + 'subtonic), II / bII, and the Picardy-ish IV.'
    : 'In a major-ish mode the conventional borrowings are bVII, bVI, bIII (chromatic mediant), iv (minor '
      + 'subdominant), and ii° — the parallel-minor colours.';
  return [
    'MODAL INTERCHANGE: ON. You MAY borrow chords from outside the mode, written as chromatic Roman numerals '
      + '(e.g. "bVII", "bVI", "iv", "V" in a minor mode). Prefer the CONVENTIONAL borrowings — they read as '
      + 'colour, not error. ' + borrowings + ' Use borrowings deliberately and sparingly; a borrowed chord '
      + 'should feel like a chosen colour, not a wrong note.',
  ].join('\n');
}

// The cadence/compatibility table — embedded inline so the model picks a cadence
// that is compatible with the section's final chord AND the mode. The validator
// enforces both; this is the model's map of the rules.
function cadenceCompatibilityTable() {
  return [
    'CADENCE TYPES (choose one per section for "cadence"). The cadence resolves at the section\'s LAST bar; '
      + 'its required APPROACH CHORD must be the section\'s FINAL progression chord, and some cadences need a '
      + 'particular kind of mode. (The validator enforces both — do not pick an incompatible cadence.)',
    '  - PAC  (perfect authentic): final chord must be V. Resolves V→I, lead lands on the tonic. Any mode with a V.',
    '  - IAC  (imperfect authentic): final chord must be V. Like PAC but the lead lands on the 3rd/5th, softer. Any mode.',
    '  - half: final chord must be V — the section ends ON the dominant, hanging, unresolved. Any mode.',
    '  - deceptive: final chord must be V. Resolves V→vi/VI instead of the tonic — the surprise. Any mode.',
    '  - plagal: final chord must be IV (or iv) — the "amen" subdominant→tonic. Any mode with a IV.',
    '  - modal_iv_i: final chord must be a MINOR iv; works ONLY in minor-tonic modes (natural minor, dorian, '
      + 'aeolian, phrygian, harmonic minor, …). The characteristic modal close, no raised leading tone. '
      + '(A MAJOR IV→i is a plagal cadence, not this.)',
    '  - phrygian_ii_i: final chord must be bII (or "II" when the mode names degree 2 as the flat-2, e.g. '
      + 'phrygian / phrygian_dominant). Works ONLY in modes with a diatonic flat-2 — the famous half-step descent.',
  ].join('\n');
}

// The musical-quality coaching (Session 10's lesson: explicit guidance moves
// output more than vocabulary alone). Function, harmonic rhythm, B-contrast,
// reprise, and the memorable-progression exemplars.
function compositionalGuidance() {
  return [
    'COMPOSITIONAL GUIDANCE — this is the difference between a progression and a random walk. Follow it:',
    '  1. CLEAR HARMONIC FUNCTION. Each section should move through functions: a TONIC area (I/i), a '
      + 'PREDOMINANT (ii, IV, vi), a DOMINANT (V, vii°), and a resolution. A random walk through in-mode chords '
      + 'sounds aimless even when every chord is diatonic.',
    '  2. HARMONIC RHYTHM IS STRUCTURAL. Vary the chords-per-bar with bar ranges. Earlier/calmer sections often '
      + 'hold ONE chord across TWO bars (slow, spacious: "bars": [1, 2]); contrast sections often move ONE chord '
      + 'per bar (faster, more drive); the cadential approach often quickens to a chord per bar to push into the '
      + 'close. Do NOT give every section the same rhythm.',
    '  3. CONTRAST THE B SECTION. The B (contrast) section should harmonically depart from A — move to a related '
      + 'key area (vi in major, III in minor), introduce a chromatic chord, shift the harmonic rhythm, and/or end '
      + 'on a non-PAC cadence. It should not just re-run A\'s progression.',
    '  4. RE-ESTABLISH HOME AT THE REPRISE. A returning A/A\' section should firmly re-assert the tonic area '
      + 'before its final cadence — ground the listener before the close.',
    '  5. WRITE PROGRESSIONS WITH IDENTITY. Draw on memorable, named progressions rather than wandering:',
    '       • I–V–vi–IV         (the pop standard)',
    '       • I–vi–ii–V         (cyclic, "rhythm changes" feel)',
    '       • i–bVII–bVI–V      (minor descending tetrachord)',
    '       • ii–V–I            (jazz tonal cadence)',
    '       • I–bVII–IV–I       (modal mixolydian)',
    '       • i–iv–i            (modal minor / dorian)',
    '     Pick something WITH a recognizable shape for each section, then fit it to the bars.',
  ].join('\n');
}

// The JSON skeleton the model fills in, listing each section with its bar count
// so the bar ranges tile correctly.
function schemaSkeleton(plan) {
  const sectionLines = plan
    .map(
      (s) =>
        `    ${JSON.stringify(s.label)}: { "progression": [ { "roman": "…", "bars": [1, ${s.bars}] } /* tile bars 1..${s.bars} */ ], "cadence": "…" }`
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
    '- Each section is { "progression": [ chord entries ], "cadence": one of the seven cadence names }.',
    '- Each chord entry is { "roman": <a Roman-numeral string>, "bars": [start, end] }. "bars" is 1-indexed, '
      + 'section-relative, and inclusive: [1, 2] covers bars 1 and 2 (the chord is HELD across them); [3, 3] '
      + 'covers only bar 3.',
    '- For EVERY section the chord entries must TILE bars 1..N with NO gaps and NO overlaps (N = that section\'s '
      + 'bar count shown above). Every bar gets exactly one chord. (A chord cannot change WITHIN a bar — to move '
      + 'faster, use one-bar entries; to move slower, span two bars.)',
    '- Each "roman" must be parseable (e.g. "I", "vi", "V7", "ii°", "bVII", "iv") and valid in the mode — use the '
      + 'AVAILABLE DIATONIC CHORDS above (plus borrowings only if modal interchange is ON).',
    '- The section\'s FINAL chord must be the cadence\'s required approach chord (see the cadence table).',
    '- Choose progressions that READ AS COMPOSITION — clear function, real identity, contrasting B section.',
  ].join('\n');
}

/**
 * Build the Stage 3 prompt as { system, user }. Pure (no I/O), so the inspector
 * can display it and the verifier can assert on it.
 */
export function buildHarmonicPlanPrompt({ macroParams, config }) {
  const plan = computeSectionPlan(macroParams);
  const adventurousness = harmonicAdventurousnessOf(config);
  const allowMI = allowsModalInterchange(config);
  const mode = macroParams.mode;
  const tonic = macroParams.tonic;

  const system =
    'You are a composer writing the harmonic progression and cadence for a chiptune piece. '
    + 'Your output is a strict JSON object matching the given schema; no commentary.';

  const user = [
    pieceSummary(macroParams, plan),
    availableChordsForMode(mode, tonic),
    modalInterchangeGuidance(mode, allowMI),
    cadenceCompatibilityTable(),
    compositionalGuidance(),
    `HARMONIC ADVENTUROUSNESS — ${adventurousness}:\n  ${HARMONIC_ADVENTUROUSNESS_DIRECTIVE[adventurousness]}`,
    schemaBlock(plan),
  ].join('\n\n');

  return { system, user };
}

function buildRetryPrompt(errors) {
  return [
    'The JSON you returned did not pass validation. Fix these specific problems and return the '
      + 'corrected JSON object — the full harmonic plan, same schema, no commentary:',
    '',
    errors.map((e) => `- ${e}`).join('\n'),
    '',
    'Return ONLY the corrected JSON object.',
  ].join('\n');
}

// =================================================================
// LLM CALL — mimics js/jingle/api.js's fetch / headers / error-handling shape,
// via the shared transport.
// =================================================================

async function callHarmonyLLM(system, messages) {
  return postMessages(
    { model: STAGE_3_MODEL, max_tokens: STAGE_3_MAX_TOKENS, system, messages },
    'Stage 3'
  );
}

// Strip code fences (if the model wrapped the JSON) and parse, with a brace-match
// fallback. Logs the raw response and throws clearly on failure.
function parseHarmonyResponse(raw) {
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
    console.error('Stage 3: could not parse the model response as JSON. Raw response:\n', raw);
    throw new Error('Stage 3: model response was not valid JSON (see console for the raw response).');
  }
}

// =================================================================
// VALIDATION — validateHarmonicPlan checks the WRAPPED LLM envelope. Exported so
// verify-stage3.mjs can stress-test it without re-deriving the logic. Collects
// ALL hard defects in one pass (so a retry sees them together) and accumulates
// the documented SOFT warnings separately (diagnostics, not retry triggers).
//
// HARD (errors): schema, coverage (tile 1..bars), cadence value, Roman-numeral
// parse, out-of-mode chord when interchange is OFF, cadence/final-chord
// mismatch, mode/cadence incompatibility.
// SOFT (warnings): all-tonic section, single-chord static section (bars ≥ 4),
// repeated chord across a section boundary, and each borrowed chord when
// interchange is ON. Schema hard, style/aesthetic soft (Session 10's lesson).
// =================================================================

// The cadence's required final ("approach") chord, checked against the parsed
// final numeral. Returns an error string, or null when compatible. Mode-aware:
// modal_iv_i needs a chord that RESOLVES minor on degree 4 (not just lowercase),
// so a major IV in a minor mode is correctly rejected as plagal-not-modal.
function cadenceFinalChordError(cadence, roman, mode, tonic, label) {
  let parsed;
  try {
    parsed = parseRoman(roman);
  } catch {
    return null; // unparseable — already flagged by the per-entry Roman check
  }
  const { degree, accidental } = parsed;
  const isV = degree === 5 && !accidental;
  const isFour = degree === 4 && !accidental;

  if (cadence === 'PAC' || cadence === 'IAC') {
    if (!isV) {
      return `Section "${label}" declares a ${cadence} cadence but its final progression chord is "${roman}" — `
        + `${cadence} requires V→I; either change the final chord to V or pick a different cadence (e.g. deceptive ends on V→vi).`;
    }
    return null;
  }
  if (cadence === 'half') {
    if (!isV) {
      return `Section "${label}" declares a half cadence but its final progression chord is "${roman}" — `
        + 'a half cadence ends ON V; change the final chord to V or pick a different cadence.';
    }
    return null;
  }
  if (cadence === 'deceptive') {
    if (!isV) {
      return `Section "${label}" declares a deceptive cadence but its final progression chord is "${roman}" — `
        + 'a deceptive cadence resolves V→vi; the final chord must be V (the surprise is the resolution, not the approach).';
    }
    return null;
  }
  if (cadence === 'plagal') {
    if (!isFour) {
      return `Section "${label}" declares a plagal cadence but its final progression chord is "${roman}" — `
        + 'a plagal cadence is IV→I (or iv→i); the final chord must be IV or iv.';
    }
    return null;
  }
  if (cadence === 'modal_iv_i') {
    if (!isFour) {
      return `Section "${label}" declares a modal_iv_i cadence but its final progression chord is "${roman}" — `
        + 'modal_iv_i is iv→i; the final chord must be a minor iv.';
    }
    let quality = null;
    try {
      quality = resolveRoman(roman, mode, tonic).quality;
    } catch {
      quality = null;
    }
    if (quality !== 'minor') {
      return `Section "${label}" declares a modal_iv_i cadence but its final chord "${roman}" resolves ${quality} in `
        + `${tonic} ${mode}, not a minor iv — a major IV→i is a PLAGAL cadence; use a minor iv or pick "plagal".`;
    }
    return null;
  }
  if (cadence === 'phrygian_ii_i') {
    const isFlatTwo = (accidental === 'b' && degree === 2)
      || (!accidental && degree === 2 && modeHasFlatTwo(mode, tonic));
    if (!isFlatTwo) {
      return `Section "${label}" declares a phrygian_ii_i cadence but its final progression chord is "${roman}" — `
        + 'the phrygian cadence is bII→i; the final chord must be bII (or "II" when the mode\'s degree 2 is already the flat-2).';
    }
    return null;
  }
  return null;
}

// Whether the declared cadence is compatible with the MODE at all (independent of
// the final chord). Returns an error string, or null. Only modal_iv_i and
// phrygian_ii_i are mode-restricted; the rest work across modes (their formulas
// use mode-aware voicings).
function cadenceModeError(cadence, mode, tonic) {
  if (cadence === 'modal_iv_i') {
    const quality = tonicTriadQuality(mode, tonic);
    if (quality === 'major' || quality === 'augmented') {
      return `the modal_iv_i cadence needs a minor tonic, but ${tonic} ${mode}'s i is ${quality} — `
        + 'use a major-compatible cadence here (PAC, IAC, half, deceptive, or plagal).';
    }
  }
  if (cadence === 'phrygian_ii_i') {
    if (!modeHasFlatTwo(mode, tonic)) {
      return `the phrygian_ii_i cadence needs a mode with a diatonic flat-2 (phrygian, phrygian_dominant, locrian, …), `
        + `but ${tonic} ${mode} has a natural 2 — its forced bII would be out of harmonic context. Pick a different cadence.`;
    }
  }
  return null;
}

// Validate one section's progression (the [{roman, bars}] tiling) + cadence.
// Pushes hard errors via `push`, soft warnings via `warn`. Returns
// { firstRoman, lastRoman } (the boundary chords, for the cross-section check),
// or null when the section was too malformed to analyze.
function validateSection(section, label, bars, mode, tonic, allowMI, push, warn) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    push(`Section "${label}" must be an object with "progression" and "cadence".`);
    return null;
  }

  // cadence — value check (schema). Compatibility checks run only if it is valid.
  const cadence = section.cadence;
  let cadenceValid = true;
  if (!CADENCE_TYPES.includes(cadence)) {
    push(`Section "${label}" cadence ${JSON.stringify(cadence)} is not one of: ${CADENCE_TYPES.join(', ')}.`);
    cadenceValid = false;
  }

  const progression = section.progression;
  if (!Array.isArray(progression) || progression.length === 0) {
    push(`Section "${label}" "progression" must be a non-empty array of { roman, bars } chord entries.`);
    return null;
  }

  // Per-entry schema + Roman-numeral validity, gathering the bar ranges + the
  // parsed degree of each chord (for the all-tonic soft check).
  const ranges = []; // [start, end] of well-formed, in-range entries
  const parsedDegrees = []; // { degree, accidental } of parseable, ordered by entry
  progression.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      push(`Section "${label}" progression entry ${i} must be an object { roman, bars }.`);
      return;
    }
    const { roman, bars: range } = entry;

    // bars — a [start, end] integer tuple within [1, bars]
    let rangeOk = true;
    if (!Array.isArray(range) || range.length !== 2 || !Number.isInteger(range[0]) || !Number.isInteger(range[1])) {
      push(`Section "${label}" progression entry ${i}: "bars" must be a [start, end] tuple of integers, got ${JSON.stringify(range)}.`);
      rangeOk = false;
    } else if (range[0] < 1 || range[1] > bars || range[0] > range[1]) {
      push(`Section "${label}" progression entry ${i}: bars [${range[0]}, ${range[1]}] out of range — must be within [1, ${bars}] with start <= end.`);
      rangeOk = false;
    }
    if (rangeOk) ranges.push([range[0], range[1]]);

    // roman — parseable, and valid in the mode (or a borrow when interchange is on)
    if (typeof roman !== 'string') {
      push(`Section "${label}" progression entry ${i}: "roman" must be a string, got ${JSON.stringify(roman)}.`);
      return;
    }
    let resolvedOk = true;
    try {
      resolveRoman(roman, mode, tonic);
    } catch (error) {
      push(`Section "${label}" progression entry ${i}: "${roman}" is not a parseable Roman numeral (${error.message}).`);
      resolvedOk = false;
    }
    if (resolvedOk) {
      const diatonic = isValidInMode(roman, mode, false);
      if (!diatonic) {
        if (!allowMI) {
          push(
            `Section "${label}" progression entry ${i}: "${roman}" is not diatonic in ${tonic} ${mode} and modal `
              + 'interchange is OFF — use a diatonic chord, or enable modal interchange.'
          );
        } else {
          warn(`section "${label}" borrows "${roman}" (chromatic / out-of-mode) — allowed because modal interchange is ON (informational).`);
        }
      }
      try {
        const { accidental, degree } = parseRoman(roman);
        parsedDegrees.push({ degree, accidental });
      } catch {
        /* unreachable — resolveRoman already succeeded */
      }
    }
  });

  // Coverage: the bar ranges must tile [1, bars] contiguously (no gap / overlap).
  // Same logic as Stage 5b's validateVoice.
  if (ranges.length > 0) {
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    let expectedNext = 1;
    for (const [start, end] of sorted) {
      if (start > expectedNext) {
        push(`Section "${label}" progression coverage gap: bars ${expectedNext}..${start - 1} have no chord.`);
      } else if (start < expectedNext) {
        push(`Section "${label}" progression coverage overlap at bar ${start} (already covered through bar ${expectedNext - 1}).`);
      }
      expectedNext = Math.max(expectedNext, end + 1);
    }
    if (expectedNext - 1 < bars) {
      push(`Section "${label}" progression coverage gap: bars ${expectedNext}..${bars} have no chord (section has ${bars} bars).`);
    }
  }

  // Cadence compatibility — only when the cadence value is valid and the final
  // chord parsed. If the mode itself is incompatible, that is the headline issue;
  // skip the final-chord check (changing the cadence resolves both).
  const lastEntry = progression[progression.length - 1];
  const lastRoman = lastEntry && typeof lastEntry === 'object' ? lastEntry.roman : undefined;
  const firstEntry = progression[0];
  const firstRoman = firstEntry && typeof firstEntry === 'object' ? firstEntry.roman : undefined;
  if (cadenceValid) {
    const modeError = cadenceModeError(cadence, mode, tonic);
    if (modeError) {
      push(`Section "${label}": ${modeError}`);
    } else if (typeof lastRoman === 'string') {
      const finalError = cadenceFinalChordError(cadence, lastRoman, mode, tonic, label);
      if (finalError) push(finalError);
    }
  }

  // SOFT: all-tonic (no harmonic motion) — every parsed chord is the tonic (I/i).
  if (parsedDegrees.length === progression.length && parsedDegrees.length > 0
    && parsedDegrees.every((c) => c.degree === 1 && !c.accidental)) {
    warn(`section "${label}" has no harmonic motion — every chord is the tonic (I/i).`);
  }
  // SOFT: a single-chord section that is long enough to feel static.
  if (progression.length === 1 && bars >= 4) {
    warn(`section "${label}" is harmonically static — a single chord over ${bars} bars; consider a predominant or dominant for motion.`);
  }

  return { firstRoman, lastRoman };
}

/**
 * Validate the WRAPPED HarmonicPlan envelope `{ sections: { <label>: {
 * progression: [{roman, bars}], cadence } } }` against `macroParams`. `config`
 * (optional) supplies `knobs.allow_modal_interchange`; absent, modal interchange
 * is treated as OFF (matching isValidInMode's default). Returns
 * { ok, errors, warnings }; `ok` is true only when `errors` is empty. Collects
 * ALL hard errors in one pass so the single retry sees them together; soft
 * warnings never affect `ok`.
 */
export function validateHarmonicPlan(wrapped, macroParams, config = undefined) {
  const errors = [];
  const warnings = [];
  const push = (message) => errors.push(message);
  const warn = (message) => warnings.push(message);

  if (!wrapped || typeof wrapped !== 'object' || Array.isArray(wrapped)) {
    return { ok: false, errors: ['HarmonicPlan must be a JSON object.'], warnings };
  }
  const sections = wrapped.sections;
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return { ok: false, errors: ['HarmonicPlan.sections must be an object keyed by section label.'], warnings };
  }

  let plan;
  try {
    plan = computeSectionPlan(macroParams);
  } catch (error) {
    return { ok: false, errors: [`Could not derive the section plan from macroParams: ${error.message}`], warnings };
  }
  const expectedLabels = plan.map((s) => s.label);
  const barsByLabel = new Map(plan.map((s) => [s.label, s.bars]));
  const mode = macroParams.mode;
  const tonic = macroParams.tonic;
  const allowMI = allowsModalInterchange(config);

  // Exact section-label set — none missing, none extra.
  for (const label of expectedLabels) {
    if (!Object.prototype.hasOwnProperty.call(sections, label)) {
      push(`Missing section "${label}" in the harmonic plan (expected sections: ${expectedLabels.join(', ')}).`);
    }
  }
  for (const label of Object.keys(sections)) {
    if (!barsByLabel.has(label)) {
      push(`Unexpected section "${label}" in the harmonic plan — not a section in macroParams (expected: ${expectedLabels.join(', ')}).`);
    }
  }

  // Per known section, in form order (so the cross-boundary check is meaningful).
  const boundaryByLabel = new Map();
  for (const { label } of plan) {
    if (!Object.prototype.hasOwnProperty.call(sections, label)) continue; // already flagged missing
    const boundary = validateSection(sections[label], label, barsByLabel.get(label), mode, tonic, allowMI, push, warn);
    if (boundary) boundaryByLabel.set(label, boundary);
  }

  // SOFT: a chord repeated across a section boundary (B ends on V, A' starts on V).
  for (let i = 1; i < expectedLabels.length; i++) {
    const prev = boundaryByLabel.get(expectedLabels[i - 1]);
    const here = boundaryByLabel.get(expectedLabels[i]);
    if (prev && here && typeof prev.lastRoman === 'string' && prev.lastRoman === here.firstRoman) {
      warn(`sections "${expectedLabels[i - 1]}" and "${expectedLabels[i]}" share the chord "${prev.lastRoman}" across their boundary (mild — not a defect).`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// =================================================================
// UNWRAP — convert the validated wrapped envelope into the canonical §3
// HarmonicPlan Stages 4 / 5a / 5b / 6 / 8 consume: `{ sections: [ { label,
// progression: [<roman per bar>], cadence } ] }`. Each `{ roman, bars:[s,e] }`
// expands to (e−s+1) copies of `roman`, so the per-bar array has length
// `section.bars` and Stage 6's romanForBar indexes it one chord per bar.
// Coverage is validated upstream, so every bar slot is filled.
// =================================================================

function expandProgression(entries, bars) {
  const perBar = new Array(bars).fill(null);
  for (const entry of entries) {
    if (!entry || !Array.isArray(entry.bars)) continue;
    const [start, end] = entry.bars;
    for (let bar = start; bar <= end; bar++) {
      if (bar >= 1 && bar <= bars) perBar[bar - 1] = entry.roman;
    }
  }
  return perBar;
}

function unwrapHarmonicPlan(wrapped, macroParams) {
  const plan = computeSectionPlan(macroParams);
  return {
    sections: plan.map((s) => {
      const section = wrapped.sections[s.label];
      return {
        label: s.label,
        progression: expandProgression(section.progression, s.bars),
        cadence: section.cadence,
      };
    }),
  };
}

// =================================================================
// THE STAGE — generateHarmonicPlan
// =================================================================

/**
 * Generate the harmonic plan for the supplied upstream context. Returns the
 * canonical §3 HarmonicPlan `{ sections: [ { label, progression, cadence } ] }`
 * Stages 4 / 5a / 5b / 6 / 8 consume.
 *
 * Modes:
 *   - Live: builds the prompt, calls the LLM, validates; on validation failure it
 *     retries ONCE with the specific errors fed back, then throws if still invalid.
 *   - Offline: pass `__mockResponse` (a JSON string) to skip the network and run
 *     that string through the same parse + validate + unwrap path — how
 *     verify-stage3.mjs exercises the stage without an API call.
 *
 * `onTrace`, if supplied, is called once per model round-trip (or the mock) with
 * `{ attempt, raw, ok, errors }`, and once more after a successful result with
 * `{ attempt: 'soft-note', warnings }` IF any soft warnings fired (those are
 * diagnostics, not failures). It is never required.
 */
export async function generateHarmonicPlan({
  macroParams,
  config,
  __mockResponse,
  onTrace,
} = {}) {
  if (!macroParams) throw new Error('generateHarmonicPlan requires macroParams.');

  const { system, user } = buildHarmonicPlanPrompt({ macroParams, config });
  const trace = typeof onTrace === 'function' ? onTrace : () => {};

  // Emit (and log) a validated plan's soft warnings. Diagnostics, never failures.
  const emitSoftWarnings = (warnings) => {
    if (warnings && warnings.length > 0) {
      trace({ attempt: 'soft-note', raw: null, ok: true, errors: [], warnings });
      for (const warning of warnings) console.warn(`Stage 3 (soft): ${warning}`);
    }
  };

  // --- Offline / deterministic fallback: same parse + validate, no network. ---
  if (__mockResponse !== undefined) {
    const parsed = parseHarmonyResponse(__mockResponse); // throws clearly on bad JSON
    const result = validateHarmonicPlan(parsed, macroParams, config);
    trace({ attempt: 0, raw: __mockResponse, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 3: mock response failed validation. Raw:\n', __mockResponse);
      throw new Error(`Stage 3: mock harmonic plan is invalid:\n  - ${result.errors.join('\n  - ')}`);
    }
    emitSoftWarnings(result.warnings);
    return unwrapHarmonicPlan(parsed, macroParams);
  }

  // --- Live path: call, validate, retry once with the errors fed back. ---
  const messages = [{ role: 'user', content: user }];
  let raw = await callHarmonyLLM(system, messages);
  let result;
  let parsed;
  try {
    parsed = parseHarmonyResponse(raw);
    result = validateHarmonicPlan(parsed, macroParams, config);
  } catch (parseError) {
    // Treat an unparseable first response like a validation failure so the single
    // retry gets a chance to return clean JSON.
    result = { ok: false, errors: [parseError.message], warnings: [] };
  }
  trace({ attempt: 1, raw, ok: result.ok, errors: result.errors });

  if (!result.ok) {
    messages.push({ role: 'assistant', content: raw });
    messages.push({ role: 'user', content: buildRetryPrompt(result.errors) });
    raw = await callHarmonyLLM(system, messages);
    parsed = parseHarmonyResponse(raw); // throws clearly if still unparseable
    result = validateHarmonicPlan(parsed, macroParams, config);
    trace({ attempt: 2, raw, ok: result.ok, errors: result.errors });
    if (!result.ok) {
      console.error('Stage 3: harmonic plan failed validation after one retry. Raw:\n', raw);
      throw new Error(`Stage 3: harmonic plan is invalid after one retry:\n  - ${result.errors.join('\n  - ')}`);
    }
  }

  emitSoftWarnings(result.warnings);
  return unwrapHarmonicPlan(parsed, macroParams);
}
