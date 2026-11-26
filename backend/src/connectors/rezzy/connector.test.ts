import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AvailabilitySourceConfig } from '@spotradar/shared';
import { fakeClock, jsonResponse, recordingFetch, slot } from '../../testHelpers.ts';
import { UpstreamTimeoutError } from '../timeout.ts';
import type { AvailabilityTarget } from '../types.ts';
import {
  AREA_CACHE_MS,
  REZZY_HOST,
  buildRezzyAreaUrl,
  buildRezzyBlockersUrl,
  createRezzyConnector,
} from './connector.ts';
import { RezzyParseError } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const AREA = fixture('sportarea-tenant15-area33.json');
const BLOCKERS: Record<string, string> = {
  '2026-11-26': fixture('blockers-tenant15-area33-2026-11-26.json'),
  '2026-11-27': fixture('blockers-tenant15-area33-2026-11-27.json'),
  '2026-11-28': fixture('blockers-tenant15-area33-2026-11-28.json'),
};
const SOURCE: Extract<AvailabilitySourceConfig, { type: 'rezzy' }> = {
  type: 'rezzy',
  tenantId: 15,
  sportAreaId: 33,
};
const TENNIS: AvailabilityTarget = { venueId: 'tennis-linden', sport: 'tennis', source: SOURCE };
const ORIGIN = 'https://www.rezzy.eu';
const AREA_PATH = '/api/sportarea/v1/Tenants/15/SportAreas/33';
const BLOCKERS_PATH =
  '/api/reservation/v1/Tenants/15/SportAreas/33/CustomerSchedules/ReservationBlockers';

/** The real API: area detail and per-date blockers. */
function rezzySite(): ReturnType<typeof recordingFetch> {
  return recordingFetch((url) => {
    if (url.pathname === AREA_PATH) return new Response(AREA, { status: 200 });
    if (url.pathname === BLOCKERS_PATH) {
      return new Response(BLOCKERS[url.searchParams.get('date') ?? ''] ?? '[]', { status: 200 });
    }
    return new Response('', { status: 404 });
  });
}

const FRIDAY_SLOTS = [
  slot('08:00', '09:00', 2),
  slot('09:00', '10:00', 1),
  slot('10:30', '11:00', 1),
  slot('11:00', '14:00', 2),
  slot('17:00', '18:00', 1),
  slot('18:00', '19:00', 3),
  slot('19:00', '21:00', 4),
];

describe('Rezzy URLs', () => {
  it('build the area and blockers endpoints', () => {
    assert.equal(
      buildRezzyAreaUrl(SOURCE, '2026-11-27').href,
      `${ORIGIN}${AREA_PATH}?date=2026-11-27`,
    );
    assert.equal(
      buildRezzyBlockersUrl(SOURCE, '2026-11-27').href,
      `${ORIGIN}${BLOCKERS_PATH}?date=2026-11-27`,
    );
    assert.equal(REZZY_HOST, 'www.rezzy.eu');
  });
});

