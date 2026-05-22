# eki-melo Composition Engine Buildplan

> Canonical plan for rebuilding the jingle composition pipeline as a typed,
> multi-stage system with deterministic music-theory machinery and
> LLM-driven creative decisions at well-scoped seams.
>
> This is a one-off project artifact — *not* an invocation of the
> claude-workflow metarepo's sprint-planning protocol. The project
> instructions explicitly scope out sprint planning, tier-3 reviews,
> adversarial review, structured close-outs, etc. We're using just enough
> planning structure to keep a 12-session build coherent across Claude
> Code contexts.
>
> Companion artifact: `docs/buildplan-journal.md` (created in Session 1,
> appended to between every session).

---

## 1. What we're building and why

The current jingle generator is a thin pipeline: name + description →
LLM prompt → JSON of `[pitch, duration]` events → Web Audio synth. The
LLM does all compositional work; the code is a chiptune synthesizer. This
produces inconsistent results because the LLM is asked to simultaneously
do soft semantic work (interpret a personality) and hard rule-following
(voice leading, cadence resolution, range adherence, motivic development).

The new architecture splits these jobs by skill. The LLM handles **soft
semantic and creative decisions** at well-scoped stages (aesthetic
interpretation, motif shape design, harmonic planning, texture choreography).
Deterministic JS handles **hard rule-following** (pitch realization, voice
leading, cadence enforcement). Bad compositional outputs are made
unrepresentable by the schemas at the stage boundaries — not caught by a
validator after the fact.

Spontaneity survives via three mechanisms: per-stage **freedom knobs** that
control how tight the constraints are, **anomaly slots** that let the LLM
declare one explicit rule-breaker per motif or section, and the LLM still
doing all the high-level creative choices within constrained vocabularies.

### The pipeline

```
GuestInput            (name + description, free text)
   ↓ Stage 1: Aesthetic Interpretation           [LLM, strict schema]
AestheticBrief        (energy/warmth/gravitas/pace + archetype + notes)
   ↓ Stage 2: Macro Parameters                   [rule-driven, optional LLM tiebreak]
MacroParams           (tempo, meter, tonic, mode, form, total_bars, etc.)
   ↓ Stage 3: Harmonic Plan                      [LLM under Roman-numeral grammar]
HarmonicPlan          (per-section progression + cadence type)
   ↓ Stage 4: Motivic Material                   [LLM under degree-scoped schema]
Motifs                (2–3 motifs in scale degrees + rhythm + contour)
   ↓ Stage 5a: Phrase Structure & Motif Placement [LLM]
PhrasePlan            (per-section: phrase form + motif assignments by bar)
   ↓ Stage 5b: Texture Choreography              [LLM]
TexturePlan           (per-bar harmony texture + bass pattern)
   ↓ Stage 6: Voice Realization                  [deterministic]
VoiceTracks           (lead/harmony/bass realized in current mode)
   ↓ Stage 7: Voice-Leading Pass                 [deterministic, configurable rules]
ValidatedTracks
   ↓ Stage 8: Cadence Enforcement                [deterministic overwrite]
FinalJingle           (the JSON shape the existing synth already consumes)
```

10 stages, 4 LLM calls, 4 deterministic stages, 2 rule-driven stages with
optional LLM tiebreak.

### Coexistence with current system

During Sessions 1–11, the new pipeline is built **alongside** the existing
`js/jingle/api.js` + `js/jingle/composition.js` system. The current
generator keeps working throughout the build. Session 12 wires the
front-end to the new pipeline and demotes the old call path to a fallback
(kept for one release, then removed).

---

## 2. File layout

New code lives under `js/jingle/theory/` (data + music-theory libraries)
and `js/jingle/pipeline/` (stage implementations).

```
js/jingle/
├── api.js                          [existing — replaced in Session 12]
├── composition.js                  [existing — replaced in Session 12]
├── render.js                       [existing — unchanged]
├── synth.js                        [existing — unchanged]
├── theory/
│   ├── scales.json                 [Session 1]
│   ├── mode-engine.js              [Session 1]
│   ├── forms.json                  [Session 2]
│   ├── phrase-structures.json      [Session 2]
│   ├── form-engine.js              [Session 2]
│   ├── motif.js                    [Session 3]
│   ├── transformations.js          [Session 3]
│   ├── textures.js                 [Session 6]
│   ├── bass-patterns.js            [Session 4]
│   ├── roman-numeral.js            [Session 5]
│   ├── cadence-formulas.js         [Session 5]
│   └── voice-leading-rules.js      [Session 7]
├── pipeline/
│   ├── stage-1-aesthetic.js        [Session 12]
│   ├── stage-2-macro.js            [Session 12]
│   ├── stage-3-harmony.js          [Session 11]
│   ├── stage-4-motifs.js           [Session 10]
│   ├── stage-5a-phrase.js          [Session 9]
│   ├── stage-5b-texture.js         [Session 8]
│   ├── stage-6-voice.js            [Session 4]
│   ├── stage-7-leading.js          [Session 7]
│   ├── stage-8-cadence.js          [Session 5]
│   ├── pipeline-runner.js          [Session 4, expanded each session]
│   └── pipeline-config.js          [Session 4 — freedom knobs]
└── debug/
    ├── pipeline-inspector.html     [Session 4 — debug UI]
    └── texture-demo.html           [Session 6 — audition harness]
```

`docs/` gains:
```
docs/
├── composition-engine-buildplan.md   [this file]
├── buildplan-journal.md              [Session 1 — appended each session]
└── architecture.md                   [existing — updated in Session 12]
```

---

## 3. Cross-session contracts (JSON schemas at the seams)

These are the **stable interfaces** between stages. Any session that
produces or consumes one of these must conform exactly. If a session
needs to evolve a schema, that's a journal entry, not an ambush.

**Pitch representation (Session 1 amendment).** Inside the pipeline, a pitch
is a structured **Pitch object** carrying its full music-theoretic identity —
`{ letter, accidental, octave }` (see `js/jingle/theory/pitch.js`). This is
the inter-stage currency wherever a concrete pitch is passed (Stage 6's voice
realization and everything it feeds). Rendering to a string happens only at
output boundaries: `toScoreString(pitch)` for theoretical notation (a Cb stays
a Cb), and `toSynthString(pitch, preference)` for the synth's
single-accidental alphabet. The pitch *strings* shown in the schemas below
(`"D5"`, `"C5"`, `[pitch, duration]` pairs) are the **synth-facing
rendering** — what `toSynthString` emits at the Stage 6 → synth boundary, and
what the existing `synth.js` consumes — not the internal representation.

