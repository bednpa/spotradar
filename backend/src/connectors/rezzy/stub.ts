import { readFileSync } from 'node:fs';

const AREA_FIXTURE = 'sportarea-tenant15-area33.json';
const BLOCKERS_FIXTURE = 'blockers-tenant15-area33-2026-11-26.json';
const STUB_TENANT = '15';
const STUB_AREA = '33';
const AREA_PATH = `/api/sportarea/v1/Tenants/${STUB_TENANT}/SportAreas/${STUB_AREA}`;
const BLOCKERS_PATH = `/api/reservation/v1/Tenants/${STUB_TENANT}/SportAreas/${STUB_AREA}/CustomerSchedules/ReservationBlockers`;

const cache = new Map<string, string>();

function fixture(name: string): string {
  let body = cache.get(name);
  if (body === undefined) {
    body = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    cache.set(name, body);
  }
  return body;
}

function json(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Stub for the Rezzy API (E2E, no network). Tenant 15 / sport area 33 (TennisLinden) is
 * served for ANY date: the recorded area detail (the season hours are the same every weekday and
 * carry no date) and the recorded 2026-11-26 blockers (they carry no date either, so the same
 * occupancy shows every day). Any other tenant, area or path answers 404, which the connector
 * reports as an unreadable source.
 */
export function serveRezzyStub(url: URL): Response {
  if (url.pathname === AREA_PATH) return json(fixture(AREA_FIXTURE));
  if (url.pathname === BLOCKERS_PATH) return json(fixture(BLOCKERS_FIXTURE));
  return json('{}', 404);
}
