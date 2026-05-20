# EKI Melo

> An 8-bit chiptune **arrival jingle** generator for birthday parties. Each guest gets a personalized NES-style theme and a 16-bit pixel avatar. Inspired by Japanese train-station *eki melodies*.

## What it does

You enter a guest's name and a sentence about their personality. The app calls Claude to compose a 3-voice chiptune piece (square-wave lead, pulse harmony, triangle bass) with proper musical form — AABA / ABA' / ABCA — and to design a 24×24 animated pixel avatar in their character. Every reroll preserves the previous version so you can compare and pick favorites. You can download any jingle as a WAV.

The whole thing renders inline as a "character select" screen with section markers on the piano-roll visualization.

## Run locally

It's a single HTML file. Once the serverless proxy is wired up (see Deployment below), you can:

```bash
git clone https://github.com/stevengizzi/eki-melo.git
cd eki-melo
# serve locally with any static server
python3 -m http.server 8000
# visit http://localhost:8000
```

For the API calls to work outside the artifact context, you need either:
- A deployed proxy (recommended — see Deployment), or
- A local proxy (e.g. `wrangler pages dev` for Cloudflare)

## Deployment

The app needs a tiny serverless proxy in front of the Anthropic API to keep the API key off the client. See `docs/architecture.md` for the rationale.

[To be filled in after deployment platform is chosen.]

## Tech stack

- Single-file HTML, vanilla JS, no build step
- Web Audio API for chiptune synthesis (pulse waves via Fourier coefficients, triangle bass, ADSR envelopes)
- OfflineAudioContext + hand-rolled 16-bit PCM encoder for WAV export
- Claude API (`claude-sonnet-4-20250514`) for jingle and avatar generation
- Browser `localStorage` for guest persistence (with JSON backup export/import as a safety net)

## Documentation

| Document | Purpose |
|----------|---------|
| `docs/project-knowledge.md` | Project context, current state, communication preferences |
| `docs/architecture.md` | Technical blueprint and key patterns |
| `docs/decision-log.md` | DEC entries — why things are the way they are |
| `CHANGELOG.md` | Version history |
| `CLAUDE.md` | Claude Code session entry point |

## Workflow

This project uses a lightweight subset of the [claude-workflow](https://github.com/stevengizzi/claude-workflow) methodology — decision logging and the canon-doc structure, but not the full sprint cycle (it's a weekend party app, not production software). Future iteration happens via:
- **Claude.ai project** for design conversations and HTML rewrites
- **Claude Code** for refactors, proxy work, and deployment plumbing
- **Git** as the bridge between them