### GuestInput
```json
{
  "name": "string",
  "description": "string"
}
```

### AestheticBrief
```json
{
  "energy":    1-10,
  "warmth":    1-10,
  "gravitas":  1-10,
  "pace":      1-10,
  "archetype": "heroic|melancholic|mischievous|regal|pastoral|whimsical|mysterious|fierce|tender|stoic",
  "character_notes": "string — free text for anything the structured fields didn't capture"
}
```

### MacroParams
```json
{
  "tempo": 120,
  "meter": { "numerator": 4, "denominator": 4, "grouping": [4] },
  "tonic": "D",
  "mode":  "dorian",
  "form":  "AABA",
  "section_proportions": [0.25, 0.25, 0.25, 0.25],
  "phrase_structures":   ["period", "period", "sentence", "period"],
  "total_bars": 16,
  "harmonic_rhythm": [1, 1, 1, 1],
  "swing": 0.0,
  "register_center": "C5"
}
```

Grouping for compound: `{4,4,[4]}` straight, `{6,8,[3,3]}` compound,
`{7,8,[2,2,3]}` asymmetric. `harmonic_rhythm` is chords-per-bar.

### HarmonicPlan
```json
{
  "sections": [
    {
      "label": "A1",
      "progression": ["i", "i", "VII", "v", "iv", "i", "v", "i"],
      "cadence": "modal_iv_i",
      "anomaly": null
    }
  ]
}
```

Cadence vocabulary: `PAC`, `IAC`, `half`, `deceptive`, `plagal`,
`modal_iv_i`, `phrygian_ii_i`. Roman numerals validated against active
mode in `roman-numeral.js` — invalid chords for the mode are rejected at
the schema boundary unless `allow_modal_interchange` is set.

### Motifs
```json
{
  "a": {
    "degrees": [1, 3, 5, 4],
    "rhythm":  [0.5, 0.5, 1, 0.5],
    "contour": "rising_arc",
    "register": "mid",
    "anomaly": null
  },
  "b": {
    "degrees": [5, 6, 7, 1, 7, 5],
    "rhythm":  [0.25, 0.25, 0.5, 0.5, 0.25, 0.25],
    "contour": "peak_descend",
    "register": "high",
    "anomaly": { "type": "chromatic_neighbor", "at_position": 2 }
  }
}
```

Degrees: 1–7 with optional `+8`/`-8` octave displacement (so `[1, 3, 5, +8]`
is C–E–G–C-up-an-octave). Negative degrees allowed (`-3` is the 3rd below
tonic). Rhythm in beats with the meter's beat unit. Anomaly is a structured
violation (chromatic neighbor, leap-larger-than-max, register escape) the
LLM declares explicitly.

### PhrasePlan
```json
{
  "A1": {
    "phrase_structure": "period",
    "lead": [
      { "motif": "a", "transform": "literal",           "start_bar": 1, "length_bars": 2 },
      { "motif": "a", "transform": "sequence_up_step",  "start_bar": 3, "length_bars": 2 },
      { "motif": "a", "transform": "fragment_tail",     "start_bar": 5, "length_bars": 2 },
      { "motif": null,"transform": "cadential_gesture", "start_bar": 7, "length_bars": 2 }
    ]
  }
}
```

### TexturePlan
```json
{
  "A1": {
    "harmony": [
      { "bars": [1, 2], "mode": "parallel_thirds_below" },
      { "bars": [3, 4], "mode": "imitation_one_beat_delay" },
      { "bars": [5, 6], "mode": "contrary_motion" },
      { "bars": [7, 8], "mode": "drone_on_5" }
    ],
    "bass": [
      { "bars": [1, 4], "pattern": "root_fifth" },
      { "bars": [5, 6], "pattern": "walking" },
      { "bars": [7, 8], "pattern": "cadential_5_1" }
    ]
  }
}
```

### VoiceTracks / ValidatedTracks / FinalJingle

All have the same shape as the current jingle JSON (lead/harmony/bass as
arrays of `[pitch, duration]` pairs, plus title/tempo/key/mood/form/sections
metadata). The existing `synth.js` consumes this unchanged. The `pitch`
strings here are produced by `toSynthString(pitch, preference)` (Session 1
amendment): Stage 6 works in Pitch objects throughout and renders to these
synth-safe strings only at this final boundary. A future score-export path
would render the same Pitch objects via `toScoreString` instead, with no
change upstream.

### PipelineConfig (freedom knobs)

```json
{
  "preset": "balanced",
  "knobs": {
    "max_leap_degrees": 5,
    "cadence_palette": ["PAC", "modal_iv_i", "half", "deceptive"],
    "allow_modal_interchange": false,
    "allow_secondary_dominants": false,
    "texture_change_rate": "medium",
    "voice_leading_strictness": "chiptune_idiomatic",
    "anomaly_budget_per_motif": 1,
    "anomaly_budget_per_section": 1,
    "scale_palette_filter": null
  }
}
```

Presets: `conservative`, `balanced`, `adventurous`, `wild`. Each sets a
bundle of knobs. Individual knobs override the preset.

---

## 4. Data library specifications

### Scale library (Session 1)

`js/jingle/theory/scales.json` — a flat dictionary of scale name →
`{intervals, family, tags, characteristic_intervals, common_progressions}`.

**Coverage target:** ~30–40 scales at launch.
- All 7 diatonic modes
- All 7 modes of harmonic minor
- All 7 modes of melodic minor
- All 7 modes of harmonic major (and the parent)
- Double harmonic + its key modes (hungarian minor, oriental, etc.)
- Neapolitan major + minor
- Hungarian major, Romanian minor
- Pentatonics: major, minor, Japanese pentatonics (Hirajoshi, In, Yo, Iwato)
- Blues major + minor
- Whole-tone, both octatonic/diminished, augmented
- Bebop dominant + major + dorian

**Verification:** every interval pattern must be hand-cross-checked against
a reference (Wikipedia + a music theory textbook). Tags drive aesthetic
mapping in Stage 2, so they need to be deliberate, not bulk-generated. The
session prompt for Session 1 includes a verification checklist.

**Deferred:** melakarta (Indian), maqam (Arabic), pelog/slendro (Indonesian),
Enigmatic, Persian, and other regional/exotic scales. These can be added
later once the architecture is stable.

### Form library (Session 2)

