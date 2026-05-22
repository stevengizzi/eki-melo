# EKI Melo

> An 8-bit chiptune **arrival jingle** generator for birthday parties. Each guest gets a personalized NES-style theme and a 16-bit pixel avatar. Inspired by Japanese train-station *eki melodies*.

## What it does

You enter a guest's name and a sentence about their personality, pick a composition **engine**, and the app composes a 3-voice chiptune piece (square-wave lead, pulse harmony, triangle bass) with proper musical form — AABA / ABA' / ABCA — and designs a pixel-art character: Claude writes the character spec, then PixelLab's PixFlux model renders a 64×64 sprite. Every reroll preserves the previous version so you can compare and pick favorites. You can download any jingle as a WAV.

**Two composition engines (you choose per guest):**

- **Pipeline** (default) — a 10-stage composer (`js/jingle/pipeline/`, with the music-theory layer in `js/jingle/theory/`): an LLM interprets the vibe into an aesthetic, deterministic code picks the macro parameters (key/mode/form/tempo), then LLM stages write the harmony, the melodic phrases, the arrangement, and the texture, and deterministic stages realize the voices, fix the voice-leading, and enforce the cadences. The LLM makes the soft creative calls; the code enforces the hard music-theory rules.
- **v1** (classic) — the original single-prompt generator (`js/jingle/composition.js` + `api.js`): one prompt to Claude, one jingle JSON back.

The chosen engine is recorded on each jingle and badged in the archive; if one engine fails you can retry with the other. The whole thing renders inline as a "character select" screen with section markers on the piano-roll visualization. See DEC-014.

## Project structure

```
eki-melo/
├── index.html              ← markup only; loads styles.css + js/main.js
├── styles.css
├── js/                     ← ES modules (no build step; the import graph is load order)
│   ├── main.js             ← event wire-up + initial load
│   ├── env.js              ← artifact/browser endpoint + storage detection
│   ├── storage.js          ← guests, migrate/load/save (per-jingle engine field)
│   ├── ui.js               ← render, guest cards, engine badge
│   ├── handlers.js         ← generate/reroll dispatch (+ retry-with-other-engine)
│   ├── jingle/
│   │   ├── engines.js      ← dual-engine dispatcher (v1 | pipeline)
│   │   ├── composition.js  ← v1 system prompt (read-only)
│   │   ├── api.js          ← v1 generateJingle (read-only)
│   │   ├── synth.js        ← chiptune synthesis + WAV (read-only)
│   │   ├── render.js       ← piano-roll renderer (read-only)
│   │   ├── theory/         ← scales, modes, forms, motifs, cadences, voice-leading, verifiers
│   │   └── pipeline/       ← the 10-stage composer (stage-1…stage-8 + runner + config)
│   └── avatar/             ← avatar api + render
├── functions/
│   └── api/
│       ├── generate.js     ← Cloudflare Pages Function: proxies jingles to Anthropic
│       └── avatar.js       ← Cloudflare Pages Function: Claude → PixelLab avatar pipeline
├── docs/
│   ├── project-knowledge.md
│   ├── architecture.md
│   ├── decision-log.md
│   ├── composition-engine-buildplan.md   ← the 12-session rebuild plan
│   └── buildplan-journal.md              ← per-session build journal
├── archive/                ← preserved earlier single-file versions
├── README.md
├── CHANGELOG.md
├── CLAUDE.md               ← Claude Code session entry point
└── .gitignore
```

## Running locally

The app requires the `/api/generate` and `/api/avatar` functions to be reachable. Easiest is Cloudflare's local dev tool:

```bash
# One-time setup
npm install -g wrangler

# Set your API keys for local use (.dev.vars is gitignored)
cat > .dev.vars <<'EOF'
ANTHROPIC_API_KEY="sk-ant-..."
PIXELLAB_API_KEY="your-pixellab-token"
EOF

# Run the local dev server (serves the static file + runs functions)
wrangler pages dev .

# Visit http://localhost:8788
```

If you just want to preview the UI without API calls, a plain static server works (`python3 -m http.server 8000`) — composition will fail with a 404 on `/api/generate`, but the design and existing data renders. (Avatars also need `/api/avatar` + a PixelLab key; jingles need `/api/generate` + an Anthropic key.)

## Deployment (Cloudflare Pages)

One-time setup:

1. **Create a Cloudflare account** at https://dash.cloudflare.com/sign-up if you don't have one.
2. **Workers & Pages → Create application → Pages → Connect to Git.**
3. **Authorize Cloudflare on GitHub**, select the `eki-melo` repo.
4. **Build settings:** leave the framework preset as "None", build command empty, build output directory `/`. There's no build step.
5. **Environment variables:** add `ANTHROPIC_API_KEY` (your `sk-ant-...` key) and `PIXELLAB_API_KEY` (your PixelLab token) as **secrets** (not plaintext variables). Set scope to "Production". Add the same secrets to "Preview" if you want preview deployments to work. Get a PixelLab token at https://www.pixellab.ai/signin.
6. **Save and deploy.** First deployment takes ~30 seconds.

After deployment:
- Production URL: `https://eki-melo.pages.dev` (or your custom subdomain)
- Every push to `main` triggers a new deployment automatically
- Branch pushes get preview URLs

## First-run data restore

If you have a JSON backup from the Claude.ai artifact preview, click `↑ IMPORT BACKUP` in the deployed app and select the file. Your guests, jingle versions, and avatars will restore from disk.

Keep backups outside the repo — `.gitignore` blocks them from accidentally being committed, but a folder like `~/Documents/eki-melo-backups/` is a sensible home.

## Tech stack

- Single-file HTML, vanilla JS, no build step
- Web Audio API for chiptune synthesis (pulse waves via Fourier coefficients, triangle bass, ADSR envelopes)
- OfflineAudioContext + hand-rolled 16-bit PCM encoder for WAV export
- Claude API (`claude-sonnet-4-20250514`) via Cloudflare Pages Function proxy — jingles and avatar character specs
- PixelLab API (PixFlux) for avatar sprite rendering, orchestrated server-side by `/api/avatar`
- Browser `localStorage` for persistence (`window.storage` adapter when running in Claude.ai artifact context)

## Documentation

| Document | Purpose |
|----------|---------|
| `docs/project-knowledge.md` | Project context, current state, communication preferences |
| `docs/architecture.md` | Technical blueprint and key patterns |
| `docs/decision-log.md` | DEC entries — why things are the way they are |
| `CHANGELOG.md` | Version history |
| `CLAUDE.md` | Claude Code session entry point |

## Workflow

This project uses a lightweight subset of the [claude-workflow](https://github.com/stevengizzi/claude-workflow) methodology — decision logging and the canon-doc structure, but not the full sprint cycle. Future iteration happens via:

- **Claude.ai project** for design conversations and HTML rewrites (the storage adapter means the same `index.html` works in the artifact runtime)
- **Claude Code** for refactors, proxy work, and deployment plumbing
- **Git** as the bridge between them
