# Decision Log

> All architectural and process decisions, logged at the time they are made.
> Format: DEC-NNN entries.

---

**DEC-001:** Vanilla single-file HTML over React
**Date:** 2026-05-18
**Sprint:** Bootstrap

**Decision:**
Build the entire app as a single HTML file with inline CSS and vanilla JavaScript. No React, no build step, no bundler.

**Alternatives Rejected:**
1. React component artifact: Audio synthesis is inherently imperative — schedule notes, manage AudioContext lifecycle, hold oscillator references. React's lifecycle and re-render model fights against this. Hooks for audio always end up as `useRef` wrappers around what is essentially mutable state.
2. Vite + React + TypeScript: Overkill for a 1500-line single-page app with one user. The build step would add more friction than it removes.

**Rationale:**
The app is small enough that the UI re-render performance of `innerHTML = ...` is fine. Vanilla JS keeps the audio code natural and the file portable — you can `python -m http.server` and have it running. A single HTML file is also trivially shareable and serves as both the artifact-rendered version and the deployable version.

**Constraints:**
Solo project, no engineering team, target deployment is a static site.

**Cross-References:**
- Related decisions: DEC-002, DEC-007

---

**DEC-002:** Three-voice synthesis modeled on NES APU
**Date:** 2026-05-18
**Sprint:** Bootstrap

**Decision:**
Three Web Audio voices that map directly to NES Audio Processing Unit channels:
- **Lead:** 50% duty pulse wave (NES Pulse 1)
- **Harmony:** 25% duty pulse wave (NES Pulse 2)
- **Bass:** Triangle wave (NES Triangle channel)

ADSR envelope per note: 3ms attack, 40ms decay, 72% sustain, 80ms or 30%-of-duration release (whichever is shorter).

**Alternatives Rejected:**
1. Two voices (melody + bass): Loses the contrapuntal interest. A guest's "theme" should sound composed, not solo.
2. Four voices including NES noise channel for percussion: Considered. Skipped to keep prompt complexity bounded. Could add later if rhythmic backbone feels lacking after extended use.
3. Sample-based playback (SoundFont, real chiptune samples): Heavier, slower, and breaks the "synthesized live in browser" feel.

**Rationale:**
NES APU is the canonical chiptune sound. Three voices give enough room for melody + counterline + harmonic foundation without the complexity of a full DAW arrangement. The duty-cycle distinction between Pulse 1 and Pulse 2 provides timbral contrast — the harmony cuts through without muddying the lead.

**Constraints:**
Web Audio's stock waveforms don't include variable-duty pulse. Pulse synthesis requires `PeriodicWave` construction (see DEC-003).

**Cross-References:**
- Related decisions: DEC-003

---

**DEC-003:** Pulse waves via Fourier coefficients, not `osc.type='square'`
**Date:** 2026-05-18
**Sprint:** Bootstrap

**Decision:**
Generate pulse waves by constructing `PeriodicWave` objects from explicit Fourier coefficients, computed as `imag[i] = (2/(i*π)) * sin(i*π*duty)` for harmonics 1–31.

**Alternatives Rejected:**
1. `osc.type = 'square'`: Only produces 50% duty. No way to differentiate Pulse 1 from Pulse 2 — both voices end up sounding identical.
2. Use one of Web Audio's `OscillatorType` values: None of them give variable duty cycles.
3. AudioWorklet with custom waveform generation: Heavier, async setup, overkill for a static periodic waveform.

**Rationale:**
`PeriodicWave` is the right primitive for fixed-shape oscillators. Fourier construction is mathematically clean — 32 harmonics is more than enough for the bandwidth of these waveforms at the pitches we play, and there's no audible aliasing. The same code path serves both online `AudioContext` (live playback) and `OfflineAudioContext` (WAV rendering).

**Constraints:**
Web Audio API capabilities.

**Cross-References:**
- Related decisions: DEC-002, DEC-008

---

**DEC-004:** Claude as the composer; structured JSON schema for jingle data
**Date:** 2026-05-18
**Sprint:** Bootstrap

**Decision:**
Use Claude (model `claude-sonnet-4-20250514`) to generate jingle structures via a strict JSON contract: `{title, tempo, key, mood, form, sections, lead, harmony, bass}` where each track is an array of `[noteName, beats]` tuples. Note names follow `C5`, `F#4`, `Bb3`, `rest` format. Durations in beats.

**Alternatives Rejected:**
1. Algorithmic composition (Markov chains, rule-based): Generic, doesn't capture personality. The whole point is that "mellow shoegaze friend" sounds different from "always-grinning party animal."
2. Markdown or natural-language output, parsed loosely: Brittle and slow. JSON gives a clean machine-readable handoff.
3. MIDI bytes directly: More compact but harder for Claude to produce reliably and harder for humans to debug.

