# Changelog

All notable changes to EKI Melo. Most recent first.

## [v2.1.0] — 2026-05-22

Additive, non-breaking: every existing jingle, backup, and engine keeps working
exactly as before. Adds a way to download how a jingle was made.

### Added
- **Download dropdown on every guest card.** The single `↓ WAV` button is now a
  `↓ DOWNLOAD ▾` menu with three slots: **WAV (audio)** (unchanged), **JSON
  (diagnostic)** (new), and a disabled **MIDI — Session 15** placeholder. The menu
  opens on click, closes on outside-click or Escape, and is arrow-key navigable.
- **JSON diagnostic export.** Any already-generated jingle can be downloaded as a
  structured JSON capturing the prompts + artifacts that produced it — for talking
  through which composition STAGE to iterate on. For a **pipeline (v2)** jingle the
  bundle has the per-stage prompts, the validated artifact each stage emitted, Stage
  2's deterministic rule trace, each stage's soft warnings, and the beat-stamped
  realization. For a **v1** jingle it has the system + user prompt and the parsed
  jingle. Bundles carry a semver `diagnostic_version` (`1.0.0`). See DEC-016.
- **Live + retroactive capture.** Newly generated jingles capture a LIVE diagnostic
  (the real LLM responses). Jingles from before this release are RECONSTRUCTED on
  first download — the deterministic pieces (prompts, Stage 2 trace, realization) are
  faithfully re-derived; the never-stored LLM raw responses are honestly `null`. A
  reconstructed bundle is cached so the next download is instant.
- **Diagnostics in the backup.** `↓ EXPORT BACKUP` now includes saved diagnostics
  (backup `version: 3`). Import accepts backups WITH or WITHOUT them — old backups
  restore fine (empty diagnostics; re-download reconstructs on demand). Corrupt
  bundles in an import are skipped, not stored.

### Changed
- **`engines.js` gains an optional `onDiagnostic` capture hook** (the one narrow
  engine change). `composition.js` / `api.js` / `render.js` / `synth.js` stay
  byte-for-byte unchanged; v1's prompt template is duplicated into `engines.js` (kept
  in sync with the read-only api.js). Pipeline jingles now store the resolved config
  (`pipelineMetadata.config_used`) for diagnostic fixture-replay. Diagnostic capture
  is secondary — if it fails, the jingle still saves. See DEC-017.

### Notes
- MIDI export is Session 15; the dropdown slot ships disabled as a placeholder.
- New verifier `verify-diagnostics.mjs`; all fifteen verifiers pass offline.

## [v2.0.0] — 2026-05-22

The composition-engine rebuild ships. This is the milestone the 12-session
`docs/composition-engine-buildplan.md` was building toward, so it adopts a
semantic version (`v2.0.0`) rather than continuing the `vN` release-tag run —
`v2` marks "the second-generation composer is live." The prior `v1`…`v8` tags
remain the historical record.

### Added
- **Dual-engine jingle composition, chosen per guest.** The Add-Guest form now
  has an **ENGINE** toggle next to Compose:
  - **v2** (default) — the new 10-stage composer pipeline: aesthetic
    interpretation → macro parameters → harmony → melodic phrases → arrangement →
    texture → voice realization → voice-leading → cadence. Five LLM calls scoped
    to soft creative decisions, deterministic music theory for the hard rules.
    (The engine's internal id is `pipeline`; it's labeled **v2** in the UI.)
  - **v1** (classic) — the original single-prompt generator, unchanged.
  Each generated jingle records which engine made it; the guest card shows a
  small **v2** / **v1** badge that updates as you page through a guest's
  archive. See DEC-014.
- **Retry with the other engine.** If the chosen engine fails, a one-tap "Retry
  with v1 / Retry with Pipeline" button appears. No silent auto-fallback — your
  engine choice is preserved across the failure (a held avatar isn't re-spent on
  the retry). See DEC-014.
- **Pipeline metadata stored per jingle.** Pipeline jingles keep their full
  intermediate plans (aesthetic / macroParams / harmony / motifs / phrase /
  texture) under `pipelineMetadata` for inspection.

