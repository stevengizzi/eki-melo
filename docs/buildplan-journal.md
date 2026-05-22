# eki-melo Composition Engine Buildplan — Journal

> Rolling shared state between build sessions. One entry per session.
> Format per buildplan §6. The Claude.ai-side review adds a second voice
> to each entry after the fact.

## Session 1 — 2026-05-21 — scales + mode engine

**What landed (commits):**
- feat: add scale library + mode engine (DEC-scope: theory layer)
  - `js/jingle/theory/scales.json` — 47 verified scales
  - `js/jingle/theory/mode-engine.js` — pitch resolution
  - `js/jingle/theory/scales-sources.md` — verification sources
  - `docs/buildplan-journal.md` — this file

**Coverage (47 scales, all interval patterns sum to 12):**
- Diatonic modes (7): major, dorian, phrygian, lydian, mixolydian,
  aeolian, locrian
- Harmonic minor modes (7): harmonic_minor, locrian_n6, ionian_sharp5,
  dorian_sharp4, phrygian_dominant, lydian_sharp2, altered_dim
- Melodic minor modes (7): melodic_minor, dorian_b2, lydian_augmented,
  lydian_dominant, mixolydian_b6, locrian_n2, altered
- Harmonic major + 3 modes (4): harmonic_major, dorian_b5,
  lydian_diminished, mixolydian_b2
- Double harmonic family (3): double_harmonic, hungarian_minor, oriental
- Neapolitan (2): neapolitan_major, neapolitan_minor
- Hungarian major (1), Romanian minor (1)
- Pentatonics (6): major_pentatonic, minor_pentatonic, hirajoshi, in_sen,
  yo_scale, iwato
- Blues (2): blues_major, blues_minor
- Symmetric (4): whole_tone, wh_diminished, hw_diminished, augmented
- Bebop (3): bebop_dominant, bebop_major, bebop_dorian

**Exit criteria status:**
- [x] 30+ scales (shipped 47), every interval pattern verified against a
  reference — sources cited in `scales-sources.md`
- [x] `mode-engine.js` exports `getScale`, `pitchSetForScale`,
  `degreeToPitch`, `listScalesByTag`, `listScalesByFamily`
- [x] Manual test: logged the pitch set of every scale rooted on C and
  degree-to-pitch resolution for a sample of modes/keys; eyeballed against
  references — all correct. Automated sweep over all 12 tonics and degrees
  −9…+9 confirmed 0 failures (every emitted pitch parses in synth.js
  `noteToFreq` and yields a finite, positive frequency)
- [x] This journal entry

**Verification anchors that passed:**
- A4 → 440.000 Hz, C4 → 261.626 Hz (matches 12-TET / synth.js)
- `pitchSetForScale("dorian", "D")` === `["D","E","F","G","A","B","C"]`
  (matches buildplan example exactly)
- Octave-marker convention: `+8` → C5 (tonic octave up), `-8` → C3 (tonic
  octave down), `-3` → A3 (third below C4), `+9` → D5 (second an octave up)

**Deferred:**
- melakarta (Carnatic), maqam (Arabic — many need quarter tones outside
  12-TET), pelog/slendro (Indonesian), Enigmatic, Persian, Prometheus,
  tritone scale. Out of 12-TET or contested patterns; revisit post-launch
  once the architecture is stable, per buildplan §4.
- The remaining 4 harmonic-major modes — shipped only the 3 with stable,
  uncontested names/intervals (buildplan asked for "at least 3").

**Notes for next session (Session 2 — forms + phrase structures):**
- The theory layer lives in `js/jingle/theory/`. New data files (forms.json,
  phrase-structures.json) and `form-engine.js` go alongside.
- `mode-engine.js` imports scales.json via a JSON import attribute
  (`import scales from './scales.json' with { type: 'json' }`). Works in
  Node 22 and modern browsers, but the project has **no package.json and no
  build step** by design — running these modules under Node for a manual
  test needs a *temporary* `{"type":"module"}` package.json (create, run,
  delete; do not commit it). The browser needs no such thing.
- `degreeToPitch` is the single seam Stage 6 (Session 4) will lean on to
  realize motif degrees into pitches. Signature:
  `degreeToPitch(scaleName, tonic, degree, octave)`.

**Surprises / decisions made:**
- **Pitch spelling is by pitch class, not diatonic letter-stepping.** The
  synth's `noteToFreq` (`^([A-G][#b]?)(-?\d+)$` + a 17-entry NOTE_MAP) only
  understands a single accidental and has no `Cb`/`Fb`/`E#`/`B#` or double
  accidentals — those parse to NaN and play silence. Diatonic spelling
  would emit exactly those in keys like Gb major or F# major, so the engine
  spells every pitch with a guaranteed-safe name and a single sharp-or-flat
  preference chosen from the tonic (circle-of-fifths side). **Consequence:**
  enharmonically "wrong-looking" but sonically identical spellings appear,
  e.g. C lydian prints `C D E Gb G A B` (the #4 as `Gb`, not `F#`). This is
  intentional and harmless for audio; it only affects how a pitch reads in a
  log. If a later session wants pretty notation for display, that's a
  separate speller, not this function's job.
- **Degree numbering uses the interval-number convention** (magnitude =
  interval size, sign = direction; 1 = tonic, 8 = octave). This is the only
  reading that makes all three buildplan examples simultaneously true:
  `+8` = tonic octave up, `-8` = tonic octave down, `-3` = a third below the
  tonic. A pure linear (degree−1) model would have broken `-8`.
- **`romanian_minor` and `dorian_sharp4` share an interval set** (both
  `[2,1,3,1,2,1,2]`). Kept as two entries on purpose — the buildplan lists
  each by name and they carry different family/idiom context (harmonic-minor
  mode vs. Romanian/Ukrainian folk scale).
- **`hirajoshi` has competing definitions** across sources. Shipped the
  Kostka/Payne Western-pedagogy form `[2,1,4,1,4]` and flagged the ambiguity
  in `scales-sources.md`.
- `getScale` returns a `structuredClone` so callers can't mutate the shared
  library; the hot paths (`pitchSetForScale`, `degreeToPitch`) read the raw
  reference internally to stay cheap.

**Claude.ai-side verification (Steven + Claude Opus 4.7):**
- All 47 interval patterns mathematically verified; rotational
  relationships within diatonic / harmonic-minor / melodic-minor /
  harmonic-major / double-harmonic families confirmed correct by
  independent rotation check.
- Mode engine smoke-tested in Node over a representative sweep of
  scales × tonics × degrees (−9 to +15); every output parses in
  synth.js noteToFreq with finite positive frequency. No failures.
- Two design decisions accepted as-is for downstream sessions:
  (1) pitch-class-based spelling (enharmonic but synth-safe; means
  some scales print with odd-looking spellings like C lydian's
  Gb instead of F# — audibly identical, no downstream impact unless
  we later add a note-name display);
  (2) keeping `dorian_sharp4` and `romanian_minor` as separate names
  for the same interval set, on aesthetic-association grounds.
- Open question deferred to Session 12: verify JSON import-attribute
  syntax (`with { type: 'json' }`) loads correctly in the Claude.ai
  artifact runtime in addition to the deployed browser. Modern
  browsers and Node 22 work; the artifact runtime is the one
  context I can't predict. Fallback if needed: inline the scale
  data into a `.js` module.

**Verdict: Session 1 complete. Cleared to proceed to Session 2.**

### Addendum (2026-05-21) — Pitch identity vs. rendering

**Amendment, not a new session.** Session 1 spelled pitches by pitch class
with a single sharp/flat preference, because the synth's `noteToFreq` can't
parse `Cb`, `Fb`, `E#`, `B#`, or double accidentals. That's still correct for
*playback*, but it threw away the theoretical spelling — and the theory layer
may eventually be ported to score-notation projects (LilyPond / MusicXML /
VexFlow) where a Cb is a Cb, the #4 of lydian is F#, and double accidentals are
meaningful. This amendment separates pitch **identity** from pitch
**rendering** so both are served from one canonical representation.

**What changed.**
- **New `js/jingle/theory/pitch.js`** — the `Pitch` type
  `{ letter, accidental, octave }` and its theoretical operations: `toMidi`,
  `pitchClassOf`, `pitchFromLetterAndAccidental`, `toScoreString`,
  `parseScoreString`, `pitchEquals`. Zero dependencies; portable as-is.
- **`mode-engine.js` rewritten** — `pitchSetForScale` and `degreeToPitch` now
  return **Pitch objects** (previously pitch-class strings). Spelling is
  derived from each scale's new `spelling` array (`letter_step` + `accidental`
  per degree) combined with the tonic, so output is theoretically correct
  including legitimate double accidentals (e.g. A# harmonic minor's leading
  tone is `Gx`). Imports only `pitch.js` + `scales.json`.
- **New `js/jingle/theory/synth-rendering.js`** — `toSynthString(pitch,
  preference)`, the *only* file aware of the synth's single-accidental
  constraint. Uses the MIDI number as source of truth: `Cb4` (MIDI 59) →
  `"B3"`, `E#3` (MIDI 53) → `"F3"`. No import from `synth.js` — the contract
  ("emit strings `noteToFreq` accepts") is enforced by the test, not a code
  dependency, keeping theory/ portable.
- **`scales.json`** — every one of the 47 scales gained a `spelling` array,
  one entry per degree, in `intervals` order.
