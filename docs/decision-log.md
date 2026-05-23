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

---

**DEC-012:** Adopt PixelLab API for avatar rendering; Claude becomes the character designer
**Date:** 2026-05-20
**Sprint:** v7

**Decision:**
Replace the in-house LLM-pixel-art approach with a two-stage pipeline. Claude (Sonnet 4) reads the guest's name and description and returns a structured character spec — `archetype`, `hooks`, `palette`, `paletteHints`, and a concrete `visualPrompt`. PixelLab's PixFlux model then renders that `visualPrompt` into a 64×64 transparent-background PNG sprite. A new Cloudflare Pages Function, `/api/avatar` (`functions/api/avatar.js`), orchestrates both calls server-side, holding both `ANTHROPIC_API_KEY` and a new `PIXELLAB_API_KEY` as secrets. New avatars carry `version: 4` plus `imageData`; the renderer dispatches on version so legacy hex-grid avatars keep rendering through the (renamed) `renderAvatarLegacy`.

**Alternatives Rejected:**
1. Keep iterating on LLM-pixel-art (the DEC-005 / DEC-011 lineage): Three iterations (32×48 → 24×24 → 32×32, with progressively stronger prompts) established a real capability ceiling. Sonnet 4 reliably interprets archetypes and proposes specific hooks, but cannot render coherent pixel grids — outputs are either disconnected accessories with no figure, or coherent generic figures with no archetype-specific detail. More prompt scaffolding did not break through.
2. SVG portraits via Claude: Viable, and Claude renders SVG well, but vector portraits break the chiptune/pixel aesthetic the whole app is built around.
3. Templated pre-drawn archetype sprites: Loses the per-guest uniqueness that makes the "select your character" conceit feel personal.
4. Ship charming-generic (accept the LLM ceiling): Viable, but a pixel-art-specialized model produces dramatically better, recognizably-distinct output for ~$0.008 a sprite — a 24-guest party costs ~$0.50.

**Rationale:**
Keep Claude doing what it is good at — interpreting personality into a character concept and a concrete visual prompt — and hand pixel rendering to a model purpose-built for it. The split also makes each side independently improvable (tune the Claude prompt without touching rendering, or swap PixelLab models without touching the spec). Both keys stay server-side behind `/api/avatar`, consistent with DEC-010's reasoning for the jingle proxy.

**Constraints:**
- New external dependency: a PixelLab account + API token, required for avatars in production. New `PIXELLAB_API_KEY` secret in the Cloudflare environment (and in `.dev.vars` locally).
- Avatars are unavailable in the Claude.ai artifact runtime — it has no Pages Function and cannot reach PixelLab. `AVATAR_ENDPOINT` is gated on the same `IS_ARTIFACT` signal used elsewhere; jingles still work in artifact mode. Artifact mode is now a dev convenience, not a production target.
- Storage stays backward-compatible (DEC-007): legacy hex avatars (no `version`) and v4 PNG avatars coexist in the same per-guest `avatars` array; `renderAvatar()` dispatches on `version`. The `version: 4` marker is the avatar-*format* version, distinct from the v7 release tag.
- Base64 PNGs inflate JSON backups modestly (~6–12 KB per 64×64 sprite); still well within reason.

**Implementation note — endpoint correction:**
The v7 spec referenced `POST /v2/generate-image-pixflux`. The live PixelLab API (verified against the api.pixellab.ai OpenAPI spec) exposes the operation at `POST /v2/create-image-pixflux`; `generate-image-pixflux` does not exist and would 404. The request fields (`description`, `image_size`, `no_background`, `text_guidance_scale`), Bearer auth, and the `image.base64` response field all matched the spec. The `base64` field is documented only as "Base64 encoded image data" with no guaranteed `data:` prefix, so the function adds the data-URI prefix only when absent.