**Rationale:**
JSON with the `[note, beats]` schema is compact, human-readable in the response, and trivially parseable. Tuples-as-arrays beat objects (`{note, beats}`) on token count without sacrificing clarity. Claude is good at generating structured output when given a clear schema and an example.

**Constraints:**
Anthropic API call budget; needs to be fast enough that "compose theme" feels responsive at a party.

**Cross-References:**
- Related decisions: DEC-005, DEC-010

---

**DEC-005:** Pixel avatars as hex-indexed palette + frame-row strings
**Date:** 2026-05-19
**Sprint:** Bootstrap

**Decision:**
Generate 24×24 pixel avatars via Claude as `{palette: [...], frames: [[24 strings of 24 hex chars each], ...], fps}`. Index 0 is always transparent; indices 1–15 are hex color strings. Each frame is exactly 24 rows of 24 hex characters; each character is a palette index.

**Alternatives Rejected:**
1. Have Claude generate SVG: Better at SVG than at pixel art, but produces vector graphics rather than chunky 16-bit sprites — wrong aesthetic.
2. Hand-built template system (Claude picks attributes, code assembles from sprite parts): Reliable but inflexible. Loses the surprise factor that makes the avatars charming.
3. 16×16 sprites: Too small for personality detail. 32×32 too big — slower to generate, more tokens, harder for Claude to keep coherent.
4. JSON of `{x, y, color}` triples: 1.5–2x larger than packed row strings.

**Rationale:**
The hex-string-row format gives Claude a clear, validatable structure (24 chars × 24 rows = trivially countable) while keeping the response small (~600 chars per frame). Single-hex-character indexing limits the palette to 16 colors per sprite, which is exactly the SNES-era constraint we want for the aesthetic. The rendering code tolerates malformed rows (pad/truncate to 24 chars, default to transparent on unknown indices) so a slightly wonky Claude response still produces a sprite rather than a crash.

**Constraints:**
The model isn't going to generate Capcom-quality pixel art. Acceptable — charming-weird fits the party tone, and the versions-array lets the user reroll until satisfied.

**Cross-References:**
- Related decisions: DEC-004, DEC-006
- Superseded in part by DEC-011 (format changed to 32×48 portrait)

---

**DEC-006:** Versioned arrays for jingles and avatars; reroll appends
**Date:** 2026-05-19
**Sprint:** v2

**Decision:**
Each guest stores `jingles: [...]` and `avatars: [...]` arrays plus `currentJingleIndex` and `currentAvatarIndex` cursors. Rerolling generates a new version and appends to the array, then moves the cursor to the new entry. UI provides ◀/▶ navigation to switch between versions.

**Alternatives Rejected:**
1. Reroll overwrites the current jingle/avatar: Original behavior in v1. Lost data and discouraged experimentation — Steven explicitly said "I generated one for me just now and I already don't want to lose it."
2. Versioned but with a delete-version button: Adds UI complexity. With JSON backup export available, no need to manually prune.
3. Sliding window (keep last N versions): Premature optimization. Storage limits are nowhere near being hit.

**Rationale:**
The party use case rewards iteration — you want to compose several attempts and pick the favorite. Throwing away history makes that emotionally costly. Storage is cheap; experimentation should be free.

**Constraints:**
Required a schema migration from v1's `{jingle: {...}}` to v2's `{jingles: [{...}], currentJingleIndex: 0, ...}`. Migration is read-side only, non-destructive — the migrated data is written back only if the in-memory transformation succeeded.

**Cross-References:**
- Related decisions: DEC-007, DEC-009

---

**DEC-007:** Storage abstracted; same key across schema versions; non-destructive migration
**Date:** 2026-05-19
**Sprint:** v2

**Decision:**
Use a single storage key (`eki_guests_v1`) across schema versions. Migration happens on load: detect old schema, transform in memory, write the new schema back only after successful transformation. Storage will move from `window.storage` (artifact runtime) to `localStorage` (deployed browser) via a feature-detecting adapter in the next refactor — but the key and migration logic stay the same.

**Alternatives Rejected:**
1. Versioned storage keys (`eki_guests_v2`): Considered, would have protected v1 data as a hard fallback. Decided against because (a) the migration is read-only and (b) the explicit JSON backup feature serves the same safety purpose with user awareness.
2. Wipe old data and start fresh: Unacceptable — would have deleted Steven's existing in-progress guest composed in the v1 artifact preview.
3. Two storage backends in parallel: Adds complexity without clear benefit.

**Rationale:**
Steven was actively using the app when v2 shipped. Preserving his existing in-progress data was the highest priority. The migration runs on every load until everyone is on the v2 schema, which is fine because it's idempotent (already-migrated guests pass through unchanged).

