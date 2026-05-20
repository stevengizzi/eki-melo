# Architecture

> Technical blueprint. How the system is built.
> Last updated: 2026-05-20

## Overview

Single-file HTML web app with no build step. All synthesis, rendering, and API orchestration happens in the browser. A thin serverless proxy holds the Anthropic API key and forwards requests from the client to the Claude Messages API.

## Components

```
┌─────────────────────────────────────────────────────────┐
│  Browser (index.html — one file, vanilla JS)            │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  UI layer   │  │  Synthesis   │  │  Avatar      │  │
│  │  (render,   │  │  (Web Audio, │  │  rendering   │  │
│  │   handlers) │  │   live +     │  │  (canvas,    │  │
│  │             │  │   offline)   │  │   raf loop)  │  │
│  └─────────────┘  └──────────────┘  └──────────────┘  │
│         │                │                   │           │
│         └────────┬───────┴───────────────────┘           │
│                  │                                       │
│         ┌────────▼────────┐                              │
│         │  Storage layer  │  ← feature-detected:         │
│         │  (adapter)      │     window.storage (artifact)│
│         └─────────────────┘     localStorage (browser)   │
│                  │                                       │
│         ┌────────▼────────┐                              │
│         │  JSON backup    │                              │
│         │  export/import  │                              │
│         └─────────────────┘                              │
│                                                          │
└─────────────────────────────────────────────────────────┘
                  │
                  │  POST /api/generate
                  ▼
┌─────────────────────────────────────────────────────────┐
│  Serverless proxy (Cloudflare Pages Function or similar)│
│                                                          │
│  - Reads ANTHROPIC_API_KEY from env                     │
│  - Adds x-api-key + anthropic-version headers           │
│  - Per-IP rate limit (TBD)                              │
│  - Forwards body to api.anthropic.com/v1/messages       │
│  - Returns response as-is                               │
└─────────────────────────────────────────────────────────┘
                  │
                  ▼
          api.anthropic.com (Claude Sonnet 4)
```

## Tech Stack

**Frontend:**
- HTML5, vanilla JavaScript (ES2020+), CSS (no preprocessor)
- Web Audio API (online `AudioContext` for playback, `OfflineAudioContext` for WAV rendering)
- HTML Canvas 2D for avatar sprites (with `image-rendering: pixelated` for crisp scaling)
- Google Fonts: Press Start 2P (display), VT323 (body)
- Browser `localStorage` for persistence (with `window.storage` fallback when running in Claude.ai artifact context)

**API:**
- Anthropic Claude API, model `claude-sonnet-4-20250514`
- Two parallel calls per guest generation (jingle + avatar) via `Promise.allSettled`

**Deployment:**
- Static hosting on a platform that supports serverless functions (Cloudflare Pages, Vercel, Netlify — TBD)
- Single serverless function: `/api/generate` proxies to Anthropic with key injection

## File Structure

```
eki-melo/
├── index.html              ← the entire app
├── README.md
├── CHANGELOG.md
├── CLAUDE.md
├── docs/
│   ├── project-knowledge.md
│   ├── architecture.md     ← this file
│   └── decision-log.md
├── functions/              ← Cloudflare Pages convention
│   └── api/
│       └── generate.js     ← serverless proxy (TBD)
└── archive/                ← preserved earlier versions
    ├── eki_greetings_v1.html
    └── eki_greetings_v2.html  (the artifact-runtime version)
```

## Key Patterns

### Storage adapter (planned)
A small adapter that exposes the same async `get(key)` / `set(key, value)` / `delete(key)` interface backed by either `window.storage` (when running in the Claude.ai artifact runtime) or `localStorage` (when running standalone). Feature detection on `typeof window.storage !== 'undefined'`. Same `STORAGE_KEY = 'eki_guests_v1'` and same non-destructive migration logic regardless of backend.

### Endpoint detection (planned)
`const API_ENDPOINT = (typeof window.storage !== 'undefined') ? 'https://api.anthropic.com/v1/messages' : '/api/generate';` — uses the same artifact-context signal to choose whether to hit the API directly (proxied automatically by the artifact runtime) or via the deployed proxy.

### Versioned arrays for user-generated content
Both `jingles` and `avatars` are arrays per guest, with a cursor field (`currentJingleIndex`, `currentAvatarIndex`). Reroll always appends; navigation cursors are user-controlled. No automatic deletion — pruning happens only via the JSON backup workflow.

### Synthesis function works on either AudioContext type
`scheduleJingle(ctx, dest, jingle, startTime, periodicWaves)` takes the context as a parameter, so the same code drives live playback (online context) and WAV export (offline context).

### Hand-rolled WAV encoder
44-byte WAV header + 16-bit signed PCM interleaved samples. ~30 lines. Keeps the single-file constraint intact (no external libraries).

### Schema migration on read, not on write
`loadGuests()` checks for the old `{jingle: {...}}` shape on each guest and transforms in memory to the new `{jingles: [...], currentJingleIndex, avatars, currentAvatarIndex}` shape. Writes the migrated data back only after successful in-memory transformation. Idempotent (already-migrated guests pass through unchanged).

### Pixel sprite format
24×24 grid stored as an array of 24 strings, each 24 hex characters long. Each character is a palette index (0 = transparent, 1–15 = colors from the `palette` array). Two frames per avatar for subtle idle animation at 3 fps. Render loop uses `requestAnimationFrame` for cross-tab efficiency.

### Aesthetic ground rules
NES "select character" screen vibe. Dark purple palette anchored by `#0d0221`. Pixel-art borders via layered box-shadows. Scanline overlay via repeating-linear-gradient. Glow-pulse animation on the currently-playing card. Animated red playhead on the piano-roll viz. Press Start 2P for headers, VT323 for body — both monospace, both pixel-era.