**Cross-References:**
- Supersedes the avatar-generation approach in DEC-005 and DEC-011 (the hex-grid renderer is retained as legacy-only for backward compatibility)
- Related decisions: DEC-010 (server-side key proxy), DEC-006 (versioned arrays), DEC-007 (non-destructive storage)

---

**DEC-013:** Multi-file client code organization
**Date:** 2026-05-21
**Sprint:** v8

**Decision:**
Split the client code that lived inline in `index.html` into ES modules under `js/`, and move the CSS into `styles.css`. `index.html` becomes markup only: a `<link rel="stylesheet" href="styles.css">` and a single `<script type="module" src="js/main.js">`. Load order is the import graph, not script-tag order. Layout:

```
index.html        ← markup; loads styles.css + js/main.js
styles.css        ← all CSS
js/
  env.js          ← IS_ARTIFACT, API/AVATAR endpoints, storageBackend detection
  storage.js      ← STORAGE_KEY, guests, setGuests, migrate/load/saveGuests
  jingle/
    synth.js      ← pulse-wave synthesis, LiveSynth, synth singleton, WAV render
    composition.js← JINGLE_SYSTEM_PROMPT ("what a jingle should be")
    api.js        ← generateJingle ("how we ask Claude")
    render.js     ← renderPianoRoll + playhead animation
  avatar/
    api.js        ← generateAvatar (client caller for /api/avatar)
    render.js     ← renderAvatar dispatch, mountAvatars, avatarAnimations
  ui.js           ← render, renderGuestCard, escapeHtml, showError/hideError, toast
  handlers.js     ← orchestration: click/keyboard handlers
  main.js         ← event wire-up + loadGuests() init
```

Server-side Pages Functions (`functions/api/*`) are untouched.

**Alternatives Rejected:**
1. Keep the single inline file: It crossed the point where navigation friction outweighed the portability of one file. Jingle composition is about to grow (a dedicated `composition.js` now owns the musical brief, separate from the API plumbing in `api.js`), and a 1500-line single file made every change a scroll-hunt.
2. Add a bundler (Vite/esbuild) while splitting: Reintroduces the build step DEC-001 deliberately avoided. Native ES modules need no build — Cloudflare Pages serves the files directly and the browser resolves the import graph.
3. Concatenate into a few large files instead of one-module-per-concern: Less churn, but the `/* === SECTION === */` banners already mapped cleanly to per-concern files, so the finer split cost little and reads better.

**Rationale:**
The existing section banners were the natural seams. One section split across two files — the jingle prompt went to `composition.js` (owns the compositional intent, the place future composition logic grows) and the fetch/parse stayed in `api.js` (owns the request). The `guests` array stays a live module binding in `storage.js`: importers mutate it in place (`push`/`unshift`) and reassign through `setGuests()` so the live binding updates everywhere. `loadGuests()` no longer calls `render()` — storage stays UI-free and `main.js` orchestrates `loadGuests().then(render)`.

**Constraints:**
- No build step and no external JS libraries (DEC-001 still holds for those aspects). This entry supersedes only the *single-file* aspect of DEC-001.
- `STORAGE_KEY = 'eki_guests_v1'` and the migrate-on-read path unchanged (DEC-007); JSON backup format unchanged (DEC-009); the Anthropic key never reaches the client (DEC-010).
- The `env.js` endpoint/storage detection seam is preserved so the artifact-runtime adaptation logic still works; artifact mode remains a dev convenience, not a production target (per DEC-012). `index.html` is the canonical deployable; `archive/` keeps the historical single-file artifact versions.

**Cross-References:**
- Supersedes the single-file aspect of DEC-001 (vanilla JS, no framework, no build step all retained)
- Related decisions: DEC-007 (storage key/migration), DEC-009 (backup format), DEC-010 (key proxy)

---

**DEC-014:** Composition engine rebuild ships as a user-selected dual-engine (v1 + pipeline)
**Date:** 2026-05-22
**Sprint:** Composition-engine rebuild (Session 13 — wire-up)

