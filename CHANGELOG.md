# Changelog

All notable changes to EKI Melo. Most recent first.

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
