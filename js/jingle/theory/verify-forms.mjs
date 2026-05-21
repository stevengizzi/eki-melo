/* =================================================================
   VERIFY-FORMS — exit-criterion check for the form + phrase-structure
   libraries and the form engine (buildplan Session 2).

   It confirms:
     1. forms.json is internally consistent — section_count agrees with
        the label, relationship and proportion arrays; every proportion
        distribution has one entry per section and sums to 1.0; relationship
        roles/variations are from the allowed vocabularies and every `of` /
        `contrast_from` reference points at a real sibling label.
     2. phrase-structures.json is consistent — sub-phrase lengths and
        motif-assignment bars line up, and cadence types are from the
        allowed vocabulary.
     3. The engine behaves — distributeBars sums to the requested total with
        no empty section across every form, total and variant; getForm /
        getPhraseStructure hand back defensive copies; listFormsByTag works.
     3b. Largest-remainder symmetry — an all-equal default split is near-
        uniform (max - min <= 1), and sections sharing an `of:` target with
        equal proportions stay within one bar of each other across every
        variant. (contrast_from is deliberately not held to this.)
     4. The Session-2 exit-criterion demo — AABA over 16 and 20 bars with the
        default and both alternative proportions, printed for eyeballing.

   Prints failures verbosely and exits non-zero on any failure.

   RUNNING IT. Same throwaway-package.json dance as verify-spelling.mjs (the
   repo has no package.json by design):

     printf '{"type":"module"}' > js/jingle/package.json
     node js/jingle/theory/verify-forms.mjs
     rm js/jingle/package.json

   The browser loads these modules directly and needs none of this.
   ================================================================= */
import forms from './forms.json' with { type: 'json' };
import phraseStructures from './phrase-structures.json' with { type: 'json' };
import {
  getForm,
  distributeBars,
  getSectionRelationships,
  getPhraseStructure,
  listFormsByTag
} from './form-engine.js';

const ROLES = new Set([
  'exposition',
  'repetition',
  'contrast',
  'reprise',
  'development',
  'episode',
  'refrain'
]);
const VARIATIONS = new Set(['minor', 'major', 'ornamented']);
const CADENCE_TYPES = new Set([
  'none',
  'PAC',
  'IAC',
  'half',
  'deceptive',
  'plagal',
  'modal_iv_i',
  'phrygian_ii_i'
]);

const failures = [];
const fail = (scope, detail) => failures.push(`[${scope}] ${detail}`);
const sumOf = (numbers) => numbers.reduce((total, n) => total + n, 0);
const nearlyOne = (sum) => Math.abs(sum - 1) < 1e-9;

// --- 1. forms.json internal consistency. -----------------------------------
for (const [name, form] of Object.entries(forms)) {
  const { section_count, section_labels, relationships, proportions_default, proportions_alt } =
    form;

  if (section_labels.length !== section_count) {
    fail(name, `section_count ${section_count} != ${section_labels.length} labels`);
  }
  const labelSet = new Set(section_labels);
  if (labelSet.size !== section_labels.length) {
    fail(name, `duplicate section labels: [${section_labels.join(', ')}]`);
  }

  const relationshipLabels = Object.keys(relationships);
  if (relationshipLabels.length !== section_count) {
    fail(name, `relationships has ${relationshipLabels.length} entries, expected ${section_count}`);
  }
  for (const label of relationshipLabels) {
    if (!labelSet.has(label)) {
      fail(name, `relationship key "${label}" is not a declared section label`);
    }
    const relationship = relationships[label];
    if (!ROLES.has(relationship.role)) {
      fail(name, `${label}: role "${relationship.role}" not in the allowed set`);
    }
    if (relationship.variation !== null && !VARIATIONS.has(relationship.variation)) {
      fail(name, `${label}: variation "${relationship.variation}" not in the allowed set`);
    }
    for (const refKey of ['of', 'contrast_from']) {
      const ref = relationship[refKey];
      if (ref !== null && !labelSet.has(ref)) {
        fail(name, `${label}: ${refKey} "${ref}" points at no known section`);
      }
      if (ref === label) {
        fail(name, `${label}: ${refKey} refers to itself`);
      }
    }
  }

  const distributions = [proportions_default, ...proportions_alt];
  distributions.forEach((distribution, i) => {
    const tag = i === 0 ? 'default' : `alt[${i - 1}]`;
    if (distribution.length !== section_count) {
      fail(name, `proportions ${tag} has ${distribution.length} entries, expected ${section_count}`);
    }
    if (!nearlyOne(sumOf(distribution))) {
      fail(name, `proportions ${tag} sum to ${sumOf(distribution)}, expected 1.0`);
    }
    if (distribution.some((p) => p <= 0)) {
      fail(name, `proportions ${tag} has a non-positive share: [${distribution.join(', ')}]`);
    }
  });

  const [minBars, maxBars] = form.typical_total_bars;
  if (!(Number.isInteger(minBars) && Number.isInteger(maxBars) && 0 < minBars && minBars <= maxBars)) {
    fail(name, `typical_total_bars [${minBars}, ${maxBars}] is not a valid ascending positive range`);
  }
  if (!Array.isArray(form.tags) || form.tags.length === 0) {
    fail(name, 'tags is empty');
  }
}

