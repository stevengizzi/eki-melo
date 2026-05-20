# Project Knowledge (Claude Context)

> Tier A operational context for Claude.ai and Claude Code.
> Last updated: 2026-05-20

## What Is This Project

EKI Melo is a personal web app that generates 8-bit chiptune arrival jingles and 16-bit pixel avatars for birthday-party guests. Each guest gets a personalized NES-style theme composed with proper musical form (AABA / ABA' / ABCA, motivic development, voice exchange, cadence resolution) and a 24×24 animated sprite that captures their personality. The aesthetic is "character select screen meets Japanese train-station eki melody."

This is a weekend project built for one real birthday party. It is not a production product — it has one user (Steven), is shared with friends as a curiosity, and is intentionally tiny in scope.

## Current State

- **Versions shipped:** v1 (single jingle per guest), v2 (versioned jingles + animated pixel avatars + WAV download + JSON backup + multi-section musical form)
- **Deployment status:** Not yet deployed publicly — currently runs as a Claude.ai artifact only. Repo exists at https://github.com/stevengizzi/eki-melo with v1 and v2 commits.
- **Open work:**
  - Refactor storage layer to use `localStorage` adapter (with `window.storage` fallback for artifact context)
  - Build serverless proxy for the Anthropic API (platform TBD)
  - Wire up GitHub → platform auto-deploy
  - Light per-IP rate limit in the proxy to protect API spend

## Architecture

Single-file HTML, vanilla JS, no build step. Three Web Audio voices recreate the NES APU (50% pulse lead, 25% pulse harmony, triangle bass) via Fourier-coefficient PeriodicWave construction. Jingle and avatar generation happen in parallel via `Promise.allSettled` against the Anthropic Messages API. Each guest stores arrays of versioned jingles and avatars; reroll appends rather than overwrites.

See `docs/architecture.md` for the full picture.

## Tech Stack

- HTML / vanilla JavaScript / CSS (no React, no build step, no bundler)
- Web Audio API (online context for playback, OfflineAudioContext for WAV rendering)
- Claude API — model: `claude-sonnet-4-20250514`
- Browser `localStorage` for persistence
- Google Fonts (Press Start 2P, VT323) for the NES aesthetic
- **Deployment target:** TBD — likely Cloudflare Pages with Functions

## Key Active Decisions

See `docs/decision-log.md` for full rationale. Headlines:

- **DEC-001:** Vanilla JS single-file app, not React — audio synthesis is imperative
- **DEC-002:** Three-voice synthesis matching NES APU channels
- **DEC-003:** Pulse waves via Fourier coefficients (`PeriodicWave`), not `osc.type='square'`, so duty cycles are authentic
- **DEC-006:** Versioned arrays for both jingles and avatars; reroll appends. Combined with JSON backup export/import.
- **DEC-008:** WAV download via `OfflineAudioContext` + hand-rolled 16-bit PCM encoder (no external libraries)
- **DEC-010:** Serverless proxy in front of the Anthropic API to keep the key off the client (platform TBD)

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