### Changed
- **Generate + reroll now dispatch through `js/jingle/engines.js`** (the new
  engine dispatcher: 60s timeout, structured errors, one structured log line per
  generation). Reroll honors the form's current engine selection, so a guest can
  hold a mix of v1 and pipeline takes.
- **Per-jingle storage schema** gains `engine: 'v1' | 'pipeline'` (+ optional
  `pipelineMetadata`). Migration is non-destructive (DEC-007): every jingle
  stored before this release is tagged `engine: 'v1'` on read (v1 was the only
  engine then) and written back only after a clean full read. See DEC-015.

### Fixed (post-initial-deploy)
- **Pipeline jingles were always named "Untitled Jingle."** The pipeline had no
  naming stage. Stage 1 (aesthetic) now also authors a short evocative theme
  title (the runner falls back to "{Guest}'s Theme" if the model omits one).
- **The jingle's mood line showed the full guest description** instead of a
  one-word mood. The pipeline's `FinalJingle.mood` now uses the canonical mood
  label from Stage 2 (e.g. "wistful"), not the raw vibe text.
- **Every guest sounded the same: ~96 BPM, always ternary.** Root cause: the
  Stage-1 LLM *clusters its structural hints* — for ordinary personality
  descriptions (most of a guest list) it returns the same safe tempo (≈96 BPM)
  and form (ABA) almost deterministically, even when its own mood label varies.
  Fix: Stage 2 now DERIVES tempo and form from mood + intensity and ignores the
  LLM's `tempo_hint` / `form_hint` (the LLM keeps the calls it's reliable on —
  mood, key, mode, title). Tempo spreads across slow/medium/fast tiers (96–152)
  and forms spread across AABA / ternary / binary / ternary_varied, so a varied
  guest list now gets varied tempos and structures. Also removed an over-eager
  32-beat "downsize" that had made AABA unreachable (AABA 2/2/2/2 is a known-good
  jingle form).
- **Engine label.** The pipeline engine is now labeled **v2** in the UI (badge,
  selector, retry button); its stored id stays `pipeline` (no migration).

### Preserved
- **v1 is bit-identical.** `composition.js` / `api.js` / `render.js` /
  `synth.js` are untouched; `engines.js` reuses `api.js`'s `generateJingle`
  verbatim for the v1 path. Both engines work in the deployed browser AND the
  Claude.ai artifact runtime (same `env.js` endpoint adapter). `STORAGE_KEY`
  unchanged; the JSON backup export/import round-trips the new fields with no
  format change (DEC-009); the Anthropic key stays server-side (DEC-010).

## [v8] — 2026-05-21

### Changed
- **Client code split into ES modules.** The JavaScript that lived inline in `index.html` now lives under `js/` (`env`, `storage`, `jingle/{synth,composition,api,render}`, `avatar/{api,render}`, `ui`, `handlers`, `main`), and all CSS moved to `styles.css`. `index.html` is now markup only — it loads `styles.css` and a single `<script type="module" src="js/main.js">`; load order is the import graph, not script tags. Still no build step and no external libraries — Cloudflare Pages serves the files directly and the browser resolves the imports. The jingle system prompt now lives in `jingle/composition.js` (the musical brief) separate from `jingle/api.js` (the request to Claude), giving future composition logic a home. See DEC-013.

### Preserved
- Behavior is identical. `STORAGE_KEY = 'eki_guests_v1'` and the migrate-on-read path unchanged (DEC-007); JSON backup export/import format unchanged (DEC-009); the Anthropic key never reaches the client (DEC-010); the `env.js` artifact/standalone detection seam is intact. Server-side Pages Functions (`functions/api/*`) untouched.

## [v7] — 2026-05-20

### Added
- **PixelLab-powered avatar generation.** Avatars are now rendered by PixelLab's PixFlux model at 64×64 with a transparent background. Claude (Sonnet 4) becomes the *character designer*: it reads the guest's personality and returns a structured spec (`archetype`, `hooks`, `palette`, `paletteHints`, `visualPrompt`), and PixelLab renders the sprite from that `visualPrompt`. A new Cloudflare Pages Function — `/api/avatar` (`functions/api/avatar.js`) — orchestrates both API calls server-side so neither key reaches the client. ~$0.008 per sprite (~$0.50 for a 24-guest party).
- **CSS-based idle animation on avatars** — a gentle vertical bob, intensifying into a brighter glow pulse while that guest's jingle plays.

