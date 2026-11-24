# SpotRadar – project architecture and workflow

SpotRadar is a web application without a database (state is kept in memory or in a local JSON file on the backend).
It is a TypeScript monorepo using npm workspaces, split into three separate parts:

- `shared/` – Shared TypeScript types, DTO interfaces and validation schemas (the single source of truth for the API contract).
- `backend/` – HTTP REST API server and its integration tests.
- `frontend/` – Client web application (UI) and its component tests.

## Commands (run from the repository root)

- Start the dev environment (frontend + backend): `npm run dev`
- Type-check the whole project: `npm run typecheck`
- Lint: `npm run lint`
- Unit and API integration tests: `npm test`
- End-to-end tests (Playwright): `npm run test:e2e`
- Production build: `npm run build`

The root scripts call the same script in every workspace (`--workspaces --if-present`).
Every workspace must therefore define its own `typecheck`, `lint`, `test` and `build` scripts
(and `dev` / `test:e2e` where relevant), otherwise CI silently skips that check for it.

## Development and testing rules (contract-first)

1. **Strict folder separation:**
   - Backend changes belong only in `backend/`.
   - Frontend changes belong only in `frontend/`.
   - Shared types and validation schemas belong only in `shared/`.
   - Import shared code via the workspace package name (e.g. `@spotradar/shared`), never via relative paths across workspaces.
2. **Every change needs tests:**
   - Every new function, endpoint, filter or validation rule must have a matching **unit / integration test** (`npm test`).
   - If E2E mode is enabled (`run_e2e: true`), also add or update a **Playwright E2E test** (`npm run test:e2e`) covering the main user scenario and the error/empty state.
3. **No fake mocks in the production UI:** The frontend must talk to the real endpoints defined by the contract in `shared/`.
4. **Type safety:** Do not use `any`, `@ts-ignore` or linter suppressions without an explicit justification in a comment.
5. **Dependencies:** Install packages with `npm install <pkg> -w <workspace>` and always keep `package-lock.json` in sync – CI uses `npm ci` and fails without it.
6. **Verify before finishing:** No task is done until `npm run typecheck`, `npm run lint` and `npm test` pass (plus `npm run test:e2e` when E2E mode is enabled).

## Deployment (Render, free plan)

The app is deployed from `main` to Render as a single Node web service (see `render.yaml`).
Render runs `npm ci && npm run build`, then `npm start`. To keep that working:

- Root `npm start` runs the `start` script of `@spotradar/backend` – it must start the **production** server (built code, no watch mode).
- The backend listens on `process.env.PORT` (fallback e.g. `3000`) on host `0.0.0.0`.
- The backend serves the built frontend as static files (with SPA fallback to `index.html`) and the API under `/api`.
- The frontend calls the API with relative URLs (`/api/...`); in development use the dev server proxy instead of hard-coded hosts.
- `GET /api/health` must return HTTP 200 – Render uses it as the health check.
- State is ephemeral on the free plan: memory and local JSON files reset on every deploy, restart or sleep (after 15 min idle). Seed sensible initial data on startup.

## Agents and CI

- `.claude/agents/team-lead.md` (Opus) – owns the contract in `shared/`, delegates backend/frontend work, integrates and coordinates QA.
- `.claude/agents/backend-dev.md` (Sonnet) – implements `backend/` against the frozen contract; never edits `shared/`.
- `.claude/agents/frontend-dev.md` (Sonnet) – implements `frontend/` against the frozen contract; never edits `shared/`.
- `.claude/agents/qa-reviewer.md` (Sonnet) – read-only code review and browser testing via Playwright MCP.
- `.github/workflows/agent-pr.yml` – manually triggered: runs the agent on a task and opens a PR.
- `.github/workflows/pr-checks.yml` – runs typecheck, lint, tests, build and E2E on every PR.

In CI the agent runs non-interactively: do not wait for plan approval, and do not commit or push –
the workflow commits and opens the PR itself.
