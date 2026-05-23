# Project Knowledge (Claude Context)

> Tier A operational context for Claude.ai and Claude Code.
> Last updated: 2026-05-20

## What Is This Project

EKI Melo is a personal web app that generates 8-bit chiptune arrival jingles and pixel avatars for birthday-party guests. Each guest gets a personalized NES-style theme composed with proper musical form (AABA / ABA' / ABCA, motivic development, voice exchange, cadence resolution) and a 64×64 pixel-art character sprite that captures their personality (Claude designs the character; PixelLab's PixFlux model renders it — see DEC-012). The aesthetic is "character select screen meets Japanese train-station eki melody."

This is a weekend project built for one real birthday party. It is not a production product — it has one user (Steven), is shared with friends as a curiosity, and is intentionally tiny in scope.

## Current State

- **Latest release:** v2.2.1 (2026-05-23). Composition-engine rebuild is shipped; download surface complete (WAV / MIDI / JSON); mobile playback fixed.
- **Deployment:** Live at https://eki-melo.pages.dev via Cloudflare Pages. Auto-deploys on push to `main`.
- **Composition engine:** Dual-engine. The user picks per-generation between v1 (the original single-call generator — preserved bit-identical as the permanent fallback) and the pipeline (the 12-session rebuild — a ten-stage composer: aesthetic → macro → harmony → motifs → arrangement → texture → voice realization → voice-leading → cadence). Each stored jingle is tagged with its engine; the archive view shows it. See DEC-014.
- **Diagnostic export:** Any generated jingle (live or already-archived) downloads as a structured JSON capturing the prompts and per-stage artifacts that produced it, including reconstructed prompts for older jingles. Sidecar storage namespace (`eki_diagnostics_v1`); included in backup export; import accepts files with or without. See DEC-016 + DEC-017.
- **Open work:** Composition iteration driven by diagnostic analysis (the rebuild met the architectural bar but the "memorable melody" pressure point continues — diagnostic JSONs are the next medium for that conversation). Two retained legacy files (`stage-4-cells-LEGACY.js` + `stage-5a-development-LEGACY.js`) await a "prune confidently" verdict after enough listening to confirm the phrase-motif pivot stays.

## Architecture

Multi-file vanilla JS, no build step. Three Web Audio voices recreate the NES APU (50% pulse lead, 25% pulse harmony, triangle bass) via Fourier-coefficient PeriodicWave construction. Jingle and avatar generation happen in parallel via `Promise.allSettled` against the Anthropic Messages API. Each guest stores arrays of versioned jingles and avatars; reroll appends rather than overwrites.

See `docs/architecture.md` for the full picture.

## Tech Stack

- HTML / vanilla JavaScript / CSS (no React, no build step, no bundler)
- Web Audio API (online context for playback, OfflineAudioContext for WAV rendering)
- Claude API — model: `claude-sonnet-4-20250514` (jingles + avatar character specs)
- PixelLab API — PixFlux model (`/v2/create-image-pixflux`) renders avatar sprites
- Browser `localStorage` for persistence
- Google Fonts (Press Start 2P, VT323) for the NES aesthetic
- **Deployment target:** Cloudflare Pages with Functions (`/api/generate`, `/api/avatar`); secrets `ANTHROPIC_API_KEY` + `PIXELLAB_API_KEY`
- Web Audio API (online context for playback, OfflineAudioContext for WAV rendering)
- Claude API — model: `claude-sonnet-4-20250514` (jingles + avatar character specs)
- PixelLab API — PixFlux model (`/v2/create-image-pixflux`) renders avatar sprites
- Standard MIDI File output via a hand-rolled writer (no library)
- Browser `localStorage` for persistence
- Sidecar `eki_diagnostics_v1` namespace for per-jingle diagnostic bundles
- Google Fonts (Press Start 2P, VT323) for the NES aesthetic

## Key Active Decisions

See `docs/decision-log.md` for full rationale. Headlines:

- **DEC-001:** Vanilla JS single-file app, not React — audio synthesis is imperative
- **DEC-002:** Three-voice synthesis matching NES APU channels
- **DEC-003:** Pulse waves via Fourier coefficients (`PeriodicWave`), not `osc.type='square'`, so duty cycles are authentic
- **DEC-006:** Versioned arrays for both jingles and avatars; reroll appends. Combined with JSON backup export/import.
- **DEC-008:** WAV download via `OfflineAudioContext` + hand-rolled 16-bit PCM encoder (no external libraries)
- **DEC-010:** Serverless proxy in front of the Anthropic API to keep the key off the client (platform TBD)
- **DEC-012:** Avatars rendered by PixelLab (PixFlux); Claude is the character designer. Two-stage `/api/avatar` Pages Function. Ends the three-iteration LLM-pixel-art run (DEC-005/DEC-011); legacy hex avatars still render via `renderAvatarLegacy`. Avatars unavailable in artifact mode.
- **DEC-014:** Composition-engine rebuild ships as a user-selected dual-engine (v1 + pipeline). v1 stays bit-identical as the deliberate fallback path; pipeline is the new default; the user picks per-generation; the archive preserves the engine choice per jingle.
- **DEC-016:** Diagnostic capture + sidecar storage architecture. Every jingle generation can be reconstructed as a structured bundle (prompts + artifacts + traces); old jingles get retroactive reconstruction; sidecar namespace isolates the diagnostic blobs from the main guest store.
- **DEC-017:** `engines.js` gains a narrow `onDiagnostic` hook to expose live capture without touching the read-only contracts on `composition.js` + `api.js`. Synthesis exports (synth.js's `noteToFreq`, `scheduleNote`, the pulse-wave builder) are reproducibility-locked — the diagnostic JSON's C-replay property depends on them being unchanged.

## Workflow

This project uses a lightweight subset of the [claude-workflow](https://github.com/stevengizzi/claude-workflow) methodology. Applied: decision logging, canon-doc structure, README discipline. Not applied: sprint planning protocols, tier-3 reviews, runner orchestration, risk register, roadmap (overkill for a weekend project — see Getting Started anti-pattern #3).

**Two-Claude usage:**
- **Claude.ai** for design conversations, HTML rewrites, prompt iteration
- **Claude Code** for refactors that span multiple files, proxy implementation, deployment plumbing
- **Git** bridges them

## Communication Style

- Direct prose over heavy formatting for chat; reserve headers/bullets for canon docs and READMEs
- Show rationale, not just decisions
- Bias toward shipping working code over architectural debate for this project's scale
- When iterating on the HTML, preserve user-generated data above all else (the whole point is composing jingles for real guests — losing them is the worst failure mode)

## Reference Documents

| Document | Purpose |
|----------|---------|
| `docs/project-knowledge.md` | This file (Claude context) |
| `docs/architecture.md` | Technical blueprint |
| `docs/decision-log.md` | DEC entries with rationale |
| `CHANGELOG.md` | Version history |
| `CLAUDE.md` | Claude Code session context |
| `README.md` | Public-facing repo entry point |