**Constraints:**
Artifact runtime's `window.storage` is per-user, but the API key for it is per-artifact-revision in practice. Deployment context will use `localStorage`, which is per-origin.

**Cross-References:**
- Related decisions: DEC-006, DEC-009

---

**DEC-008:** WAV download via OfflineAudioContext + hand-rolled 16-bit PCM encoder
**Date:** 2026-05-19
**Sprint:** v2

**Decision:**
Render each jingle to WAV via `OfflineAudioContext`, reusing the same `scheduleJingle()` function that drives live playback. Encode the resulting `AudioBuffer` as a 16-bit signed PCM WAV with a hand-written 44-byte header. Trigger download via `Blob` + anchor click.

**Alternatives Rejected:**
1. MP3 / AAC encoding: Requires a library (lamejs, etc.). For 15–25 second files at 1.5MB each, WAV is fine and lossless.
2. Use a WAV-encoder library (e.g. `audiobuffer-to-wav`): Adds a dependency for ~30 lines of code.
3. MediaRecorder API: Encodes from a live AudioContext stream, so playback would have to happen in real time. OfflineAudioContext renders faster than realtime.
4. Web MIDI export: Considered. Loses the chiptune timbre, which is the whole point.

**Rationale:**
The synthesis code already takes `(ctx, dest, jingle, startTime, periodicWaves)` so it works on either AudioContext type without modification. Hand-rolling the WAV header is ~30 lines and a one-time write — saves a dependency that would otherwise have to be vendored into the single-file HTML.

**Constraints:**
Stays inside the "single file, no build, no external deps" envelope from DEC-001.

**Cross-References:**
- Related decisions: DEC-001, DEC-003

---

**DEC-009:** JSON backup export/import as defense in depth
**Date:** 2026-05-19
**Sprint:** v2

**Decision:**
Top-of-page buttons for "Export Backup" (downloads all guests as JSON with timestamp) and "Import Backup" (file picker, restores or merges by guest ID). Merge strategy on import: incoming entries with matching IDs overwrite local; non-matching IDs add to the list.

**Alternatives Rejected:**
1. Auto-backup to a server: Requires a backend just for backups. Out of scope.
2. Auto-backup to localStorage under a second key: Doesn't survive cleared browser data.
3. Only export, no import: Less useful — Steven would still lose data on a fresh deployment if storage didn't migrate.

**Rationale:**
The single biggest failure mode of this app is losing a guest's perfect-on-the-first-try jingle the night before the party. Storage abstractions can fail, migrations can have bugs, browsers can wipe data. A user-controlled JSON file on disk is the ultimate backstop. Import doubles as the migration path from artifact-preview → deployed standalone.

**Constraints:**
None of significance.

**Cross-References:**
- Related decisions: DEC-006, DEC-007

---

**DEC-010:** Serverless proxy in front of the Anthropic API
**Date:** 2026-05-20
**Sprint:** Pre-deployment

**Decision:**
Deploy a tiny serverless function that holds the Anthropic API key as an environment secret, forwards request bodies from the browser, and adds the required headers (`x-api-key`, `anthropic-version: 2023-06-01`). The browser calls `/api/generate` instead of `api.anthropic.com` directly. Platform selection pending (Cloudflare Pages, Vercel, or Netlify — all viable).

**Alternatives Rejected:**
1. Direct browser API calls with key embedded: Would require committing the key to the public repo or asking each user to paste their own key. Either way, key leakage = unbounded API spend.
2. Direct browser API calls with `anthropic-dangerous-direct-browser-access: true` and key passed by user: Acceptable for purely-personal local use but unacceptable for a shared link. Want the URL shareable.
3. Run a dedicated server (Express, Fastify): Overkill — the function does ~30 lines of work. Cold starts are not a concern at this traffic volume.

**Rationale:**
The header naming (`anthropic-dangerous-direct-browser-access`) is a tell that Anthropic deliberately makes direct-browser usage friction-laden. The right design has the secret server-side. Serverless functions are the lightest possible "backend" that can hold a secret — no infrastructure to manage, generous free tiers, GitHub auto-deploy. Adds the bonus capability of per-IP rate limiting in front of the API call to bound spend.

**Constraints:**
Must not break the local-dev path. Must work with the existing artifact runtime (which proxies API calls automatically) without modification — feature detection on `window.storage` (a proxy-context signal) suffices to choose endpoint.

**Cross-References:**
- Related decisions: DEC-004
- Source: Claude Code session that set up the repo flagged the three blockers (missing auth, missing version header, CORS) and recommended the proxy pattern.

---

**DEC-011:** Avatars upgraded to 32×48 portrait sprites with an archetype-driven prompt
**Date:** 2026-05-20
**Sprint:** v4