describe('Rezzy connector', () => {
  it('reads a day: area detail plus blockers', async () => {
    const fetchFn = rezzySite();
    const connector = createRezzyConnector({ fetch: fetchFn, now: fakeClock().now });
    assert.equal(connector.type, 'rezzy');
    assert.deepEqual(await connector.getFreeSlots(TENNIS, '2026-11-27'), FRIDAY_SLOTS);
    assert.equal(fetchFn.calls.length, 2);
    assert.equal(fetchFn.calls[0]?.url.href, `${ORIGIN}${AREA_PATH}?date=2026-11-27`);
    assert.equal(fetchFn.calls[1]?.url.href, `${ORIGIN}${BLOCKERS_PATH}?date=2026-11-27`);
    const init = fetchFn.calls[1]?.init;
    assert.equal((init?.headers as Record<string, string>)['user-agent'], 'SpotRadar/1.0');
    assert.ok(init?.signal instanceof AbortSignal);
  });

  it('switches the date: another date means another query and another result', async () => {
    const fetchFn = rezzySite();
    const connector = createRezzyConnector({ fetch: fetchFn, now: fakeClock().now });
    assert.deepEqual(await connector.getFreeSlots(TENNIS, '2026-11-28'), []);
    assert.deepEqual(await connector.getFreeSlots(TENNIS, '2026-11-27'), FRIDAY_SLOTS);
    assert.deepEqual(
      fetchFn.calls.map((c) => `${c.url.pathname}?${c.url.searchParams.get('date')}`),
      [
        `${AREA_PATH}?2026-11-28`,
        `${BLOCKERS_PATH}?2026-11-28`,
        `${AREA_PATH}?2026-11-27`,
        `${BLOCKERS_PATH}?2026-11-27`,
      ],
    );
  });

  it('caches the area detail per date for an hour, blockers are always fresh', async () => {
    const fetchFn = rezzySite();
    const clock = fakeClock();
    const connector = createRezzyConnector({ fetch: fetchFn, now: clock.now });
    await connector.getFreeSlots(TENNIS, '2026-11-27');
    await connector.getFreeSlots(TENNIS, '2026-11-27');
    assert.equal(fetchFn.calls.length, 3); // area, blockers, blockers
    clock.advance(AREA_CACHE_MS + 1);
    await connector.getFreeSlots(TENNIS, '2026-11-27');
    assert.equal(fetchFn.calls.length, 5);
  });

  it('drops cells that already started today (Europe/Prague)', async () => {
    // 12:40 UTC = 13:40 in Prague (CET) on Thursday 2026-11-26.
    const connector = createRezzyConnector({
      fetch: rezzySite(),
      now: () => new Date('2026-11-26T12:40:00Z'),
    });
    assert.deepEqual(await connector.getFreeSlots(TENNIS, '2026-11-26'), [
      slot('14:00', '15:00', 1),
      slot('16:00', '17:00', 1),
      slot('18:00', '19:30', 1),
      slot('19:30', '20:00', 2),
      slot('20:00', '22:00', 4),
    ]);
  });

  it('returns nothing for a past day without asking the server', async () => {
    const fetchFn = rezzySite();
    const connector = createRezzyConnector({
      fetch: fetchFn,
      now: () => new Date('2026-11-27T08:00:00Z'),
    });
    assert.deepEqual(await connector.getFreeSlots(TENNIS, '2026-11-26'), []);
    assert.equal(fetchFn.calls.length, 0);
  });

  it('rejects HTTP errors (401, 503) of either endpoint', async () => {
    const deny = createRezzyConnector({
      fetch: () => Promise.resolve(new Response('', { status: 401 })),
    });
    await assert.rejects(deny.getFreeSlots(TENNIS, '2026-11-27'), /HTTP 401/);
    const site = rezzySite();
    const blockersDown = createRezzyConnector({
      fetch: recordingFetch((url, init) =>
        url.pathname === BLOCKERS_PATH ? new Response('busy', { status: 503 }) : site(url, init),
      ),
    });
    await assert.rejects(blockersDown.getFreeSlots(TENNIS, '2026-11-27'), /HTTP 503/);
  });

  it('times out slow answers', async () => {
    const connector = createRezzyConnector({
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(connector.getFreeSlots(TENNIS, '2026-11-27'), UpstreamTimeoutError);
  });

  it('rejects a changed structure instead of returning partial data', async () => {
    const html = createRezzyConnector({
      fetch: () => Promise.resolve(new Response('<html>Nová stránka</html>', { status: 200 })),
    });
    await assert.rejects(html.getFreeSlots(TENNIS, '2026-11-27'), RezzyParseError);
    const site = rezzySite();
    const wrongBlockers = createRezzyConnector({
      fetch: recordingFetch((url, init) =>
        url.pathname === BLOCKERS_PATH ? jsonResponse({ items: [] }) : site(url, init),
      ),
    });
    await assert.rejects(wrongBlockers.getFreeSlots(TENNIS, '2026-11-27'), RezzyParseError);
  });

  it('rejects other source types', async () => {
    const connector = createRezzyConnector({ fetch: rezzySite() });
    await assert.rejects(
      connector.getFreeSlots({ ...TENNIS, source: { type: 'none' } }, '2026-11-27'),
      /tennis-linden\/tennis is not a Rezzy source/,
    );
  });
});
