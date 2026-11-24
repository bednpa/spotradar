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

## Deployment (free, Render)

Every commit on `main` that passes the CI checks is deployed to [Render](https://render.com) (free web service, defined in [`render.yaml`](render.yaml)).

One-time setup:

1. Sign up at render.com with your GitHub account.
2. **New → Blueprint**, select this repository – Render reads `render.yaml` and creates the `spotradar` service.
3. The app is then available at `https://spotradar.onrender.com` (or a similar URL shown in the Render dashboard).

Free plan limits: the service sleeps after 15 minutes without traffic (first request then takes ~1 minute), and in-memory / JSON file data resets on every deploy or restart.

Development rules for humans and agents are in [`CLAUDE.md`](CLAUDE.md).
