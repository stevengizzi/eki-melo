/* =================================================================
   STAGE 2 — MACRO PARAMETERS (buildplan Session 13). The deterministic stage:
   it turns the Aesthetic (Stage 1's small dict of hints + intensity) into the
   concrete MacroParams the rest of the pipeline runs on — a key, a mode, a form,
   a bar count, a per-section bar plan, a tempo, a register, and a harmonic-rhythm
   hint. NO LLM CALL. Stage 1 already deferred every ambiguous field with the
   "auto" sentinel, so Stage 2 just makes principled deterministic choices: honor
   each hint when it is set, fall back to a mood-label-keyed default when it is
   "auto". (The buildplan §3 floated an optional LLM tiebreak here; the "auto"
   deferral makes it unnecessary.)

   It is a SIBLING-SHAPED stage (generate* / validate* exports, an onTrace soft-
   warning channel) but pure JS — so it has no prompt, no network, no retry.

     generateMacroParams({ aesthetic, lengthBudget?, config?, onTrace? }) → MacroParams
     validateMacroParams(macroParams) → { ok, errors, warnings }
     deriveKnobs({ aesthetic, config? }) → config   (the intensity-derived knobs)

   OUTPUT (the MacroParams Stages 3/4/5a/5b/6/8 consume — the shape the inspector's
   hand-supplied cases use and computeSectionPlan reads):
     {
       tonic, mode, form, total_bars,
       sections: [{ label, bars }],
       meter: { numerator: 4, denominator: 4 },   // fixed for now
       register_center,                            // a pitch string, e.g. "C5"
       tempo, harmonic_rhythm, mood
     }

   THE KNOBS (deriveKnobs). The four freedom knobs the downstream LLM stages read
   (harmonic / phrase / arrangement / texture adventurousness) plus motif_
   architecture default to values DERIVED FROM INTENSITY — a gentle/ambient guest
   (low intensity) gets tame, by-the-book settings; a hard-hitting guest gets wild
   ones. `config.user_knobs_override === true` bypasses the derivation entirely
   (the user's explicit knob preferences win). This is a SEPARATE concern from
   MacroParams (knobs live on the config the pipeline threads, not in the §3
   MacroParams shape), so the runner calls deriveKnobs and threads its result to
   the downstream stages; generateMacroParams stays a pure §3 producer.

   PORTABILITY. pipeline/ code: imports theory/form-engine + scales.json +
   pipeline-config. No network, no synth, no api.js.
   ================================================================= */
import { distributeBars, getForm } from '../theory/form-engine.js';
import scales from '../theory/scales.json' with { type: 'json' };
import { DEFAULT_CONFIG } from './pipeline-config.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// scales.json calls the plain minor "aeolian"; Stage 1's prompt names it
// "natural_minor". Normalize the alias so downstream gets a real scale key.
function canonicalMode(mode) {
  return mode === 'natural_minor' ? 'aeolian' : mode;
}

// =================================================================
// 1. TONIC — hint if set, else a project-idiomatic per-mood default. These
// mappings are consistent, not principled — a house style, not music theory.
// =================================================================
const MOOD_TONIC = {
  celebratory: 'C', triumphant: 'C', playful: 'C',
  wistful: 'A', calm: 'A',
  hopeful: 'D',
  mysterious: 'E', dark: 'E',
  intimate: 'F',
  energetic: 'G',
};

function chooseTonic(aesthetic) {
  if (aesthetic.tonic_hint && aesthetic.tonic_hint !== 'auto') return aesthetic.tonic_hint;
  return MOOD_TONIC[aesthetic.mood_label] ?? 'C';
}

// =================================================================
// 2. MODE — hint if set, else per-mood default. Intimate splits on intensity.
// =================================================================
const MOOD_MODE = {
  celebratory: 'major', triumphant: 'major', playful: 'major', hopeful: 'major',
  wistful: 'aeolian',
  calm: 'dorian',
  mysterious: 'harmonic_minor',
  dark: 'phrygian',
  energetic: 'mixolydian',
};

