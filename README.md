# EKI Melo

> An 8-bit chiptune **arrival jingle** generator for birthday parties. Each guest gets a personalized NES-style theme and a 16-bit pixel avatar. Inspired by Japanese train-station *eki melodies*.

## What it does

You enter a guest's name and a sentence about their personality. The app calls Claude to compose a 3-voice chiptune piece (square-wave lead, pulse harmony, triangle bass) with proper musical form — AABA / ABA' / ABCA — and to design a 24×24 animated pixel avatar in their character. Every reroll preserves the previous version so you can compare and pick favorites. You can download any jingle as a WAV.

The whole thing renders inline as a "character select" screen with section markers on the piano-roll visualization.

## Project structure

```
eki-melo/
├── index.html              ← the entire app
├── functions/
│   └── api/
│       └── generate.js     ← Cloudflare Pages Function: proxies to Anthropic
├── docs/
│   ├── project-knowledge.md
│   ├── architecture.md
│   └── decision-log.md
├── archive/                ← preserved earlier versions
│   ├── eki_greetings_v1.html
│   └── eki_greetings_v2.html
├── README.md
├── CHANGELOG.md
├── CLAUDE.md               ← Claude Code session entry point
└── .gitignore
```

## Running locally

The app requires the `/api/generate` proxy to be reachable. Easiest is Cloudflare's local dev tool:

```bash
# One-time setup
npm install -g wrangler

# Set your Anthropic API key for local use
echo 'ANTHROPIC_API_KEY="sk-ant-..."' > .dev.vars
# (.dev.vars is gitignored)

# Run the local dev server (serves the static file + runs functions)
wrangler pages dev .

# Visit http://localhost:8788
```

If you just want to preview the UI without API calls, a plain static server works (`python3 -m http.server 8000`) — composition will fail with a 404 on `/api/generate`, but the design and existing data renders.

## Deployment (Cloudflare Pages)

One-time setup:

1. **Create a Cloudflare account** at https://dash.cloudflare.com/sign-up if you don't have one.
2. **Workers & Pages → Create application → Pages → Connect to Git.**
3. **Authorize Cloudflare on GitHub**, select the `eki-melo` repo.
4. **Build settings:** leave the framework preset as "None", build command empty, build output directory `/`. There's no build step.
5. **Environment variables:** add `ANTHROPIC_API_KEY` as a **secret** (not a plaintext variable) with your `sk-ant-...` key. Set scope to "Production". Add the same secret to "Preview" if you want preview deployments to work.
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
- Claude API (`claude-sonnet-4-20250514`) via Cloudflare Pages Function proxy
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
