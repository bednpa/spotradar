# SpotRadar

SpotRadar web app – a TypeScript monorepo (npm workspaces) developed with the help of Claude Code agents and GitHub Actions.

## Structure

- `shared/` – API contract: shared types and validation schemas
- `backend/` – REST API server (no database; in-memory / JSON file state)
- `frontend/` – web UI

## Commands

```bash
npm ci              # install dependencies
npm run dev         # start frontend + backend
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

## AI agent workflow

1. Go to **Actions → Agent Feature PR → Run workflow**, describe the task and choose whether to run E2E tests.
2. Claude Code (`team-lead` agent) implements the task, runs the checks and the workflow opens a pull request.
3. `PR Verification Checks` independently runs typecheck, lint, tests, build and E2E on the PR.
4. Review and merge.

Required repository setup:

- Secret `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions)
- Settings → Actions → General → **Allow GitHub Actions to create and approve pull requests**

Development rules for humans and agents are in [`CLAUDE.md`](CLAUDE.md).
