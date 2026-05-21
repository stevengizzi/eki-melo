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