function chooseMode(aesthetic) {
  if (aesthetic.mode_hint && aesthetic.mode_hint !== 'auto') return canonicalMode(aesthetic.mode_hint);
  if (aesthetic.mood_label === 'intimate') {
    return clamp(aesthetic.intensity ?? 0.5, 0, 1) > 0.6 ? 'aeolian' : 'major';
  }
  return MOOD_MODE[aesthetic.mood_label] ?? 'major';
}

// =================================================================
// 3. TEMPO — hint if set (clamped sane), else mood + intensity. Fast moods scale
// UP with intensity; slow moods scale DOWN (calmer = slower); the rest sit medium.
// =================================================================
const FAST_MOODS = new Set(['energetic', 'triumphant', 'celebratory']);
const SLOW_MOODS = new Set(['calm', 'wistful', 'intimate']);

function chooseTempo(aesthetic) {
  if (typeof aesthetic.tempo_hint === 'number') return clamp(Math.round(aesthetic.tempo_hint), 60, 200);
  const intensity = clamp(aesthetic.intensity ?? 0.5, 0, 1);
  if (FAST_MOODS.has(aesthetic.mood_label)) return Math.round(130 + 20 * intensity); // 130–150
  if (SLOW_MOODS.has(aesthetic.mood_label)) return Math.round(100 - 20 * intensity); // 80–100, inverse
  return Math.round(105 + 20 * intensity); // 105–125, medium
}

// =================================================================
// 4. FORM — hint (mapped to a real forms.json name) if set, else per-mood default.
// The Stage-1 hint vocabulary is user-facing shorthand ("AB", "ABA", "AABB") that
// maps onto the library's canonical form names; the moods that have no explicit
// default fall back to ternary (a balanced ABA). rondo is too long for a jingle —
// if hinted under 48 beats it is replaced with ternary.
// =================================================================
const FORM_HINT_TO_CANONICAL = {
  AABA: 'AABA',
  ABA: 'ternary',
  AB: 'binary',
  AABB: 'binary', // no AABB form in the library; collapses to a doubled binary
  ternary: 'ternary',
  ternary_varied: 'ternary_varied',
  rondo: 'rondo',
};
const MOOD_FORM_DEFAULT = {
  triumphant: 'AABA', celebratory: 'AABA',
  hopeful: 'ternary', calm: 'ternary', dark: 'ternary', mysterious: 'ternary',
  intimate: 'binary',
  energetic: 'ternary_varied',
  // playful + wistful (unclassified) fall through to ternary below.
};

function chooseForm(aesthetic, lengthBudget, warn) {
  let form;
  if (aesthetic.form_hint && aesthetic.form_hint !== 'auto') {
    form = FORM_HINT_TO_CANONICAL[aesthetic.form_hint] ?? 'ternary';
    if (aesthetic.form_hint === 'AABB') warn('form hint "AABB" has no exact library form; resolved to AB (binary).');
  } else {
    form = MOOD_FORM_DEFAULT[aesthetic.mood_label] ?? 'ternary';
  }
  if (form === 'rondo' && lengthBudget < 48) {
    warn('rondo needs ≥48 beats to breathe; at this length it was replaced with ternary (ABA).');
    form = 'ternary';
  }
  return form;
}

// =================================================================
// 8. HARMONIC RHYTHM — a prompt hint (chords-per-bar) derived from length + mood.
// Short pieces let the chords breathe (one per two bars); long ones can move
// twice a bar, but only for the high-energy moods at high intensity.
// =================================================================
function chooseHarmonicRhythm(totalBars, mood, intensity) {
  if (totalBars <= 6) return 'one_per_2bars';
  if (totalBars > 12) {
    return (mood === 'triumphant' || mood === 'energetic') && intensity >= 0.7 ? 'two_per_bar' : 'one_per_bar';
  }
  return 'one_per_bar'; // 7–12 bars
}

// =================================================================
// 7. REGISTER — register_hint → a pitch string whose octave digit is what Stage 6
// (leadOctaveOf) and the cadence formulas actually read. "mid" / absent → C5.
// =================================================================
const REGISTER_OCTAVE = { low: 4, mid: 5, high: 6 };

