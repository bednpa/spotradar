import { readFileSync } from 'node:fs';
import { toLocalDateTime } from '@spotradar/shared';

const SLATINA_CLUB_ID = '216930';
const SLATINA_FIXTURE = 'slatina-2026-11-27.json';
const SLATINA_FIXTURE_DATE = '2026-11-27';
const EMPTY_FIXTURE = 'kravihora-2026-11-26.json';
const EMPTY_CLUB_ID = '216928';

const cache = new Map<string, string>();

function fixture(name: string): string {
  let body = cache.get(name);
  if (body === undefined) {
    body = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    cache.set(name, body);
  }
  return body;
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  return new Headers(init?.headers).get(name) ?? undefined;
}

function json(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Stub for `POST https://api.padelos.co/customers/searchByDate` (E2E, no network). The club is
 * read from the `x-clubos-club` header and the date from the JSON body (`date` argument wins,
 * else today in Prague when the body has none):
 * - Slatina (216930): the recorded 2026-11-27 answer with every slot date rewritten to the
 *   requested date, so there are free courts on any day;
 * - any other club id: the recorded empty Kraví hora answer (`availability: []`) with its
 *   `data[0].id` set to the requested club id, so the parser accepts it as an empty day;
 * - a missing club header: HTTP 400 like the real API.
 */
export function servePadelosStub(url: URL, init: RequestInit | undefined, date?: string): Response {
  if (url.pathname !== '/customers/searchByDate' || init?.method !== 'POST') {
    return json('{"success":false,"data":"NotFound"}', 404);
  }
  const clubId = headerValue(init, 'x-clubos-club') ?? headerValue(init, 'x-clubos-club-info');
  if (!clubId) return json('{"success":false,"data":"BadRequest.MissingRequiredField"}', 400);
  const requested = date ?? requestedDate(init) ?? toLocalDateTime(new Date()).date;
  if (clubId === SLATINA_CLUB_ID) {
    return json(
      fixture(SLATINA_FIXTURE).replaceAll(
        `"date": "${SLATINA_FIXTURE_DATE}"`,
        `"date": "${requested}"`,
      ),
    );
  }
  // Fixture ids are JSON strings: replace the club id of the recorded empty answer.
  return json(fixture(EMPTY_FIXTURE).replace(`"id": "${EMPTY_CLUB_ID}"`, `"id": "${clubId}"`));
}

function requestedDate(init: RequestInit | undefined): string | undefined {
  if (typeof init?.body !== 'string') return undefined;
  try {
    const body = JSON.parse(init.body) as { date?: unknown };
    return typeof body.date === 'string' ? body.date : undefined;
  } catch {
    return undefined;
  }
}