// --- 2. phrase-structures.json consistency. --------------------------------
for (const [name, structure] of Object.entries(phraseStructures)) {
  const subPhraseLabels = new Set(structure.sub_phrases.map((sub) => sub.label));
  let cursorBar = 1;
  for (const sub of structure.sub_phrases) {
    if (!Number.isInteger(sub.length_bars) || sub.length_bars < 1) {
      fail(name, `sub-phrase "${sub.label}" has invalid length_bars ${sub.length_bars}`);
    }
    if (!CADENCE_TYPES.has(sub.cadence_type)) {
      fail(name, `sub-phrase "${sub.label}" cadence_type "${sub.cadence_type}" not in the allowed set`);
    }
    cursorBar += sub.length_bars;
  }
  const totalBars = cursorBar - 1;

  for (const assignment of structure.default_motif_assignments) {
    if (!subPhraseLabels.has(assignment.sub_phrase)) {
      fail(name, `motif assignment references unknown sub-phrase "${assignment.sub_phrase}"`);
    }
    const end = assignment.start_bar + assignment.length_bars - 1;
    if (assignment.start_bar < 1 || end > totalBars) {
      fail(
        name,
        `motif assignment bars ${assignment.start_bar}..${end} fall outside the ${totalBars}-bar structure`
      );
    }
  }
}

// --- 3. Engine behaviour. --------------------------------------------------
const TEST_TOTALS = [4, 8, 12, 16, 20, 24, 32, 40];
for (const name of Object.keys(forms)) {
  const variantCount = 1 + forms[name].proportions_alt.length;
  for (let variant = 0; variant < variantCount; variant++) {
    for (const total of TEST_TOTALS) {
      if (total < forms[name].section_count) continue;
      const counts = distributeBars(name, total, variant);
      if (counts.length !== forms[name].section_count) {
        fail(name, `distributeBars(${total}, v${variant}) returned ${counts.length} sections`);
      }
      if (sumOf(counts) !== total) {
        fail(name, `distributeBars(${total}, v${variant}) = [${counts}] sums to ${sumOf(counts)}`);
      }
      if (counts.some((c) => !Number.isInteger(c) || c < 1)) {
        fail(name, `distributeBars(${total}, v${variant}) = [${counts}] has a non-positive/non-integer count`);
      }
    }
  }
}

// --- 3b. Bar-distribution symmetry (Hamilton largest-remainder). -----------
// A. Equal-proportion symmetry: when proportions_default is all-equal, the
//    default bar split must be near-uniform (max - min <= 1). This is the
//    AABA-20 case the old even-preference rounding got wrong ([4,4,6,6]).
// B. of:-relationship symmetry: sections that share an `of:` target AND were
//    given equal proportions must land within one bar of each other, so
//    repeated/reprise sections (an AABA's A1/A2/A3) stay recognizably equal
//    across every variant. Sections deliberately given different proportions
//    (an AABA alt variant's longer reprise) are exempt — only equal-proportion
//    siblings are held to the bound, which is exactly what largest-remainder
//    guarantees and is the point of the fix.
// C. contrast_from is intentionally NOT checked: a B that contrasts with A1
//    carries no obligation to match the length of another contrasting section.
const variantProportions = (form, variant) =>
  variant === 0 ? form.proportions_default : form.proportions_alt[variant - 1];
const allEqual = (numbers) => numbers.every((n) => n === numbers[0]);
const spread = (numbers) => Math.max(...numbers) - Math.min(...numbers);

