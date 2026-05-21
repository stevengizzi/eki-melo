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