function chooseRegisterCenter(aesthetic) {
  const octave = REGISTER_OCTAVE[aesthetic.register_hint] ?? 5;
  return `C${octave}`;
}

// =================================================================
// KNOB DERIVATION — intensity → the four adventurousness knobs + motif_architecture.
// =================================================================

// The three-tier adventurousness scale used by harmonic / phrase / texture.
function tierFromIntensity(intensity) {
  if (intensity < 0.4) return 'tame';
  if (intensity < 0.7) return 'adventurous';
  return 'wild';
}

/**
 * The effective config for the downstream LLM stages: `config` with its knobs
 * overlaid by intensity-derived defaults. `config.user_knobs_override === true`
 * returns `config` unchanged (the user's explicit knobs win). Arrangement uses a
 * two-level scale with a raised threshold (its variation is more audibly
 * disruptive); allow_modal_interchange is aligned to the derived harmonic level
 * (off when tame, on otherwise) so Stage 3's validator and prompt stay consistent.
 * Returns a fresh object; never mutates `config`.
 */
export function deriveKnobs({ aesthetic, config = DEFAULT_CONFIG } = {}) {
  if (config && config.user_knobs_override === true) return config;
  const intensity = clamp(typeof aesthetic?.intensity === 'number' ? aesthetic.intensity : 0.5, 0, 1);
  const harmonic = tierFromIntensity(intensity);
  const derived = {
    harmonic_adventurousness: harmonic,
    phrase_adventurousness: tierFromIntensity(intensity),
    texture_adventurousness: tierFromIntensity(intensity),
    arrangement_adventurousness: intensity < 0.6 ? 'tame' : 'adventurous',
    motif_architecture: 'phrase',
    allow_modal_interchange: harmonic !== 'tame',
  };
  return { ...config, knobs: { ...(config?.knobs ?? {}), ...derived } };
}

// =================================================================
// THE STAGE — generateMacroParams
// =================================================================

/**
 * Turn an Aesthetic into MacroParams. `lengthBudget` is the total piece length in
 * beats (default 32 — the jingle length cap); `config` is accepted for parity but
 * does not affect the §3 fields (knobs are deriveKnobs's job). `onTrace`, if
 * supplied, receives `{ attempt: 'soft-note', warnings }` once if any soft
 * warning fired (the form downsize / substitution notes).
 *
 * THE 32-BEAT DOWNSIZE (buildplan §7.7). At the default 32-beat budget a 4-section
 * form (AABA, rondo, …) distributes to ~2 bars per section — too cramped for
 * harmonic variety. When every section would get ≤2 bars, the form is downsized to
 * AB (binary, 2 sections × 4 bars) with a soft warning.
 */
export function generateMacroParams({ aesthetic, lengthBudget = 32, config, onTrace } = {}) {
  void config; // §3 fields don't read knobs; accepted for sibling-parity.
  if (!aesthetic || typeof aesthetic !== 'object' || Array.isArray(aesthetic)) {
    throw new Error('generateMacroParams requires an aesthetic object (Stage 1 output).');
  }
  const trace = typeof onTrace === 'function' ? onTrace : () => {};
  const warnings = [];
  const warn = (m) => warnings.push(m);

  const mood = aesthetic.mood_label;
  const intensity = clamp(typeof aesthetic.intensity === 'number' ? aesthetic.intensity : 0.5, 0, 1);

  const meter = { numerator: 4, denominator: 4 };
  const beatsPerBar = meter.numerator;
  const total_bars = Math.max(1, Math.round(lengthBudget / beatsPerBar));

  const tonic = chooseTonic(aesthetic);
  const mode = chooseMode(aesthetic);
  const tempo = chooseTempo(aesthetic);
  let form = chooseForm(aesthetic, lengthBudget, warn);

  // Per-section bar plan, with the 32-beat downsize.
  let counts = distributeBars(form, total_bars);
  if (lengthBudget === 32 && counts.length > 2 && counts.every((b) => b <= 2)) {
    warn(`downsized ${form} to AB (binary) to fit the 32-beat budget — each section needs ≥3 bars for harmonic variety.`);
    form = 'binary';
    counts = distributeBars(form, total_bars);
  }
  const labels = getForm(form).section_labels;
  const sections = labels.map((label, i) => ({ label, bars: counts[i] }));

  if (warnings.length > 0) trace({ attempt: 'soft-note', warnings });

  return {
    tonic,
    mode,
    form,
    total_bars,
    sections,
    meter,
    register_center: chooseRegisterCenter(aesthetic),
    tempo,
    harmonic_rhythm: chooseHarmonicRhythm(total_bars, mood, intensity),
    mood,
  };
}

