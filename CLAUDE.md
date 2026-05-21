# CLAUDE.md

> Entry point for Claude Code sessions on this repo.

## Project Snapshot

EKI Melo — vanilla-JS web app that generates 8-bit chiptune arrival jingles and pixel-art avatars for birthday-party guests. Uses the Claude API for composition and PixelLab for sprite rendering. Single developer, deployed at https://eki-melo.pages.dev via Cloudflare Pages.

## Read These First

1. `README.md` — what the project does, how to run it
2. `docs/project-knowledge.md` — current state, tech stack, communication preferences
3. `docs/architecture.md` — components, patterns, file structure
4. `docs/decision-log.md` — why things are the way they are

## File Layout

Client code is split into ES modules under `js/`. `index.html` is markup only; it loads `styles.css` and `js/main.js` as a single module entry point. Load order is the import graph, not script-tag order. The full layout and rationale are in DEC-013.

Server-side Pages Functions live in `functions/api/`. `generate.js` proxies jingle requests to Anthropic; `avatar.js` runs the Claude→PixelLab pipeline. Their paths ARE their routes (Cloudflare Pages convention), so don't relocate them.

## Common Operations

**Run locally:**
```bash
# Full stack (recommended — exercises the Pages Functions):
wrangler pages dev .

# UI only (Functions return 404; the artifact-mode fallback in js/env.js
# means jingles still work via direct Anthropic calls, but avatars don't):
python3 -m http.server 8000
```

Open the served URL in a browser. No build step. Hard-refresh after edits.

**Git workflow:** commit straight to `main`. Solo developer, no branches or PRs. Auto-deploy on push IS the deployment workflow.

**Deploy:** push to `main`. Cloudflare Pages picks it up.

## Hard Constraints

These have real teeth and apply regardless of how small a change feels:

- **Preserve user data above all.** Storage migrations must be non-destructive (transform in memory, write back only after success). The JSON backup export must always work. See DEC-007, DEC-009.
- **API keys never on the client.** All Anthropic calls go through `functions/api/generate.js`; all PixelLab calls go through `functions/api/avatar.js`. The only direct-to-`api.anthropic.com` path is the artifact-runtime branch in `js/env.js`, which exists because the Claude.ai artifact runtime proxies it automatically. See DEC-010.
- **No build step.** Files are served directly; ES modules resolve in the browser. Introducing a bundler is a posture change — propose it as a DEC entry first.
- **No frameworks (React, Vue, etc.).** Audio synthesis is imperative; the rest of the app is simple enough not to need component machinery. See DEC-001 (the single-file aspect of which is superseded by DEC-013; the no-framework aspect still holds).
- **Both runtime modes must keep working.** The same code runs in deployed Cloudflare Pages (`localStorage` + `/api/*`) AND in the Claude.ai artifact runtime (`window.storage` + direct `api.anthropic.com` for jingles; avatars unavailable). The detection seam in `js/env.js` is the only point that distinguishes them — keep it intact.

External JS libraries are not banned, but introduce one only when the alternative is materially worse. Log it as a DEC entry.

## Editing Discipline

- Every architectural change gets a `DEC-NNN` entry in `docs/decision-log.md`. Format follows the existing entries.
- User-visible changes get a `CHANGELOG.md` entry.
- Pattern or component-graph changes get reflected in `docs/architecture.md`.
- Trivial edits (typos, small refactors, prompt tweaks within an existing approach) don't need DEC entries.

## Picking the Right Solution

This is a single-user app with no SLA, no team, and no cross-release migration burden — which means the cost of choosing the wrong abstraction is low and the freedom to pick whatever fits is high. Don't pre-emptively default to "minimal because the project is small." If a more involved solution is genuinely the right shape (a dedicated module, a richer data structure, a more deliberate process), do it. If the simple thing fits, do that. Decide on merits, not on project label.

The constraints above are what's non-negotiable; everything else is a judgment call. When a change has real tradeoffs, name them — don't present only the upside.

## Workflow

This project uses a light subset of `claude-workflow`: decision logging, canon docs (`docs/`), README discipline, changelog discipline. The heavier protocols (sprint planning, tier-3 reviews, adversarial review, autonomous runner, risk register, roadmap, sprint history, mid-sprint doc-sync, in-flight triage, campaign orchestration) are designed for multi-developer cadence and aren't currently applied. If a situation comes up where one genuinely would help, it's fine to invoke it — just don't reach for them by default.

## Things Not To Do

- Don't replace pulse-wave synthesis with `osc.type = 'square'` — kills the NES timbre. See DEC-003.
- Don't change `STORAGE_KEY` without writing a migration that preserves existing guest data. See DEC-007.
- Don't make reroll overwrite the existing version. The versioned-array structure is deliberate. See DEC-006.
- Don't move files under `functions/api/` — their paths are their routes.