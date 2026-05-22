# Architecture

> Technical blueprint. How the system is built.
> Last updated: 2026-05-22

## Overview

Vanilla-JS web app with no build step — `index.html` markup plus ES modules under `js/` and a single `styles.css`, served directly (no bundler). All synthesis and rendering happen in the browser. Two serverless Pages Functions hold the API keys and orchestrate outbound calls: `/api/generate` proxies jingle requests to the Claude Messages API, and `/api/avatar` runs a two-stage avatar pipeline (Claude designs a character spec, then PixelLab's PixFlux model renders the sprite). Both keys stay server-side.

## Components

```
┌─────────────────────────────────────────────────────────┐
│  Browser (index.html + js/ ES modules, vanilla JS)      │
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
                  │                                  │
        POST /api/generate                  POST /api/avatar
              (jingle)                    (name + description)
                  │                                  │
                  ▼                                  ▼
┌──────────────────────────┐   ┌────────────────────────────────────┐
│ Pages Function           │   │ Pages Function /api/avatar          │
│ /api/generate            │   │ (functions/api/avatar.js)           │
│                          │   │                                      │
│ - Reads ANTHROPIC_API_KEY│   │ Stage 1 — Claude designs the         │
│ - Adds x-api-key +       │   │   character spec (archetype, hooks,  │
│   anthropic-version      │   │   palette, visualPrompt) using       │
│ - Per-IP rate limit (TBD)│   │   ANTHROPIC_API_KEY                  │
│ - Forwards body to       │   │ Stage 2 — PixelLab PixFlux renders a │
│   api.anthropic.com      │   │   64×64 transparent PNG from the     │
│ - Returns response as-is │   │   visualPrompt using PIXELLAB_API_KEY│
└──────────────────────────┘   │ - Returns { ...spec, imageData }     │
                  │             └────────────────────────────────────┘
                  │                    │                      │
                  ▼                    ▼                      ▼
       api.anthropic.com      api.anthropic.com     api.pixellab.ai
       (Claude Sonnet 4)      (Claude Sonnet 4)     (PixFlux model)
```

## Tech Stack

**Frontend:**
- HTML5, vanilla JavaScript (ES2020+), CSS (no preprocessor)
- Web Audio API (online `AudioContext` for playback, `OfflineAudioContext` for WAV rendering)
- HTML Canvas 2D for avatar sprites (with `image-rendering: pixelated` for crisp scaling)
- Google Fonts: Press Start 2P (display), VT323 (body)
- Browser `localStorage` for persistence (with `window.storage` fallback when running in Claude.ai artifact context)

**API:**
- Anthropic Claude API, model `claude-sonnet-4-20250514` — composes jingles and (since v7) designs avatar character specs
- PixelLab API, PixFlux model (`POST /v2/create-image-pixflux`) — renders 64×64 transparent-background pixel sprites from the Claude-authored visual prompt (Bearer auth)
- The client fires two parallel requests per guest via `Promise.allSettled`: `/api/generate` (jingle) and `/api/avatar` (avatar). The avatar request is itself a server-side two-stage Claude→PixelLab pipeline.

**Deployment:**
- Static hosting on a platform that supports serverless functions (Cloudflare Pages — the `functions/` convention is in use)
- Two serverless functions: `/api/generate` (jingle proxy) and `/api/avatar` (Claude→PixelLab avatar orchestration). Secrets: `ANTHROPIC_API_KEY` and `PIXELLAB_API_KEY`.

## File Structure

The client code is split into ES modules under `js/`; `index.html` is markup
only and loads `styles.css` plus `js/main.js` (`type="module"`). Load order is
the import graph, not script-tag order. No build step — Cloudflare Pages serves
the files directly and the browser resolves the imports (DEC-013).

```
eki-melo/
├── index.html              ← markup; loads styles.css + js/main.js
├── styles.css              ← all CSS
├── js/
│   ├── env.js              ← IS_ARTIFACT, API/AVATAR endpoints, storage detection
│   ├── storage.js          ← STORAGE_KEY, guests, setGuests, migrate/load/save
│   ├── jingle/
│   │   ├── engines.js      ← dual-engine dispatcher (v1 | pipeline) + 60s timeout
│   │   ├── synth.js        ← pulse synthesis, LiveSynth, synth singleton, WAV render [read-only]
│   │   ├── composition.js  ← JINGLE_SYSTEM_PROMPT — the v1 musical brief [read-only]
│   │   ├── api.js          ← v1 generateJingle (the single-prompt request to Claude) [read-only]
│   │   ├── render.js       ← renderPianoRoll + playhead animation [read-only]
│   │   ├── theory/         ← music-theory layer: scales/modes, forms, motifs,
│   │   │                      roman-numeral, cadences, voice-leading, textures,
│   │   │                      pitch + the verify-*.mjs offline test scripts
│   │   └── pipeline/       ← the 10-stage composer:
│   │       │                  stage-1-aesthetic (LLM)  stage-2-macro (deterministic)
│   │       │                  stage-3-harmony (LLM)    stage-4-motifs (LLM, phrases)
│   │       │                  stage-5a-phrase (LLM, arrangement)  stage-5b-texture (LLM)
│   │       │                  stage-6-voice / 7-leading / 8-cadence (deterministic)
│   │       └──                pipeline-runner + pipeline-config (freedom knobs)
│   │                          (+ stage-4-cells-LEGACY / stage-5a-development-LEGACY,
│   │                           the retained cell-vs-phrase A/B path behind motif_architecture)
│   ├── avatar/
│   │   ├── api.js          ← generateAvatar (client caller for /api/avatar)
│   │   └── render.js       ← renderAvatar dispatch, mountAvatars, avatarAnimations
│   ├── ui.js               ← render, renderGuestCard, escapeHtml, errors, toast
│   ├── handlers.js         ← orchestration: click/keyboard handlers
│   └── main.js             ← event wire-up + loadGuests() init
├── README.md
├── CHANGELOG.md
├── CLAUDE.md
├── docs/
│   ├── project-knowledge.md
│   ├── architecture.md     ← this file
│   └── decision-log.md
├── functions/              ← Cloudflare Pages convention
│   └── api/
│       ├── generate.js     ← jingle proxy → Anthropic
│       └── avatar.js       ← avatar pipeline → Claude + PixelLab
└── archive/                ← preserved earlier versions
    ├── eki_greetings_v1.html
    └── eki_greetings_v2.html  (the artifact-runtime version)
```

### Module graph notes
- `storage.js` exposes `guests` as a live module binding: importers read it and
  mutate it in place (`push`/`unshift`), and reassign through `setGuests()` so the
  binding updates for every importer. `storage.js` imports only `env.js` — it has
  no UI dependency, so `loadGuests()` does not render; `main.js` runs
  `loadGuests().then(render)`.
- `jingle/composition.js` owns *what a jingle should be* (the system prompt);
  `jingle/api.js` owns *how we ask Claude* (the request). The split gives future
  composition logic a home apart from the network plumbing.
- `ui.js` and `jingle/render.js` form a deliberate import cycle (`renderGuestCard`
  needs `renderPianoRoll`; `renderPianoRoll` needs `escapeHtml`). ES modules
  resolve it because both bindings are used at call time, not module-eval time.
- `jingle/render.js` wires `synth.onStart`/`synth.onEnd` to the playhead at module
  load; `synth` is the singleton exported by `jingle/synth.js`.

## Key Patterns

### Composition engines (dual: v1 + 10-stage pipeline)
Two engines compose jingles; the user picks one per generation via the Add-Guest form's ENGINE toggle. `js/jingle/engines.js` is the single dispatcher — `generateJingle({ guestName, mood, engine })` — runs the chosen engine under a 60s timeout, tags the result with `engine`, attaches `pipelineMetadata` for pipeline jingles, throws a structured `EngineError ({ engine, stage?, message, cause })` on failure, and logs one line per generation. No auto-fallback: a failure surfaces a "retry with the other engine" affordance in `handlers.js`, preserving the deliberate choice. See DEC-014.

- **v1** — `composition.js` (the system prompt) + `api.js` (`generateJingle(name, description)`): one LLM call → one jingle JSON. `engines.js` calls it verbatim and tags `engine: 'v1'`. Unchanged from before the rebuild.
- **pipeline** — `pipeline/pipeline-runner.js`'s `runPipelineGenerating` threads seven upstream stages then a deterministic back-half:
  1. **Stage 1 — aesthetic** (LLM): free-text vibe → a small Aesthetic dict (mood label, optional key/mode/tempo/register/form hints with `"auto"` deferral, intensity).
  2. **Stage 2 — macro** (deterministic, no LLM): Aesthetic → MacroParams (tonic/mode/form/total_bars/sections/tempo/register/harmonic_rhythm). Honors each hint, falls back to mood-keyed defaults for `"auto"`, downsizes a 4-section form to AB when the 32-beat budget would cramp it (§7.7). `deriveKnobs` overlays intensity-derived freedom knobs onto the config threaded downstream (unless `config.user_knobs_override`).
  3. **Stage 3 — harmony** (LLM): per-section Roman-numeral progression + cadence, validated against the mode's grammar.
  4. **Stage 4 — melodic phrases** (LLM): one phrase per section over that section's harmony (the Session-12 phrase-motif model).
  5. **Stage 5a — arrangement** (LLM): place each phrase literally or varied, with a deterministic beat-length/overflow check.
  6. **Stage 5b — texture** (LLM): per-bar harmony texture + bass pattern.
  7. **Stages 6/7/8** (deterministic): voice realization (Pitch objects) → voice-leading repair → cadence enforcement → render to the synth's `[pitch, duration]` alphabet.

  The runner is two entry points: a synchronous `runPipeline` that requires every upstream artifact (the hand-supplied/verifier path), and the async `runPipelineGenerating` that fills any absent artifact via its stage. The pipeline's `FinalJingle` already carries synth-ready tracks, so `engines.js`'s pipeline→playback conversion is a field-pick, and the read-only `synth.js`/`render.js` play and draw either engine identically. Each stage's offline verifier (`theory/verify-*.mjs`) exercises it through a `__mockResponse` deterministic-fallback path with no live API call.

### Storage adapter (planned)
A small adapter that exposes the same async `get(key)` / `set(key, value)` / `delete(key)` interface backed by either `window.storage` (when running in the Claude.ai artifact runtime) or `localStorage` (when running standalone). Feature detection on `typeof window.storage !== 'undefined'`. Same `STORAGE_KEY = 'eki_guests_v1'` and same non-destructive migration logic regardless of backend.

### Endpoint detection
`API_ENDPOINT` (jingles) resolves via the artifact-context signal `IS_ARTIFACT`: `api.anthropic.com/v1/messages` when running inside the Claude.ai artifact (which proxies API calls automatically) or `/api/generate` when standalone. `AVATAR_ENDPOINT` is `'/api/avatar'` standalone but `null` in the artifact — avatars require the Pages Function (it holds the PixelLab key) and the artifact runtime cannot reach PixelLab, so `generateAvatar()` throws early in that mode. Jingles still work in artifact mode; avatars do not.

### Versioned arrays for user-generated content
Both `jingles` and `avatars` are arrays per guest, with a cursor field (`currentJingleIndex`, `currentAvatarIndex`). Reroll always appends; navigation cursors are user-controlled. No automatic deletion — pruning happens only via the JSON backup workflow.

### Synthesis function works on either AudioContext type
`scheduleJingle(ctx, dest, jingle, startTime, periodicWaves)` takes the context as a parameter, so the same code drives live playback (online context) and WAV export (offline context).

### Hand-rolled WAV encoder
44-byte WAV header + 16-bit signed PCM interleaved samples. ~30 lines. Keeps the single-file constraint intact (no external libraries).

### Schema migration on read, not on write
`loadGuests()` checks for the old `{jingle: {...}}` shape on each guest and transforms in memory to the new `{jingles: [...], currentJingleIndex, avatars, currentAvatarIndex}` shape. Writes the migrated data back only after successful in-memory transformation. Idempotent (already-migrated guests pass through unchanged). The Session-13 dual-engine extends this: `migrateJingle` adds `engine: 'v1'` to any jingle that lacks the tag (v1 was the only engine before then) and preserves `pipelineMetadata` on pipeline jingles; `loadGuests` triggers the write-back when any jingle is missing the tag. Non-destructive throughout — migrations only add defaults (DEC-007, DEC-015). The JSON backup export/import (DEC-009) carries the new fields with no format change.

### Avatar formats (versioned, two renderers)
Two avatar shapes coexist in the per-guest `avatars` array, and `renderAvatar()` dispatches on the `version` field:
- **v4 (current, PixelLab):** `version: 4` with `imageData` (a `data:image/png;base64,…` URL), `width`/`height` of 64, plus the Claude-authored metadata (`archetype`, `hooks`, `palette`, `paletteHints`, `visualPrompt`). Rendered by `renderAvatarImage()` — draws the PNG onto a canvas scaled to fill the square wrap; idle/playing motion comes from CSS, so no `requestAnimationFrame` loop runs.
- **Legacy (no `version` field):** a hex-grid sprite — an array of frame strings, each row a line of palette-index hex chars (0 = transparent), with `palette`, `fps`, and stored `width`/`height` (24×24, 32×48, or 32×32 across earlier iterations). Rendered by `renderAvatarLegacy()` with a `requestAnimationFrame` frame-swap loop. Retained read-only for backward compatibility; no new legacy avatars are produced.

### Aesthetic ground rules
NES "select character" screen vibe. Dark purple palette anchored by `#0d0221`. Pixel-art borders via layered box-shadows. Scanline overlay via repeating-linear-gradient. Glow-pulse animation on the currently-playing card. Animated red playhead on the piano-roll viz. Press Start 2P for headers, VT323 for body — both monospace, both pixel-era.
