/* =================================================================
   FORM ENGINE — resolves form and phrase-structure names to their
   structural metadata, and distributes a bar budget across a form's
   sections.

   The deterministic structural layer for the composition pipeline
   (buildplan Session 2). Reads the form library (forms.json) and the
   phrase-structure library (phrase-structures.json) and answers: how many
   sections does form X have and how do they relate, how should N bars be
   split across them, and what does phrase structure Y look like.

   This is the macro-level companion to mode-engine.js's pitch layer.
   Stage 2 (macro params) picks a form and total bar count; this module
   turns that choice into a concrete per-section bar plan. Stage 5a (phrase
   placement) reads section relationships and phrase structures to decide
   where motifs go and how sections quote one another.

   PORTABILITY. This module imports only from forms.json and
   phrase-structures.json — no synth- or pipeline-specific code. It is
   portable to other composition projects as-is.

   BAR DISTRIBUTION. distributeBars favours even bar counts (multiples of
   two), because musical phrases overwhelmingly come in even lengths. It is
   a soft preference: the hard guarantees are that the returned counts sum
   to exactly totalBars and that no section is shorter than one bar. When a
   total cannot be split into all-even sections (an odd total, or
   proportions that do not land on even multiples), single-bar adjustments
   are applied to the sections whose counts deviate most from their ideal.
   The function does not guarantee that repeated sections (the two A's of an
   AABA, say) receive identical counts when the total forces an uneven split
   — downstream stages may override the plan if exact symmetry is wanted.
   ================================================================= */
import forms from './forms.json' with { type: 'json' };
import phraseStructures from './phrase-structures.json' with { type: 'json' };

function rawForm(name) {
  if (typeof name !== 'string' || !(name in forms)) {
    throw new Error(`Unknown form "${name}". See forms.json for available forms.`);
  }
  return forms[name];
}

function rawPhraseStructure(name) {
  if (typeof name !== 'string' || !(name in phraseStructures)) {
    throw new Error(
      `Unknown phrase structure "${name}". See phrase-structures.json for available structures.`
    );
  }
  return phraseStructures[name];
}

// The proportion array for a given variant. variantIndex 0 is
// proportions_default; 1..k select proportions_alt[0..k-1].
function proportionsForVariant(form, formName, variantIndex) {
  if (!Number.isInteger(variantIndex) || variantIndex < 0) {
    throw new Error(`variantIndex must be a non-negative integer, got ${variantIndex}.`);
  }
  if (variantIndex === 0) {
    return form.proportions_default;
  }
  const alt = form.proportions_alt[variantIndex - 1];
  if (!alt) {
    throw new Error(
      `Form "${formName}" has no variant ${variantIndex}: there are ` +
        `${form.proportions_alt.length} alternative distribution(s) ` +
        `(use variantIndex 0–${form.proportions_alt.length}).`
    );
  }
  return alt;
}

const sumOf = (numbers) => numbers.reduce((total, n) => total + n, 0);

/**
 * The full form data object for `name`, returned as a fresh copy so callers
 * cannot mutate the shared library.
 */
export function getForm(name) {
  return structuredClone(rawForm(name));
}

/**
 * Integer bar counts for each section of `formName`, summing to exactly
 * `totalBars`. `variantIndex` selects the proportion distribution: 0 (the
 * default) is `proportions_default`, 1 is the first entry of
 * `proportions_alt`, and so on.
 *
 * Counts are biased toward even values where the total allows (see the
 * module header). Every section gets at least one bar; `totalBars` must
 * therefore be at least the form's section count.
 */
export function distributeBars(formName, totalBars, variantIndex = 0) {
  const form = rawForm(formName);
  if (!Number.isInteger(totalBars) || totalBars < 1) {
    throw new Error(`totalBars must be a positive integer, got ${totalBars}.`);
  }
  const proportions = proportionsForVariant(form, formName, variantIndex);
  const sectionCount = proportions.length;
  if (totalBars < sectionCount) {
    throw new Error(
      `Cannot distribute ${totalBars} bars across ${sectionCount} sections ` +
        `of "${formName}" — each section needs at least one bar.`
    );
  }

  // Ideal real-valued share per section, and an even-preferring first guess
  // (nearest even integer, floored at one so no section is empty).
  const ideal = proportions.map((proportion) => proportion * totalBars);
  const counts = ideal.map((share) => Math.max(1, 2 * Math.round(share / 2)));

  // Reconcile the guess to the exact total. Each pass moves bars in pairs to
  // preserve evenness, falling back to a single bar when the remaining
  // difference is odd or no section can absorb a pair without dropping below
  // one. Bars are added to the most under-allocated section and taken from
  // the most over-allocated one, measured against the ideal share.
  const reconcile = () => {
    let difference = totalBars - sumOf(counts);
    while (difference !== 0) {
      let step = difference > 0 ? Math.min(2, difference) : Math.max(-2, difference);
      let candidates = counts
        .map((_, index) => index)
        .filter((index) => counts[index] + step >= 1);
      if (candidates.length === 0) {
        step = step > 0 ? 1 : -1;
        candidates = counts.map((_, index) => index).filter((index) => counts[index] + step >= 1);
      }
      const deviation =
        step > 0
          ? (index) => ideal[index] - counts[index] // reward under-allocated
          : (index) => counts[index] - ideal[index]; // reward over-allocated
      const target = candidates.reduce((best, index) =>
        deviation(index) > deviation(best) ? index : best
      );
      counts[target] += step;
      difference -= step;
    }
  };
  reconcile();

  return counts;
}

/**
 * The section-relationship map for `formName` (role / of / variation /
 * contrast_from per section label), returned as a fresh copy.
 */
export function getSectionRelationships(formName) {
  return structuredClone(rawForm(formName).relationships);
}

/**
 * The full phrase-structure data object for `name`, returned as a fresh
 * copy so callers cannot mutate the shared library.
 */
export function getPhraseStructure(name) {
  return structuredClone(rawPhraseStructure(name));
}

/**
 * Names of every form whose `tags` include `tag`.
 */
export function listFormsByTag(tag) {
  if (typeof tag !== 'string') {
    throw new Error(`tag must be a string, got ${typeof tag}.`);
  }
  return Object.keys(forms).filter((name) => forms[name].tags.includes(tag));
}
