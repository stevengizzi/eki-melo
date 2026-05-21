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