- All three theory/ files have **zero imports outside theory/** (portability
  requirement). No existing files (synth.js, render.js, api.js, composition.js,
  index.html) were touched.

**File-reorg rationale.** The split is along the portability seam: identity +
score rendering live in `pitch.js`/`mode-engine.js` (no synth knowledge);
synth rendering is quarantined in `synth-rendering.js`. A score-notation
project can take the first two and ignore the third.

**Symmetric-scale compromise.** Whole-tone, both octatonics, and augmented
divide the octave evenly and have no canonical letter spelling. Shipped a
"least double accidentals" compromise (every letter used ≤ twice, no double
accidentals) and documented it in `scales-sources.md`:
`whole_tone` → C D E F# G# A#; `wh_diminished` → C D Eb F F# G# A B;
`hw_diminished` → C Db Eb E F# G A Bb; `augmented` → C Eb E G Ab B
(`1 b3 3 5 b6 7`, which avoids the double sharps the buildplan's first-pass
suggestion produced). Score export of music in these scales may want composer
review — acknowledged limit, not a bug.

**Verification (`js/jingle/theory/verify-spelling.mjs`, committed).** For all
47 scales: (1) each spelled degree's pitch class agrees with the
cumulative-sum of intervals; (2) across 14 representative tonics, every
`toScoreString` round-trips through `parseScoreString` to the same Pitch;
(3) every degree's `toSynthString` (both preferences) parses through the real
`synth.js` `noteToFreq` to a finite positive frequency and preserves pitch
class; (4) spot-checks pass — **Gb major = Gb Ab Bb Cb Db Eb F** (not …B…),
**F# major = F# G# A# B C# D# E#**, **D dorian = D E F G A B C**, **A harmonic
minor = A B C D E F G#**, **hungarian minor on C = C D Eb F# G Ab B**. Result:
`PASSED`, exit 0. Run it with a throwaway module-scope `package.json` (the repo
has none by design): `printf '{"type":"module"}' > js/jingle/package.json &&
node js/jingle/theory/verify-spelling.mjs; rm js/jingle/package.json` — do not
commit that package.json.

**Buildplan updated.** §3 now states Pitch objects are the inter-stage currency
and that the `[pitch, duration]` strings in the schemas are the synth-facing
`toSynthString` rendering applied at the Stage 6 → synth boundary; the schemas
themselves are unchanged.

**Note for Session 4 (Stage 6).** `degreeToPitch` / `pitchSetForScale` now hand
back Pitch objects. Stage 6 should keep them as Pitch through realization and
call `toSynthString(pitch, preference)` only when emitting the final
`[pitch, duration]` events for the synth. Pick `preference` from the tonic
(sharp side vs. flat side of the circle of fifths) as before.

**Claude.ai-side verification (Steven + Claude Opus 4.7):**
- Verify-spelling.mjs re-run independently in the conversation
  workspace — PASSED, exit 0. 47 scales × 14 tonics × 2 preferences
  fully exercised, plus the 5 spot-checks. Zero pitch-class
  mismatches across the whole library.
- Hardest spellings hand-verified outside the test harness:
  C lydian #4 = F# (was Gb pre-amendment, now correct);
  F# major 7th = E#; Gb major 4th = Cb (collapses to B with
  octave wrap at synth boundary);
  Gb dorian's b3 = Bbb and b7 = Fb (real double-flat case);
  D# phrygian dominant 3rd = F## (real double-sharp case).
- Pathological tonic check: pitchSetForScale("altered_dim", "Cb")
  would require a triple accidental on the b7 degree. Throws cleanly
  with the documented out-of-scope error and helpful context
  (letter + octave named in the message). Correct fail-loud behavior.
- Symmetric-scale spellings reviewed and accepted as documented:
  whole_tone / wh_diminished / hw_diminished / augmented all use
  letter repetition rather than double accidentals; pitch classes
  correct.
- Portability invariant confirmed by import inspection: pitch.js
  has zero imports, mode-engine.js imports only pitch.js +
  scales.json, synth-rendering.js imports only pitch.js. The
  synth contract is enforced by the verification test rather than
  a code dependency.

**Verdict: Session 1 amendment complete. Foundation is now suitable
for cross-project portability into score-notation contexts as well
as the chiptune synth path. Cleared to proceed to Session 2.**

## Session 2 — 2026-05-21 — form library + phrase-structure library

**What landed (commits):**
- feat(jingle): add form + phrase-structure libraries and form engine
  - `js/jingle/theory/forms.json` — 12 forms with full relationship metadata
  - `js/jingle/theory/phrase-structures.json` — 4 phrase structures
  - `js/jingle/theory/form-engine.js` — getForm, distributeBars,
    getSectionRelationships, getPhraseStructure, listFormsByTag
  - `js/jingle/theory/verify-forms.mjs` — committed exit-criterion check
  - `docs/buildplan-journal.md` — this entry

**Coverage (12 forms):**
through_composed, binary, rounded_binary, ternary, ternary_varied, AABA,
ABAB, ABAC, ABCA, rondo (ABACA), arch (ABCBA), eki_mini (ABA' under 12 bars).
All seven relationship roles are exercised across the library — exposition,
repetition, contrast, reprise, development, episode, refrain.

Phrase structures (4): period (4+4, half→PAC), sentence (2+2+4,
presentation/repetition/continuation→PAC), phrase_group (4+4 independent,
IAC then PAC), hybrid (2+2+4, basic idea + contrasting idea + continuation).

**Exit criteria status:**
- [x] 10 forms in forms.json with full relationship metadata — shipped 12
  (the prompt's own list names 12), every `of` / `contrast_from` reference
  validated against real sibling labels
- [x] 4 phrase structures in phrase-structures.json
- [x] `form-engine.js` exports `getForm`, `distributeBars`,
  `getSectionRelationships`, `getPhraseStructure`, `listFormsByTag`
- [x] Manual test: distributed 16 bars across AABA with the default and both
  alt proportions, logged the result, verified labels + relationships match
  the spec. `verify-forms.mjs` runs the full sweep (12 forms × 8 totals ×
  all variants for distributeBars, plus library-consistency and defensive-copy
  checks). Result: `PASSED`, exit 0.

**16-bar AABA distribution (the exit-criterion demo):**
- default `[0.25, 0.25, 0.25, 0.25]` → A1=4 A2=4 B=4 A3=4
- alt[0] `[0.2, 0.2, 0.35, 0.25]` → A1=2 A2=4 B=6 A3=4
- alt[1] `[0.25, 0.25, 0.3, 0.2]` → A1=4 A2=4 B=4 A3=4

**Deferred:**
- distributeBars does not force repeated sections (the A's of an AABA) to
  receive identical counts when the total can't be split evenly — see the
  decision below. Revisit only if a downstream stage needs strict symmetry;
  it can override the plan in the meantime.
- Bar distribution is meter-agnostic (a bar is a bar). Correct at this layer;
  compound-meter beat handling is a Stage-6 concern (buildplan §7 item 3).

**Notes for next session (Session 3 — motif + transformations):**
- `form-engine.js` sits alongside `mode-engine.js` in `theory/`, same
  import-attribute (`with { type: 'json' }`) + `structuredClone`-on-read
  conventions. Zero imports outside `theory/`; portability invariant holds.
- The transform names in `phrase-structures.json`'s
  `default_motif_assignments` (`literal`, `sequence_up_step`,
  `fragment_head`) deliberately anticipate Session 3's transformation
  library. `cadential_gesture` there is a placeholder *slot* for the closing
  gesture (matching the PhrasePlan example in buildplan §3), NOT yet a
  transform — Session 3/5 decides how the cadential gesture is produced.
- `verify-forms.mjs` is committed; run it with the same throwaway
  package.json dance as `verify-spelling.mjs`:
  `printf '{"type":"module"}' > js/jingle/package.json && node
  js/jingle/theory/verify-forms.mjs; rm js/jingle/package.json` — do not
  commit that package.json.

**Surprises / decisions made:**
- **distributeBars even-preference is soft, not strict symmetry.** It rounds
  each section to the nearest even bar count, then reconciles to the exact
  total in pairs (falling back to single-bar moves for odd totals or when no
  section can absorb a pair). The hard guarantees are: sum equals totalBars,
  and every section ≥ 1 bar. It does NOT guarantee repeated sections get
  equal counts under awkward totals — the AABA alt[0] case above lands
  A1=2, A2=4 because `[0.2,0.2,0.35,0.25]×16 = [3.2,3.2,5.6,4]` has no
  all-even split summing to 16 that also keeps the two A's equal, so one A
  is docked. Default proportions and totals that divide cleanly (16, 24, 32)
  give clean symmetric splits. A useful property of the reconciliation step:
  it forces the sum to totalBars regardless of float drift in the
  proportions, so the "sums to 1.0" contract on the data is a courtesy, not
  a load-bearing precondition.
- **`eki_mini` modeled as ABA', not AB.** The buildplan describes it as
  "short AB or ABA' under 12 bars"; chose the three-section ABA' form so the
  mini jingle gets a (varied, `variation: minor`) recap. `typical_total_bars`
  is [4, 12]; at 4 bars distributeBars yields [2, 1, 1].
- **cadence_type vocabulary extends buildplan §3 with `"none"`.** The §3
  cadence list (PAC/IAC/half/deceptive/plagal/modal_iv_i/phrygian_ii_i) names
  only real cadences. Non-cadencing sub-phrases (a sentence's presentation
  and repetition, a hybrid's basic idea) need a "no cadence here" marker, so
  `"none"` was added for those. verify-forms.mjs validates against the
  extended set.
- **`default_motif_assignments` use generic motif slots `"a"`/`"b"` and the
  PhrasePlan assignment shape** (`sub_phrase`, `motif`, `transform`,
  `start_bar`, `length_bars`). They are *suggestions* the phrase-placement
  stage can take or ignore, not bindings — kept deliberately small so they
  read as defaults, not a fixed score.

**Claude.ai-side verification (Steven + Claude Opus 4.7):**
- verify-forms.mjs re-run independently — PASSED, exit 0. All 12 forms
  internally consistent, all 4 phrase structures consistent, distributeBars
  sums correctly across 8 totals × all variants.
- Session 1's verify-spelling.mjs still passes (no regression).
- Forms reviewed: relationship encodings match each form's traditional
  identity (AABA's A2 as repetition of A1, arch's symmetric B1/B2 and A1/A2
  reprises, rondo's refrain/episode distinction, eki_mini's front-loaded
  proportions matching the genre convention).
- Phrase structures reviewed: period / sentence / phrase_group / hybrid
  match canonical Caplin schema; phrase_group is the only structure using
  two distinct motifs (a + b), which correctly distinguishes its
  "independent phrases" character from the motif-a-developmental
  structures.

**Issue flagged: distributeBars asymmetric for repeated sections.** The
even-preference rounding produces unequal bar counts for sections the user
gave equal proportions to. AABA at 20 bars yields [4,4,6,6] instead of
[5,5,5,5]; at 12 bars yields [2,2,4,4]; rondo at 16 yields [2,2,4,4,4];
arch loses palindromic symmetry at most non-multiple-of-2×section_count
totals. This breaks form identity (A3 longer than A1 in AABA) and would
mislead Session 5a/9's reading of the bar plan. The current docstring
acknowledges the limitation but understates frequency — it's the default
outcome at most odd-quotient totals, not an edge case.

Amendment applied (see addendum below): the even-preference reconcile is
replaced with Hamilton's largest-remainder method, and equal-proportion +
of:-relationship symmetry are now enforced by the verifier. PASSED.

**Verdict: Session 2 amendment-complete. Cleared to proceed to Session 3.**

### Addendum (2026-05-21) — Hamilton's largest-remainder bar distribution

**Amendment, not a new session.** The Session-2 review flagged that
`distributeBars`'s even-preference rounding produced asymmetric bar counts for
sections the user gave equal proportions to. This addendum replaces the
algorithm; `forms.json` and `phrase-structures.json` are untouched (the data
was fine — the algorithm was the issue).

**The bug.** The old strategy rounded each section's ideal share to the
nearest *even* integer, then reconciled to the exact total by moving bars in
pairs. At most non-trivial totals this forced repeated sections to unequal
lengths even when their proportions were identical:

- AABA 20 (equal proportions) → `[4,4,6,6]` (should be `[5,5,5,5]`)
- AABA 12 → `[2,2,4,4]` (should be `[3,3,3,3]`)
- rondo 16 → `[2,2,4,4,4]` (should be near-uniform)
- arch 16 → `[2,2,4,4,4]` (broke palindromic symmetry)

An AABA whose A3 is 50% longer than A1 isn't recognizably AABA, and the bad
bar plan would have misled Session 5a/9 when they read it.

**The fix.** `distributeBars` now uses Hamilton's largest-remainder method:
floor each section's ideal share (proportion × totalBars) for a baseline,
compute the deficit (totalBars − Σfloors), then hand the deficit out one bar
at a time to the sections with the largest fractional remainder — ties broken
by ideal share (descending), then by section order. A safety net promotes any
section that floored to zero up to one bar (taking from the largest section,
sum preserved); given the existing `totalBars >= section_count` guard it does
not trigger for the shipped forms, but it keeps the ≥1-bar contract honest.
The even-preference guess and the pair-by-pair reconcile loop are gone.

Bar counts are no longer biased toward even values — they fall out of the
proportions and the total. A caller wanting only-even output should request a
`totalBars` that is a clean multiple of the form's structure. The module
header and the `distributeBars` docstring were updated to say so.

**New distribution values (vs. the original Session-2 entry's table):**
- AABA 16 default `[0.25×4]` → `[4,4,4,4]` (unchanged — divides cleanly)
- AABA 16 alt[0] `[0.2,0.2,0.35,0.25]` → `[3,3,6,4]` (was `[2,4,6,4]`)
- AABA 16 alt[1] `[0.25,0.25,0.3,0.2]` → `[4,4,5,3]` (was `[4,4,4,4]`)
- AABA 20 default → `[5,5,5,5]` (was `[4,4,6,6]` — the headline fix)
- AABA 20 alt[0] → `[4,4,7,5]`; alt[1] → `[5,5,6,4]`

**New verifier assertions (`verify-forms.mjs` §3b):**
- **A. Equal-proportion symmetry.** For every total ≥ section_count, when a
  form's `proportions_default` is all-equal, the default split is near-uniform
  (max − min ≤ 1). Catches the AABA-20 case directly.
- **B. of:-relationship symmetry.** Sections bucketed by `(of: target,
  proportion)` — i.e. equal-proportion siblings of the same target — must stay
  within one bar of each other across every form, variant and total. Catches
  asymmetric AABA/rondo reprises. Sections deliberately given *different*
  proportions (an AABA alt variant's longer reprise) are exempt by
  construction, which is why the unchanged data still passes.
- **C. `contrast_from` symmetry is NOT required** and is deliberately not
  checked — contrasting sections carry no equal-length obligation.
- **D.** The existing checks (sum equals total, no zero/negative counts,
  out-of-range variant and too-small total throw) are preserved.
- **E.** The exit-criterion demo now prints AABA over **16 and 20** bars, so
  the run visibly shows the formerly-failing `[4,4,6,6]` is now `[5,5,5,5]`.

**Result.** `verify-forms.mjs` PASSED, exit 0 (12 forms × 8 totals × all
variants, plus the new symmetry sweep). Session-1 `verify-spelling.mjs` still
PASSED, exit 0 (no regression). Theory layer still imports nothing outside
`theory/` — `form-engine.js` reads only `forms.json` + `phrase-structures.json`.

**Note for next session.** The original entry's "Deferred" bullet about
`distributeBars` not forcing repeated-section symmetry, and its
even-preference "Surprises / decisions made" bullet, are now superseded by
this addendum; they stand as the historical record of what Session 2 first
shipped.

**Verdict: Session 2 amendment complete. Bar plans are now symmetric where the
proportions are. Cleared to proceed to Session 3.**

**Claude.ai-side verification of the amendment (Steven + Claude Opus 4.7):**
- Independent symmetry sweep ran 534 cases (12 forms × all variants × 15
  totals from 4 to 48 bars): zero of:-relationship violations, zero
  equal-proportion symmetry violations.
- AABA equal-proportion default verified across every multiple of 4
  from 8 to 48: all produce clean uniform allocations [n, n, n, n].
  The headline case AABA 20 is now [5, 5, 5, 5] (was [4, 4, 6, 6]).
- Hamilton's method implementation is textbook-correct. Tiebreak order
  (remainder desc → share desc → index asc) is sensible.
- Session 1's verify-spelling.mjs re-run: still PASSED. No regression.
- Forms.json and phrase-structures.json untouched, per amendment scope.
- Minor non-blocking note: when proportions are exactly equal at a total
  not divisible by section count, the deficit goes to low-index sections
  (off-by-1 in the lowest-index direction). Arch's alt[0] equal-proportion
  variant at non-multiples-of-5 gives A1 one more bar than A2, slightly
  breaking the palindrome. Within the ±1 tolerance, so not a test
  violation; arch's default proportions are naturally palindromic so
  this only matters if a future caller uses arch's equal-proportion
  alt at a non-multiple-of-5 total. Filed as a potential future polish.

**Verdict: Session 2 amendment complete and rigorously verified.
Cleared to proceed to Session 3.**

## Session 3 — 2026-05-21 — motif representation + transformation library

**What landed (commits):**
- feat(jingle): add motif model + transformation library
  - `js/jingle/theory/motif.js` — motif representation, validation,
    degree-event renderer, contour classifier, degree<->linear bridge
  - `js/jingle/theory/transformations.js` — the 14-function development
    algebra (pure, degree-space)
  - `js/jingle/debug/motif-playground.html` — standalone visual verifier
    (no audio; Session 4 adds pitch realization)
  - `js/jingle/theory/verify-motif.mjs` — committed exit-criterion check
  - `docs/buildplan-journal.md` — this entry

**Exit criteria status:**
- [x] `motif.js` exports `renderMotifToDegreeEvents(motif, startBeat)` →
  `[{degree, octave_offset, beat, duration}, ...]` (degree normalized to
  1–7, octave_offset carrying all displacement), plus `validateMotif`,
  `motifTotalBeats`, `motifContour`. (Also exports the `degreeToLinear` /
  `linearToDegree` / `contourOfDegrees` helpers that transformations.js
  reuses — single source of truth for the interval-number math.)
- [x] `transformations.js` exports all 14 transforms as pure
  `(motif, params) → motif`: `literal`, `transpose_step`, `transpose_third`,
  `sequence_up_step`, `sequence_down_step`, `invert`, `retrograde`,
  `augment_2x`, `diminute_2x`, `fragment_head`, `fragment_tail`,
  `ornament_upper_neighbor`, `ornament_lower_neighbor`,
  `ornament_chromatic_passing` (flags the anomaly).
- [x] `motif-playground.html` — pick a motif from a 4-motif library, pick a
  transform with params, see original vs. transformed on a degree grid
  (horizontal = beat, vertical = degree 1–7, octave displacement shown as
  ▲n/▼n badges, anomaly notes dashed-red). No audio.
- [x] `verify-motif.mjs` PASSED, exit 0 (decomposition, contour, total beats,
  degree<->linear round-trip, validateMotif accept/reject classes, and per-
  transform purity + structure-invariant + value checks). Session 1's
  verify-spelling.mjs and Session 2's verify-forms.mjs still PASSED — no
  regression.
- [x] This journal entry.

**Coverage / verification anchors that passed:**
- Octave decomposition (`renderMotifToDegreeEvents`): `+8` → {degree 1,
  oct +1}, `-8` → {degree 1, oct −1}, `-3` → {degree 6, oct −1}, `+9` →
  {degree 2, oct +1}. Matches the Session-1 mode-engine octave convention.
- Transpose octave bookkeeping: degree 7 + 1 step = degree 8 (not a wrapped
  degree 1); degree 1 − 1 step = degree −2 (the second below the tonic).
- Inversion involution: invert∘invert around a fixed pivot is the identity.
- Retrograde / fragment / ornaments correctly remap (or drop) a declared
  anomaly's `at_position`.

**Deferred:**
- **Chromatic pitch realization.** `ornament_chromatic_passing` inserts a
  note carrying the departure degree as a placeholder and flags the anomaly
  `{type:"chromatic_neighbor", at_position}`; the actual chromatic pitch (and
  its up/down direction, inferable from the flanking notes) is realized by
  Stage 6 (Session 4+). Degree space has no integer for a chromatic note, so
  this is the right seam.
- **Anomaly budget enforcement** (buildplan §7.1) is untouched here — these
  functions don't count anomalies. `ornament_chromatic_passing` sets the
  single anomaly slot, replacing any prior anomaly; chaining two ornaments
  that each declare an anomaly is a budget question for the LLM stages, not
  the transform.
- **Compound-meter beat semantics** (buildplan §7.3) — rhythm values are
  unitless beats here; what a "beat" means in 6/8 is a Stage-6 concern.

**Notes for next session (Session 4 — Stage 6 voice realization):**
- The Stage-6 seam is: `renderMotifToDegreeEvents(motif, startBeat)` →
  for each event call `degreeToPitch(scaleName, tonic, event.degree,
  baseOctave + event.octave_offset)`. The renderer deliberately normalizes
  every motif degree to an in-octave 1–7 plus an `octave_offset`, so Stage 6
  passes a clean 1–7 degree and folds the displacement into the octave
  argument — `+8` always lands an octave up regardless of the realizing
  scale's note count.
- Apply the transform (PhrasePlan names it) *before* rendering to events.
  Transforms are pure and recompute contour, so the realized motif's contour
  field is trustworthy.
- `ornament_chromatic_passing` hands Stage 6 a placeholder degree + an
  anomaly. Stage 6 must read the anomaly to bend that note chromatically;
  rendering the placeholder degree verbatim would just repeat the departure
  note.
- Same theory-layer conventions as Sessions 1–2: zero imports outside
  `theory/` (motif.js imports nothing; transformations.js imports only
  motif.js), `structuredClone` on anything handed back that a caller might
  mutate, `verify-motif.mjs` run with the throwaway `package.json` dance.
- The playground must be **served over HTTP** (ES module imports); it is not
  a `file://` page. `python3 -m http.server 8000`, then open
  `/js/jingle/debug/motif-playground.html`.

**Surprises / decisions made:**
- **Inversion is computed in linear pitch-height space, not on raw degree
  values.** The buildplan gives the formula `degree' = 2*pivot - degree`, but
  applied to interval-number degree values that formula misbehaves around the
  tonic (it produces the redundant degree −1, and mirrors are wrong by a
  step). Reflecting the *linear height* (`degreeToLinear`) and converting back
  is the true melodic mirror — e.g. invert([1,3,5,4]) around the default
  pivot (the first degree) = [1,−3,−5,−4], a clean downward mirror. This is
  the "reflects each degree around pivot" intent; the literal arithmetic was
  the loose part.
- **Transformations recompute the output's `contour`; `literal` does not.**
  After invert/retrograde/fragment the stored label would otherwise be stale,
  so every transform that changes the degrees re-derives the contour from the
  result. `literal` is the exact identity and returns the motif verbatim
  (including a hand-authored contour). The four library motifs in the
  playground are stored with their derived contours, so `literal` reads as a
  true no-op there.
- **`motifContour` reads degrees literally — writing `1` vs `8` changes the
  contour.** Degree 1 is the *low* tonic (height 0); the octave is degree 8
  (height 7). The buildplan's §3 example motif `b` `[5,6,7,1,7,5]` is labeled
  `peak_descend`, but read literally that drop to the low tonic makes it
  `wandering`; written as `[5,6,7,8,7,5]` (the octave) it classifies as
  `peak_descend` as intended. So authors should use `8` for "up to the
  octave." The classifier itself is principled: count monotonic runs (≥3 →
  wandering, 1 → rising/falling arc) and, for a single interior turning point,
  let the end-vs-start relationship decide rising_arc vs peak_descend (and
  falling_arc vs valley_ascend) — which is why `[1,3,5,4]` is `rising_arc`
  (rose then dipped, still ends high) while `[1,3,5,3,1]` is `peak_descend`.
- **`contour` and `register` are closed vocabularies, validated.** `CONTOURS`
  (the six labels) and `REGISTERS` (`low`/`mid`/`high`) are exported and
  `validateMotif` rejects anything outside them, per the project's
  "make bad states unrepresentable at the boundary" stance.
- **Degrees are validated as non-zero integers with no magnitude cap.** The
  conventional range is roughly −8..+9, but transforms can legitimately push
  past an octave (sequencing a high motif up), so capping magnitude would
  reject valid output. `0` is rejected (no degree 0); `−1` is accepted but is
  a redundant spelling of the tonic and `linearToDegree` never emits it.
- **Ornaments insert one note and split the ornamented note's rhythm in
  half** (original note then neighbor, each half the duration), matching the
  buildplan's "splitting that note's rhythm in half." Neighbor default
  position is the last note; chromatic-passing default is the second-to-last
  (it needs a following note to pass into, and throws if asked to pass after
  the final note). The chromatic anomaly's `at_position` points at the
  *inserted* note in the returned motif (most useful for Stage 6), which I
  chose over a literal echo of the param and have documented in the function.
- **Added `verify-motif.mjs` (not in the literal Session-3 file list).**
  Sessions 1–2 established the committed-verifier convention and the
  Claude.ai-side review re-runs them; the transform algebra (octave
  bookkeeping, inversion, anomaly remapping) is exactly the kind of tricky
  cross-session contract worth a regression check.

**Claude.ai-side verification (Steven + Claude Opus 4.7):**
- verify-motif.mjs re-run independently — PASSED, exit 0.
  Session 1 (verify-spelling) and Session 2 (verify-forms) re-run —
  both still PASSED, no regression.
- Inversion correctness independently verified across multiple pivots,
  including the pathological all-tonic case. Linear-space pivot
  reflection correctly mirrors intervals (negated linear deltas) and
  flips contour categories appropriately (peak↔valley).
- Octave bookkeeping confirmed across iterated transposition: the
  motif [1,2] stepped up by +2 four times produces [3,4]→[5,6]→
  [7,8]→[9,10], with no wrap at the octave boundary and no gap at
  the tonic.
- Chromatic anomaly correctly survives transposition (position
  unchanged) and retrograde (position mirrored via n-1-pos).
- Purity confirmed: applying multiple transformations in sequence
  leaves the input motif untouched.
- Two design choices noted for downstream awareness, neither blocking:
  (a) `register` is carried through transformations unchanged, so a
  transposed motif may be labeled "mid" while sitting in high
  territory — register is an intent hint, not a derived fact;
  (b) `ornament_chromatic_passing` replaces any prior anomaly while
  the neighbor ornaments preserve it. Chaining chromatic_passing
  after another anomaly drops the prior anomaly. Documented; the
  LLM stages will need to know.

**Verdict: Session 3 complete. Cleared to proceed to Session 4 —
the first audible-output session.**

## Session 4 — 2026-05-21 — voice realization. End-to-end audio working.

**What landed (commits):**
- feat(jingle): add bass patterns + roman-numeral stub
  - `js/jingle/theory/bass-patterns.js` — the five Pitch-bearing patterns
    (root_fifth, walking, pedal, arpeggio, cadential_5_1) + a BASS_PATTERNS
    registry
  - `js/jingle/theory/roman-numeral-stub.js` — diatonic-triad resolveRoman
    (placeholder; Session 5 swaps in the full roman-numeral.js)
- feat(jingle): add Stage 6 voice realization + pipeline runner + inspector
  - `js/jingle/pipeline/stage-6-voice.js` — realizeVoices (lead/harmony/bass)
  - `js/jingle/pipeline/pipeline-config.js` — DEFAULT_CONFIG + presets
  - `js/jingle/pipeline/stage-7-leading.js`, `stage-8-cadence.js` — identity
    stubs (Session 7 / Session 5)
  - `js/jingle/pipeline/pipeline-runner.js` — threads 6 → 7-stub → 8-stub →
    toSynthString → FinalJingle
  - `js/jingle/debug/pipeline-inspector.html` + `pipeline-inspector-cases.js`
    — the "we hear chiptune" harness, 3 hand-written cases
  - `js/jingle/theory/verify-stage6.mjs` — committed regression check
  - `docs/buildplan-journal.md` — this entry

**Exit criteria status:**
- [x] `bass-patterns.js` exports the 5 patterns; each returns Pitch-bearing
  events for ≥ 4/4 (root_fifth also adapts to 3/4 and 6/8; walking falls back
  to root_fifth outside 4/4 this session, per spec).
- [x] `roman-numeral-stub.js` exports `resolveRoman` for diatonic triads
  (root/quality/members as Pitch objects).
- [x] `stage-6-voice.js` `realizeVoices` walks phrasePlan + texturePlan and
  produces VoiceTracks with Pitch objects throughout, including chromatic
  anomaly realization (verified out-of-scale).
- [x] `pipeline-runner.js` threads 6 → 7-stub → 8-stub → toSynthString →
  FinalJingle (the existing synth's `[pitch, duration]` JSON shape).
- [x] `pipeline-inspector.html` plays the 3 cases through LiveSynth — Steven
  listened to all three and confirmed they sound composed (verdict below).
- [x] All prior verify scripts still PASS, plus `verify-stage6.mjs` (exit 0).
- [x] This journal entry.

**Verification anchors that passed (`verify-stage6.mjs`, committed):**
- resolveRoman: C-major I at octave 3 = C3/E3/G3 (major); V = G4/B4/D5; ii =
  minor; "II" in E phrygian-dominant = F-major triad (the bII colour, spelled
  by the mode); diminished diatonic triads resolve with quality derived from
  the pitches; a leading accidental (`bII`) throws.
- bass-patterns: root_fifth 4/4 on C-major I = C3 G3 C3 G3; 3/4 = three
  quarter events; 6/8 sums to 6 beat-units. walking/pedal/arpeggio/cadential
  all return positive-duration Pitch events; arpeggio 4/4 = 8 eighths.
- realizeVoices: a chromatic_neighbor anomaly between ^1 and ^2 in C major
  realizes as a genuinely out-of-scale pitch (C→C#→D).
- End-to-end over all 3 cases: every lead/harmony/bass event has a positive
  duration and (when not a rest) a synth string parsing through the **real**
  `synth.js` noteToFreq to a finite positive frequency; all three voices are
  beat-length-aligned (64/64/64 beats for the 16-bar major case). Sessions
  1–3's verify-spelling / verify-forms / verify-motif still PASS — no
  regression.

**The three listening cases (all 4/4):**
- *Sunrise Fanfare* — C major, AABA, 16 bars. Exercises all five bass patterns
  and parallel_thirds_below. Lead opens C5 E5 G5 E5 D5 C5 then sequences up a
  step (D5 F5 A5…) and a third (E5 G5 B5…) — audible motivic development.
- *Wanderer's Path* — D dorian, ABA, 12 bars. Pedal-drone B section.
- *Desert Caravan* — E phrygian-dominant, ABA, 12 bars. Carries the chromatic
  passing tone (ornament_chromatic_passing) in the A′ recap, and declares
  `phrygian_ii_i` cadences for Session 5 to realize.

**Deferred:**
- **Cadence realization.** Sections currently end on whatever the last motif
  fragment + bass pattern produced; `cadential_5_1` is only a bass placeholder
  and the `cadential_gesture` lead slot is skipped (trailing rest). Real
  cadence enforcement is Session 5 (Stage 8). The phrygian case is pre-wired
  with `phrygian_ii_i` to audition then.
- **Texture vocabulary.** Only `parallel_thirds_below` is built; every other
  texture name throws a loud "not implemented in Session 4" error by design.
  Full vocabulary is Session 6.
- **Roman-numeral chromatics.** The stub rejects leading accidentals (bII,
  #IV); Session 5's resolver handles them. Mode-relative diatonic numerals
  cover everything the Session-4 cases need (the mode supplies the spelling).
- **Non-uniform harmonic_rhythm.** One chord per bar is assumed; the
  `harmonic_rhythm` field is carried but not yet consumed.
- **Per-section modulation.** Mode/tonic are piece-global from macroParams
  this session.
- **Voice-leading.** No range/crossing repair yet (Session 7). Harmony sits a
  diatonic third under the lead, clamped to C4–B5; it can sit close to the
  lead but the pieces stay legible.
- **walking look-ahead** stops at the bass-assignment boundary (uses the next
  bar *within* the same assignment as its target); good enough for a placeholder.
- **3/4 and 6/8** are implemented in bass-patterns and exercised by the
  verifier, but not used in the listening cases (compound-meter tempo-unit
  semantics, buildplan §7.3, are untested by ear).

**Notes for next session (Session 5 — Roman resolver + cadence):**
- `roman-numeral-stub.js` and `roman-numeral.js` (Session 5) share the
  signature `resolveRoman(romanString, mode, tonic, octave = 4)`. Stage 6 and
  the bass patterns import `resolveRoman` by name, so the swap is
  `s/roman-numeral-stub/roman-numeral/` at the two import sites
  (stage-6-voice.js, and verify-stage6.mjs's spot-checks).
- `stage-8-cadence.js` is an identity stub exporting `enforceCadences(
  voiceTracks, harmonicPlan, macroParams)`. The runner already calls it in
  position; Session 5 fills the body. VoiceTracks events are
  `{ pitch: Pitch|null, duration }` (null = rest) in playback order — cadence
  formulas overwrite the final events of each section's slice.
- Section boundaries: `computeSectionPlan(macroParams)` (exported from
  stage-6) is the single source of truth for per-section bar offsets; reuse it
  in Stage 8 to find each section's final beats.

**Surprises / decisions made:**
- **The synth plays events back-to-back, not by absolute beat.** `scheduleJingle`
  accumulates `t += duration` per event; it never reads an absolute position.
  So VoiceTracks must be a contiguous sequence and gaps must be explicit
  **rests**. Stage 6 builds beat-stamped events internally, then flattens
  (sort by beat, insert `{ pitch: null }` rests for gaps, pad to total beats).
  The runner maps `pitch === null` → `"rest"` (which noteToFreq already treats
  as silence). This `null`-for-rest convention is a small extension of the
  buildplan's `{ pitch, duration }` VoiceTracks shape, documented in
  stage-6-voice.js.
- **Bass-pattern signature gained an optional trailing `params`.** The spec's
  `(chord, mode, tonic, meter, barCount)` has nowhere to put pedal's
  `params.degree` or walking's next-chord target, so each pattern takes a 6th
  optional `params` ({ octave, degree, nextChord }). The five documented
  positional args are unchanged.
- **resolveRoman derives quality from the realized pitches, not the numeral's
  case.** This makes it correct in every mode for free — "II" in
  phrygian-dominant comes back major because degree 2 of that mode is a major
  third + minor third, regardless of how the numeral was capitalised. Modal
  spellings (the famous bII) fall out of the mode's own degrees. The stub's
  scope is deliberately diatonic; leading accidentals throw with a pointer to
  Session 5.
- **Stage 6 drives the bass one bar per call** (`barCount = 1`), so each bar
  resolves its own chord and walking gets the *next* bar as `params.nextChord`.
  The patterns still loop `barCount` internally, so they remain correct if a
  later caller asks for several bars at once.
- **`cadential_5_1` ignores the bar's chord** and plays V→i of the section
  tonic (per spec — "regardless of input"). Driven per-bar, every call is "the
  last bar," which is exactly where the TexturePlan assigns it.
- **Chromatic-anomaly spelling** nudges the diatonic note's accidental by ±1
  toward the neighbour; only if that would demand a triple accidental does it
  fall back to a clean MIDI respelling. Audibly identical either way (the
  synth boundary collapses spelling), but it keeps the Pitch theoretically
  sane for a future score export.
- **Test cases carry an explicit `macroParams.sections` `[{label, bars}]`** so
  they are self-contained and don't depend on forms.json label naming; when
  absent, `computeSectionPlan` falls back to the form + `distributeBars`. Bar
  indices in phrasePlan/texturePlan are 1-indexed and section-relative.

**HUMAN CHECKPOINT — CLEARED (2026-05-21).** Steven listened to all three
cases through the inspector. Verdict, verbatim:

> They sound composed, yes. They sound like an amateur composer wrote them —
> structurally, harmonically, and contrapuntally very simple and by-the-books,
> but still intentional, nonetheless.

That clears the bar for Session 4 (audio works and reads as *intentional*
rather than random). The three "amateur / by-the-books" axes he named are each
the explicit remit of a later session, so this is the expected ceiling for the
back-half-only pipeline, not a defect:

- **Harmonically simple / by-the-books** — progressions are hand-written stubs
  (Session 11 hands this to the LLM under the Roman-numeral grammar) and there
  are no real cadences yet (Session 5, Stage 8). Sections currently just stop
  on the last fragment.
- **Contrapuntally simple** — the harmony voice is parallel_thirds_below and
  nothing else (Session 6's texture vocabulary: contrary motion, imitation,
  drones, etc.), and there is no voice-leading pass smoothing or de-crossing
  the voices (Session 7).
- **Structurally simple** — the motifs, transforms, and phrase placements are
  the hand-authored fixtures in pipeline-inspector-cases.js (Sessions 9/10
  generate motifs and phrase plans via the LLM; the development beyond
  literal/sequence/transpose lives there).

No specific *wrong-sounding* defect was reported — the simplicity is the
absence of the not-yet-built stages, not a bug in Stage 6. Carrying this
forward as the baseline to beat once S5–S7 land.

**Verdict: Session 4 complete. End-to-end audio working and confirmed
composed. Cleared to proceed to Session 5 (Roman resolver + cadence
enforcement) when Steven kicks it off.**

**Claude.ai-side verification (Steven + Claude Opus 4.7):**
- All four verify scripts re-run independently — PASSED:
  verify-spelling, verify-forms, verify-motif, verify-stage6 (all exit 0).
- Independent end-to-end pipeline runs across all 3 cases:
  Sunrise Fanfare (64 beats), Wanderer's Path (48 beats), Desert
  Caravan (48 beats). Every voice in every case has 0 bad pitches
  through the real noteToFreq. All three voices in each case
  beat-aligned to identical totals.
- Roman-numeral stub spot-checked independently:
  `II` in E phrygian-dominant → F major triad (the bII colour);
  `V` in D dorian → A-C-E minor (modal v, no leading tone).
  Modal chord qualities fall out for free via the stack-the-mode's-
  own-thirds approach.
- Bass patterns sanity-checked across 4/4, 3/4, 6/8:
  root_fifth, walking (4/4-only with nextChord look-ahead), pedal,
  arpeggio, cadential_5_1 all produce structurally correct events.
- Chromatic_neighbor anomaly realization confirmed via bendHalfStep
  (Desert Caravan's chromatic passing tone is genuinely out-of-scale).
- Two non-blocking observations:
  (a) 6/8 root_fifth produces 4 equal dotted-eighth notes per bar
  rather than the more idiomatic "boom-pa-pa boom-pa-pa" pattern.
  Defensible as a pattern but not the most genre-typical. The
  listening cases are all 4/4 so this didn't surface in Steven's
  ear; flag for audition when a 6/8 piece arrives.
  (b) Arpeggio in 6/8 creates a hemiola against the 3+3 grouping.
  Musically defensible, worth noting when 6/8 pieces enter the
  listening rotation.
- Steven's "amateur but intentional" verdict reads correctly to me:
  the simplicity matches the not-yet-built stages, no Stage 6
  defects detected.

**Verdict: Session 4 complete and verified. End-to-end audio
working at the expected baseline. Cleared to proceed to Session 5.**

## Session 5 — 2026-05-21 — Roman-numeral resolver + cadence formulas + Stage 8

**What landed (commits):**
- feat(jingle): add full Roman-numeral resolver + cadence formulas
  - `js/jingle/theory/roman-numeral.js` — the full resolver (drop-in for the
    Session-4 stub): diatonic modal stacking + chromatic alterations + seventh/
    sixth chords + `isValidInMode` / `listAvailableChords`
  - `js/jingle/theory/cadence-formulas.js` — the 7 cadence functions + registry
- feat(jingle): enforce cadences in Stage 8 + beat-stamp the voice tracks
  - `js/jingle/pipeline/stage-8-cadence.js` — real `enforceCadences` (splice)
  - `js/jingle/pipeline/stage-6-voice.js` — returns beat-stamped events now;
    swaps to the full resolver; exports `toSequence` + `pieceTotalBeats`
  - `js/jingle/pipeline/pipeline-runner.js` — sequences after Stage 8
  - `js/jingle/pipeline/stage-7-leading.js` — doc-only (beat-stamped note)
  - `js/jingle/theory/roman-numeral-stub.js` — marked DEPRECATED (kept for
    verify-stage6's stub-specific assertions)
  - `js/jingle/debug/pipeline-inspector-cases.js` + `pipeline-inspector.html`
    — cadence coverage across all 7 types + a post-cadence VoiceTracks panel
  - `js/jingle/theory/verify-stage8.mjs` — committed Session-5 regression check
  - `docs/buildplan-journal.md` — this entry

**Exit criteria status:**
- [x] `roman-numeral.js` exports `resolveRoman` / `isValidInMode` /
  `listAvailableChords` with the documented behaviour (signature unchanged from
  the stub: `resolveRoman(romanString, mode, tonic, octave = 4)`).
- [x] `cadence-formulas.js` exports all 7 cadence functions (PAC, IAC, half,
  deceptive, plagal, modal_iv_i, phrygian_ii_i) + a `CADENCE_FORMULAS` registry.
- [x] `stage-8-cadence.js` overwrites cadences for all 3 listening cases (and
  the inspector now spreads all 7 cadence types across them).
- [x] Inspector exercises each cadence type; the phrygian_ii_i cadence in Desert
  Caravan lands the half-step descent (verified: bass F3→E3 under lead F5→E5 in
  both A and A'; Sunrise A3 PAC lands lead on C5 with bass G3→C3).
- [x] All prior verify scripts pass (verify-spelling / -forms / -motif / -stage6,
  all exit 0) + new `verify-stage8.mjs` passes.
- [x] This journal entry.

**Verification anchors that passed (`verify-stage8.mjs`, committed):**
- resolver, diatonic (stub-compatible): C major I = C3-E3-G3; V = G4-B4-D5; "II"
  in E phrygian-dominant = F-A-C (the bII colour, modal spelling); "v" there is
  diminished; "VII" in D dorian = C-E-G.
- resolver, chromatic: bII in C = Db-F-Ab (Neapolitan, correctly spelled); bII
  in E phrygian-dominant = F-A-C (== the diatonic II — same F, the cadence's
  half step); bVI in C = Ab-C-Eb; bVII in C = Bb-D-F; #iv defaults minor.
- resolver, extensions: V7 = G-B-D-F (dominant7); Imaj7 (major7); ii7 (minor7);
  viiø7 (halfdim7); vii°7 in A harmonic minor (dim7); I6 (major6).
- listing: `listAvailableChords("dorian")` = [i, ii, III, IV, v, vi°, VII]
  (matches the buildplan example exactly); major = [I, ii, iii, IV, V, vi, vii°].
- validity: V/vii° valid in major; vi° NOT (the ° contradicts the diatonic
  minor); bVI invalid without the flag, valid with `allowModalInterchange`; V
  valid in aeolian with the flag; garbage → false.
- all 7 cadence formulas verified pitch-for-pitch in C major plus the two
  mode-specific cases (phrygian_ii_i in E phrygian-dominant, modal_iv_i in D
  dorian).
- Stage 8 splice: voices stay sorted and non-overlapping after the splice; the
  PAC lands the final lead on the tonic in the section's final bar; the input
  Stage-6 tracks are not mutated; an unknown cadence type throws.
- end-to-end over all 3 cases: every event has positive duration and (when not a
  rest) a synth string parsing through the **real** synth.js noteToFreq to a
  finite positive frequency; all three voices stay beat-aligned. Sessions 1–4
  verifiers still PASS.

**Deferred:**
- **`allow_modal_interchange` plumbing.** `isValidInMode` honours the flag (3rd
  arg, default off), but no stage threads `config.knobs.allow_modal_interchange`
  into it yet — that wiring is the LLM harmonic stage (Session 11). The borrowed-
  chord vocabularies (`BORROWED_MAJORISH` / `BORROWED_MINORISH`) are a starting
  set; later sessions can widen them.
- **`allow_secondary_dominants`.** The resolver can build any chord by explicit
  marker (e.g. forcing a major V in a minor mode via a leading accidental), but
  there is no applied-dominant grammar (`V/V` etc.) — out of scope this session.
- **Voice-leading between the cadence and the bar before it.** Stage 8 overwrites
  cleanly but does not smooth the join into the cadence (a motif may leap into
  the approach note). Smoothing is Stage 7's job (Session 7).
- **Cadence octave register.** The cadence always voices lead at the register
  centre, harmony an octave below, bass at octave 3 — a fixed registral arrival.
  If a section's melody sat far from the centre, the cadence will jump to it.
  Acceptable for a deterministic close; revisit if it sounds abrupt by ear.

**Notes for next session (Session 6 — texture vocabulary + audition):**
- The VoiceTracks contract changed: Stage 6/7/8 now pass **beat-stamped**
  `{ pitch, beat, duration }` events (sorted by beat); the single `toSequence`
  collapse to the synth's contiguous `{ pitch, duration }` shape runs in the
  runner AFTER Stage 8 (buildplan recommended option (b)). Session 6's texture
  functions feed Stage 6's harmony builder, which still works in beat-stamped
  events — no change to that seam, but the textures must emit beat-stamped
  events too (not pre-sequenced).
- `toSequence` and `pieceTotalBeats` are exported from `stage-6-voice.js` for the
  runner; reuse them rather than re-deriving.
- The Roman resolver is the real one now; `resolveRoman(roman, mode, tonic,
  octave)` returns Pitch-bearing `{ root, quality, members }`. Textures that need
  the current chord (chord_tones_pulse, drones) call it directly.
- `roman-numeral-stub.js` is deprecated but still present (verify-stage6 asserts
  its narrow scope). A follow-up cleanup commit should delete it and point
  verify-stage6's stub-specific unit checks at the full resolver — left for when
  someone is touching verify-stage6 anyway, to avoid a churny no-op commit now.

**Surprises / decisions made:**
- **Two realization strategies, split on whether the numeral is altered.**
  Diatonic numerals stack thirds in the ACTIVE MODE (quality derived from the
  pitches — this is exactly the stub's "modal spellings fall out for free", so
  the resolver is a true drop-in). Chromatic numerals (leading b/#) take the
  MAJOR-scale degree of the tonic, shift it a semitone, and build a major-or-
  minor triad in the altered root's own key (thirds stacked in MAJOR relative to
  the new root). The major-relative base is what makes bII land on the same pitch
  regardless of mode: bII in C = Db, bII in E = F — and in E phrygian-dominant
  that F equals the diatonic degree-2, which is precisely why the phrygian
  cadence works whether you spell it `II` or `bII`.
- **Quality is still derived (not dictated by case) for diatonic chords.** Per
  the stub's design, case is informational for plain diatonic numerals; the modal
  triad's quality wins. An explicit `°`/`+` marker that *contradicts* the modal
  quality re-spells the triad (a chromatic alteration); a matching marker keeps
  the modal spelling verbatim. Case sets the default quality only on the
  chromatic path, where there is no mode to derive from.
- **`^7→^1` only ascends across an octave boundary.** Within one octave the scale
  degrees run 1 < 2 < … < 7 < 8(=octave), so degree 7 sits a major seventh ABOVE
  degree 1. The first cut of the deceptive cadence used lead `^7→^1` and produced
  a descending major-seventh leap (B5→C5) instead of the leading-tone resolution.
  Fixed: the deceptive lead steps up `^2→^3` (lands on the submediant's fifth) and
  the ascending leading tone `^7→^8` lives in the harmony voice (B4→C5). The
  authentic cadences resolve DOWNWARD (`^2→^1`), which needs no octave care.
- **Cadences are voiced as chords, not bare melody.** Every approach/resolution
  beat is voiced from chord tones (root in the bass, a third/fifth inside, the
  cadence's required scale degree on top), so each beat spells a recognisable
  triad — PAC's approach is a full G-B-D, its resolution C+E, etc. Lead/harmony/
  bass at octaves 5/4/3 so the three voices never cross.
- **Full-bar vs. last-two-beats overwrite.** PAC/IAC/plagal/modal_iv_i/
  phrygian_ii_i overwrite the whole final bar (approach for the first half, the
  resolution for the second — the buildplan's bass instruction, voiced across all
  three voices so they move together at the bar midpoint). half/deceptive
  overwrite only the final two beats (only the closing gesture matters; the rest
  of the bar keeps the upstream material). Documented in each formula's docstring.
- **Option-(b) refactor adopted.** Stage 6 used to flatten to a back-to-back
  sequence (rests for gaps) before returning; that made Stage 8's "find and
  overwrite the final beats" awkward. Now Stage 6/7/8 pass beat-stamped events and
  the single `toSequence` collapse happens once, in the runner, after Stage 8. ~A
  10-line move; it makes the splice logic (drop events inside the window, truncate
  one straddler, insert + re-sort) genuinely simple. verify-stage6 still passes
  because it reads `.pitch`/`.duration` (still present) and the e2e path goes
  through the runner (still sequenced).
- **Cadence coverage spread across the 3 cases.** To exercise all 7 types in the
  inspector: Sunrise A1=IAC / A2=deceptive / B=half / A3=PAC; Wanderer A=modal_iv_i
  / B=plagal / A'=modal_iv_i; Desert A=phrygian_ii_i / B=half / A'=phrygian_ii_i.
  The human-checkpoint requirements (Sunrise A3 PAC, Desert A/A' phrygian) are
  preserved. Stage 8 overwrites the final bar regardless of each section's written
  progression, so changing the `cadence` field needed no progression changes.
- **No DEC/CHANGELOG entry this session.** Consistent with Sessions 1–4 and the
  buildplan: the new pipeline is built alongside the deployed app and is not
  user-visible until Session 12, which is where the buildplan schedules the DEC
  entry, CHANGELOG line, and architecture.md update. The beat-stamped-VoiceTracks
  refactor is internal to the in-progress pipeline and is recorded here.

**HUMAN CHECKPOINT — CLEARED (2026-05-21).** Steven listened to all three
inspector cases. Verdict, verbatim:

> Sounding good. Still roughly the same in terms of basic-but-not-musically-
> stimulating. It's technically fine, and clearly intentionally composed, but
> it's fairly uninspiring. The cadences do wrap up more cleanly than before
> though, so that's good.

That clears Session 5's specific bar: **the cadences resolve cleanly now**
("wrap up more cleanly than before") — sections no longer stop on the last motif
fragment. The two named listening targets land as designed (Sunrise A3 PAC,
Desert A/A' phrygian half-step descent), confirmed both by ear and in the
regression check.

The "basic / uninspiring" axis is unchanged from the Session-4 "amateur but
intentional" verdict, and is the expected ceiling for the back-half-only
deterministic pipeline — every lever that adds musical interest is a later
session, not a defect here:
- **Contrapuntally flat** — harmony is still only `parallel_thirds_below`
  (Session 6's texture vocabulary: contrary motion, imitation, drones, etc.),
  with no voice-leading pass yet (Session 7).
- **Harmonically/structurally plain** — progressions, motifs, transforms and
  phrase placements are the hand-authored fixtures; the LLM creativity that
  varies them lands in Sessions 9–11.

No wrong-sounding cadence defect was reported. Carrying the "basic but
intentional, now with clean cadences" baseline forward as the bar for Session 6
to lift on the contrapuntal/textural axis.

**Verdict: Session 5 complete and confirmed by ear. All six verifiers pass,
cadences resolve cleanly. Cleared to proceed to Session 6 (texture vocabulary +
audition harness) when Steven kicks it off.**

**Claude.ai-side verification (Steven + Claude Opus 4.7):**
- All five verify scripts re-run independently — PASSED:
  verify-spelling, verify-forms, verify-motif, verify-stage6,
  verify-stage8 (all exit 0).
- Cadence output traced through all 3 cases on the final-bar pitches.
  Every cadence resolves to the documented voicing:
  · Sunrise — IAC (D5→E5 over G3→C3), deceptive (D5→E5 over G3→A3
    with harmony's ^7→^8 carrying leading-tone resolution), half
    (C5→D5 over held V), PAC (D5→C5 over G3→C3)
  · Wanderer's — modal_iv_i (G5→F5 over G3→D3, no raised leading
    tone), plagal (D5 held across IV→i), modal_iv_i recap
  · Desert Caravan — phrygian_ii_i (F5→E5 over F3→E3, the half-
    step descent in both voices simultaneously), half, phrygian
    recap
- Roman-numeral resolver's two-strategy design verified: diatonic
  numerals stack thirds in the active mode (modal qualities fall
  out for free); chromatic numerals shift the major-scale degree
  and rebuild as a triad in the altered root's key. Checked bII
  in C/E across modes, V7 in dorian (modal b7 — A-C-E-G in D
  dorian), iv in dorian (proper modal minor with no leading tone).
- Stage 6 refactor to beat-stamped events confirmed: the toSequence
  collapse now happens once at the runner after Stage 8, exactly
  the cleaner seam the prompt recommended. Stage 7's stub and
  Stage 8 both operate on {pitch, beat, duration}; this materially
  simplifies Session 7's voice-leading pass.
- All three inspector cases exercise all 7 cadence types between
  them (IAC, deceptive, half, PAC, modal_iv_i, plagal,
  phrygian_ii_i). 0 bad pitches through noteToFreq across every
  voice in every case.

**Verdict: Session 5 complete and verified. Cadences land correctly
by both ear (Steven) and pitch (regression). Cleared to proceed to
Session 6 — the texture-vocabulary audition session that's the one
explicit human-listening gate in the build.**

## Session 6 — 2026-05-21 — texture vocabulary + audition harness 🎧

> Implementation entry. This is the texture-audition session: the
> human-checkpoint record (Steven's per-texture listening notes) is added to
> this entry AFTER his audition pass — it is not here yet.

**What landed (commits):**
- docs(jingle): record Session 5 Claude.ai-side verification (the pending S5
  review block, committed on its own so history is honest)
- feat(jingle): add texture vocabulary + Stage 6 registry dispatch
  - `js/jingle/theory/textures.js` — 13 textures + `TEXTURE_REGISTRY`
  - `js/jingle/pipeline/stage-6-voice.js` — `buildHarmony` dispatches via the
    registry; the Session-4 inline `parallel_thirds_below` placeholder and its
    "not implemented in Session 4" throw are removed
  - `js/jingle/theory/verify-textures.mjs` — committed regression check
- feat(jingle): add texture audition harness + exercise textures e2e
  - `js/jingle/debug/texture-demo.html` — the audition harness
  - `js/jingle/debug/pipeline-inspector-cases.js` — Wanderer B → `oblique_held`,
    Desert A' → `imitation_one_beat_delay`
- docs(jingle): record Session 6 texture implementation (this entry)

**The 13 textures (all pure, beat-stamped Pitch events, register MIDI 60–83):**
parallel_thirds_below, parallel_thirds_above, parallel_sixths_below,
parallel_sixths_above, contrary_motion, oblique_held, drone_on_1, drone_on_5,
imitation_one_beat_delay, voice_exchange, dropout, chord_tones_pulse,
heterophony. The buildplan asked for 8–10; shipped 13 (the full list it
enumerated).

**Exit criteria status:**
- [x] `textures.js` exports all 13 texture functions + `TEXTURE_REGISTRY`.
- [x] `stage-6-voice.js` dispatches via `TEXTURE_REGISTRY` (no inline
  placeholder, no throw). Unknown texture name throws a clear error naming it.
- [x] `texture-demo.html` auditions each texture against each of 5 motifs, with
  a "Play all textures" button for back-to-back comparison and a notes
  scratchpad.
- [x] `pipeline-inspector-cases.js` exercises two non-default textures
  end-to-end (`oblique_held`, `imitation_one_beat_delay`) alongside the
  parallel-thirds default; all 3 cases still run clean.
- [x] `verify-textures.mjs` PASSED (exit 0); all prior verifiers
  (verify-spelling / -forms / -motif / -stage6 / -stage8) still PASS — no
  regression.
- [x] This implementation journal entry.
- [x] **Human checkpoint — Steven's audition pass** (CLEARED; see the checkpoint
  block at the end of this entry).

**Verification anchors that passed (`verify-textures.mjs`, committed):**
- Every texture, run against representative two-bar leads in four modes (C major,
  D dorian, A harmonic-minor, E phrygian-dominant): returns an array; every
  event has a valid Pitch and a positive duration; every Pitch is in MIDI 60–83;
  and no harmony event sits above the lead note sounding at its onset — except
  `imitation_one_beat_delay`, which logged 3 documented crossings across the
  probes (the delayed echo dipping below the lead) and is the accepted exception.
- Registry completeness: all 13 names are callable functions.
- End-to-end: `runPipeline` over all 3 inspector cases (now including
  `oblique_held` and `imitation_one_beat_delay`) yields a FinalJingle whose
  every event has a positive duration and parses through the real `synth.js`
  `noteToFreq` to a finite, positive frequency, with the three voices
  beat-aligned.
- Belt-and-braces: a throwaway check ran all 5 demo motifs × 13 textures (65
  combos) through the demo's exact build path (render → texture → `toSequence` →
  `toSynthString` → `noteToFreq`); 0 bad pitches, 0 overlapping events, 0 throws.

**Range / voicing model (the shared discipline every texture obeys):**
- `clampToRange` octave-displaces any pitch into the MIDI 60–83 (C4–B5) window.
- `placeAtOrBelow(pitch, leadMidi)` clamps to range, then drops octaves until the
  harmony sits at or below the lead — the no-voice-crossing rule — without
  falling through the window floor. Parallel/contrary/oblique/drone/pulse all
  route through it. Held textures place below the *lowest* lead note in the
  passage, so the held tone never crosses anywhere in the passage.

**Surprises / decisions made:**
- **The chord context is a `chordsByAbsBar` Map keyed by absolute bar index, and
  its keys ARE the passage's bar range.** Stage 6 builds it from the section's
  HarmonicPlan progression (one chord per bar, cycling, resolved near the harmony
  register at octave 4) and hands it to the texture. Bar-by-bar textures (drones,
  oblique, chord_tones_pulse, imitation) read `[...keys].sort()` to know their
  span without a separate bar-range argument — this is why the signature needs no
  explicit start/end bar.
- **Textures reason in degree space via the lead's `degree`/`octave_offset`, not
  by re-deriving from the Pitch.** The lead events Stage 6 hands over carry both
  the realized Pitch and the originating degree, so "a third below" is a clean
  `leadLinear − 2` in scale steps, staying in mode through `degreeToPitch`. (A
  chromatic-anomaly bend on the lead is ignored by the parallel/heterophony math,
  same as the Session-4 placeholder did — the harmony tracks the diatonic degree.)
- **`imitation_one_beat_delay` — the "rest where it overlaps a still-sounding
  lead note" clause is read as rest-on-coincident-attack.** Taken literally, the
  lead sounds continuously, so "rest wherever the harmony overlaps a sounding
  lead note" would silence the whole voice — degenerate. The implemented reading
  suppresses an echo note only when its onset coincides with a lead onset (the
  strongest overlap, a simultaneous attack), which yields an audible
  call-and-echo with gaps. The transposition is a semitone shift landing the
  first echo note on the chord tone nearest the lead's first pitch (smallest
  shift, ties downward). The one-beat tail that would spill past the passage is
  clipped, so imitation never bleeds into the next texture or the cadence.
  **This is an interpretation, flagged for Steven's ear** — if the gappy echo
  sounds wrong, that's a finding to revisit.
- **`heterophony` doubles the lead an OCTAVE BELOW, not at strict unison.** The
  prompt says "same pitch as lead by default," but the ornament (a scale step
  toward the next pitch) rises above the lead on any ascending step — a voice
  crossing the global rule forbids. Voicing the whole shadow an octave below
  keeps the same pitch *classes* while guaranteeing the rising ornament still
  sits under the lead, so the no-crossing invariant holds cleanly and the
  ornament stays a smooth step (rather than getting octave-dropped on every
  ascent). Documented as a deliberate departure from the literal unison reading.
- **`voice_exchange` is the documented Session-6 placeholder.** It plays the
  lead an octave below (one event per lead note, same beat/duration). True voice
  exchange — the lead taking a held tone while the harmony carries the melody —
  needs Stage 6 to rewrite the lead too, which is out of scope here; the
  octave-below double is the audible stand-in. Flagged in the docstring and below.
- **`oblique_held` takes its single held pitch from the passage's FIRST chord**
  (root by default, fifth on `params.degree === 5`), since the held tone does not
  move with the progression. `drone_on_1` / `drone_on_5` instead lock to the
  section's *tonic* scale degree (1 or 5), NOT the chord root, per spec.
- **Inspector e2e coverage widened to three textures.** Wanderer's B section now
  auditions `oblique_held` (a held drone over the pedal bass) and Desert
  Caravan's A' recap auditions `imitation_one_beat_delay` (the delayed canon over
  the chromatic-ornamented recap), proving the held-drone and delayed-imitation
  paths survive Stage 6 → Stage 8 → cadence enforcement. The cadence still
  overwrites each section's final bar, so imitation's tail-clip lands just short
  of the cadence window with no conflict.
- **No DEC/CHANGELOG entry** — consistent with Sessions 1–5 and the buildplan:
  the new pipeline is built alongside the deployed app and is not user-visible
  until Session 12, which is where the DEC/CHANGELOG/architecture updates are
  scheduled.

**Deferred:**
- **True voice exchange** (lead ↔ harmony role swap with a generated lead
  counter-line) — placeholder this session; revisit when a session is touching
  the lead realization (Stage 6's update in S9–S11, or a dedicated polish pass).
- **Imitation interval = semitone, delay = one beat-unit.** The transposition is
  chromatic (a literal semitone shift to the nearest chord tone), so the echo can
  carry a brief out-of-mode pitch; a tonal-answer variant (transpose by scale
  steps, staying in mode) is a possible refinement if the chromatic echo grates.
  The one-beat delay is one meter beat-unit; compound-meter (6/8) delay semantics
  are untested by ear (all demo/inspector cases are 4/4) — buildplan §7.3.
- **Texture transition smoothing** (buildplan §7.2) — when a section changes
  texture mid-stream the harmony voice may jump; no smoothing this session, by
  design. Revisit if it sounds bad once the LLM texture stage (S8) drives changes.
- **Voice-leading repair** is still Session 7 — textures self-police range and
  crossing, but there is no parallel-perfect repair or smoothing pass yet.

**Notes for the human checkpoint (how to audition):**
- Serve over HTTP (ES modules): from the repo root `python3 -m http.server 8000`,
  then open `/js/jingle/debug/texture-demo.html`. Pick a motif, pick a texture,
  Play. "Play all textures" cycles every texture against the selected motif with
  the name shown above the piano roll and a 0.5s gap between each. The notes box
  is a scratchpad (not saved) — transcribe the keepers back here afterward.
- Also re-open `/js/jingle/debug/pipeline-inspector.html` and confirm all 3
  full-pipeline cases still hold together with the new textures (Wanderer's
  oblique drone, Desert's delayed canon, parallel thirds elsewhere).
- Listen for concrete defects (out-of-mode notes, voice crossings, broken
  rhythms) — those get fixed in this session or logged as deferred for a specific
  later session. Subjective "sounds boring" notes are recorded, not chased.
- The two interpretation calls most worth Steven's ear: the gappy
  `imitation_one_beat_delay` echo and the octave-below `heterophony` shadow.

**Verdict: Session 6 implementation complete; all verifiers pass and the
audition harness is ready. The session is NOT closed until Steven completes the
listening pass and his per-texture notes are recorded here.**

### Audition fixes (2026-05-21, mid-pass) — two defects found by ear, fixed

Steven's listening pass surfaced two concrete defects (not taste calls); both
fixed in `textures.js` + `verify-textures.mjs`, all verifiers still green.

**1. The four parallel textures collapsed to two distinct sounds.** With the
strict at-or-below rule, `parallel_thirds_above` octave-displaced down to avoid
crossing is *identical* to `parallel_sixths_below` (a third above and a sixth
below are octave-equivalent — same pitch classes a 7-scale-step octave apart),
and likewise `parallel_sixths_above` == `parallel_thirds_below`. Confirmed
pitch-for-pitch: over a C5 E5 G5 F5 E5 C5 lead, thirds_above and sixths_below
both produced E4 G4 B4 A4 G4 E4. The buildplan literally instructed this
("octave-displace down if it would cross"), but with the lead always in octave
5 the "above" textures *always* fold under and become redundant — the melody
never changes, so they can't sound higher.
- **Fix (decision, deviates from the buildplan's voice-crossing rule):** the two
  `*_above` textures now sit GENUINELY ABOVE the lead — a true upper harmony —
  rather than folding down. They get a raised register ceiling
  (`HARMONY_ABOVE_HIGH_MIDI` = MIDI 96 / C7) so a third/sixth over an octave-5/6
  lead has headroom instead of clamping back under it, and they are documented
  voice-crossing exceptions alongside imitation. All four parallel textures are
  now distinct registers: close-below, close-above, wide-below, wide-above (over
  the C-major probe: A4-class below thirds, E5-class above thirds, E4-class
  below sixths, A5/C6-class above sixths).

**2. `imitation_one_beat_delay` was gutted, not "gappy".** The Session-6
"rest on a coincident attack" reading dropped almost every echo note: the
one-beat delay snaps the echo onto the lead's own (0.5-quantized) beat grid, so
onset coincidences are the rule, not the exception. Measured survivors out of
the lead's notes: bright_arpeggio 2/6, dorian_call 2/6, harmonic_minor 3/5,
phrygian_dominant **1/7**, pentatonic 3/7 — not a canon, just stray blips.
- **Fix (decision, drops a buildplan clause):** the coincident-attack rest is
  removed; imitation is now a true overlapping canon (every echo note sounds,
  one beat later, transposed to the nearest chord tone, tail clipped at the
  passage end). Overlap with the lead IS the canon, and crossing is already the
  documented exception here. The literal "rest where it overlaps a still-
  sounding lead note" clause stays unimplemented — a continuous lead makes it
  degenerate, and the coincident-attack reading was the destructive cut.
  bright_arpeggio now echoes C5 E5 G5 F5 E5 (5 of 6, last clipped); phrygian
  echoes the full E5 F5 G#5 A5 G#5 F5 line one beat late.

**Resolved (taste call, Steven's decision):** `heterophony` is logically
correct and behaves as documented, but (a) it sits an OCTAVE BELOW the lead
rather than at unison, and (b) it always moves by step, so it traces the lead's
*direction* but not its *intervals* — a leapy lead (an arpeggio) gets its leaps
filled into a scale underneath, a stepwise lead becomes the line an octave down
with each note anticipated. The alternative was literal unison + ornament (now
viable since crossing is accepted for intrinsic-crossing textures). **Steven
listened and kept the octave-below shadow as-is** ("sounds fine, we can keep it
how it is"). No change.

**Bolder demo motifs added (2026-05-21).** At Steven's request, three
deliberately adventurous probes were added to `texture-demo.html` alongside the
five tame controlled ones, so the textures can be auditioned against
wide-leap / wide-range / exotic lines rather than only stepwise ones:
`wide_leaps_major` (C major, an octave leap spanning C5–C6),
`leaping_harmonic_minor` (A harmonic minor, octave leap + the high G# leading
tone), `byzantine_flourish` (C double-harmonic, the b2/b6 augmented-second
colour with skipping leaps). All three render clean across every texture (0
problems over 3 motifs × 13 textures: in-tune, no overlaps, no throws). These
are still hand-written probes — the engine's own creative melodies are the LLM
stages' job (S9–S11), not Session 6.

**HUMAN CHECKPOINT — CLEARED (2026-05-21).** Steven auditioned the textures in
`texture-demo.html` and the three full-pipeline cases in the inspector. Verdict,
verbatim:

> It's getting there! The textures make it more interesting for sure. It still
> isn't...taking the kinds of creative, musical risks that I would hope it would.
> The melodies all feel very stepwise and simple. As we continue to iterate, I'll
> be looking for more creative, soulful, emotional, evocative melodies,
> accompaniment styles, etc.

That clears Session 6's specific bar: the texture vocabulary works and audibly
lifts the contrapuntal/textural axis ("more interesting") that Sessions 4–5 were
flat on. Two concrete defects surfaced during the pass and were fixed in-session
(see "Audition fixes" above): the four parallel textures collapsing to two
distinct sounds (the `*_above` textures now sit genuinely above the lead) and
`imitation_one_beat_delay` being gutted by the coincident-attack rule (now a true
overlapping canon). `heterophony` was accepted as-is (octave-below shadow).

The "stepwise / not enough musical risk" axis is **not a Session-6 defect** and
not a texture issue — it's the melodic material, which this session uses only as
hand-written controlled probes. Melodic creativity (motif shape, leaps,
development, harmonic risk) is the explicit remit of the not-yet-built LLM
creative stages: Stage 4 motifs (S10), Stage 5a phrase/development (S9), Stage 3
harmony (S11), wielded through the freedom-knob presets (`adventurous`/`wild`),
the anomaly slots, and the 47-scale palette. Recorded as the standing aesthetic
bar to beat as those stages land (also captured in project memory) — the
deterministic back-half is rule-following by design and will not be the source
of "soul." The bolder demo motifs added this session let that adventurousness be
heard against the textures now, ahead of the generative stages.

No wrong-sounding texture defect remains open. Carrying "textures work and add
interest; melodic soul is the LLM stages' job" forward as the baseline.

**Verdict: Session 6 complete and confirmed by ear. All six verifiers pass, the
full texture vocabulary dispatches end-to-end, the two audition defects are
fixed, and the human-listening gate is cleared. Cleared to proceed to Session 7
(Stage 7 — voice-leading pass) when Steven kicks it off. Do NOT start Session 7
automatically.**

**Claude.ai-side verification (Steven + Claude Opus 4.7):**
- All six verify scripts re-run independently — PASSED:
  verify-spelling, verify-forms, verify-motif, verify-stage6,
  verify-stage8, verify-textures (all exit 0).
- Audition fix #1 (parallel *_above textures sitting genuinely above)
  confirmed by independent MIDI comparison against a C-major arpeggio:
  thirds_above [76,79,83,81,79,76] vs sixths_below [64,67,71,69,67,64].
  Same pitch classes, two octaves apart — true register separation,
  no longer redundant.
- Audition fix #2 (imitation as true overlapping canon) confirmed in
  E phrygian-dominant: 7 lead notes → 6 echo notes (last clipped at
  passage end). Pre-fix was 1 of 7; post-fix is a complete canon.
- All three inspector cases run with 0 bad pitches through the real
  noteToFreq across every voice.
- The two deviations from the buildplan (the *_above ceiling raise +
  imitation's removed coincident-attack rule) are well-documented in
  the texture docstrings and the journal; they are corrections, not
  shortcuts. Music-theoretically the right calls.
- The "stepwise / not enough musical risk" axis from Steven's
  listening verdict is correctly scoped to the LLM creativity stages
  (S9–S11) rather than to Session 6. The deterministic textures
  cannot supply melodic soul; that is structural by design.

**Verdict: Session 6 complete, audition cleared, both surfaced
defects fixed in-session. The texture vocabulary works and audibly
lifts the contrapuntal axis. Cleared to proceed to Session 7 —
voice-leading pass.**

## Session 7 — 2026-05-21 — Stage 7 voice-leading pass (configurable rule set)

> Implementation entry. This session's human checkpoint is lightweight (a quick
> confirm that chiptune_idiomatic is audibly unchanged + one curiosity listen to
> cpp_strict) and is recorded at the end of this entry AFTER Steven's pass — it
> is not here yet.

**What landed (commits):**
- feat(jingle): add Stage 7 voice-leading rule set + pipeline wiring
  - `js/jingle/theory/voice-leading-rules.js` — `applyVoiceLeading` +
    `voiceLeadingReport` + the four primitive repair helpers
    (`clampToRange`, `snapToMode`, `moveByStep`, `intervalBetween`) +
    `summarizeRepairs` + the `PRESETS` registry (data-driven)
  - `js/jingle/pipeline/stage-6-voice.js` — tags a realized chromatic-neighbor
    lead note with `anomalous: true` and carries the flag through `asTrack`
  - `js/jingle/pipeline/stage-7-leading.js` — identity stub replaced with a thin
    dispatcher over the preset rule set
  - `js/jingle/pipeline/pipeline-runner.js` — threads `macroParams` into Stage 7
- feat(jingle): add Stage 7 verifier + inspector preset toggle
  - `js/jingle/theory/verify-stage7.mjs` — committed regression check
  - `js/jingle/debug/pipeline-inspector.html` — voice-leading preset toggle +
    a Stage-7 panel (repairs summary + one diff line per repair + repaired tracks)
- docs(jingle): record Session 7 implementation (this entry)

**The two presets (PRESETS registry, data-driven):**
- `chiptune_idiomatic` (default): range_clamp ENFORCED; out_of_mode snaps the
  LEAD only, EXEMPTING anomaly-flagged notes; voice_crossing IGNORED;
  parallel_perfects ALLOWED; tritone_outline IGNORED.
- `cpp_strict`: range_clamp ENFORCED; out_of_mode snaps ALL voices with NO
  exemption; voice_crossing FORBIDDEN (octave-displace down to restore
  lead ≥ harmony ≥ bass); parallel_perfects FORBIDDEN (step-nudge the lower
  voice); tritone_outline REPAIRED (insert a stepwise passing tone, halving the
  prior note). Unknown preset → clear throw.

**Exit criteria status:**
- [x] `voice-leading-rules.js` exports `applyVoiceLeading` + the four primitive
  repair helpers + the `PRESETS` registry, both presets implemented per the
  rules above; the two presets are thin dispatchers over the same primitives.
- [x] Stage 6 tags chromatic-neighbor realizations with `anomalous: true`; the
  flag survives `asTrack` into the VoiceTracks; Stage 7 reads it. Prior tests
  still pass (the flag is additive — non-anomalous events keep the bare
  `{ pitch, beat, duration }` shape).
- [x] `stage-7-leading.js` dispatches on `config.knobs.voice_leading_strictness`
  (default `chiptune_idiomatic`); identity stub gone.
- [x] `pipeline-runner` threads `macroParams` through to Stage 7.
- [x] `pipeline-inspector.html` exposes the preset toggle and shows a repairs
  summary + per-repair diff lines; an unrepaired pass shows no diff.
- [x] `verify-stage7.mjs` PASSED (exit 0); all prior verifiers
  (verify-spelling / -forms / -motif / -stage6 / -stage8 / -textures) still
  PASS — no regression.
- [x] This journal entry.
- [x] **Human checkpoint** — lightweight confirm CLEARED (see the checkpoint
  note at the end of this entry).

**Verification anchors that passed (`verify-stage7.mjs`, committed):**
- Primitives: `clampToRange` octave-displaces (E7 → E6, C1 → C4, in-range
  untouched, bad range throws); `snapToMode` picks the nearest in-mode pitch with
  the documented downward tie (C#5 → C5, not D5; F#5 → F5 in E phrygian-dominant);
  `moveByStep` steps one scale degree (C5 →+ D5, →− B4; C5 →+ D5 in D dorian, where
  C5 is ^7); `intervalBetween` returns signed semitones (C4→G4 = +7, reverse = −7).
- (a) chiptune_idiomatic fires **0 repairs** on all three Session-6 inspector
  cases, and does not mutate the input Stage-6 tracks. The cases run end-to-end
  clean under both presets (positive durations, every synth string parses through
  the real `synth.js` `noteToFreq` to a finite positive frequency, voices
  beat-aligned).
- (b) cpp_strict repair counts locked as a regression anchor — Sunrise 6, Wanderer
  0, Desert 9. The only crossings among the inspector cases are Desert's imitation
  A' passage: 6 `uncross` repairs, **all inside the A' beat range** [32, 48), and
  **zero** uncross repairs on Sunrise/Wanderer (their textures sit at-or-below).
  A synthetic `parallel_thirds_above` passage is left alone by chiptune (0 repairs)
  and uncrossed by cpp_strict (the prompt's "*_above + imitation" expectation).
- (c) A constructed chromatic_neighbor: the flagged lead note is **preserved
  verbatim** under chiptune_idiomatic (no snap repair) and **snapped into mode**
  under cpp_strict (a `snap_to_mode` repair lands an in-mode pitch).
- (d) A voice track carrying E7 (MIDI 100) and D7 (98) is octave-displaced back
  into the 60..96 window under **both** presets.

**The cpp_strict repair table (the regression anchor, measured):**
- Sunrise Fanfare — 6 (bass): 5 `parallel_break` (lead/harmony↔bass parallel
  octaves on downbeats nudged a step) + 1 `tritone_passing` (a bass melodic
  tritone filled).
- Wanderer's Path — 0. Its textures (`parallel_thirds_below`, `oblique_held`) sit
  below, it has no out-of-mode notes, no detected parallels, no melodic tritones.
- Desert Caravan — 9: 1 `snap_to_mode` (lead F#5 anomaly, beat 36.75) +
  1 `snap_to_mode` (harmony F#5, the imitation echo, beat 37.75) + 6 `uncross`
  (imitation A', beats 34–43) + 1 `tritone_passing` (bass, beat 3.5).

**Surprises / decisions made:**
- **Enforced ranges deviate from the prompt's first-pass numbers, by
  measurement.** The prompt named lead C4..C6 and bass C2..C4. Dumping the actual
  Stage-6 output of the already-auditioned Session-6 cases showed the lead's
  octave-leap motifs reach **F6 (MIDI 89)** (Wanderer's `[5,7,8,7,5]` hits D6;
  Desert reaches F6) and the walking/arpeggio bass reaches **G4 (MIDI 67)** — both
  ABOVE those ceilings, in **all three** approved cases. Exit (a) + the human
  checkpoint require chiptune_idiomatic to fire ZERO repairs (audibly identical to
  pre-Session-7); clamping approved material to the literal numbers would regress
  it. So the enforced windows are widened to the genre's real register usage while
  still catching a genuinely out-of-register note: **lead C4..C7 (60..96), harmony
  C4..C7 (60..96, the *_above ceiling the prompt names), bass C2..C5 (36..72)**.
  The (d) range test uses a > C7 pitch — clearly out of any window — so the clamp
  is still exercised. Documented at the top of `voice-leading-rules.js`.
- **chiptune_idiomatic's out_of_mode is scoped to the LEAD voice only — also a
  measurement-driven call.** Session 6's `imitation_one_beat_delay` deliberately
  emits a chromatic echo (a semitone shift to the nearest chord tone), so Desert
  carries an out-of-mode **harmony** F#5 at beat 37.75 that is NOT anomaly-flagged
  (the prompt only tags the lead's chromatic_neighbor realization, which is the
  right scope). A literal "snap every out-of-mode event except anomaly-flagged
  ones" applied to all voices would snap that echo and regress the approved Desert
  audio. So chiptune_idiomatic snaps the LEAD only (exempting anomaly flags) and
  trusts the texture vocabulary for harmony/bass chromaticism — exactly parallel
  to why it IGNORES voice crossing ("the texture vocabulary already encodes
  crossing intent; do not second-guess"). cpp_strict, being strict, snaps ALL
  voices with no exemption, so it does snap that echo (and the lead anomaly).
- **Parallel-perfect repair can only approximate "closer to the chord tone."**
  The prompt's repair text says to nudge "whichever keeps it closer to the chord
  tone," but Stage 7's signature is `(voiceTracks, macroParams, preset)` — it is
  not handed the HarmonicPlan, so the chord is unavailable here. The repair instead
  picks the one-scale-step nudge that (a) actually breaks the parallel and (b) does
  not push the lower voice above the upper (no new crossing), preferring downward
  on a tie. This is the one place cpp_strict approximates the literal rule; flagged
  for the review. (cpp_strict exists "for correctness, not because it's the desired
  aesthetic," so the approximation is low-stakes.)
- **Parallel detection works on shared onsets, signed direction, same perfect
  class.** Two voices are checked only where both have an event onset at the same
  beat; a parallel is two consecutive shared-onset positions where the lower→upper
  interval is the same perfect class (P5 = 7 semitones, or P8/unison = 0) AND both
  voices move the same melodic direction. This is why the `parallel_thirds_below`
  passages never trip it (thirds aren't perfect) and only the down-beat
  lead/bass-octave coincidences in Sunrise do.
- **Two layers, data-driven presets.** `PRESETS` maps a name to a plain
  rule-config object (one entry per rule); `applyVoiceLeading` is a thin dispatcher
  that runs the same primitive operations per the config. A third preset is a data
  entry, not new code — per the prompt's "added by data rather than by code."
- **`voiceLeadingReport` is the report-bearing twin of `applyVoiceLeading`.** The
  spec'd contract `applyVoiceLeading(...) → voiceTracks` is preserved exactly;
  `voiceLeadingReport(...) → { tracks, repairs }` exists so the inspector (and the
  verifier) can show/count the labelled repairs without changing the contract.
- **Rule order: out_of_mode → range_clamp → voice_crossing → parallel_perfects →
  tritone_outline.** Fix pitch classes, then octaves, then crossings, then
  parallels, then insert passing tones last (so nothing downstream re-scans the
  inserted notes). Each voice is re-sorted by beat defensively before return.
- **No DEC/CHANGELOG entry** — consistent with Sessions 1–6 and the buildplan: the
  new pipeline is built alongside the deployed app and is not user-visible until
  Session 12, where the DEC/CHANGELOG/architecture updates are scheduled.

**Deferred:**
- **Chord-aware parallel-perfect repair.** When Session 11 wires the HarmonicPlan
  through the pipeline, Stage 7 could take the chord context and resolve the
  parallel-break nudge toward an actual chord tone (the literal rule), rather than
  the smoothness/no-crossing approximation used now. Revisit then.
- **`out_of_mode` for harmony/bass under chiptune_idiomatic.** Intentionally left
  permissive (trusts the texture vocabulary). If a future texture or LLM stage
  produces a genuinely-wrong out-of-mode harmony note under chiptune, this rule
  will not catch it — by design. Re-evaluate if that ever surfaces.
- **Voice-crossing repair is best-effort within range.** `uncross` drops octaves
  until the voice is at/below its reference without leaving the window floor; if it
  can't (the only headroom is below the floor), it leaves the crossing rather than
  go out of range. Has not triggered on the cases.
- **cpp_strict aesthetic.** This preset exists for correctness/curiosity, not as
  the target sound; it is not on the default path (`balanced` → `chiptune_idiomatic`).

**Notes for next session (Session 8 — Stage 5b texture choreography, first LLM
stage):**
- Stage 7 sits between Stage 6 and Stage 8 in the runner and is a pure
  pass-through under the default config (`balanced` → `chiptune_idiomatic`), which
  fires zero repairs on the current cases — so wiring the LLM texture stage does
  not change the deterministic back-half's behaviour.
- The VoiceTracks event shape gained an optional `anomalous: true` flag on
  chromatic-neighbor lead notes (additive; non-anomalous events are unchanged).
  Any new stage that synthesises lead events from a declared anomaly should set it
  so chiptune_idiomatic's out_of_mode exemption keeps working.
- Same theory-layer conventions hold: `voice-leading-rules.js` imports only
  `mode-engine.js` + `pitch.js` (zero imports outside `theory/`); run
  `verify-stage7.mjs` with the throwaway `package.json` dance.
- The inspector's preset toggle drives both the Stage-7 delta panel and playback
  (it builds a config with the chosen `voice_leading_strictness`), so an LLM-stage
  inspector panel can sit above it unchanged.

**HUMAN CHECKPOINT — CLEARED (2026-05-21, lightweight).** Steven opened the
inspector, ran the cases under both presets, and confirmed chiptune_idiomatic is
audibly unchanged from pre-Session-7. Verdict, verbatim:

> Ok great, so these are pretty much the same as before. All good.

That is exactly the gate: under the default preset the rules do not fire on the
existing cases (the inspector reads "Repairs: 0" on every case), so the
deterministic back-half sounds identical to Session 6 — Stage 7 is a transparent
pass-through until a future stage (or a non-default preset) gives it something to
repair. cpp_strict remains the correctness/curiosity configuration, not the
target aesthetic, and is off the default path.

**Verdict: Session 7 complete and confirmed by ear. All seven verifiers pass,
the identity stub is gone, and the rule set runs end-to-end under both presets.
chiptune_idiomatic is a measured no-op on the existing cases (zero repairs);
cpp_strict produces the expected crossing/parallel/tritone repairs. Cleared to
proceed to Session 8 (Stage 5b — texture choreography, the first LLM stage) when
Steven kicks it off. Do NOT start Session 8 automatically.**

**Claude.ai-side verification (Steven + Claude Opus 4.7):**
- All seven verify scripts re-run independently — PASSED:
  verify-spelling, verify-forms, verify-motif, verify-stage6,
  verify-stage8, verify-textures, verify-stage7 (all exit 0).
- Zero-repair gate confirmed across all three Session-6 cases under
  chiptune_idiomatic (0/0/0). cpp_strict repair counts measured:
  Sunrise 6 (5 parallel_breaks + 1 tritone), Wanderer's 0 (modal
  counterpoint already clean), Desert 9 (2 snap_to_mode + 6 uncross
  + 1 tritone). cpp repairs land at expected locations.
- Both deviations from the Session-7 prompt are measurement-driven
  and correct:
  (a) Ranges widened (lead C4..C7, bass C2..C5) because Session 6
      audio legitimately reaches F6 / G4; clamping to prompt's
      first-pass numbers would regress approved audio.
  (b) chiptune_idiomatic out_of_mode scoped to LEAD only because
      imitation_one_beat_delay emits chromatic echoes (texture-
      internal, not anomaly-flagged); snapping them would regress
      approved Desert Caravan audio.
  Both deviations honor the rule "Session 6 approved audio is the
  floor for chiptune_idiomatic."
- Anomaly tagging confirmed end-to-end: Desert's chromatic_neighbor
  produces an F#5 lead event at beat 36.75 with `anomalous: true`;
  preserved under chiptune_idiomatic, snapped to F5 under cpp_strict.
  Constructed test (C#5 anomalous in C major) confirms the exemption
  flips correctly with the preset.
- Range clamp confirmed: D8 → D6 (two octave displacements into
  [C4..C7]).
- PRESETS architecture is data-driven; new presets add as data
  entries rather than code. Acknowledging the documented limitation
  that cpp_strict's parallel_perfects fix approximates "step toward
  nearest chord tone" because Stage 7's signature doesn't include
  the HarmonicPlan — if cpp_strict ever becomes a default path,
  threading harmonicPlan in would close that gap. (Not blocking;
  cpp_strict is a curiosity preset.)

**Verdict: Session 7 complete and verified. chiptune_idiomatic is
audibly unchanged from pre-Session-7 (the gate); cpp_strict is a
working alternative preset off the default path. Cleared to proceed
to Session 8 — the first LLM-driven stage (Stage 5b texture
choreography), a real architectural shift from deterministic to
creative.**

## Session 8 — 2026-05-21 — Stage 5b texture choreography (FIRST LLM stage)

> Implementation entry. This is the first LLM-driven stage and a real
> architectural shift: Sessions 1–7 built the deterministic back-half; Stage 5b
> begins the LLM front-half. The human checkpoint is SUBSTANTIAL this session
> (listen to a generated case, A/B against the hand-supplied twin, try all three
> freedom-knob values) and is recorded at the END of this entry AFTER Steven's
> pass — it is not here yet.

**What landed (commits):**
- feat(jingle): add Stage 5b texture choreography (first LLM stage)
  - `js/jingle/pipeline/stage-5b-texture.js` — `generateTexturePlan`
    (with `__mockResponse` offline fallback + `onTrace`), `validateTexturePlan`,
    `buildTexturePlanPrompt`; LLM call mimics api.js; validate-then-retry-once
  - `js/jingle/pipeline/pipeline-config.js` — new `texture_adventurousness` knob
    on all four presets (tame/adventurous/wild)
  - `js/jingle/pipeline/pipeline-runner.js` — sync `runPipeline` kept bit-for-bit
    (now with a clear guard if texturePlan is absent); new async
    `runPipelineGenerating` calls Stage 5b when texturePlan is absent
- feat(jingle): wire Stage 5b into the inspector + add the offline verifier
  - `js/jingle/debug/pipeline-inspector-cases.js` — `GENERATED_CASES` export
    (Sunrise + Wanderer's with texturePlan omitted); `CASES` unchanged
  - `js/jingle/debug/pipeline-inspector.html` — generated cases (optgroup-labeled
    vs hand-supplied), a texture-adventurousness selector, and a Stage-5b panel
    (prompt / raw response(s) / generated TexturePlan)
  - `js/jingle/theory/verify-stage5b.mjs` — committed offline regression check
- docs(jingle): record Session 8 implementation (this entry)

**Exit criteria status:**
- [x] `stage-5b-texture.js` exports `generateTexturePlan` (with `__mockResponse`)
  + `validateTexturePlan`.
- [x] System + user prompts are built from a clearly-named `buildTexturePlanPrompt`
  separated from the fetch logic, so Sessions 9–11 can mimic the structure.
- [x] The validator catches every documented defect — unknown texture, unknown
  bass pattern, out-of-range bars, coverage gap, coverage overlap, missing
  section, extra section (plus non-object params + envelope-shape errors). Each
  is asserted in `verify-stage5b.mjs` with a keyword check on the message.
- [x] pipeline-runner threads hand-supplied OR generated texturePlan, with the
  hand-supplied path bit-for-bit unchanged (see the decision below — the sync
  core is untouched; generation lives in an async sibling).
- [x] `pipeline-inspector.html` exposes both old and new cases (clearly labeled
  by optgroup), and the generated case ACTUALLY HITS THE LLM in the browser
  (the only place a real LLM call happens this session).
- [x] `verify-stage5b.mjs` passes offline (no API calls); all prior verifiers
  still pass (verify-spelling / -forms / -motif / -stage6 / -stage8 / -textures /
  -stage7, all exit 0).
- [x] This journal entry (prompt design, validation strategy, prompt-engineering
  notes below).
- [x] **Human checkpoint** — substantial (first LLM stage); CLEARED (see the
  checkpoint block at the end of this entry).

**Verification anchors that passed (`verify-stage5b.mjs`, committed, OFFLINE):**
- `validateTexturePlan` on a valid wrapped plan → `{ ok:true, errors:[] }`; each
  of the eight+ defect classes → `{ ok:false }` with a message naming the defect.
- `generateTexturePlan({ __mockResponse })`: a valid mock parses + validates and
  returns the FLAT plan (keys = section labels, no `sections` wrapper); threaded
  through `runPipelineGenerating` it runs end-to-end (Stage 6 → 7 → 8 →
  toSynthString) to a FinalJingle whose every pitch parses through the **real**
  synth.js `noteToFreq` to a finite positive frequency, all three voices
  beat-aligned. A malformed mock (bad JSON) throws; a semantically-invalid mock
  (unknown texture, or a missing section) throws on validation.
- `buildTexturePlanPrompt` is pure and names the exact section labels, the strict
  texture/bass vocabularies, and the active adventurousness directive.
- Prompt body size measured 4.4–4.7 KB across the three cases at `wild` — under
  the `/api/generate` 8 KiB cap (a one-shot retry adds the prior response +
  correction, ~6 KB worst case, still under).

**Prompt design choices:**
- **System prompt** establishes the role verbatim from the buildplan: "You are a
  composer choosing textures and bass patterns to choreograph a chiptune piece.
  Your output is a strict JSON object matching the given schema; no commentary."
- **User prompt** is assembled from compact, labeled blocks: PIECE (key/mode/
  form/tempo/meter/register/harmonic-rhythm/sections-with-bar-counts), MOTIFS
  (degree shapes + contour + register + any anomaly), HARMONIC PLAN (per-section
  Roman numerals + cadence), PHRASE PLAN (which motif/transform lands where),
  the STRICT texture + bass vocabularies (each name + a one-line description so
  the model knows what it's choosing from), the active adventurousness directive,
  and a JSON skeleton that lists every section by its exact label and bar count.
- **Vocabulary listings are generated off the registries' own keys**
  (`TEXTURE_REGISTRY`, `BASS_PATTERNS`), so the prompt's choice set can never
  drift from what validation accepts — add a texture and it shows up in both.
- **Forced-JSON by instruction, not a parameter.** The Anthropic Messages API has
  no `response_format`, so (per the buildplan's fallback) the prompt demands
  "RESPOND WITH ONLY THIS JSON OBJECT — no markdown fences, no commentary"; the
  parser strips fences and brace-matches, mirroring api.js exactly. (Tool-forced
  JSON was considered and rejected — it would diverge from the api.js text-block
  parsing pattern Sessions 9–11 will reuse, for no real gain on a small object.)

**Validation strategy:**
- `validateTexturePlan` collects ALL defects (it does not stop at the first), so
  the single retry can be handed every problem at once. Each message names the
  section, the voice, the assignment index, and the offending value.
- The five rigour checks from the prompt are all enforced: (a) the section-label
  set matches `computeSectionPlan(macroParams)` exactly — none missing, none
  extra; (b) harmony/bass are arrays of well-formed assignments with a valid
  registry name and a `[start,end]` integer tuple; (c) bars within `[1, N]`,
  `start<=end`; (d) per voice, ranges tile `[1, N]` contiguously — gaps and
  overlaps detected by an expected-next-bar walk; (e) optional `params` is an
  object or absent.
- **The validator reuses `computeSectionPlan`** (exported from stage-6-voice.js)
  as the single source of truth for labels + bar counts — the same function
  Stage 6 and the runner use — so "what's a valid section" can't drift between
  the validator and the realizer.

**Surprises / decisions made:**
- **Wrapped LLM envelope, flat inter-stage plan.** The Session-8 prompt's OUTPUT
  diagram and validation spec ("`sections` is an object…") describe a WRAPPED
  shape `{ sections: { <label>: {…} } }`, but the canonical inter-stage
  TexturePlan (buildplan §3, what Stage 6 consumes, what the hand-supplied cases
  use) is FLAT `{ <label>: {…} }`. Reconciled by treating the wrapped shape as
  Stage 5b's LLM I/O envelope only: the model emits it, `validateTexturePlan`
  checks it, then `generateTexturePlan` UNWRAPS `.sections` and returns the flat
  §3 plan. So `input.texturePlan` is one consistent shape whether hand-supplied
  or generated, Stage 6 needs no change, and the §3 contract holds. A top-level
  `sections` key is also genuinely easier for the model than a bare map of labels
  like `"A'"`.
- **`runPipeline` stays SYNCHRONOUS; generation lives in an async sibling.** The
  prompt's pseudocode puts an `await generateTexturePlan(...)` inside the runner's
  if/else, which would make `runPipeline` async and force every existing
  synchronous caller (the inspector's hand-supplied path + verify-stage6/7/8/
  textures, which all call `runPipeline(testCase)` and use the result directly)
  to change. To keep the hand-supplied path bit-for-bit unchanged AND all prior
  verifiers passing, the if/else is realized as: `runPipeline` (sync core,
  unchanged, now with a clear guard if texturePlan is absent) + a new async
  `runPipelineGenerating` that calls Stage 5b when texturePlan is absent then
  delegates to the sync core. This is the pattern the remaining LLM stages
  (1/2/3/4/5a) will follow — present-supplied input wins; otherwise call the LLM
  stage — and it means adding an LLM stage never changes the deterministic
  back-half's calling convention.
- **New `texture_adventurousness` knob (≠ `texture_change_rate`).** The prompt
  reads `config.knobs.texture_adventurousness` ∈ {tame, adventurous, wild}, which
  did not exist — the config had `texture_change_rate` ∈ {low, medium, high},
  reserved for the deterministic side. Added `texture_adventurousness` to all four
  presets (conservative→tame, balanced→adventurous, adventurous→adventurous,
  wild→wild) rather than overloading the existing knob. Additive — no other stage
  reads it; the existing presets/verifiers are unaffected. The reader falls back
  to `adventurous` if the knob is absent.
- **Model pinned to `claude-sonnet-4-20250514`.** The deployed `/api/generate`
  proxy's `ALLOWED_MODELS` permits only this one (and api.js uses it), so pinning
  it keeps BOTH runtime modes working — the Cloudflare proxy path and the
  artifact direct-to-anthropic path — without a server change. A model upgrade is
  a coordinated allow-list + client change, deferred (Session 12+). Noted so a
  future session doesn't silently switch the model and 400 the deployed path.
- **`onTrace` callback (no input mutation) feeds the inspector.** Rather than
  mutating an out-param, `generateTexturePlan` accepts an optional `onTrace`
  called once per model round-trip (or the mock) with `{ attempt, raw, ok,
  errors }`. The inspector collects these to show every attempt's raw response
  and which one validated; the prompt itself is displayed by calling the pure
  `buildTexturePlanPrompt` directly.
- **Retry ceiling is one (two tries total), per the buildplan.** On a validation
  (or first-response parse) failure, the stage appends the assistant's bad
  response + a correction prompt listing the specific errors, and asks once more.
  Still invalid → throw with the full error list and the raw response logged.
  An unparseable FIRST response is treated as a validation failure so the retry
  gets a chance; an unparseable SECOND response throws directly.

**Prompt-engineering notes (from offline testing — the live aesthetic test is the
human checkpoint):**
- Verification this session was OFFLINE only (no API key in the build context):
  the `__mockResponse` path exercises the full parse+validate+e2e pipeline, and
  prompt structure/size were checked, but no live model output was generated or
  judged here. The quality of the model's *texture choices* is exactly what
  Steven's listening pass evaluates.
- The JSON skeleton lists each section with its bar count inline
  (`"A1": { "harmony": [ /* tile bars 1..4 */ ], … }`) because coverage (no gaps/
  overlaps tiling `[1,N]`) is the constraint a model is most likely to get wrong;
  putting N right next to each label is the cheapest nudge. If the model still
  miscovers in practice, the retry feeds back the exact gap/overlap bars.
- The adventurousness directive only prints the ACTIVE level's instruction (not
  all three), to avoid diluting the steer. tame ≈ "mostly parallel_thirds_below +
  root_fifth"; adventurous ≈ "vary per section, use contrast/breath"; wild ≈ "a
  different texture every 4–8 bars, reach for the bold ones."

**Deferred:**
- **Live prompt tuning.** Any aesthetic adjustments to the prompt (texture-choice
  tendencies, how strongly each adventurousness level varies) wait on Steven's
  listening pass — those are findings, not blockers, per the checkpoint rules.
- **`params` semantics are validated but not richly specified to the model.** The
  prompt mentions `{"degree": 5}` for oblique/drone/pedal; the validator only
  checks `params` is an object. If the model invents unsupported param keys, Stage
  6 ignores them harmlessly (textures read only the keys they know). Tighten later
  if it matters.
- **Tonal-vs-chromatic, transition smoothing, compound meter** — all inherited
  Session-6 deferrals; Stage 5b just chooses WHICH textures, it doesn't change how
  they realize.
- **Model upgrade + allow-list** — pinned to sonnet-4 for now (see above).

**Notes for next session (Session 9 — Stage 5a phrase structure + motif
placement):**
- Mimic this stage's structure: a pure `build<Stage>Prompt({…}) → { system, user }`
  separated from the fetch; a `validate<Output>(plan, macroParams) → { ok, errors }`
  that collects ALL defects and reuses `computeSectionPlan` for section truth; a
  `generate<Output>({ …, __mockResponse, onTrace })` with the offline fallback and
  the one-shot validate-then-retry loop; the model pinned to
  `claude-sonnet-4-20250514`; the wrapped-LLM-envelope / flat-inter-stage-plan
  split if §3's shape and a clean LLM schema disagree.
- The async `runPipelineGenerating` is where the front-half assembles. Session 9+
  will add their own "generate if absent" step there (PhrasePlan before Stage 5b's
  TexturePlan, since 5b consumes the phrasePlan). Keep `runPipeline` synchronous.
- `verify-stage5b.mjs` runs with the throwaway-package.json dance like the others.
- Stage 5b post-LLM enforcement is intentionally just shape/coverage/vocabulary —
  no musical-quality rejection (e.g. "don't dropout the whole A section"). Session
  9's PhrasePlan validator, by contrast, DOES owe motivic-development rules
  (B-section non-literal, reprise contains the A motif, no adjacent-identical
  transform patterns) per the buildplan — those are post-LLM rejections, not just
  prompt asks.

**HUMAN CHECKPOINT — CLEARED (2026-05-21, substantial — first LLM stage).** Steven
ran the generated cases through the inspector (live LLM via `wrangler pages dev`),
A/B'd them against the hand-supplied twins, and tried the adventurousness knob.
Verdict, verbatim:

> Ok yes...I'm liking this. Each session is adding just a little bit more to the
> pot. I appreciate the kind of texture variation that's happening. Again, the
> melodies are still too simplistic, and the forms feel too "by the books"...the
> bass lines and melodies aren't creative enough yet, still, but the counterpoint
> harmony is getting there.

That clears Session 8's specific bar: **the LLM texture stage works end-to-end and
reads as compositional rather than random.** The texture variation is the part
Steven called out as landing ("I appreciate the kind of texture variation"; "the
counterpoint harmony is getting there") — which is exactly Stage 5b's deliverable.
No concrete defect surfaced: no validation failures or ill-formed plans, and no
wrong-sounding texture choice was reported — the model's per-section picks read as
intentional.

The three axes Steven still finds wanting are each the explicit remit of a
not-yet-built stage, not a Stage-5b defect:
- **Melodies too simplistic** — the lead is the hand-written motifs + transforms in
  `pipeline-inspector-cases.js`. Motif *shape* generation is Stage 4 (Session 10);
  phrase/development placement is Stage 5a (Session 9). Melodic soul lives there,
  wielded through the freedom knobs, the anomaly slots, and the 47-scale palette —
  the standing aesthetic bar carried since Session 6.
- **Bass lines not creative enough** — bass is the deterministic pattern vocabulary
  (root_fifth / walking / pedal / arpeggio / cadential_5_1). Stage 5b now *chooses*
  among them per section, but the patterns themselves are fixed, and they walk a
  hand-written progression (Stage 3 harmony is Session 11). A richer bass-pattern
  vocabulary is a candidate deferred enhancement once the generative stages land.
- **Forms too by-the-books** — `macroParams.form` is hand-supplied this session;
  form selection is Stage 2 (Session 12) and phrase-structure choice within a form
  is Stage 5a (Session 9).

Carrying forward: the contrapuntal/textural axis is now landing (Sessions 6 + 8);
melodic, bass, and formal creativity is the job of the remaining LLM stages
(S9–S12). Aesthetic surprises in the texture choices, if any, are future
prompt-tuning findings, not blockers — none were reported this pass.

**Verdict: Session 8 complete and confirmed by ear.** The first LLM stage is wired
end-to-end with strict schema validation, a one-shot retry, a deterministic offline
fallback, and the freedom-knob plumbing; `verify-stage5b` and all seven prior
verifiers pass offline. Texture choreography reads as compositional, the texture
variation and counterpoint are audibly landing, and the human gate is cleared.
Cleared to proceed to Session 9 (Stage 5a — phrase structure + motif placement)
when Steven kicks it off. Do NOT start Session 9 automatically.

**Claude.ai-side verification (Steven + Claude Opus 4.7):**
- All eight verify scripts re-run independently — PASSED:
  verify-spelling, verify-forms, verify-motif, verify-stage6,
  verify-stage8, verify-textures, verify-stage7, verify-stage5b
  (all exit 0, all offline).
- Backward compatibility confirmed: sync `runPipeline` produces
  the same event counts on all three Session-6 cases (79/68 lead/
  bass for Sunrise, 58/33 for Wanderer's, 54/38 for Desert) —
  bit-for-bit unchanged.
- Sync `runPipeline` throws cleanly on missing texturePlan with
  a message pointing to `runPipelineGenerating` — surfaces
  incorrect API usage immediately.
- Async `runPipelineGenerating` with `__mockResponse` produces a
  beat-aligned (64/64/64) generated case with 0 bad pitches
  through the real synth.js noteToFreq.
- Validator catches all four documented defect modes with
  retry-actionable error messages: unknown texture name (lists
  allowed), coverage gap (names the uncovered bars), coverage
  overlap (names the colliding bar), missing section (names the
  missing label + expected set). Validator collects ALL defects
  in one pass — the one-shot retry can address them together.
- Two architectural choices judged correct in retrospect:
  (a) Sync core + async sibling (rather than the prompt's
      implicit "make runPipeline async") — every existing call
      site stays sync, the throw-on-missing surfaces wrong-side
      usage, and the pattern generalizes to Stages 5a/4/3/2/1.
  (b) Wrapped envelope at the LLM seam, flat plan inter-stage —
      downstream consumers (Stage 6) see one consistent shape
      whether the plan came from hand-supplied input or the LLM.
- Model pinning to claude-sonnet-4-20250514 to match the
  /api/generate allow-list is well-documented — preserves both
  the deployed Pages and Claude.ai artifact-runtime paths
  without a server change (a project-instructions hard
  constraint).
- Steven's "counterpoint harmony is getting there" verdict
  matches the Stage-5b deliverable exactly; the "melodies/bass/
  forms" axes are correctly scoped to the remaining LLM stages
  (S9–S12).

**Verdict: Session 8 complete and verified. First LLM stage is
wired end-to-end with strict validation, one-shot retry, offline
fallback, and the freedom-knob plumbing. The patterns established
here (sync-core + async-sibling, wrapped envelope at LLM seam,
collect-all-defects validation, model-pinning) are the template
for Stages 5a, 4, 3, 2, 1. Cleared to proceed to Session 9 —
Stage 5a phrase structure + motif placement.**

## Session 9 — 2026-05-21 — Stage 5a phrase structure + motif placement (SECOND LLM stage)

> Implementation entry. Stage 5a is the SECOND LLM stage and the sibling of
> Session 8's Stage 5b — same architecture, different remit (it shapes how the
> motifs develop, not the harmony texture). The human checkpoint is SUBSTANTIAL
> this session (Steven's "want more creative melodies" pressure starts to bite:
> listen to a fully-generated case, A/B against the hand-supplied + Stage-5b-only
> twins, try the new phrase_adventurousness knob, read the generated PhrasePlan
> for compositional intent) and is recorded at the END of this entry AFTER his
> pass — it is not here yet.

**What landed (commits):**
- feat(jingle): add Stage 5a phrase structure + motif placement (2nd LLM stage)
  - `js/jingle/pipeline/stage-5a-phrase.js` — `generatePhrasePlan` (with
    `__mockResponse` offline fallback + `onTrace`), `validatePhrasePlan`,
    `buildPhrasePlanPrompt`; LLM call mimics api.js / Stage 5b; validate-then-
    retry-once. Structurally identical to stage-5b-texture.js.
  - `js/jingle/theory/form-engine.js` — new `deriveSectionRelationships(labels)`
    (form-independent, label-pattern inference; the fallback for when curated
    metadata doesn't line up with the labels in play)
  - `js/jingle/pipeline/pipeline-config.js` — new `phrase_adventurousness` knob on
    all four presets (tame/adventurous/wild), modeled on texture_adventurousness
  - `js/jingle/pipeline/pipeline-runner.js` — `runPipelineGenerating` now threads
    Stage 5a (phrasePlan) before Stage 5b (texturePlan); sync `runPipeline`
    requires BOTH phrasePlan AND texturePlan
- feat(jingle): wire Stage 5a into the inspector + add the offline verifier
  - `js/jingle/debug/pipeline-inspector-cases.js` — new `wanderer-fully-generated`
    case in `GENERATED_CASES` (both phrasePlan AND texturePlan omitted); `CASES`
    and the Session-8 generated cases unchanged
  - `js/jingle/debug/pipeline-inspector.html` — a phrase-adventurousness selector,
    a Stage-5a panel (prompt / raw response(s) / generated PhrasePlan) above the
    Stage-5b panel, and a phrase-then-texture generation flow for the
    fully-generated case
  - `js/jingle/theory/verify-stage5a.mjs` — committed offline regression check
- docs(jingle): record Session 9 implementation (this entry)

**Exit criteria status:**
- [x] `stage-5a-phrase.js` exports `generatePhrasePlan` + `validatePhrasePlan` +
  `buildPhrasePlanPrompt`, structurally mirroring stage-5b-texture.js (prompt
  builder separated from the fetch; wrapped LLM envelope unwrapped to the flat §3
  plan; collect-all-defects validation; validate-then-retry-once; `__mockResponse`
  offline fallback; model pinned to `claude-sonnet-4-20250514`).
- [x] The validator catches every development-rule defect with retry-actionable
  messages — unknown motif, unknown transform, B-section-without-development,
  reprise-without-source-motif, adjacent-identical, overlap, motivic-transform-on-
  a-cadence-bar, plus the schema rules (missing/extra section, bad phrase_structure,
  out-of-range start_bar, bad length_bars, envelope shape). Each is asserted in
  `verify-stage5a.mjs` with a keyword check on the message.
- [x] form-engine exposes section relationships for the validator: the curated
  `getSectionRelationships(form)` (already present from Session 2) PLUS the new
  `deriveSectionRelationships(labels)` fallback. The stage combines them — see the
  form-engine amendment below.
- [x] pipeline-runner threads phrasePlan generation into `runPipelineGenerating`
  (Stage 5a before Stage 5b, so the texture stage receives the resolved phrasePlan);
  sync `runPipeline` now requires BOTH phrasePlan AND texturePlan.
- [x] `pipeline-inspector.html` shows the generated PhrasePlan (Stage-5a panel) and
  the generated TexturePlan (Stage-5b panel) on the fully-generated case, with a
  phrase-adventurousness selector alongside the texture one.
- [x] `verify-stage5a.mjs` passes offline (no API calls); all prior verifiers still
  pass (verify-spelling / -forms / -motif / -stage6 / -stage8 / -textures / -stage7 /
  -stage5b — all exit 0).
- [x] This journal entry.
- [ ] **Human checkpoint** — substantial (the melodic-creativity pressure point);
  NOT yet run. Added after Steven's listening pass.

**Verification anchors that passed (`verify-stage5a.mjs`, committed, OFFLINE):**
- `validatePhrasePlan` on a valid wrapped plan (D dorian ternary; A states/sequences
  motif a, B develops motif b with invert+retrograde, A' brings back a) →
  `{ ok:true, errors:[] }`. Each documented defect → `{ ok:false }` with a message
  naming the defect (the keyword-checked list above). Notably: the cadence-bar rule
  fires with the harmonicPlan supplied and is correctly SKIPPED when it is omitted
  (the optional 4th arg — see the decision below).
- `generatePhrasePlan({ __mockResponse })`: a valid mock parses + validates and
  returns the FLAT §3 plan (keys = section labels, no `sections` wrapper). Threaded
  through `runPipelineGenerating` with Stage 5b ALSO mocked, it runs end-to-end
  (5a → 5b → 6 → 7 → 8 → toSynthString) to a FinalJingle whose every pitch parses
  through the real synth.js `noteToFreq` to a finite positive frequency, all three
  voices beat-aligned (48/48/48 for the 12-bar case). A malformed mock (bad JSON)
  throws; a semantically-invalid mock (B-without-development, unknown transform)
  throws on validation.
- `buildPhrasePlanPrompt` is pure and names the exact section labels (including the
  primed `"A'"`), the phrase-structure + transform vocabularies, cadential_gesture,
  and the active adventurousness directive.
- Spot-check of the live prompt for the fully-generated Wanderer's case: the FORM
  ROLES block reads `A: exposition`, `B: contrast vs A — MUST contain non-literal
  motivic development`, `A': reprise of A — MUST bring back a motif from A` — the
  curated AABA/ternary metadata correctly remapped onto the explicit `[A, B, A']`
  labels.