// =================================================================
// VALIDATION — validateMacroParams. HARD: schema + section/total consistency.
// SOFT: total_bars < 4 (too short for any form); tempo outside [60, 200].
// =================================================================

/**
 * Validate a MacroParams object. Returns { ok, errors, warnings }; `ok` is true
 * only when `errors` is empty. Soft warnings never affect `ok`.
 */
export function validateMacroParams(macroParams) {
  const errors = [];
  const warnings = [];
  const push = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!macroParams || typeof macroParams !== 'object' || Array.isArray(macroParams)) {
    return { ok: false, errors: ['MacroParams must be a JSON object.'], warnings };
  }

  if (typeof macroParams.tonic !== 'string' || !/^[A-G](#{1,2}|b{1,2})?$/.test(macroParams.tonic)) {
    push(`tonic must be a pitch-class letter A–G with an optional accidental, got ${JSON.stringify(macroParams.tonic)}.`);
  }
  if (typeof macroParams.mode !== 'string' || !(macroParams.mode in scales)) {
    push(`mode must be a known scale name, got ${JSON.stringify(macroParams.mode)}.`);
  }
  if (typeof macroParams.form !== 'string' || macroParams.form.length === 0) {
    push(`form must be a non-empty string, got ${JSON.stringify(macroParams.form)}.`);
  }
  if (typeof macroParams.mood !== 'string' || macroParams.mood.length === 0) {
    push(`mood must be a non-empty string, got ${JSON.stringify(macroParams.mood)}.`);
  }
  if (typeof macroParams.register_center !== 'string') {
    push(`register_center must be a pitch string (e.g. "C5"), got ${JSON.stringify(macroParams.register_center)}.`);
  }

  // total_bars — positive integer; under 4 is a soft warning (too short for a form).
  const totalBars = macroParams.total_bars;
  if (!Number.isInteger(totalBars) || totalBars < 1) {
    push(`total_bars must be a positive integer, got ${JSON.stringify(totalBars)}.`);
  } else if (totalBars < 4) {
    warn(`total_bars ${totalBars} is very short — under 4 bars leaves little room for any form.`);
  }

  // sections — non-empty array of { label, bars }; must sum to total_bars.
  if (!Array.isArray(macroParams.sections) || macroParams.sections.length === 0) {
    push('sections must be a non-empty array of { label, bars }.');
  } else {
    let sum = 0;
    macroParams.sections.forEach((s, i) => {
      if (!s || typeof s !== 'object' || typeof s.label !== 'string' || !Number.isInteger(s.bars) || s.bars < 1) {
        push(`sections[${i}] must be { label: string, bars: positive integer }, got ${JSON.stringify(s)}.`);
      } else {
        sum += s.bars;
      }
    });
    if (Number.isInteger(totalBars) && sum !== totalBars) {
      push(`sections bars sum to ${sum} but total_bars is ${totalBars} — they must agree.`);
    }
  }

  // meter — { numerator, denominator } integers.
  const meter = macroParams.meter;
  if (!meter || typeof meter !== 'object' || !Number.isInteger(meter.numerator) || !Number.isInteger(meter.denominator)) {
    push(`meter must be { numerator: int, denominator: int }, got ${JSON.stringify(meter)}.`);
  }

  // tempo — a number; outside [60, 200] is a soft warning.
  if (typeof macroParams.tempo !== 'number' || Number.isNaN(macroParams.tempo)) {
    push(`tempo must be a number, got ${JSON.stringify(macroParams.tempo)}.`);
  } else if (macroParams.tempo < 60 || macroParams.tempo > 200) {
    warn(`tempo ${macroParams.tempo} is outside the sane range [60, 200] BPM.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
