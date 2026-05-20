# Changelog

All notable changes to EKI Melo. Most recent first.

## [Unreleased]

### Planned
- Storage adapter (`window.storage` / `localStorage` feature detection)
- Endpoint detection (artifact-context vs deployed-proxy)
- Serverless proxy at `/api/generate` (platform TBD)
- GitHub auto-deploy
- Per-IP rate limit on the proxy

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