**Prompt design choices:**
- **System prompt** verbatim from the buildplan: "You are a composer choosing phrase
  structure and shaping motivic development for a chiptune piece. Your output is a
  strict JSON object matching the given schema; no commentary."
- **User prompt** is assembled from compact, labeled blocks: PIECE (key/mode/form/
  tempo/meter/register/harmonic-rhythm/sections-with-bar-counts), MOTIFS (degrees +
  rhythm + contour + register + any anomaly, each named so the model references it
  by name), HARMONIC PLAN (per-section progression + cadence — informs phrase choices
  and which sections need the cadential slot), FORM ROLES (per-section role / reprise-
  source / contrast, with inline "MUST …" notes so the model honors the development
  rules), the PHRASE STRUCTURE vocabulary (period/sentence/phrase_group/hybrid with
  one-line descriptions), the TRANSFORM vocabulary (every transformations.js export +
  cadential_gesture, each with a one-line description), an explicit DEVELOPMENT RULES
  block (the same five rules the validator enforces, stated as prompt asks so the
  first pass is usually valid), the active adventurousness directive, and a JSON
  skeleton listing every section by its exact label + bar count + a per-section
  cadential-bar note.
- **Transform vocabulary is generated off transformations.js's own exports**
  (`Object.keys(Transforms)` filtered to functions), so the listing — and what the
  validator accepts — can never drift from the library. cadential_gesture is appended
  separately (it is a reserved slot, not a transformations.js export).