### Changed
- **Avatar generation pipeline replaced**, ending the three-iteration run of in-house LLM-pixel-art (v4 32×48 → v5 24×24 → v6 32×32). Sonnet 4 reliably interprets archetypes but cannot render coherent pixel grids; a purpose-built pixel-art model does, for trivial cost. See DEC-012.
- **Avatar storage schema** now stores PNG image data (`imageData`) and a `version: 4` marker for new avatars (the avatar *format* version — distinct from this v7 release tag). The renderer dispatches on `version`: legacy hex-encoded avatars (no `version` field) keep rendering through the original canvas path, now named `renderAvatarLegacy`.

### Preserved
- Storage key and per-guest schema unchanged (DEC-007). All legacy avatars (24×24, 32×48, 32×32) still load and render. Versioned avatar arrays and reroll behavior intact. JSON backup export/import round-trips v4 avatars — the base64 PNG inflates backups modestly (~6–12 KB per 64×64 sprite).

### Note
- Avatars are **unavailable in the Claude.ai artifact runtime** — it has no Pages Function and cannot reach PixelLab. Jingles still work there. `AVATAR_ENDPOINT` is gated on the same `IS_ARTIFACT` signal the rest of the app uses.

## [v6] — 2026-05-20

### Changed
- **Avatar canvas 24×24 → 32×32 (square); prompt restructured around two named rules.** The v5 retreat to 24×24 fixed figure coherence but starved the archetype hooks of room, so sprites read as generic hooded blobs. 32×32 keeps the square aspect that holds figures compact while giving back pixels for 2–3 visible accessories. The prompt now leads with two co-equal rules — **RULE 1: draw a connected figure** (head→torso→legs, no floating parts), and **RULE 2: the hooks must be visible in the final sprite** (identifiable from the pixels alone, with concrete pixel budgets per accessory). Frame-delta tolerance widened to 3–12 px and the palette allowance raised to 5–12 colors; normalization now pads/truncates to 32 rows × 32 chars.

### Preserved
- Storage key and per-guest schema unchanged. Legacy 24×24 and 32×48 avatars still load and render — `renderAvatar()` reads each sprite's stored width/height and picks the largest integer scale that fits the frame, aspect intact.

## [v5] — 2026-05-20

### Changed
- **Avatar canvas retreated 32×48 → 24×24; drawing rules rewritten.** Kept v4's archetype-first interpretation framing (Claude commits to an archetype, 2–3 visual hooks, and an animation concept before placing pixels), but walked the canvas back to a 24×24 square. The drawing rules now demand a single *connected* body silhouette — head→torso→legs as one continuous shape — built first, with hooks (tools, companions, hats) attached to that body second. The 32×48 portraits tended to render as well-conceived hooks floating in empty space rather than a coherent figure; the smaller canvas forces the compactness the model handles better. Frames reduced to 2 at 3 fps.

### Preserved
- Storage key and per-guest schema unchanged. Old v4 32×48 avatars still load and render — `renderAvatar()` reads each sprite's stored width/height and picks the largest integer scale that fits the (now square) frame, so legacy portrait sprites render at reduced scale (64×96, centered in the 96×96 box) with aspect intact.

## [v4] — 2026-05-20

### Changed
- **Avatar sprites enlarged 24×24 → 32×48 (portrait).** Sprites are now full-body "class-select" characters instead of head-and-shoulders. The avatar frame is a 2:3 portrait (96×144 desktop, 64×96 mobile); `renderAvatar()` picks the largest integer scale that fits the frame, preserving aspect.
- **Avatar prompt rewritten around archetypes.** Claude now commits to a character archetype (Ranger, Artificer, Scholar, …), 2–3 concrete visual "hooks", and an explicit animation concept *before* placing pixels. The output JSON carries `archetype`, `hooks`, and `animation_concept` reasoning fields ahead of the sprite data. Frames bumped to 2–4 at 3–6 fps with more pronounced idle motion (4–20 px changed per frame).
- **More robust JSON cleanup.** Code-fence stripping now removes fences anywhere in the response, not just at the start/end.

