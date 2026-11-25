# Calendar loading – measurements

Measured on 2026-11-25 (~22:30 CET) from a GitHub Actions runner against the **live** booking
systems with `npm run measure:calendar -w @spotradar/backend` (backend/scripts/measure-calendar.ts:
the same code path as `GET /api/calendar`, in-process, badminton, all 7 venues). The numbers depend
on the network and the venues' servers, so read them as orders of magnitude.

## Before (main, no warming, no stale-while-revalidate)

| Request                    | Time   | Live venue-days                   |
| -------------------------- | ------ | --------------------------------- |
| day (cold)                 | 5.4 s  | 4/7 (Bizzy `unknown`)             |
| week (cold)                | 8.0 s  | 28/49                             |
| week (warm, within 15 min) | 2 ms   | 28/49                             |
| next week (cold)           | 13.2 s | 28/49                             |
| week after 15 min          | ≈ 8 s  | not measured: expired = cold read |

## After

| Request                                  | Time                | Live venue-days |
| ---------------------------------------- | ------------------- | --------------- |
| day (cold, no warming)                   | 5.7 s               | 7/7             |
| week (cold, no warming)                  | 9.2 s               | 49/49           |
| background warming pass (today + 6 days) | 11.9 s, off-request | 49 reads        |
| **week after warming** (normal case)     | **3 ms**            | 49/49           |
| **week with expired (stale) cache**      | **13 ms**           | 49/49           |
| next week (cold, frontend prefetches it) | 12.4 s, off-screen  | 49/49           |

- The cold paths cost about the same as before. The gain is that users no longer hit them: the
  warmer runs right after startup and every 10 min, and expired entries younger than 60 min are
  answered at once with their real `checkedAt` while they refresh in the background.
- Hosts that fail at connection level (refused, reset, DNS, timeout) are backed off for 5 → 60 min,
  so a blocked host (e.g. Bizzy refusing data-centre IPs) costs 0 ms per request instead of up to
  8 s × days.
- Multi-day pages: Hala Sprint (MemberZone) costs 1 request per 7 days, a Bizzy venue 1–2 per
  8 days. ClubSpire (1 per day) and MemberPro (1 POST per day) have no multi-day page.
- In the browser, the focused day is requested on its own and drawn first; the rest of the week
  shows a skeleton until the full range arrives, and the next week is prefetched once the
  current one is shown.
- The backend logs `[availability] <venue> <date> read in N ms (ok|failed: …)` per connector read
  and `[calendar] <from>..<to> N venues in N ms` per request, so production timings can be read
  from the logs.

On this run the Bizzy hosts accepted the connection (they refused the CI runner earlier the same
day), so the 7/7 and 49/49 include live Bizzy data.

## Suggested workflow change (not applied: the agent may not edit `.github/workflows/`)

`agent-pr.yml` writes the PR body itself, so the agent cannot put these numbers there; this file
is the place to find them. Two small changes would help future agent runs:

1. Install the Playwright browser **before** the "Run Claude agent" step
   (`npx --no-install playwright install --with-deps chromium`), so the agent can run
   `npm run test:e2e` itself. Today it is installed only in the later E2E step.
2. Optionally append a notes file written by the agent (e.g. `.test-reports/pr-notes.md`, if it
   exists) to the PR body.