- **Forced-JSON by instruction**, fences-stripped + brace-matched parse — identical
  to Stage 5b / api.js. Model pinned to `claude-sonnet-4-20250514` (the /api/generate
  allow-list), max_tokens 2500 (slightly above 5b's 2000, since a lead array per
  section is a touch larger than a texture/bass pair).

**Validation strategy (the music-theory work this session):**
- `validatePhrasePlan` collects ALL defects in one pass (like 5b), so the single
  retry is handed every problem at once. Two layers: a per-section `validateLead`
  (schema rule f, adjacency c, coverage/overlap d, cadence-bar e) and a cross-section
  pass (development a, reprise-motif b) that uses the section relationships.
- The five DEVELOPMENT RULES, implemented:
  - (a) **B-type development.** A `contrast`/`variation` section must contain at least
    one assignment whose transform is a genuine non-literal motivic transform (motif
    ≠ null, transform ∉ {literal, cadential_gesture}). All-literal (or literal +
    cadential only) → rejected with the buildplan's exact message.
  - (b) **Reprise reuses its source motif.** A `reprise`/`varied_reprise` section must
    use at least one motif that its source section also uses (so A3 of AABA must
    contain "a"). The source's motif set is collected from the plan being validated;
    if the source has no motifs, the rule is a no-op (nothing to match).
  - (c) **No adjacent identical pair.** Adjacent (by sorted start_bar) assignments
    may not share the same `{ motif, transform }` — compared via a canonical key with
    sorted params, so `transpose_third(direction=up)` ≠ `transpose_third(direction=down)`.
  - (d) **No overlaps; no overflow.** Sorted by start_bar, each assignment's
    `start + length` (the first free bar) must be ≤ the next assignment's start; gaps
    (rests) are allowed; the last assignment may not run past `section.bars + 1`.
  - (e) **Cadenced final bar = cadential_gesture.** If the section declares a cadence
    in the harmonicPlan, any assignment covering its final bar with a transform other
    than cadential_gesture is rejected (Stage 8 overwrites that bar, so a motivic
    transform there is silently wiped — this is the "musically wrong" defect the human
    checkpoint watches for, caught at validation instead).
  - (f) Schema: exact section-label set, phrase_structure ∈ the four names, motif null
    or a known key, transform a recognized name (or the object form), start_bar in
    [1, bars], length_bars ≥ 1.