### Preserved
- Storage key and per-guest schema unchanged. Existing 24×24 avatars still load and render (square, centered in the portrait frame). Versioned avatar arrays and reroll behavior intact.

## [v3] — 2026-05-20

### Added
- **Storage adapter** with feature detection. Same `index.html` runs in both the Claude.ai artifact runtime (`window.storage` backend) and a regular browser (`localStorage` backend). Same `STORAGE_KEY = 'eki_guests_v1'` in both modes — schema and migration logic unchanged.
- **API endpoint detection.** `API_ENDPOINT` resolves to `https://api.anthropic.com/v1/messages` when running in the artifact (which proxies API calls automatically) or `/api/generate` when running standalone.
- **Cloudflare Pages Function at `/api/generate`** (`functions/api/generate.js`). Holds `ANTHROPIC_API_KEY` server-side, adds required `x-api-key` and `anthropic-version` headers, forwards the request body to the Anthropic Messages API. Defenses: 8 KiB body cap, model allow-list, `max_tokens` clamped to 4000, POST-only.
- **`.gitignore`** with rules to block backup JSON files (`*-backup-*.json`), local env files (`.dev.vars`, `.env`), wrangler state, and OS noise. Backups stay out of the public repo by default.
- **Deployment runbook in README.md** — six-step Cloudflare Pages setup.

### Changed
- `eki_greetings.html` renamed to `index.html` (the canonical deployable file).
- Earlier versions moved to `archive/` (`eki_greetings_v1.html`, `eki_greetings_v2.html`).

### Preserved
- All v2 features: versioned jingles, versioned avatars, WAV download, JSON backup, multi-section musical form, schema migration. Visible behavior is identical; only the storage and network plumbing changed.

## [v2] — 2026-05-19

### Added
- **Versioned jingles and avatars per guest.** Reroll appends to an array; ◀/▶ navigation between versions; nothing is ever scrapped.
- **Pixel avatars.** 24×24 sprite with 2-frame idle animation (head tilt / blink / breathing / hair sway). Hex-indexed palette, rendered on canvas with `image-rendering: pixelated`. Generated in parallel with the jingle via `Promise.allSettled`.
- **Independent avatar reroll** (`↻ NEW AVATAR` button), separate from jingle reroll.
- **WAV download** per jingle. `OfflineAudioContext` re-renders using the same synthesis path, then a hand-rolled 16-bit PCM encoder produces a downloadable WAV. Filename: `{guest}-{theme_title}.wav`.
- **JSON backup export/import.** Top-of-page buttons for `↓ EXPORT BACKUP` (full JSON dump) and `↑ IMPORT BACKUP` (file picker, merges by guest ID).
- **Section markers on the piano roll.** Pink vertical lines + labels (A, B, A') show the musical form visually.

### Changed
- **Jingle prompt rewritten for musical form.** Now requires 32–56 beats, multi-section structure (AABA / ABA' / ABCA), motivic development between sections, voice exchange across sections, and proper V→I or IV→I cadence. Roughly 4x longer than v1.
- **Schema migration.** Old `{jingle: {...}}` per-guest shape converts on load to the new `{jingles: [...], currentJingleIndex, avatars, currentAvatarIndex}` shape. Non-destructive — original data preserved until migration succeeds.

### Preserved
- Storage key (`eki_guests_v1`) kept identical to v1 so existing user data survives the schema change.

## [v1] — 2026-05-18

### Added
- Initial release: NES-style arrival jingle generator for birthday party guests.
- Three-voice Web Audio chiptune synthesis: 50% pulse lead, 25% pulse harmony, triangle bass. ADSR envelope per note. Pulse waves built from Fourier coefficients via `PeriodicWave`.
- Claude API integration generates a personalized jingle from guest name + personality description.
- Persistent storage of guests in `window.storage`.
- Piano-roll visualization per guest, color-coded by voice (green=lead, blue=harmony, yellow=bass).
- Animated red playhead during playback.
- Reroll and delete per guest.
- NES "select character" aesthetic: dark purple palette, scanline overlay, Press Start 2P + VT323 fonts, pixel-art borders via layered box-shadows, glow-pulse animation on the playing card.