`js/jingle/theory/forms.json` — a dictionary of form name →
`{section_count, section_labels, relationships, proportions_default,
proportions_alt, typical_total_bars, tags}`.

**Coverage target:** ~10 forms at launch.
- through_composed
- binary (AB)
- rounded_binary (AB-A')
- ternary (ABA)
- ternary_varied (ABA')
- AABA
- ABAB
- ABAC
- ABCA
- rondo (ABACA)
- arch (ABCBA)
- eki_mini (short AB or ABA' under 12 bars — idiomatic to the reference genre)

`phrase-structures.json` — a smaller dictionary:
- period (4+4 antecedent-consequent)
- sentence (2+2+4 presentation + continuation)
- phrase_group (4+4 independent)
- hybrid (2+2+4 variants)

### Texture vocabulary (Session 6)

`js/jingle/theory/textures.js` — texture is **code**, not data, because each
texture is a function `(leadEvents, currentChord, mode, params) → harmonyEvents`.

**Coverage target:** 8–10 textures at launch.
- `parallel_thirds_below` / `parallel_thirds_above`
- `parallel_sixths_below` / `parallel_sixths_above`
- `contrary_motion`
- `oblique_held` (harmony holds while lead moves)
- `drone_on_1` / `drone_on_5`
- `imitation_one_beat_delay`
- `voice_exchange` (harmony takes the melody this passage)
- `dropout` (harmony silent)
- `chord_tones_pulse` (harmony arpeggiates chord tones in steady rhythm)
- `heterophony` (harmony plays ornamented version of lead's melody)

**Audition checkpoint:** Session 6 builds the demo harness *before* Session 8
commits to using textures in the LLM pipeline. Steven listens, gives
feedback on the textures themselves. This is the only checkpoint where
human aesthetic judgment is explicitly required.

**Deferred to post-launch:** stretto, invertible counterpoint, hocket,
true 3-voice fugal imitation. These are achievable but raise the
complexity bar; defer until the core pipeline is stable.

### Cadence formulas (Session 5)

`js/jingle/theory/cadence-formulas.js` — each cadence is a function
`(meter, currentMode, currentTonic, lastBeats) → newLastBeats`.

- `PAC`: V→i in bass, ^2-^1 or ^7-^1 in lead, lead lands on ^1 on downbeat
- `IAC`: V→i but lead doesn't land on ^1 (lands on ^3 or ^5)
- `half`: ends on V chord, lead on ^2 or ^7
- `deceptive`: V→VI (or V→vi in major)
- `plagal`: IV→I (or iv→i in minor)
- `modal_iv_i`: characteristic modal cadence — IV→i in minor modes
- `phrygian_ii_i`: bII→i, the famous phrygian cadence

These **overwrite** the final 1–2 beats of each section, ignoring whatever
the upstream stages produced. Cadence enforcement is non-negotiable.

### Voice-leading rules (Session 7)

`js/jingle/theory/voice-leading-rules.js` — a configurable rule set with
two starting presets:
- `chiptune_idiomatic` (default): allow parallel fifths, allow parallel
  octaves on strong beats, forbid voice crossing, repair tritone outlines,
  snap out-of-mode to nearest in-mode unless anomaly-flagged.
- `cpp_strict`: forbid parallel perfects, forbid voice crossing, repair
  augmented intervals in melodic line, strict mode adherence.

Each rule is a function that scans the validated voice tracks and either
returns "OK" or returns a list of repair operations (octave displacement,
pitch substitution, etc.).

---

## 5. Session list

12 sessions. Each session sized for one Claude Code context window (~200–500
lines of new code + supporting data + tests). The prompts below are
paste-able verbatim into Claude Code with this buildplan available in the
session's project knowledge.

**Convention for every session prompt:**
- Reference this buildplan as canonical context
- State the goal and exit criteria
- List files to create/modify
- Quote the relevant schemas from §3
- Note any cross-session contracts to honor
- Specify deferred work (don't scope creep)

---

### Session 1 — Scale library + mode engine

**Goal:** A verified scale data file and a small JS module that can resolve
any scale name to its pitch set in any key.

**Files:**
- Create `js/jingle/theory/scales.json`
- Create `js/jingle/theory/mode-engine.js`
- Create `docs/buildplan-journal.md` (initial entry)

**Exit criteria:**
- 30+ scales in `scales.json`, every interval pattern verified against a
  reference (cite source in a comment or sidecar `scales-sources.md`)
- `mode-engine.js` exports `getScale(name)`, `pitchSetForScale(name, tonic)`,
  `degreeToPitch(name, tonic, degree, octave)`, `listScalesByTag(tag)`,
  and `listScalesByFamily(family)`
- Manual test: log the pitch set of every scale rooted on C, eyeball
  against reference; log degree-to-pitch resolution for a sample of
  modes in a sample of keys
- Journal entry: "Session 1 done. Scales covered: [list]. Deferred: [list].
  Notes: [anything unexpected]."

**Paste-able Claude Code prompt:**

```
You are implementing Session 1 of the eki-melo composition engine rebuild.
Read docs/composition-engine-buildplan.md first — it is the canonical
context for this work. This session: scale library + mode engine.

Create js/jingle/theory/scales.json containing at minimum:
- All 7 diatonic modes (major, dorian, phrygian, lydian, mixolydian,
  minor/aeolian, locrian)
- All 7 modes of harmonic minor (parent + locrian_n6, ionian_sharp5,
  dorian_sharp4, phrygian_dominant, lydian_sharp2, altered_dim)
- All 7 modes of melodic minor (parent + dorian_b2, lydian_aug,
  lydian_dom, mixolydian_b6, locrian_n2, altered)
- Harmonic major and at least 3 of its modes
- Double harmonic major + hungarian_minor + oriental
- Neapolitan major + minor
- Hungarian major, Romanian minor
- Major + minor pentatonic, hirajoshi, in_sen, yo_scale, iwato
- Blues major + minor
- Whole-tone, wh_diminished, hw_diminished, augmented
- Bebop dominant, bebop major, bebop dorian

Each scale entry has the shape:
{
  "intervals": [semitone steps that sum to 12 — e.g., major = [2,2,1,2,2,2,1]],
  "family": "diatonic|harmonic_minor|melodic_minor|harmonic_major|double_harmonic|
            neapolitan|hungarian|romanian|pentatonic|blues|symmetric|bebop",
  "tags": ["evocative", "tense", "bright", "exotic", ...] — descriptive tags
          for aesthetic mapping. Use deliberate tags, not bulk-generated.
  "characteristic_intervals": ["augmented_second_at_b3_3", ...],
  "common_progressions": ["i-bII-i", "i-bVII-VI-V", ...]
}

CRITICAL: every interval pattern must sum to 12 (octave) for 7-note scales,
or the appropriate total for pentatonic/hexatonic/octatonic scales. Verify
each pattern against Wikipedia or a music theory textbook. If you're not
certain about an exotic scale's interval pattern, OMIT IT rather than
guess — better to ship fewer correct scales than wrong ones.

Then create js/jingle/theory/mode-engine.js exporting:
- getScale(name) → the full scale data object
- pitchSetForScale(name, tonic) → array of pitch class names (e.g., for
  "dorian" rooted on D: ["D", "E", "F", "G", "A", "B", "C"])
- degreeToPitch(scaleName, tonic, degree, octave) → "D5" etc. Handles
  negative degrees (degree below tonic) and octave displacement
  (e.g., degree=+8 means tonic an octave above).
- listScalesByTag(tag) → array of scale names matching the tag
- listScalesByFamily(family) → array of scale names in the family

The pitch math uses A4 = 440 Hz, standard 12-TET, and matches the existing
noteToFreq in js/jingle/synth.js (don't break that — verify your
degreeToPitch outputs are pitch strings parseable by the existing function).

Also create docs/buildplan-journal.md with an initial entry:
"Session 1 — [date] — scales + mode engine. Coverage: [list]. Deferred: [list].
Notes: [any decisions or surprises]."

Do not touch any existing files in js/jingle/ other than reading them for
reference. Commit straight to main per project convention.

When done, write a session summary to the journal and stop. Do not start
Session 2.
```

---

### Session 2 — Form library + phrase structure library

**Goal:** Form and phrase-structure data, plus selection helpers.

**Files:**
- Create `js/jingle/theory/forms.json`
- Create `js/jingle/theory/phrase-structures.json`
- Create `js/jingle/theory/form-engine.js`
- Update `docs/buildplan-journal.md`

**Exit criteria:**
- 10 forms in `forms.json` with full relationship metadata
- 4 phrase structures in `phrase-structures.json`
- `form-engine.js` exports `getForm(name)`, `distributeBars(formName, totalBars, variant)`,
  `getSectionRelationships(formName)`, `getPhraseStructure(name)`,
  `listFormsByTag(tag)`
- Manual test: distribute 16 bars across AABA with default and alt
  proportions, log the result; verify section labels and relationships
  match the spec

**Paste-able Claude Code prompt:**

```
You are implementing Session 2 of the eki-melo composition engine rebuild.
Read docs/composition-engine-buildplan.md first. This session: form library
+ phrase structure library.

Create js/jingle/theory/forms.json with at least these forms:
- through_composed, binary, rounded_binary, ternary, ternary_varied,
  AABA, ABAB, ABAC, ABCA, rondo (ABACA), arch (ABCBA), eki_mini

Each form entry:
{
  "section_count": int,
  "section_labels": [string, ...],     // e.g., ["A1", "A2", "B", "A3"] for AABA
  "relationships": {
    "<label>": {
      "role": "exposition|repetition|contrast|reprise|development|episode|refrain",
      "of": "<other label>" or null,
      "variation": "minor|major|ornamented" or null,
      "contrast_from": "<other label>" or null
    }
  },
  "proportions_default": [float, ...]  // sums to 1.0, one entry per section
  "proportions_alt": [[float, ...], ...] // 2-3 alternative distributions
  "typical_total_bars": [min, max],
  "tags": ["balanced", "punchy", "expansive", "developmental", ...]
}

Create js/jingle/theory/phrase-structures.json with:
- period (4+4 antecedent + consequent, ends on half then PAC)
- sentence (2+2+4 presentation + repetition + continuation)
- phrase_group (4+4 independent phrases)
- hybrid (2+2+4 with contrasting basic ideas)

Each phrase-structure entry:
{
  "sub_phrases": [{"label": "antecedent", "length_bars": 4, "cadence_type": "half"}, ...],
  "default_motif_assignments": [...],   // suggested where motifs go
  "tags": ["balanced", "dynamic", "ambiguous", ...]
}

Then create js/jingle/theory/form-engine.js exporting:
- getForm(name)
- distributeBars(formName, totalBars, variantIndex=0) → array of integer
  bar counts per section, rounded sensibly so sections are even bar
  counts where possible
- getSectionRelationships(formName) → the relationships object
- getPhraseStructure(name)
- listFormsByTag(tag) → array of form names

Update docs/buildplan-journal.md with a Session 2 entry.

Do not touch any pipeline code or any existing js/jingle/ files. Commit
straight to main. When done, write the journal entry and stop. Do not
start Session 3.
```

---

### Session 3 — Motif representation + transformation library

**Goal:** Motif data structure, motif → events renderer (in scale degrees,
not pitches yet), and the transformation library.

**Files:**
- Create `js/jingle/theory/motif.js`
- Create `js/jingle/theory/transformations.js`
- Create `js/jingle/debug/motif-playground.html` (a minimal test page)
- Update `docs/buildplan-journal.md`

**Exit criteria:**
- `motif.js` exports `renderMotifToDegreeEvents(motif, startBeat)` →
  `[{degree, octave_offset, beat, duration}, ...]`
- `transformations.js` exports each transformation as a pure function
  `(motif, params) → motif`:
  `literal`, `transpose_step`, `transpose_third`, `sequence_up_step`,
  `sequence_down_step`, `invert` (around a pivot degree),
  `retrograde`, `augment_2x`, `diminute_2x`, `fragment_head`,
  `fragment_tail`, `ornament_upper_neighbor`, `ornament_lower_neighbor`,
  `ornament_chromatic_passing` (this one returns a motif with anomaly
  flagged)
- `motif-playground.html` is a standalone debug page that lets us pick a
  motif from a small library, apply a transformation, and see the result
  (degrees on a horizontal axis, not yet rendered to audio)
- Journal entry

**Paste-able Claude Code prompt:**

```
You are implementing Session 3 of the eki-melo composition engine rebuild.
Read docs/composition-engine-buildplan.md first. This session: motif
representation + transformation library.

Create js/jingle/theory/motif.js:

A motif is { degrees: number[], rhythm: number[], contour: string,
register: string, anomaly: object|null }. degrees are 1-7 with optional
+8 / -8 octave displacement, and negative numbers (e.g., -3 = 3rd below
tonic). rhythm is array of beat values matching degrees in length.

Export:
- validateMotif(motif) → throws on malformed input
- renderMotifToDegreeEvents(motif, startBeat) → array of
  {degree, octave_offset, beat, duration} where degree is 1-7, octave_offset
  is the net octave (handling +8/-8 in input), beat is absolute start beat,
  duration is in beats.
- motifTotalBeats(motif) → sum of rhythm
- motifContour(motif) → "rising_arc", "falling_arc", "peak_descend",
  "valley_ascend", "static", "wandering" — derived from the degree sequence

Create js/jingle/theory/transformations.js:

Each transformation is a pure function (motif, params) → motif. The motif
is in scale degrees, so transformations stay in degree space (not pitch
space). Transformations to implement:

- literal(motif) — identity
- transpose_step(motif, {steps}) — adds steps to every degree, modulo 7
  with octave bookkeeping (e.g., degree 7 + 1 step = degree 1 with +8)
- transpose_third(motif, {direction}) — adds 2 scale steps
- sequence_up_step(motif) — alias for transpose_step({steps: 1})
- sequence_down_step(motif) — alias for transpose_step({steps: -1})
- invert(motif, {pivot}) — reflects each degree around pivot
  (degree' = 2*pivot - degree). Default pivot = motif[0].
- retrograde(motif) — reverses degrees AND rhythm
- augment_2x(motif) — doubles every rhythm value
- diminute_2x(motif) — halves every rhythm value
- fragment_head(motif, {count}) — first N notes only, count defaults to half
- fragment_tail(motif, {count}) — last N notes only
- ornament_upper_neighbor(motif, {at_position}) — inserts the scale step
  above the note at the position, splitting that note's rhythm in half
- ornament_lower_neighbor(motif, {at_position}) — symmetric
- ornament_chromatic_passing(motif, {at_position}) — inserts a chromatic
  step between two notes; returns motif with anomaly:
  {type: "chromatic_neighbor", at_position}

CRITICAL: transformations preserve motif structure. The rhythm array must
remain consistent with the degrees array length (except for augment/diminute
which scale rhythm uniformly, ornaments which add a note, and fragment
which removes notes).

Create js/jingle/debug/motif-playground.html — a standalone HTML file that:
- Imports motif.js and transformations.js as ES modules
- Has a small library of 3-4 hand-written motifs
- Lets the user pick a motif and a transformation (with params), see the
  resulting degree sequence visualized on a simple grid (horizontal = beat,
  vertical = degree, with the +8/-8 octave markers shown)
- Does NOT play audio yet — pitch realization is Session 4. This page is
  for visual verification only.

Update docs/buildplan-journal.md. Commit straight to main. Stop after
Session 3.
```

---

### Session 4 — Stage 6 (voice realization) + pipeline runner + first audio

**Goal:** Render hand-written plans to audible chiptune output. End-to-end
sound by end of session.

**Files:**
- Create `js/jingle/theory/bass-patterns.js`
- Create `js/jingle/pipeline/stage-6-voice.js`
- Create `js/jingle/pipeline/pipeline-runner.js`
- Create `js/jingle/pipeline/pipeline-config.js`
- Create `js/jingle/debug/pipeline-inspector.html`
- Update `docs/buildplan-journal.md`

**Exit criteria:**
- `stage-6-voice.js` exports `realizeVoices(macroParams, motifs, phrasePlan, texturePlan, harmonicPlan)` → `VoiceTracks`
- `bass-patterns.js` exports `root_fifth`, `walking`, `pedal`, `arpeggio`,
  `cadential_5_1`
- The pipeline-runner runs Stages 6→7→8 (with 7 and 8 as identity passes
  for now) against hand-written upstream inputs and produces a `FinalJingle`
- The pipeline-inspector page lets us pick from 2-3 hand-written test
  cases, run the pipeline, see each stage's output, and PLAY the result
  through the existing synth
- **Steven listens to at least 2 hand-written test cases by end of session
  and confirms they sound roughly composed**

**Paste-able Claude Code prompt:**

```
You are implementing Session 4 of the eki-melo composition engine rebuild.
Read docs/composition-engine-buildplan.md first. This session: voice
realization (Stage 6), bass patterns, pipeline runner skeleton, and a
debug page that plays the result. By end of session, we hear chiptune.

Create js/jingle/theory/bass-patterns.js exporting:
Each pattern is a function (chordRoman, mode, tonic, meter, barCount) →
array of [pitch, duration] events covering the bars.

- root_fifth: root on beats 1 and 3, fifth on beats 2 and 4 (4/4); adapt
  for 3/4 and 6/8
- walking: root, scalar step toward next chord, fifth, scalar step toward
  next chord (4/4 quarter notes)
- pedal: hold a single pitch for the duration (which pitch determined by
  params: degree 1 or degree 5)
- arpeggio: 1-3-5-3 in eighths (4/4), adapt for other meters
- cadential_5_1: V-i bass motion in the last bar, regardless of input
  (this is for cadence approach — Session 5 will refine this)

Create js/jingle/pipeline/stage-6-voice.js exporting realizeVoices.
Signature: realizeVoices({macroParams, motifs, harmonicPlan, phrasePlan,
texturePlan, config}) → VoiceTracks ({ lead, harmony, bass } arrays of
[pitch, duration] pairs).

Algorithm:
1. For each section in phrasePlan: walk the lead assignments. For each
   {motif, transform, start_bar, length_bars}: apply transform to motif,
   render to degree events, then convert degrees to pitches using
   mode-engine's degreeToPitch with the section's tonic/mode.
2. For each section in texturePlan: walk the harmony assignments. For each
   {bars, mode}: read the lead events in that bar range and apply the
   texture function. For Session 4, only implement parallel_thirds_below
   as a placeholder — the full texture vocabulary is Session 6.
3. For each section in texturePlan: walk the bass assignments. For each
   {bars, pattern}: look up the chord in that bar from harmonicPlan,
   resolve Roman numeral to chord root (use a stub roman-numeral resolver
   inline — Session 5 will replace with the proper one), call the bass
   pattern function.

Create js/jingle/pipeline/pipeline-config.js exporting DEFAULT_CONFIG with
the PipelineConfig shape from buildplan §3.

Create js/jingle/pipeline/pipeline-runner.js exporting runPipeline(input,
config). For Session 4, the input is a complete hand-written
{macroParams, motifs, harmonicPlan, phrasePlan, texturePlan}. Stages 7 and
8 are identity passes (write them as TODO stubs that return their input
unchanged). The runner returns FinalJingle.

Create js/jingle/debug/pipeline-inspector.html — a debug page with:
- A dropdown of 2-3 hand-written test cases (define these inline in the
  HTML or in a sidecar JS file — make at least one in major and one in
  a minor mode)
- A "Run Pipeline" button
- Each stage's output displayed (JSON, scrollable)
- A "Play" button that hands the FinalJingle to the existing
  LiveSynth from js/jingle/synth.js
- The existing piano-roll renderer from js/jingle/render.js displaying
  the result

IMPORTANT: Do NOT modify any existing files in js/jingle/ (api.js,
composition.js, render.js, synth.js, etc). Import from them as needed.
The existing system must continue working.

Update docs/buildplan-journal.md. Commit straight to main. Stop after
Session 4.
```

---

### Session 5 — Stage 8 (cadence enforcement) + Roman numeral resolver

**Goal:** Mode-aware Roman-numeral resolution and proper cadence formulas
overwriting the final beats of each section.

**Files:**
- Create `js/jingle/theory/roman-numeral.js`
- Create `js/jingle/theory/cadence-formulas.js`
- Update `js/jingle/pipeline/stage-8-cadence.js` (replace stub from S4)
- Update `js/jingle/pipeline/stage-6-voice.js` (use the real resolver)
- Update the inspector and journal

**Exit criteria:**
- `roman-numeral.js` exports `resolveRoman(romanString, mode, tonic)` →
  `{root, quality, members}` where members are pitch class names
- Validates: lowercase = minor quality, uppercase = major, diminished
  marker (°), augmented (+), seventh chord (7), etc. Rejects invalid
  chords for the mode unless config allows.
- `cadence-formulas.js` exports each cadence as a function
  `(meter, mode, tonic, lastBeatsRange) → newLastBeats` for each voice
- `stage-8-cadence.js` overwrites the last 1-2 beats of each section
  per the section's cadence type
- Audible test: re-run the hand-written cases from S4, every section now
  resolves to a proper cadence
- Journal entry

**Paste-able Claude Code prompt:**

```
You are implementing Session 5 of the eki-melo composition engine rebuild.
Read docs/composition-engine-buildplan.md first. This session: Roman
numeral resolver + cadence formulas + Stage 8.

Create js/jingle/theory/roman-numeral.js exporting:
- resolveRoman(romanString, mode, tonic) → {root: pitch_class,
  quality: "major"|"minor"|"diminished"|"augmented"|"major7"|"minor7"|
  "dominant7"|"halfdim7"|"dim7", members: [pitch_class, ...]}
- isValidInMode(romanString, mode) → boolean
- listAvailableChords(mode) → array of canonical Roman strings for the mode

Parsing rules:
- Uppercase letter (I, II, III, IV, V, VI, VII) = major triad on that degree
- Lowercase (i, ii, iii, etc.) = minor triad
- ° suffix = diminished, + suffix = augmented
- 7 suffix = seventh chord (quality determined by base — V7 = dominant 7,
  i7 = minor 7, IM7 = major 7)
- bIII, #IV, etc. = chromatic alteration of the scale degree

Diatonic chord qualities derive from the active mode (using the scale
library). For example, in dorian: i (minor), ii (minor), III (major),
IV (major), v (minor), vi° (diminished), VII (major). In phrygian
dominant: I (major), bII (major), iii° (diminished), iv (minor),
v° (diminished), bVI (major), bvii (minor).

Create js/jingle/theory/cadence-formulas.js with one exported function per
cadence type. Each function takes (meter, mode, tonic, sectionEvents)
and returns the modified events for the final 1-2 bars only (or final
beats for shorter sections):

- PAC(...) → V→i in bass, lead resolves ^2-^1 or ^7-^1 landing on ^1 on
  the downbeat of the final bar
- IAC(...) → V→i but lead lands on ^3 or ^5
- half(...) → ends on V, lead on ^2 or ^7
- deceptive(...) → V→VI (or vi in major)
- plagal(...) → IV→I (or iv→i in minor)
- modal_iv_i(...) → iv→i with characteristic modal inflection
- phrygian_ii_i(...) → bII→i, characteristic phrygian half-step approach

Replace the Stage 8 stub in js/jingle/pipeline/stage-8-cadence.js with:
- Walk the harmonicPlan's sections
- For each section, look up the cadence type and call the matching
  formula function
- Overwrite the final beats of lead, harmony, and bass with the formula's
  output (don't touch the rest of the section)

Update Stage 6 (js/jingle/pipeline/stage-6-voice.js) to use the new
roman-numeral resolver instead of the stub. Bass patterns now get the
real chord root from resolveRoman.

Add at least one phrygian-dominant test case to the pipeline inspector
so we can hear the phrygian_ii_i cadence work correctly.

Update docs/buildplan-journal.md. Commit straight to main. Stop after
Session 5.
```

---

### Session 6 — Texture vocabulary + audition harness 🎧 audible checkpoint

**Goal:** Build out the texture vocabulary AND a demo page where Steven
auditions each texture against a fixed motif. This is the one session
where Steven's ear is explicitly the gate.

**Files:**
- Create `js/jingle/theory/textures.js`
- Create `js/jingle/debug/texture-demo.html`
- Update `js/jingle/pipeline/stage-6-voice.js` (use the full texture library)
- Update the journal

**Exit criteria:**
- 10+ textures implemented as pure functions
- `texture-demo.html` lets Steven pick a motif (4-5 hand-written motifs in
  different modes) and audition each texture against it in isolation
- Steven listens through every texture and gives a thumbs-up or notes
  per-texture; notes captured in the journal
- Stage 6 uses any texture from the library via the TexturePlan spec
- Journal entry with Steven's per-texture notes

**Paste-able Claude Code prompt:**

```
You are implementing Session 6 of the eki-melo composition engine rebuild.
Read docs/composition-engine-buildplan.md first. This session: texture
vocabulary + audition harness.

Create js/jingle/theory/textures.js. Each texture is a pure function:
texture(leadEvents, currentChordsByBar, mode, tonic, meter, params) →
harmonyEvents (an array of [pitch, duration] pairs, with "rest" for silence).

The leadEvents are [pitch, duration] pairs in absolute time order.
currentChordsByBar is a map from bar index to {root, quality, members}
from the Roman numeral resolver. mode and tonic are strings. meter is
{numerator, denominator, grouping}. params is texture-specific.

Implement these textures:

- parallel_thirds_below: for each lead note, find the scale degree a third
  below (skip if rest), output a note of same duration. If the resulting
  pitch is outside C4-B5 range, octave-displace up.
- parallel_thirds_above: symmetric
- parallel_sixths_below: scale degree a sixth below
- parallel_sixths_above: symmetric
- contrary_motion: harmony moves opposite direction to lead. Start a third
  below lead's first note; each subsequent harmony note is a third above
  or below the previous harmony note in the direction OPPOSITE to lead's
  motion. Stay in mode.
- oblique_held: harmony holds a single pitch (the chord's root or fifth,
  determined by params.degree) for as long as lead moves; rearticulates
  on each bar boundary.
- drone_on_1 / drone_on_5: similar to oblique but locked to scale degree
  1 or 5 of the section's tonic (not the chord's root).
- imitation_one_beat_delay: harmony plays the lead's motif one beat
  later, transposed to fit the current chord (start on a chord tone).
  Where harmony would overlap with lead, harmony rests for the overlap.
- voice_exchange: this texture means harmony PLAYS THE LEAD'S NOTES for
  this passage, and Stage 6 must then generate a counter-line for the
  lead. For simplicity in S6: implement this as "harmony plays the lead
  events shifted down an octave, lead becomes a held pitch on the chord
  tone above." This is a placeholder; refine later.
- dropout: harmony plays all rests for the passage.
- chord_tones_pulse: harmony plays chord tones (root, third, fifth) in
  steady eighth notes for the passage, cycling through inversions.
- heterophony: harmony plays the lead's pitches but with twice the
  rhythmic density (each lead note becomes two notes — the original plus
  a passing or neighbor tone).

All textures respect the harmony voice range (C4-B5) via octave displacement.
None of them produces voice crossing (harmony ≤ lead at every instant) —
if a texture would cross, octave-displace harmony down.

Create js/jingle/debug/texture-demo.html — a single page where:
- Steven picks a motif from 4-5 hand-written examples in different modes
  (one major, one dorian, one harmonic minor, one phrygian dominant, one
  pentatonic)
- Steven picks a texture from a dropdown
- A "Play" button renders the motif in the chosen mode, applies the
  texture, and plays the result via LiveSynth
- The result is visible as a piano roll
- A "Play all textures" button cycles through every texture with the
  same motif for back-to-back comparison

Update stage-6-voice.js to dispatch texture mode names to the texture
library functions. Replace the placeholder parallel_thirds_below from S4.

THIS IS A HUMAN-IN-THE-LOOP CHECKPOINT. After implementation, Steven will
audition the textures. Capture his per-texture feedback in
docs/buildplan-journal.md under "Session 6 — texture audition notes". If
any texture sounds wrong, log it as deferred work; don't try to fix
aesthetic issues in this session.

Update docs/buildplan-journal.md. Commit straight to main. Stop after
Session 6.
```

---

### Session 7 — Stage 7 (voice-leading pass)

**Goal:** Configurable voice-leading rule set with repair operations.

**Files:**
- Create `js/jingle/theory/voice-leading-rules.js`
- Replace stub `js/jingle/pipeline/stage-7-leading.js`
- Update the inspector + journal

**Exit criteria:**
- Two rule presets work: `chiptune_idiomatic` and `cpp_strict`
- Repair operations: octave displacement for range violations, pitch
  substitution for parallel perfects (cpp_strict only), snap-to-mode for
  out-of-mode accidentals (unless anomaly-flagged)
- Inspector shows before/after VoiceTracks (any repairs visible)
- Journal entry

(Prompt template follows the pattern of S5/S6 — omitted here for brevity;
to be drafted at the time the session is kicked off, using the established
conventions from prior sessions.)

---

### Session 8 — Stage 5b (texture choreography, first LLM stage)

**Goal:** LLM call that generates a TexturePlan given upstream context.

**Files:**
- Create `js/jingle/pipeline/stage-5b-texture.js`
- Update the inspector to show LLM input/output
- Update the journal

**Exit criteria:**
- LLM call uses the existing `functions/api/generate.js` endpoint
- Strict schema validation on the LLM output
- Schema rejections retry once with the schema error fed back
- Inspector shows LLM prompt, raw response, parsed/validated TexturePlan
- Demo: feed a hand-written upstream, get an LLM-generated TexturePlan,
  hear the result
- Journal entry with notes on the texture choreography quality

---

### Session 9 — Stage 5a (phrase structure + motif placement)

**Goal:** LLM call that generates a PhrasePlan given motifs and macro params.

**Files:**
- Create `js/jingle/pipeline/stage-5a-phrase.js`
- Update the inspector + journal

**Exit criteria:**
- PhrasePlan output validates against schema
- Motivic development rules enforced post-LLM: B sections must contain at
  least one non-literal transformation; reprises must contain the A motif;
  no two adjacent sections may have identical transformation patterns.
  These are post-LLM rejections, not just prompt instructions.
- Demo: feed hand-written motifs + macro, get LLM PhrasePlan, hear result
- Journal entry

---

### Session 10 — Stage 4 (motivic material)

**Goal:** LLM generates motifs in degree notation.

**Files:**
- Create `js/jingle/pipeline/stage-4-motifs.js`
- Update inspector + journal

**Exit criteria:**
- Motifs validate against schema (degrees in range, rhythm matches length,
  total duration within limit, leap budget respected unless anomaly-flagged)
- 2-3 motifs per piece
- Inspector shows motif visualization (the playground from S3)
- Journal entry

---

### Session 11 — Stage 3 (harmonic plan)

**Goal:** LLM generates Roman numeral progressions per section.

**Files:**
- Create `js/jingle/pipeline/stage-3-harmony.js`
- Update inspector + journal

**Exit criteria:**
- HarmonicPlan validates: every Roman numeral is valid in the active mode
  (or modal interchange is allowed by config and the borrowed chord is
  flagged)
- Cadence type per section is from the allowed cadence_palette
- Demo: feed hand-written macro, get LLM HarmonicPlan, run full pipeline
  through, hear result
- Journal entry

---

### Session 12 — Stages 1 + 2 + full wire-up

**Goal:** Wire the front-end through the new pipeline end-to-end. Old
generator becomes a fallback.

**Files:**
- Create `js/jingle/pipeline/stage-1-aesthetic.js`
- Create `js/jingle/pipeline/stage-2-macro.js`
- Update `js/jingle/api.js` to use the new pipeline as primary
- Update `docs/architecture.md` with the new pipeline diagram
- Add DEC entry in `docs/decision-log.md`
- CHANGELOG entry
- Update journal with "build complete"

**Exit criteria:**
- Front-end input (name + description) flows through all 10 stages
- A fallback flag in pipeline-config.js can route to the old generator
  if the new one fails — fail open, not closed
- The existing UI still works: jingles get saved, played, exported as
  WAV, displayed on the piano roll
- DEC entry: "DEC-NNN: Composition engine rebuild to 10-stage pipeline"
- CHANGELOG entry under appropriate version
- Journal closing entry

---

## 6. Rolling journal protocol

`docs/buildplan-journal.md` is the shared state between sessions.

**Format:**

```markdown
# eki-melo Composition Engine Buildplan — Journal

## Session N — <date> — <one-line session title>

**What landed (commits):**
- abc1234: <message>
- def5678: <message>

**Exit criteria status:**
- [x] Criterion 1
- [x] Criterion 2
- [ ] Criterion 3 — deferred, see below

**Deferred:**
- <thing>: <why deferred, when to revisit>

**Notes for next session:**
- <anything Session N+1 needs to know>

**Surprises / decisions made:**
- <thing>: <what we decided and why>
```

**Workflow between sessions:**
1. Steven kicks off Session N in Claude Code with the paste-able prompt
   from this buildplan.
2. Claude Code executes, commits, pushes, updates the journal with its
   own session-N entry.
3. Steven returns to this Claude.ai conversation, pastes the commit log
   and any output Claude Code surfaced.
4. Claude (here) reads the commits, verifies against the session's exit
   criteria, flags any issues.
5. We update the journal with verification notes (the second voice on
   the session) and discuss anything for Session N+1.
6. Steven kicks off Session N+1.

The journal stays in the repo and is the source of truth for what happened.
This Claude.ai conversation is the discussion thread *around* the journal.

---

## 7. Decisions deferred / open questions

These don't block any session; flagging them for later attention:

1. **Anomaly budget enforcement.** The schema allows one anomaly per motif
   and one per section, but the enforcement story isn't fully worked out:
   what does the system do if the LLM declares more than budgeted? Reject
   the whole output and retry, or strip extras? Default: reject and retry
   with an error message. Revisit if retries are common.

2. **Texture transitions.** When texture changes mid-section (e.g., bars
   1-2 parallel thirds, bars 3-4 contrary motion), there's a transition
   beat where the harmony voice may jump. Should we smooth these? Default:
   no smoothing in Session 6; revisit if it sounds bad.

3. **Compound meter motif handling.** Motifs are specified in scale
   degrees and rhythm-in-beats. In 6/8, what's a "beat" — the dotted-quarter
   pulse or the eighth-note subdivision? Default: rhythm values are
   relative to the meter's denominator (so 0.5 in 6/8 is a sixteenth note,
   1.5 is a dotted quarter pulse). Revisit when the first 6/8 piece sounds
   wrong.

4. **Modal interchange across stages.** If Stage 3's config allows modal
   interchange and the LLM borrows bIII from parallel minor in a major
   piece, Stage 6 needs to use parallel-minor pitches for that bar.
   Mode-engine needs a `degreeToPitchInBorrowedMode` helper. Defer to
   whichever session first needs it (probably Stage 6's update in S11).

5. **Per-guest "adventurousness" UI control.** The front-end could expose
   a slider that sets the config preset. Out of scope for the build —
   add post-launch if it'd be fun.

6. **Listening test corpus.** Should we collect 10-20 reference jingles
   (current generator's output) as a baseline to compare against the new
   pipeline's output? Lightweight, useful for regression detection.
   Defer to Session 12 close-out.

7. **Phrase-length motifs (COMMITTED dedicated session — e.g. "10b").**
   Surfaced at the Session-10 human checkpoint. Today a motif is a MICRO cell
   (≤ 1 bar) and the macro melody is built by Stage 5a developing it; this is
   coherent and reliable but is plausibly the ceiling on *memorability* (v1's
   freely-authored longer melodies were more memorable). The recommendation is
   to let the LLM author longer melodic PHRASES — either (A) raise the motif
   length cap to be section-relative while keeping the cell+development model,
   or (B) make the motif the section's full phrase and shrink Stage 5a to
   arranging/varying phrases. Either needs a deterministic beat-length /
   overflow check in Stage 5a (which also fixes the hollow-reprise + per-bar-gap
   findings). Full design notes are in the Session-10 journal entry
   (2026-05-22). Steven's decision: do this as its own session with its own
   prompt, not folded into Session 10. The Session-10 pitch-range fix (motifs
   may now reach/exceed the octave) is the half that was done immediately.

   **Session-11 update (2026-05-22): COMMITTED as the next session.** The
   Session-11 checkpoint added a SECOND, independent reason beyond memorability:
   melody/HARMONY COHERENCE. Once Stage 3 generates richer, *moving* harmony
   (e.g. a 4-bar `I-vi-ii-V` instead of a 2-bar `I-V`), a single fixed cell can
   only fit the one bar it was written for and clashes on the rest — and no cheap
   patch closes it (a prompt steer leaks; a chord-fit guard either misses the
   non-gross cases or, tightened, rejects nearly every non-home placement and
   aborts runs). So richer harmony made coherence WORSE, confirming the
   cell+development model caps *both* memorability and coherence. Authoring the
   melody against the whole progression (framing B) fixes both at once. Steven
   committed to this as the next session in place of further coherence patching.
   The Session-11 chord-fit guard + harmony-aware Stage-5a prompt remain as the
   interim floor until then.

---

## 8. Conventions

- **Commits straight to main**, per project memory.
- **No new external JS libraries**, per project hard constraints. Pure
  vanilla JS, single-file `index.html`, ES modules.
- **API key stays server-side** — Stage 1, 3, 4, 5a, 5b all go through
  `functions/api/generate.js`. No direct anthropic.com calls in
  `index.html`.
- **The new pipeline must work in both contexts** (Claude.ai artifact
  runtime + deployed browser), per the storage/endpoint adapter
  constraint. Test in both before Session 12 closes.
- **Each session ends with a journal entry** by Claude Code. The
  Claude.ai-side review adds a second voice to the entry.
- **No scope creep**. Deferred work goes in the journal as a "deferred"
  note, not silently included.