- **The validator reuses `computeSectionPlan`** (from stage-6-voice.js) as the single
  source of truth for labels + bar counts — the same function Stage 6, the runner,
  and Stage 5b use — so "what's a valid section" can't drift.

**Form-engine amendment (the section-relationship work):**
- form-engine already exposed `getSectionRelationships(formName)` (Session 2), keyed
  by the FORM's section labels. The wrinkle: a piece can override a form's labels via
  `macroParams.sections` (e.g. Wanderer's uses `form: ternary` but labels `[A, B, A']`,
  while the library's ternary is `[A1, B, A2]`), so a direct `relationships[label]`
  lookup misses. Two parts to the fix, split by layer:
  - **theory layer:** added `deriveSectionRelationships(labels)` to form-engine — a
    pure, form-independent inference from the label letter-pattern (first appearance
    of a letter = exposition or, for a non-home letter, contrast; a later appearance
    with no contrast between = repetition; a later appearance after a contrast =
    reprise; `of`/`contrast_from` resolved to the right sibling). Verified against
    ternary/AABA/ABCA — matches the curated forms.json semantics.
  - **pipeline layer:** Stage 5a's `sectionRelationshipsForPlan(macroParams, plan)`
    PREFERS the curated `getForm(form).relationships`, remapped onto the actual labels
    by POSITION (and remapping `of`/`contrast_from` through the same position map), and
    FALLS BACK to `deriveSectionRelationships(labels)` only when there is no matching
    form (unknown form, or a section-count mismatch). This keeps the curated, hand-
    authored relationships for the 12 library forms (so e.g. ABAB's A2 stays a
    `repetition`, not a `reprise`) while still handling label overrides and ad-hoc
    forms. The label-remapping lives in the pipeline (not form-engine) because it
    depends on `computeSectionPlan`, which is pipeline code — form-engine stays
    theory-pure (imports nothing outside theory/).

**Surprises / decisions made:**
- **`validatePhrasePlan` takes an OPTIONAL 4th arg `harmonicPlan`.** The buildplan's
  signature is `validatePhrasePlan(wrappedPlan, macroParams, motifs)`, but rule (e)
  needs the per-section cadence, which lives in the harmonicPlan, not macroParams.
  Resolved by adding `harmonicPlan` as an optional 4th argument: when present, rule
  (e) runs; when absent, it is skipped (the other rules still hold). `generatePhrasePlan`
  always passes it. The documented 3-arg form still works; this is additive.
- **Two mock channels in `runPipelineGenerating`.** Stage 5b's `__mockResponse`
  (Session 8) is now the TEXTURE channel (kept for back-compat — verify-stage5b is
  unchanged and still passes); the new `__mockPhraseResponse` is the PHRASE channel,
  with `onPhraseTrace` as the phrase trace hook. The fully-generated verifier supplies
  both; the Session-8 sunrise/wanderer-generated cases still supply only the texture
  mock (their phrasePlan is present, so Stage 5a is never called for them).
- **Dependency order in the runner: Stage 5a before Stage 5b.** Stage 5b's prompt
  consumes the phrasePlan (which motif/transform lands where), so the phrasePlan must
  be resolved first. The runner generates phrasePlan (if absent), then passes the now-
  resolved phrasePlan into the texture generation. Present-supplied input still wins at
  each step.
- **The hand-supplied Session 4–7 phrase plans put motivic transforms on cadenced
  final bars; the GENERATED plans must NOT (rule e).** The fixtures in
  pipeline-inspector-cases.js end sections with `fragment_tail` / ornaments even though
  those sections declare cadences — harmless, because (1) those hand-supplied cases are
  never run through `validatePhrasePlan` (only generated plans are) and (2) Stage 8
  overwrites the final bar regardless. Rule (e) exists precisely so the LLM doesn't
  waste a developmental gesture on a bar that's about to be overwritten. So generated
  plans use the reserved `cadential_gesture` (motif null) on every cadenced section's
  final bar; the hand-supplied fixtures are left as the historical Session-4 shape.
- **`phrase_adventurousness` knob (≠ `texture_adventurousness`).** Added a distinct knob
  on all four presets (conservative→tame, balanced→adventurous, adventurous→adventurous,
  wild→wild), modeled on Session 8's texture knob. tame ≈ "literal + step/third
  sequences, period-dominant, ornaments rare"; adventurous ≈ "retrograde/inversion in
  contrast sections, fragmentation, tasteful ornaments"; wild ≈ "bold throughout, plus
  exactly one section reaches for a striking anomaly gesture (chromatic passing /
  retrograde / invert) the others don't." The wild "exactly one anomaly section" rule
  is a PROMPT directive, not a validator rule (the buildplan lists it under the knobs,
  and the enforced rules are a–f) — it is what the human checkpoint's step 3 confirms by
  ear, not a hard rejection.
- **Stacked Stage-5a / Stage-5b panels, not literal side-by-side.** The inspector is a
  vertical stack of stage panels; the generated PhrasePlan (Stage-5a panel) sits directly
  above the generated TexturePlan (Stage-5b panel) on the fully-generated case, both
  visible at once. This matches the existing layout idiom and satisfies "inspect what the
  model chose for both stages on the same case." The inspector keeps its manual
  generate-then-display flow (rather than calling `runPipelineGenerating`) so the
  intermediate VoiceTracks / Stage-7 repairs / cadence panels still render.
- **No DEC/CHANGELOG entry** — consistent with Sessions 1–8 and the buildplan: the new
  pipeline is built alongside the deployed app and is not user-visible until Session 12,
  where the DEC/CHANGELOG/architecture updates are scheduled.

**Deferred:**
- **Live prompt tuning.** Any aesthetic adjustments (how strongly each adventurousness
  level develops, whether the model reaches for the bolder transforms often enough) wait
  on Steven's listening pass — those are findings, not blockers, per the checkpoint rules.
  Verification this session was OFFLINE only (no API key in the build context); the model's
  actual motif-placement choices are exactly what the human checkpoint evaluates.
- **`deriveSectionRelationships` vs. curated metadata for ABAB-style returns.** The
  label-pattern fallback marks a returned home section after a contrast as a `reprise`,
  whereas forms.json marks ABAB's mid-stream A2 a `repetition`. This only affects the
  FALLBACK path (non-library forms / count mismatch) — the 12 library forms use the
  curated metadata — and even the stricter reading is musically defensible (it would just
  ask A2 to reuse A1's motif, which an "A" return should anyway). Documented; revisit only
  if a non-library form needs the finer distinction.
- **`params` semantics validated but not deeply specified to the model.** The prompt
  describes `invert {pivot}`, `transpose_third {direction}`, etc.; the validator checks the
  transform name + that `params` is an object. If the model supplies an unsupported param
  key, Stage 6's transform reads only the keys it knows (or uses its default). Tighten if
  it matters.
- **Anomaly-budget enforcement** (buildplan §7.1) is still untouched — the wild knob asks
  for "exactly one" striking section in prose but nothing counts ornament_chromatic_passing
  usage against `anomaly_budget_per_section`. That accounting is a later concern (it spans
  Stage 4 motifs + Stage 3 harmony too).

**Notes for next session (Session 10 — Stage 4 motivic material):**
- Mimic this stage's structure exactly (it is now the second worked example of the LLM-
  stage template, alongside 5b): a pure `build<Stage>Prompt({…}) → { system, user }`; a
  `validate<Output>(…) → { ok, errors }` collecting ALL defects and reusing
  `computeSectionPlan`/theory libraries for ground truth; a `generate<Output>({ …,
  __mockResponse, onTrace })` with the offline fallback + one-shot validate-then-retry;
  model pinned to `claude-sonnet-4-20250514`; wrapped LLM envelope unwrapped to the flat
  inter-stage shape.
- Stage 4 generates the MOTIFS that Stage 5a places. In `runPipelineGenerating` it slots
  in BEFORE Stage 5a (motifs → phrase plan → texture plan), following the same "generate
  if absent" pattern. It will need its own mock channel (e.g. `__mockMotifsResponse`).
  `validateMotif` already exists in theory/motif.js — Stage 4's validator should lean on it
  for the per-motif shape and add the schema/degree-range/leap-budget/anomaly-budget checks.
- The motif-playground (Session 3) is the visualization the buildplan asks Stage 4's
  inspector panel to reuse.
- `verify-stage5a.mjs` runs with the throwaway-package.json dance like the others.

**HUMAN CHECKPOINT — NOT YET RUN (substantial — the melodic-creativity pressure point).**
The session is NOT closed until Steven completes the listening pass: open the inspector,
run "Wanderer's Path — fully generated" (live LLM for BOTH Stage 5a and 5b), A/B it against
the hand-supplied Wanderer's and the Stage-5b-only-generated Wanderer's from Session 8,
exercise the phrase_adventurousness knob (tame/adventurous/wild — confirm wild produces
ornaments/retrogrades the others don't), and read the generated PhrasePlan in the Stage-5a
panel for compositional intent (a B with a retrograde/inversion, a reprise that brings A's
motif back varied). His verdict and any findings get appended here afterward. Per the
checkpoint rules: validation failures / ill-formed plans are fix-now items; aesthetic
surprises are future prompt-tuning findings, not blockers — UNLESS a surprise is musically
wrong (e.g. a motivic transform stranded on a cadence bar Stage 8 will overwrite, which
rule (e) is built to catch).

**Verdict: Session 9 implementation complete; all nine verifiers pass offline (the eight
prior + verify-stage5a), the second LLM stage is wired end-to-end with strict schema +
music-theory validation, a one-shot retry, a deterministic offline fallback, and the
phrase_adventurousness freedom knob. The session closes after Steven's listening pass
confirms the LLM phrase stage produces audibly different motivic development than the
hand-supplied baseline. Do NOT start Session 10 automatically.**

### Checkpoint findings (2026-05-21, mid-pass — Steven's listening notes)

Steven ran "Wanderer's Path — fully generated" live and raised three observations. None
is a Stage-5a bug (a representative generated PhrasePlan validated clean and read as
compositional — B developed via `retrograde` + an inverted motif `a` + `fragment_head`;
A' reprised `a` ornamented/fragmented and wove in `b`; every cadenced final bar correctly
held the reserved `cadential_gesture`). The findings split into two scope categories and
one in-scope fix:

1. **"The opening A section barely changes run-to-run."** Correct, and expected. A is
   generated by Stage 5a, but (i) it is the *exposition* — the prompt's only "must"
   pressures are on B (develop) and A' (reprise), so the model rightly states the theme
   plainly there — and (ii) the melodic DNA itself (the motif degrees) is still
   hand-supplied; motif *shape* generation is Stage 4 (Session 10) and the harmony A sits
   over is Stage 3 (Session 11). A literal statement of a fixed motif over a fixed
   progression is invariant by construction. The freshness of the *opening idea itself*
   lives in the not-yet-built upstream stages, exactly as Steven intuited. NOT a defect.

2. **"Cadences feel painted over and manifest identically every time."** Correct, and a
   genuine aesthetic limitation — but it is Stage 8 (Session 5), not Stage 5a. Confirmed:
   the authentic-style formulas (PAC/IAC/plagal/modal_iv_i/phrygian_ii_i) overwrite the
   WHOLE final bar with a two-chord block, and the lead/harmony/bass degree pairs +
   octaves are hardcoded constants — so two `modal_iv_i` cadences in the same key (e.g.
   Wanderer's A and A') are byte-identical, and the melody hard-stops for the entire
   final bar. Stage 5a's rule (e) *reserves* that bar precisely because Stage 8 paints
   over it. **Steven's design intent (captured for the fix):** a cadence should be
   predetermined in the *abstract* sense (the cadence TYPE is fixed, like the rest of the
   Roman-numeral progression), but its *manifestation* — voicing, melodic resolution,
   how much of the bar it claims — should NOT be the same notes every time; the melody
   should flow into it rather than be replaced by a static block. This is a Stage 8
   revision (a Session-5 deliverable), tracked as its own focused piece of work — see the
   open question below. Touches the buildplan's "cadence enforcement is non-negotiable"
   stance: the enforcement (the harmonic resolution lands) stays non-negotiable; only the
   realization gains variety + melodic continuity.

3. **`phrase_structure` was ill-fitting and inert — FIXED (option a).** The model was
   labeling 4-bar sections `sentence`/`hybrid`, which are 8-bar (2+2+4) structures, and
   nothing in the realization consumes `phrase_structure` anyway (it is read only as a
   hint inside the Stage-5b texture prompt). The vocabulary descriptions now express each
   structure's SHAPE as proportions (a 1:1 or 1:1:2 split) rather than fixed bar counts,
   with an instruction that they scale to the section's length (a 4-bar period is 2+2),
   so the model picks a structure that *fits* the section instead of being forced into an
   8-bar label. This is a prompt-quality fix only — it does NOT make `phrase_structure`
   audible. Actually *realizing* phrase structure (sub-phrase cadence placement) remains
   deferred; `phrase_structure` stays a high-level hint until a stage owns its realization.

### Cadence-manifestation revision (2026-05-21) — Stage 8, post-checkpoint

Steven chose option (A): the melody flows into the cadence AND the voicing varies by
context. Implemented as a Stage 8 (Session-5) revision — the cadence TYPE per section
stays fixed and the harmonic resolution still lands (enforcement is still
non-negotiable); only the *manifestation* changed. Three coupled edits:

1. **Cadences overwrite only the final TWO BEATS** (`cadence-formulas.js`). Previously the
   authentic-style cadences (PAC/IAC/plagal/modal_iv_i/phrygian_ii_i) overwrote the WHOLE
   final bar with an approach→resolution block, hard-stopping the melody; half/deceptive
   already used two beats. Now ALL seven use the final-two-beats window, so the first part
   of the final bar keeps the lead's motif + the harmony/bass texture, which play INTO the
   cadence. `stage-8-cadence.js` needed no change — the splice window auto-narrows from the
   formulas' beats. The 7 formulas were refactored to a single `cadence(macroParams,
   section, voiceTracks, spec)` builder where `spec` names the per-voice
   [approach, resolution] degrees/chords (identical degree specs to before, so the cadence
   identities are unchanged).

2. **Register follows the approaching melody** (`cadence-formulas.js`). The lead resolution
   (and harmony, one octave below it) is voiced in the octave NEAREST the last lead pitch
   sounding before the cadence window (`approachLeadPitch` + `octaveNearestMidi`, bounded
   to ±1 octave around the register centre), instead of always snapping to the register
   centre. So the resolution continues from where the line was — no teleport — and cadences
   in different registers differ (verified: in Wanderer's, B's plagal followed the line up
   to octave 6 while A/A''s modal_iv_i stayed at octave 5). When there is no approaching
   lead pitch (a section opening on the cadence, or a formula called in isolation) it falls
   back to the register-centre octave — the pre-revision voicing, which is why
   verify-stage8's pure-formula anchors keep their pitches (only their beats moved to the
   final two beats).

3. **Stage 5a rule (e) relaxed** (`stage-5a-phrase.js`). The Session-9 rule "a cadenced
   section's final bar MUST be cadential_gesture" existed only because Stage 8 used to wipe
   the whole bar. Now that Stage 8 claims only the final two beats, a motif on the final bar
   leads INTO the cadence (its tail resolves) and is the PREFERRED, more-melodic choice —
   so the rule is removed, the prompt now steers toward leading a motif in (with
   cadential_gesture as an optional "rest into the cadence"), and `validatePhrasePlan` drops
   its (now-unused) 4th harmonicPlan argument. cadential_gesture stays a valid recognized
   transform.

**Honest limit (a finding for the listening pass).** For two same-type cadences whose
approaching melodies sit in the SAME register (e.g. Wanderer's hand-supplied A and A', both
modal_iv_i ending near octave 5), the two-beat resolution gesture itself is still identical
(G5→F5) — that descent IS the cadence type's identity, and identical contexts yield
identical cadences (which is what "predetermined in the abstract sense" implies). What
differs is the lead-IN (each section's motif now flows in differently) and the register
(when the melody sits elsewhere). For the FULLY-GENERATED case, Stage 5a gives A and A'
different motif placements, so their final bars differ audibly via the lead-ins. If Steven
finds same-register same-type cadences still too alike by ear, the next lever is varying the
resolution gesture itself (approach-tone side / inner-voice / rhythm) — deferred pending his
listen, since it risks eroding each cadence's characteristic sound.

**Verification.** verify-stage8 updated (final-two-beats timing on the seven pure-formula
anchors; the splice test now checks the PAC resolves to the tonic C in any octave AND that
lead material survives in the final bar before the cadence window — the flow-in). verify-
stage5a updated (the old cadence-bar rejection is replaced by a positive test: a motif
leading into a cadenced final bar validates OK; the 4th validator arg dropped). All nine
verifiers PASS offline. Steven evaluates the Stage-5a phrase work and this Stage-8 cadence
revision together in the (still-open) human checkpoint.