**Decision:**
The 10-stage composition pipeline built across Sessions 1–12 ships alongside the original generator as TWO co-equal engines, and the **user chooses one per generation** via a radio toggle on the Add-Guest form:

- **`v1`** — the original loose generator: one large LLM prompt (`js/jingle/composition.js`'s brief) → a jingle JSON, parsed by `js/jingle/api.js`. Unchanged and bit-identical to its pre-Session-13 behavior.
- **`pipeline`** — the new composer: Stage 1 (aesthetic interpretation, LLM) → Stage 2 (macro parameters, deterministic) → Stage 3 (harmony, LLM) → Stage 4 (melodic phrases, LLM) → Stage 5a (arrangement, LLM) → Stage 5b (texture, LLM) → Stages 6/7/8 (deterministic voice realization / voice-leading / cadence). Driven by `runPipelineGenerating`.

A new dispatcher, `js/jingle/engines.js`, exposes one `generateJingle({ guestName, mood, engine })` that runs the chosen engine under a 60s timeout, tags the result with its `engine`, attaches the full `pipelineMetadata` for pipeline jingles, and logs one structured line per generation. Each jingle stores its engine; the archive view badges it. On failure the UI surfaces the error with a one-tap "Retry with the other engine" button — there is **no auto-fallback** (the user's engine choice is deliberate and is preserved across the failure). Default engine: `pipeline` (the Session-12 confirmed "keep" verdict).

**Alternatives Rejected:**
1. *Replace v1 outright with the pipeline (the original buildplan §1 plan: "demote the old call path to a fallback, kept for one release, then removed").* The pipeline is good but "good-not-perfect" (Session-12 close-out); v1 remains a strong, different-sounding generator. Keeping both as a user choice makes v1 the permanent safety net and turns the A/B comparison into something Steven does organically over real party guests, rather than a throwaway transition aid.
2. *Auto-fallback to v1 when the pipeline fails.* Rejected: it silently overrides a deliberate choice. If a guest's pipeline take fails, the user may still want the pipeline (a retry often succeeds) — so the failure surfaces with an explicit retry-with-the-other-engine affordance instead.
3. *A `'both'` engine that generates with each and lets the user pick.* Doubles cost and latency at party time for a comparison that the per-guest toggle already affords across the guest list. Steven's call: pick one per guest.
4. *An internal-only engine flag (no UI).* The whole point is to let the party host steer the sound per guest; a hidden flag would bury the rebuild.

**Rationale:**
The pipeline's value is conditional and aesthetic, not absolute — some guests will sound better through one engine, some through the other. A user-facing toggle is the honest shape for that: it ships the rebuild as a real option while preserving the proven generator, with the dual-engine itself as the primary safety net (the secondary one, the in-pipeline cell-vs-phrase A/B behind `motif_architecture`, is retained internally — see the Session-12 journal). The pipeline's `FinalJingle` was designed (Stage 6) to emit synth-ready `[pitch, duration]` tracks, so `engines.js`'s pipeline→playback conversion is a field-pick, not a re-channelization, and the read-only `synth.js` / `render.js` play and draw either engine identically.

**Constraints:**
- Both engines must work in BOTH runtime contexts (deployed Cloudflare Pages + Claude.ai artifact runtime). Both route their LLM calls through the same `js/env.js` endpoint adapter, so neither needs a server change. (Avatars remain artifact-unavailable per DEC-012; that is unchanged.)
- `composition.js` / `api.js` / `render.js` / `synth.js` stay read-only — the dual-engine must not shift any v1 behavior. `engines.js` reuses `api.js`'s `generateJingle` verbatim for v1.
- Per-jingle storage gains `engine` + optional `pipelineMetadata`, migrated non-destructively (DEC-007 / DEC-009 — see DEC-015 and the storage changes).
- The Anthropic key stays server-side (DEC-010): the pipeline's five LLM calls all go through `/api/generate` (or the artifact direct path).

**Cross-References:**
- Related decisions: DEC-004 (Claude as composer, the v1 brief), DEC-010 (key proxy), DEC-015 (the editability change this wire-up required)
- Source: `docs/composition-engine-buildplan.md` (the 12-session plan) and `docs/buildplan-journal.md` (Sessions 1–13).

---

**DEC-015:** `index.html` / `storage.js` / `handlers.js` become editable for the dual-engine wire-up
**Date:** 2026-05-22
**Sprint:** Composition-engine rebuild (Session 13 — wire-up)

**Decision:**
Throughout Sessions 1–12 the deployed app's entry points were treated as read-only so the pipeline could be built dormant alongside the working app. Session 13 (the wire-up) necessarily makes three of them editable, and they stay editable afterward (the new pipeline lives there): `index.html` (the integration target — gains the engine selector, the per-jingle archive badge, and the retry area), `js/storage.js` (the per-jingle schema extension + migration), and `js/handlers.js` (the generate/reroll dispatch through `engines.js`). `js/ui.js` (the badge render) and `styles.css` (selector + badge styling) were never under the read-only convention and are likewise touched. `composition.js` / `api.js` / `render.js` / `synth.js` REMAIN read-only and bit-identical.

**Alternatives Rejected:**
1. *Wire the pipeline in without touching `index.html` (e.g. inject the selector from JS).* Possible, but the markup is the honest home for a form control and a per-card badge; hiding it in a script would be a worse, harder-to-find shape for no benefit now that the build phase (where the dormant-engine isolation mattered) is over.
2. *Keep `handlers.js` read-only and add a parallel handler module.* The existing handlers ARE the generate dispatch; routing the new flow anywhere else would fork the orchestration layer.

**Rationale:**
The read-only treatment of these files was a build-phase discipline — it kept the deployed app stable while the engine was assembled in isolation. Wiring the engine in is exactly the step that retires that discipline for the integration surface; it does not retire it for the four synthesis/composition files, whose stability is what guarantees v1's behavior is unchanged (DEC-014).

**Constraints:**
- Storage migration is non-destructive and read-side (DEC-007): the engine tag is added in memory and written back only after a clean full read + migration; no field is dropped. The JSON backup export/import (DEC-009) carries the new fields with no logic change (it serializes `guests` and re-runs `migrateGuest` on import — the new fields ride along; the export/import roundtrip was verified identical including the engine fields).
- The four read-only synthesis/composition files stay byte-for-byte unchanged.

**Cross-References:**
- Related decisions: DEC-013 (the multi-file layout these files live in), DEC-007 (non-destructive migration), DEC-009 (backup format), DEC-014 (the dual-engine this enables)

---

**DEC-016:** Diagnostic capture + sidecar storage architecture
**Date:** 2026-05-22
**Sprint:** Composition-engine rebuild (Session 14 — diagnostics)

**Decision:**
Any already-generated jingle can be downloaded as a structured JSON DIAGNOSTIC — a single bundle capturing the prompts + artifacts that produced it, for compositional iteration discussion ("which STAGE made this take feel uninspired?"). The design has four pillars:

1. **A versioned bundle schema** (`diagnostic_version`, semver, currently `1.0.0`) so it can evolve. Top-level: `diagnostic_type` (`live` | `reconstructed`), `generated_at` / `captured_at`, `app_version`, `engine`, a `summary`, a `final` (the realized synth tracks), and an engine-specific block — `pipeline` (a `config_snapshot` + the seven stage entries: stage 1 aesthetic, stage 2 macro with a `deterministic_trace`, stages 3/4/5a/5b each with `input` / `prompt` / `raw_response_text` / `artifact` / `soft_warnings`, and `stages_6_through_8_realization` beat-stamped tracks) or `v1` (`system_prompt` / `user_prompt` / `raw_response_text` / `parsed_jingle`). Lives in `js/jingle/diagnostics.js` with the two builders + the validator + the serializer.

2. **Two builders — LIVE and RECONSTRUCTED — with honest provenance.** A LIVE bundle is assembled at generation time from data captured AS the jingle generates: every per-stage `raw_response_text` is the real model output (`provenance: "live"`). A RECONSTRUCTED bundle is rebuilt after the fact from a stored jingle: the LLM raw responses were never stored, so they are irrecoverable (`raw_response_text: null`), but everything DETERMINISTIC is re-derived — the prompts (re-running each stage's exported `build*Prompt`), Stage 2's rule trace (re-running `generateMacroParams` with a trace hook), each stage's soft warnings (re-running its `validate*` on the stored artifact), and the Stage 6→8 realization (re-running the deterministic sync core). A field that genuinely can't be recovered is marked `"provenance": "unknown"`, never guessed.

3. **The C-replay target.** The realization tracks and the prompts are deterministic functions of the stored artifacts, so a reconstructed bundle's `final` + realization reproduce the original jingle. The LLM stages are NOT re-run (no network, model is stochastic) — their VALIDATED artifacts ARE the model's output to the validator's tolerance, so the stored artifact is the faithful record.

4. **A SIDECAR namespace, not inline storage.** Bundles are bulky (full prompts, every artifact, the tracks) and only a few are inspected at a time. Storing them inline on each jingle would bloat the main guest store (re-read+rewritten on every play/page/reroll/delete). So they live in a SEPARATE store (`js/storage-diagnostics.js`, key `eki_diagnostics_v1`, shape `{ [jingleId]: bundle }`), loaded only when a download asks. The jingle's record carries just a lightweight `diagnosticsRef: <jingleId>` pointer; absence of the field IS the absence-of-capture marker, so the migration is a pure no-op for old data. New generations populate it at save time; old jingles get it lazily on first reconstruction (which optionally caches the result back so a repeat download is O(1)). Loaded bundles (from the sidecar or a backup import) flow through `validateDiagnostic` so a corrupt bundle is detected, not silently malformed.

**Alternatives Rejected:**
1. *Store the diagnostic INLINE on the jingle.* Bloats the hot guest store and couples diagnostic writes to every guest mutation. The sidecar isolates the bulk and means a diagnostic failure can never touch guest data (DEC-007).
2. *Capture ONLY live (no reconstruction).* Then every jingle generated before this session — and any future jingle whose live capture failed — would have no diagnostic. Reconstruction makes the feature retroactive; the deterministic pieces are faithfully recoverable, and the irrecoverable LLM raws are honestly null rather than fabricated.
3. *Re-run the LLM stages during reconstruction to recover the "real" responses.* Costs money + latency and is non-deterministic — a re-run would NOT reproduce the stored artifact. The stored validated artifact is the honest record of what the model produced.
4. *Download a partial/broken bundle when reconstruction fails.* Rejected: a misleading file is worse than none (the user would paste it back for analysis and we'd argue against data we can't trust). A clean failure (error toast, no file) beats a wrong file.

**Rationale:**
The feature's purpose is compositional iteration — comparing "uninspired" vs "inspired" jingles to find which STAGE's prompt to tune. That needs the prompts + artifacts in one structured, stable, comparable artifact. The schema is the honest shape for that; the live/reconstructed split with explicit provenance keeps it truthful about what each path can know; the sidecar keeps the bulk out of the hot path; the semver lets the schema grow as the iteration loop teaches us what to capture.

**Constraints:**
- Storage stays non-destructive (DEC-007 / DEC-009): the `diagnosticsRef` migration is a no-op (the field's absence is meaningful); the backup export includes the sidecar diagnostics (backup `version: 3`), and import accepts files WITH or WITHOUT the `diagnostics` key — pre-Session-14 backups import fine with an empty sidecar, and a corrupt bundle in an import is skipped with a console warning, never stored.
- Diagnostic capture is SECONDARY to the jingle: if live capture (or its persistence) fails, the failure is logged and the generation still succeeds (the jingle is the product).
- No network, both runtime contexts: the sidecar uses the same `js/env.js` storage adapter; reconstruction + validation are pure/offline.

**Cross-References:**
- Related decisions: DEC-014 (the dual-engine whose pipelineMetadata reconstruction reads), DEC-007 / DEC-009 (non-destructive storage + backup), DEC-017 (the narrow engine hook this consumes)
- Source: `js/jingle/diagnostics.js`, `js/storage-diagnostics.js`, `js/jingle/theory/verify-diagnostics.mjs`, and the Session-14 journal entry.

---

**DEC-017:** `engines.js` gains a narrow `onDiagnostic` hook to expose live capture
**Date:** 2026-05-22
**Sprint:** Composition-engine rebuild (Session 14 — diagnostics)

**Decision:**
`generateJingle` accepts an OPTIONAL `options.onDiagnostic` callback. On a successful generation the engine emits a structured LIVE CAPTURE (the raw material a bundle is assembled from):
- **v1:** `{ engine:'v1', system_prompt, user_prompt, raw_response_text }`. v1's prompts are exposed by duplicating api.js's short user-prompt template into `engines.js` (with a "MUST stay in sync with api.js" comment — api.js is read-only by design) and importing the read-only `JINGLE_SYSTEM_PROMPT`. v1's RAW response text is NOT exposed by api.js's contract (it returns the parsed jingle only), so the field carries an honest sentinel.
- **pipeline:** `{ engine:'pipeline', config, aesthetic|harmony|motifs|phrase|texture: { raw, warnings } }` — each LLM stage's last successful raw response + soft warnings, collected via the runner's per-stage `onTrace` hooks, plus the effective knob-derived config. This required ONE additive hook on `pipeline-runner.js` — `onConfig(effectiveConfig)` — so the run's resolved config can be stored as `pipelineMetadata.config_used` (for reconstruction fixture-replay). Stage 2's `onTrace` (previously a no-op) now emits one `{ decision, rule, value }` per macro decision — a pure read of the decisions, additive, only fires when a callback is supplied.

The `composition.js` / `api.js` / `render.js` / `synth.js` files and the bodies of the two engine runners stay behaviorally unchanged; this is callback plumbing + the synced v1 template copy. Diagnostic capture NEVER fails a generation — the emit is guarded.

**Alternatives Rejected:**
1. *Make `api.js` return its raw response so v1 can expose it.* Rejected: api.js is read-only by design (DEC-014 keeps v1 bit-identical). The honest sentinel is the cost of that boundary.
2. *Thread an `onPrompts` hook through all five stage modules.* Unnecessary: each stage already exports a pure `build*Prompt`, so the prompts are rebuilt deterministically in `diagnostics.js` (identical to what the stage used) — no per-stage behavior change. Only the additive `onConfig` hook + Stage 2's trace emission were needed.
3. *Build the full bundle inside `engines.js`.* Rejected: the assembler belongs in `diagnostics.js` (with the schema). The engine emits raw captures; `handlers.js` calls `buildLiveDiagnostic` with the engine output + captures.

**Rationale:**
Live capture is strictly better than reconstruction (the real LLM raws), so it's worth a hook — but the hook must not compromise the read-only contract that guarantees v1's stability or churn the five stage modules. Rebuilding prompts from the already-exported pure builders, plus one config hook and one trace emission, is the minimal surface that yields a faithful live bundle.

**Constraints:**
- `composition.js` / `api.js` / `render.js` / `synth.js` stay byte-for-byte unchanged; the two engine-runner bodies change only by adding capture plumbing.
- `pipelineMetadata` gains `config_used` (additive; opaque to storage). All fifteen verifiers pass offline.

**Cross-References:**
- Related decisions: DEC-014 (the dual-engine + read-only synthesis files), DEC-016 (the diagnostics this feeds), DEC-010 (key stays server-side — unchanged)
- Source: `js/jingle/engines.js`, `js/jingle/pipeline/pipeline-runner.js`, `js/jingle/pipeline/stage-2-macro.js`.
