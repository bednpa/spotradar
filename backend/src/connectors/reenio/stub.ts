import { readFileSync } from 'node:fs';
import { isValidDate, zonedMidnightEpochMs } from '@spotradar/shared';

const FIXTURE_DATE = '2026-11-27';
const ISO_UTC_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g;

let recorded: string | undefined;

function fixture(): string {
  recorded ??= readFileSync(
    new URL('./fixtures/hala-51584-2026-11-27.json', import.meta.url),
    'utf8',
  );
  return recorded;
}

/**
 * The recorded `Term/List` answer of Friday 2026-11-27 shown as `date`: every UTC timestamp moves
 * by the distance between the two Prague midnights, so the local wall-clock times (free gaps at
 * 06:00-07:45, 09:30-11:00 and 21:30-22:30) stay the same on any day, also across a DST change.
 */
export function reenioTermsFor(json: string, date: string): string {
  const shiftMs = zonedMidnightEpochMs(date) - zonedMidnightEpochMs(FIXTURE_DATE);
  return json.replace(ISO_UTC_RE, (iso) =>
    new Date(Date.parse(iso) + shiftMs).toISOString().replace('.000Z', 'Z'),
  );
}

/**
 * Stub mode for Reenio (`POST {baseUrl}/api/Term/List`, multipart form with `date`): every day
 * answers with the recording of 2026-11-27 moved to the requested date, so "tomorrow" always has
 * free time beyond the 2-hour booking lead time. Requests that are not a form POST with a valid
 * `date` throw.
 */
export function serveReenioStub(url: URL, init: RequestInit | undefined): Response {
  if (!url.pathname.endsWith('/api/Term/List') || init?.method !== 'POST') {
    throw new Error(`Stub mode: ${url.href} is unreachable`);
  }
  const date = init.body instanceof FormData ? init.body.get('date') : null;
  if (typeof date !== 'string' || !isValidDate(date)) {
    throw new Error('Stub mode: Reenio request without a valid date');
  }
  return new Response(reenioTermsFor(fixture(), date), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