**Decision:**
Enlarge avatar sprites from 24×24 to 32×48 (a 2:3 portrait) and reframe them as full-body "class-select" characters. Rewrite the generation prompt so Claude first commits to a character archetype, 2–3 concrete visual hooks, and an explicit animation concept, then places pixels. The JSON now leads with `archetype`, `hooks`, and `animation_concept` reasoning fields before `palette`/`frames`/`fps`. Frames are 2–4 at 3–6 fps, each differing from the previous by 4–20 pixels.

**Alternatives Rejected:**
1. Stay at 24×24: The head-and-shoulders sprites rarely read as distinct characters — too few pixels for a recognizable silhouette plus a personality hook. The whole "select your character" conceit needs figures, not blobs.
2. Go 32×32 (square, as floated and rejected in DEC-005): A square gives no room for a full standing figure. The bottleneck was never width, it was vertical room for head + torso + legs + a tall accessory.
3. Free-form reasoning before the JSON: Prose-then-JSON invites code-fence leakage and parse failures. Putting the reasoning *inside* the JSON as leading fields keeps a single parseable payload while still forcing Claude to design before drawing.

**Rationale:**
This reverses the "32×32 too big — harder for Claude to keep coherent" call in DEC-005. The earlier worry was real, but the fix isn't a smaller canvas — it's scaffolding. Making Claude declare an archetype and a handful of hooks first gives the larger 32×48 canvas a plan to fill, so the extra pixels read as a deliberate character instead of noise. Rendering sizes the canvas by the largest integer scale that fits the frame, preserving aspect, so legacy 24×24 sprites still render centered and nothing in storage has to change.

**Constraints:**
Storage key and per-guest schema unchanged (DEC-007); existing avatars must keep rendering. Normalization pads/truncates rows to 32 chars and frames to 48 rows, so a malformed Claude response still yields a sprite rather than a crash — same tolerance posture as DEC-005.

**Cross-References:**
- Supersedes the format decision in DEC-005
- Related decisions: DEC-004, DEC-006

**Update — 2026-05-20 (same day):**
Reverted the canvas to 24×24. The archetype-first prompt framing was a clear win and is kept, but 32×48 was not: Claude (Sonnet 4) reliably produced well-conceived characters whose pieces didn't connect — a hood with empty space where the head should be, a tool floating beside a body that was never drawn. The extra vertical pixels invited the model to spread elements out and then fail to bridge them. Dropping back to 24×24 forces the figure to be compact and connected, which the model handles far more reliably; the rewritten drawing rules now make "one connected silhouette first, hooks attached second" the explicit top priority, with frames reduced to 2 at 3 fps.

This vindicates the original DEC-005 intuition ("32×32 too big — harder for Claude to keep coherent") more than DEC-011 expected: the bottleneck really was coherence at scale, and scaffolding alone didn't overcome it at 32×48. Lesson for future-self — for this model and sprite style, prefer the smallest canvas that fits the concept and spend the design budget on the *prompt's* structure, not on more pixels. Legacy 32×48 avatars still render (scaled down, aspect-preserved); nothing in storage changed.

**Update — 2026-05-20 (later same day):**
Moved the canvas to 32×32 (square) — a middle ground between the cramped 24×24 of the previous revert and the over-tall 32×48 that failed. The 24×24 retreat fixed coherence but at a cost: the connected figures it produced left almost no room for the archetype hooks, so sprites read as generic little hooded blobs — connected, but indistinguishable from one another. 32×32 keeps the square aspect that kept figures compact while giving back enough pixels for 2–3 visible accessories.

The prompt was restructured around exactly two co-equal rules: **RULE 1 — draw a connected figure** (head→torso→legs, no floating parts, no empty rows between body parts) and **RULE 2 — the hooks must be visible in the final image** (a viewer should identify the archetype from the pixels alone, with concrete pixel budgets for a shoulder companion, a held tool, a hat, a belt accessory). The 24×24 rewrite had over-corrected toward connectedness and silently dropped the "distinct character" goal that motivated DEC-011 in the first place; naming both failure modes as explicit, named rules is the fix. Frame-delta tolerance widened to 3–12 px; palette allowance raised to 5–12 colors; normalization pads/truncates to 32 rows × 32 chars.

Net trajectory of the avatar canvas: 24×24 (DEC-005) → 32×48 (DEC-011) → 24×24 (revert) → 32×32 (here). The stable lessons across all four: square beats tall for this model's coherence, and prompt scaffolding must hold *both* "connected" and "distinctive" as named constraints or the model optimizes one at the expense of the other. Legacy 24×24 and 32×48 avatars still render unchanged — `renderAvatar()` reads each sprite's stored width/height and scales to fit; nothing in storage changed (DEC-007).
