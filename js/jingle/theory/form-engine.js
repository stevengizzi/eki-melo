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

   BAR DISTRIBUTION. distributeBars splits a bar budget across a form's
   sections with Hamilton's largest-remainder method: each section's ideal
   share is its proportion × totalBars, floored to an integer baseline, and
   the leftover bars (the deficit) are handed out one at a time to the
   sections with the largest fractional remainder (ties broken by ideal
   share, then by section order). The hard guarantees are that the returned
   counts sum to exactly totalBars and that no section is shorter than one
   bar. Bar counts are NOT biased toward even values — they fall out of the
   proportions and the total, so sections given equal proportions land within
   one bar of each other (an AABA at 20 bars on equal proportions is
   [5,5,5,5], not [4,4,6,6]; repeated sections stay recognizably equal). A
   caller that wants only-even outputs should request a totalBars that is a
   clean multiple of the form's structure.
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
 * `totalBars`, allocated by Hamilton's largest-remainder method (see the
 * module header). `variantIndex` selects the proportion distribution: 0 (the
 * default) is `proportions_default`, 1 is the first entry of
 * `proportions_alt`, and so on.
 *
 * Counts follow the proportions directly — they are not rounded toward even
 * values — so sections given equal proportions land within one bar of each
 * other. Every section gets at least one bar; `totalBars` must therefore be
 * at least the form's section count.
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

  // Hamilton's largest-remainder method. Floor each section's ideal share
  // (proportion × totalBars) for a baseline, then hand the leftover bars out
  // one at a time to the sections with the largest fractional remainder,
  // breaking ties by ideal share (descending) and finally by section order.
  const ideal = proportions.map((proportion) => proportion * totalBars);
  const counts = ideal.map((share) => Math.floor(share));
  const deficit = totalBars - sumOf(counts);

  const remainderRank = ideal
    .map((share, index) => ({ index, share, remainder: share - Math.floor(share) }))
    .sort((a, b) => b.remainder - a.remainder || b.share - a.share || a.index - b.index);
  remainderRank.slice(0, deficit).forEach(({ index }) => {
    counts[index] += 1;
  });

  // Safety net for tiny proportions. The totalBars >= sectionCount guard plus
  // the deficit pass normally leave every section with at least one bar, but
  // if a share floored to zero and missed the deficit, promote it to one bar
  // by taking from the largest section. The sum stays at totalBars. This
  // should not trigger for the shipped forms; it keeps the contract safe.
  let empty = counts.indexOf(0);
  while (empty !== -1) {
    const donor = counts.reduce((best, count, index) => (count > counts[best] ? index : best), 0);
    if (counts[donor] <= 1) break;
    counts[donor] -= 1;
    counts[empty] += 1;
    empty = counts.indexOf(0);
  }

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
