# CLAUDE.md

> Entry point for Claude Code sessions on this repo.

## Project Snapshot

EKI Melo — single-file HTML app that generates 8-bit chiptune arrival jingles and 16-bit pixel avatars for birthday-party guests, using the Anthropic Claude API. Weekend project, one user, intentionally tiny scope.

## Read These First

1. `README.md` — what the project does, how to run it
2. `docs/project-knowledge.md` — current state, tech stack, communication preferences
3. `docs/architecture.md` — components, patterns, file structure
4. `docs/decision-log.md` — why things are the way they are

Skip the workflow metarepo's heavier protocols (sprint planning, tier-3 reviews, runner orchestration) — they're not applied to this project.

## Common Operations

**Run locally** (once the serverless proxy exists):
```bash
# Cloudflare Pages local dev — TBD
wrangler pages dev .
# OR static serve if you just want to view the UI:
python3 -m http.server 8000
```

**Test changes to the HTML:**
Open the file directly in a browser. No build step. Hard-refresh after edits.

**Git workflow:** commit straight to `main`. This is a solo weekend project — no branches, no PRs, no review gates. The auto-deploy on push to main IS the deployment workflow.

**Deploy:**
Push to `main`. Auto-deploy via platform integration (TBD which platform).

## Editing Discipline

- The whole app is one file. Keep it that way unless the file crosses ~3000 lines.
- `index.html` is the canonical, deployable version. The `archive/` folder preserves historical artifact-runtime versions for reference but is not deployed.
- Every architectural change gets a DEC entry in `docs/decision-log.md`. Use the format already in the file.
- Update `CHANGELOG.md` for any user-visible change.

## Hard Constraints

- **Preserve user data above all else.** This app exists to compose jingles for real people. Storage migrations must be non-destructive (transform in memory, write back only after success). The JSON backup export must always work.
- **No external JS libraries.** Single file, vanilla JS. If something needs a library, propose it in a DEC entry first.
- **No build step.** The file must be openable and editable as-is.
- **Key never on the client.** All API calls go through the serverless proxy. Never inline an API key in the HTML.

## Things Not To Do

- Don't add React, a bundler, or a framework — see DEC-001.
- Don't replace pulse-wave synthesis with `osc.type = 'square'` — see DEC-003.
- Don't change the storage key without writing a migration — see DEC-007.
- Don't make reroll overwrite the existing version — see DEC-006.

## Context This Project Does Not Use

This project uses a deliberately light subset of `claude-workflow`. Do not invoke:
- Sprint planning protocol
- Tier-3 review protocol
- Autonomous runner
- Risk register / roadmap / sprint-history docs

The full workflow is appropriate for production software with a sprint cadence. This is a weekend party app — decision logging and the canon docs are sufficient.