for (const [name, form] of Object.entries(forms)) {
  const variantCount = 1 + form.proportions_alt.length;
  for (let variant = 0; variant < variantCount; variant++) {
    const proportions = variantProportions(form, variant);
    for (const total of TEST_TOTALS) {
      if (total < form.section_count) continue;
      const counts = distributeBars(name, total, variant);

      // A — default distribution only, and only when it is all-equal.
      if (variant === 0 && allEqual(proportions) && spread(counts) > 1) {
        fail(name, `equal-proportion default at ${total} bars is not near-uniform: [${counts}]`);
      }

      // B — bucket sections by (of: target, proportion); each bucket holds
      // equal-proportion siblings of one target and must stay within one bar.
      const buckets = new Map();
      form.section_labels.forEach((label, i) => {
        const target = form.relationships[label].of;
        if (target === null) return;
        const key = `${target}@${proportions[i]}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(counts[i]);
      });
      for (const [key, bucketCounts] of buckets) {
        if (spread(bucketCounts) > 1) {
          fail(name, `of:-siblings ${key} got asymmetric counts [${bucketCounts}] at ${total} bars, v${variant}`);
        }
      }
    }
  }
}

// distributeBars rejects an out-of-range variant and an impossibly small total.
try {
  distributeBars('AABA', 16, 99);
  fail('AABA', 'distributeBars accepted an out-of-range variant index');
} catch {
  /* expected */
}
try {
  distributeBars('rondo', 3); // 5 sections, only 3 bars
  fail('rondo', 'distributeBars accepted fewer bars than sections');
} catch {
  /* expected */
}

// getForm / getPhraseStructure return defensive copies.
const copy = getForm('AABA');
copy.section_labels.push('TAMPERED');
if (getForm('AABA').section_labels.includes('TAMPERED')) {
  fail('AABA', 'getForm did not return a defensive copy');
}
const phraseCopy = getPhraseStructure('period');
phraseCopy.sub_phrases.push({ label: 'TAMPERED' });
if (getPhraseStructure('period').sub_phrases.some((s) => s.label === 'TAMPERED')) {
  fail('period', 'getPhraseStructure did not return a defensive copy');
}

// getSectionRelationships matches the labels; listFormsByTag finds the form.
const aabaRelationships = getSectionRelationships('AABA');
if (Object.keys(aabaRelationships).join(',') !== getForm('AABA').section_labels.join(',')) {
  fail('AABA', 'getSectionRelationships keys do not match section_labels order');
}
if (!listFormsByTag('balanced').includes('AABA')) {
  fail('AABA', 'listFormsByTag("balanced") did not include AABA');
}

// --- 4. Session-2 exit-criterion demo: AABA over 16 and 20 bars. -----------
// 20 bars is the case the old even-preference rounding got wrong (default
// [0.25,0.25,0.25,0.25] -> [4,4,6,6]); under largest-remainder it is the
// symmetric [5,5,5,5].
const aabaForm = getForm('AABA');
const printAABA = (total) => {
  console.log(`AABA over ${total} bars:`);
  [aabaForm.proportions_default, ...aabaForm.proportions_alt].forEach((distribution, i) => {
    const variantTag = i === 0 ? 'default' : `alt[${i - 1}]`;
    const counts = distributeBars('AABA', total, i);
    const labelled = aabaForm.section_labels.map((label, j) => `${label}=${counts[j]}`).join(' ');
    console.log(`  ${variantTag.padEnd(7)} [${distribution.join(', ')}] -> ${labelled} (sum ${sumOf(counts)})`);
  });
};
printAABA(16);
printAABA(20);

console.log('\nSection relationships for AABA:');
for (const [label, relationship] of Object.entries(getSectionRelationships('AABA'))) {
  console.log(`  ${label}: ${JSON.stringify(relationship)}`);
}

// --- Report. ---------------------------------------------------------------
console.log(
  `\nChecked ${Object.keys(forms).length} forms + ${Object.keys(phraseStructures).length} phrase ` +
    `structures, and exercised distributeBars over ${TEST_TOTALS.length} totals x all variants.`
);

if (failures.length > 0) {
  console.error(`\nFAILED — ${failures.length} problem(s):`);
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}

console.log('\nPASSED — libraries are consistent and the engine distributes bars correctly.');
