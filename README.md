# SpotRadar

SpotRadar is a web application built with TypeScript: a REST API backend and a browser frontend that share one typed API contract.
It deliberately has no database – state lives in memory or in a local JSON file on the backend – which keeps it simple to run, test and host for free.

The app is developed mainly by AI agents (Claude Code) running in GitHub Actions: you describe a feature, an agent implements it and opens a pull request, automated checks verify it, and after merge it is deployed automatically.

**Live app:** https://spotradar.onrender.com
_(on the free plan the first request after 15 minutes of inactivity takes about a minute while the app wakes up)_

## What it does

SpotRadar is a **badminton court finder for Brno** with a modern, app-like UI (light and dark) and two pages in the top bar:

- **Reserve** (`/`) – a **Day / Week / Month / Year** availability calendar (today … +14 days) with a swipeable **date
  strip**, a **sport** filter (badminton for now) and a location filter: type an address and pick one of the **live
  suggestions**, or tap the arrow icon in the field to use your location, then set a max distance. The calendar shows
  **only free courts from live data**. Click an hour to open a panel listing the venues with free courts (with price,
  MultiSport terms, website, Google Maps and a **"Book on venue's website"** link) and when each was checked ("checked
  5 min ago"). Venues without live data are listed in a collapsed "check on website" section.
- **Venues** (`/venues`) – a searchable directory of all venues: sports and other activities, courts, opening hours,
  price, MultiSport acceptance and terms, address, website, booking link, phone and a Google Maps link for ratings and reviews.

The view and filters are kept in the URL, so links are shareable. Free courts are **read from the venues' own public
booking pages** (where a connector exists) via `GET /api/calendar`.
**SpotRadar never books anything itself** – booking always happens on the venue's website.

Availability is read live (cached for 15 minutes per venue and date, pre-loaded in the background) and may be a few
minutes old – the panel always shows when it was checked.

### Data sources and connector status

Venues are a static data file in the backend (`backend/src/data/venues.ts`). Each venue declares its booking system
(`availabilitySource`) and a backend-only connector configuration. Connectors implement a pluggable
`AvailabilityConnector` interface, so new booking systems can be added without touching the search logic.

| Venue                  | District          | Courts | Booking system | Connector status                                           |
| ---------------------- | ----------------- | ------ | -------------- | ---------------------------------------------------------- |
| Sportcentrum Kuklenská | Brno-Židenice     | 4      | ClubSpire      | ✅ live                                                    |
| Centrum Viktoria       | Brno-Komárov      | 3      | ClubSpire      | ✅ live                                                    |
| Hala Sprint            | Brno-Královo Pole | 6      | MemberZone     | ✅ live                                                    |
| Sportcentrum Ivanovice | Brno-Ivanovice    | 3      | MemberPro      | ✅ live                                                    |
| Badminton Jehnice      | Brno-Jehnice      | 5      | Bizzy          | ✅ live (`unavailable` while the host refuses our servers) |
| Badminton Líšeň        | Brno-Líšeň        | 6      | Bizzy          | ✅ live (`unavailable` while the host refuses our servers) |
| X-Arena Slatina        | Brno-Slatina      | 6      | Bizzy          | ✅ live, bookings ≥ 2 h ahead only                         |

Other sports (per sport: live / all venues; details and blockers in the docs):

| Sport            | Live / venues | Live through                                                                                                                   | Still "check on website" (why)                                                                                                                     |
| ---------------- | ------------: | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tennis           |        4 / 10 | Hala Sprint (MemberZone), Tenisová hala Kohoutovice (Rezzy), Tenisový areál Komárov (own timetable), ŽLTC (own app, Firestore) | Viktoria (outdoor row free all winter), Club Classic (no page), Tenis Paradise (Cloudflare challenge), TK Tesla, Lužánky (phone), TJ Start (login) |
| Squash           |         4 / 5 | Viktoria, Fitness Boby (ClubSpire), Ivanovice (MemberPro), Squash Slovan (iSportSystem)                                        | ZONE4YOU (different scheduler app)                                                                                                                 |
| Padel            |         3 / 4 | Viktoria (ClubSpire), Padel Powers Slatina + Kraví hora (PadelOS)                                                              | Padel Club Brno (login)                                                                                                                            |
| Table tennis     |         1 / 2 | Ivanovice (MemberPro)                                                                                                          | Club Classic (no page)                                                                                                                             |
| Volleyball       |         1 / 1 | TJ Tesla – Sportovní hala Lesná (Reenio)                                                                                       | –                                                                                                                                                  |
| Beach volleyball |         2 / 4 | Beach Riviéra (STAREZ), Viktoria in season (ClubSpire)                                                                         | Club Classic (no page), Kraví hora (client zone needs login)                                                                                       |

Availability status per venue: `live` (read from the booking page), `unavailable` (a connector exists but reading failed –
the search still succeeds), `unknown` (no connector yet). Venues without
live data are listed under **"check on website"** in the slot panel – a free court is never guessed. How the connectors
work (including the Bizzy protocol and why its server may refuse data-centre IPs) is in
[`docs/live-data-connectors.md`](docs/live-data-connectors.md).

**Bizzy connector** (Jehnice, Líšeň, X-Arena; `*.e-rezervace.cz`, a RichFaces/JSF page): one GET, then an A4J postback
that switches to the 8-day view (`horizontal_service_dayandweek`) – one read covers 8 days; a date-change postback moves
the window. The parser reads the `scheduleData` JSON (grids, bookings as inclusive `[col, row]` rectangles, past cells)
and the `table#schedule_<gridId>` headers (date, time columns, courts). The Bizzy server often refuses connections from
data-centre IPs: that maps to `unavailable` with one warning per host per hour, and the host is backed off.

**Fast calendar loading:** the backend warms its cache in the background (right after startup, then every 10 min: today

- 6 days for every venue, one request at a time per host, skipping hosts that fail). Entries older than 15 min but younger
  than 60 min are answered immediately with their real "checked x min ago" time and refreshed in the background
  (stale-while-revalidate). After a connection failure (refused, timeout, DNS) a host is backed off for 5 → 60 min, so
  requests answer `unavailable` immediately instead of waiting for timeouts. The frontend loads the focused day first
  (skeleton for the rest of the week) and prefetches the next week. Measure against the live sites with
  `npm run measure:calendar -w @spotradar/backend`.

**MemberZone / MemberPro connectors** (Hala Sprint, Ivanovice): ASP.NET WebForms pages read with plain HTTP. A GET, then a
form postback with the page's hidden fields and session cookie switches the date. MemberZone returns a whole week of free
60-minute windows per page, which is cached briefly. MemberPro returns one day's grid of 30-minute cells. Both run on
`memberzone.cz` and share one per-host limiter.

**ClubSpire connector:** fetches the server-rendered day timeline
`{base}/timeline/day?tabIdx={tabIdx}&criteriaTimestamp={local midnight Europe/Prague in epoch ms}&resetFilter=true`
and parses it with cheerio: each court is a `tr[data-row-id]` in `table.schedule`, column start times come from the page
header, `can_book` / `can_book_substitute` cells are free unless also marked `full` / `full_substitute` / `disabled`;
half-hour "zoom" cells are split into sub-slots. It is polite to the venues: `User-Agent: SpotRadar/1.0`, 8 s timeout, at
most one concurrent request per host and a 15-minute cache per venue + date. Tests use sanitized HTML fixtures recorded from
the real pages – never the live sites. Refresh a raw page with
`npm run fetch:clubspire -w @spotradar/backend -- <baseUrl> <tabIdx> <YYYY-MM-DD> <outFile>`.

**Geocoding:** `/api/geocode` proxies [OpenStreetMap Nominatim](https://nominatim.org/) (`countrycodes=cz`,
`User-Agent: SpotRadar/1.0`, in-memory cache, max 1 request per second) in line with the
[Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/). Data © OpenStreetMap contributors.

### API (contract in `shared/src`)

| Method | Path                   | Success                      | Errors                                                                       |
| ------ | ---------------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/health`          | 200 `{ status: 'ok' }`       | –                                                                            |
| GET    | `/api/search`          | 200 `SearchResponse`         | 400 `VALIDATION_ERROR`, 422 `DATE_OUT_OF_RANGE`                              |
| GET    | `/api/calendar`        | 200 `CalendarResponse`       | 400 `VALIDATION_ERROR`, 422 `DATE_OUT_OF_RANGE`                              |
| GET    | `/api/geocode`         | 200 `GeocodeResponse`        | 400 `VALIDATION_ERROR`, 404 `LOCATION_NOT_FOUND`, 502 `GEOCODER_UNAVAILABLE` |
| GET    | `/api/geocode/suggest` | 200 `GeocodeSuggestResponse` | 400 `VALIDATION_ERROR`, 502 `GEOCODER_UNAVAILABLE`                           |
| GET    | `/api/venues`          | 200 `VenuesResponse`         | 400 `VALIDATION_ERROR`                                                       |

`/api/search` query: `sport`, `date` (YYYY-MM-DD, today … today + 14 days, Europe/Prague), optional `time` (HH:MM),
optional `lat` + `lng` (together), optional `maxDistanceKm` (requires `lat`/`lng`). Results list venues with a free court
(at `time`, or anytime that day) first, then sort by distance (or name). `/api/calendar` query: `sport`, `from` + `to`
(YYYY-MM-DD, both inside the search window, `from` ≤ `to`, at most 15 days), optional `lat` + `lng`, optional `maxDistanceKm`;
returns the matching venues plus per-day availability for each. `/api/geocode` query: `q` (2–200 characters).
`/api/geocode/suggest` query: `q` (2–200 characters); returns up to 5 Czech address suggestions (Brno-biased, empty list
when nothing matches) from [Photon](https://photon.komoot.io/) (OSM data, allows search-as-you-type; cached, calls spaced 300 ms apart).
`/api/venues` query: optional `sport`, optional `q` (max 100 characters; every word must occur in name, district or
address, ignoring case and diacritics); returns the venue directory sorted by name, each with `liveAvailability`.

### Toolchain

TypeScript runs directly via Node 22 type stripping (erasable syntax only, relative imports with `.ts` extensions), tests use
`node:test`, the backend uses `node:http` (+ `cheerio` for HTML parsing), and the frontend is vanilla TypeScript turned into
browser ES modules by `frontend/scripts/build.mjs` (with an import map for `@spotradar/shared`). `typecheck` uses `tsc`
(`tsconfig.base.json`), `lint` uses ESLint (`eslint.config.js`), formatting uses Prettier (`.prettierrc.json`), and E2E tests
use Playwright (`frontend/e2e`) against the backend started in stub mode (`npm run start:e2e -w @spotradar/backend`:
recorded fixtures instead of live booking pages and a fake geocoder).

## Repository structure

```text
spotradar/
├── shared/              # API contract: shared TypeScript types, DTOs and validation schemas
├── backend/             # REST API server (serves /api and the built frontend), integration tests
├── frontend/            # Web UI, component tests and Playwright E2E tests
├── .claude/
│   ├── agents/          # AI agent definitions (team-lead, backend-dev, frontend-dev, qa-reviewer)
│   ├── rules/           # Coding rules applied when agents work in backend/ or frontend/
│   └── settings.json    # Agent permissions and hooks (auto-format, checks before finishing)
├── .github/workflows/
│   ├── agent-pr.yml     # AI agent implements a task and opens a PR
│   └── pr-checks.yml    # Typecheck, lint, tests, build, E2E
├── .mcp.json            # Playwright MCP server – lets agents use a real browser
├── render.yaml          # Free deployment on Render
├── CLAUDE.md            # Project rules for humans and AI agents
└── package.json         # npm workspaces root and shared scripts
```

The project is **contract-first**: every feature starts with types and validation schemas in `shared/`, which both `backend/` and `frontend/` import – so the API and the UI cannot drift apart.

## How the AI workflow works

```mermaid
flowchart LR
    A[You: issue + agent label<br/>or manual run] --> B[Agent Feature PR<br/>agent-pr.yml]
    B --> C[Pull request]
    C --> D[PR Verification Checks<br/>pr-checks.yml]
    D --> E{You review<br/>and merge}
    E --> F[Checks on main]
    F --> G[Render deploys<br/>the live app]
```

### 1. Agent Feature PR (`agent-pr.yml`)

Started from a GitHub issue:

1. Open an issue – the **title** becomes the PR title, the **body** is the full task in plain language.
2. Add the **`agent`** label. The workflow starts, comments the run link on the issue and, when done, comments the PR link (or the failure).
3. The PR contains `Closes #<issue>`, so merging it closes the issue. To retry, remove and re-add the label.

Only issues written by the repository owner or collaborators are picked up, because the issue body becomes the agent's prompt.
It can also be started manually: **Actions → Agent Feature PR → Run workflow** with a `task`.
The agent always writes and runs Playwright E2E tests.

The workflow creates a new branch and runs Claude Code (Opus) as the **team-lead** agent, which:

1. designs the types and validation schemas in `shared/` and freezes them as the contract,
2. hands the backend and frontend parts to the **backend-dev** and **frontend-dev** agents, which work in parallel (small single-folder changes it does itself),
3. integrates the result, runs typecheck, lint and tests and fixes failures,
4. asks the **qa-reviewer** agent for a final review (at most 2 rounds).

The workflow then commits the changes and opens a pull request with a summary of test results. The agent itself is not allowed to commit or push – only the workflow does.

### 2. PR Verification Checks (`pr-checks.yml`)

Runs independently of the agent on every pull request and every push to `main`:
typecheck → lint → unit & integration tests → build → E2E tests (Playwright).
Results and logs are shown in the run summary and uploaded as an artifact.

### 3. Deployment (Render)

After a merge, the checks run on `main`; when they pass, Render builds and deploys the app automatically (`render.yaml`, `autoDeployTrigger: checksPass`). There is no separate deploy workflow and no deploy secret.

### AI agents

| Agent          | Model  | Role                                                                                                             |
| -------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `team-lead`    | Opus   | Architect and coordinator – owns the contract in `shared/`, delegates, integrates and coordinates QA.            |
| `backend-dev`  | Sonnet | Implements `backend/` with tests against the frozen contract; never edits `shared/`.                             |
| `frontend-dev` | Sonnet | Implements `frontend/` with tests against the frozen contract; never edits `shared/`.                            |
| `qa-reviewer`  | Sonnet | Read-only reviewer – checks the diff, runs the checks and tests the running app in a browser via Playwright MCP. |

All of them can also be used locally in Claude Code in this repository.

## Local development

Requires Node.js 22.

```bash
npm ci              # install dependencies
npm run dev         # start frontend + backend
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm start           # run the production build
```

## One-time setup

- **GitHub secret** `CLAUDE_CODE_OAUTH_TOKEN` (Settings → Secrets and variables → Actions) – used by the agent; generate it locally with `claude setup-token` (works with a Claude Pro/Max subscription).
- **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests.**
- **Render:** sign in at render.com with GitHub → **New → Blueprint** → select this repository.

Development rules for humans and agents are in [`CLAUDE.md`](CLAUDE.md).
