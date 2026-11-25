import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CalendarCache, sliceResponse } from './calendar-data.ts';
import type { FetchFn } from './api.ts';
import { jsonResponse, makeCalendar } from './test-fixtures.test.ts';

function countingFetch(calls: string[]): FetchFn {
  return (input) => {
    calls.push(input);
    const params = new URL(input, 'http://x').searchParams;
    const body = makeCalendar(params.get('from') ?? '', params.get('to') ?? '');
    return Promise.resolve(jsonResponse(200, body));
  };
}

const base = { sport: 'badminton' as const };

test('identical queries are fetched once', async () => {
  const calls: string[] = [];
  const cache = new CalendarCache(countingFetch(calls));
  const query = { ...base, from: '2026-11-25', to: '2026-11-27' };
  const [a, b] = await Promise.all([cache.get(query), cache.get(query)]);
  await cache.get(query);
  assert.equal(calls.length, 1);
  assert.equal(a, b);
});

test('a cached wider range serves sub-ranges', async () => {
  const calls: string[] = [];
  const cache = new CalendarCache(countingFetch(calls));
  await cache.get({ ...base, from: '2026-11-25', to: '2026-11-29' });
  const sub = await cache.get({ ...base, from: '2026-11-26', to: '2026-11-27' });
  assert.equal(calls.length, 1);
  assert.deepEqual(
    sub.days.map((d) => d.date),
    ['2026-11-26', '2026-11-27'],
  );
  assert.equal(sub.query.from, '2026-11-26');
});

test('different location or distance is a separate cache entry', async () => {
  const calls: string[] = [];
  const cache = new CalendarCache(countingFetch(calls));
  const range = { from: '2026-11-25', to: '2026-11-26' };
  await cache.get({ ...base, ...range });
  await cache.get({ ...base, ...range, lat: 49.2, lng: 16.6 });
  await cache.get({ ...base, ...range, lat: 49.2, lng: 16.6, maxDistanceKm: 5 });
  assert.equal(calls.length, 3);
  assert.equal(cache.peek({ ...base, from: '2026-11-25', to: '2026-11-25', lat: 1, lng: 2 }), null);
});

test('failures are not cached', async () => {
  let fail = true;
  const cache = new CalendarCache(() =>
    Promise.resolve(
      fail
        ? jsonResponse(500, { error: 'boom', code: 'INTERNAL_ERROR' })
        : jsonResponse(200, makeCalendar()),
    ),
  );
  const query = { ...base, from: '2026-11-25', to: '2026-11-27' };
  await assert.rejects(cache.get(query));
  fail = false;
  const ok = await cache.get(query);
  assert.equal(ok.days.length, 3);
  assert.equal(cache.requests, 2);
});

test('entries expire after the TTL', async () => {
  const calls: string[] = [];
  let now = Date.parse('2026-11-25T10:00:00Z');
  const cache = new CalendarCache(countingFetch(calls), { ttlMs: 5 * 60_000, clock: () => now });
  const query = { ...base, from: '2026-11-25', to: '2026-11-27' };
  await cache.get(query);
  now += 4 * 60_000;
  await cache.get(query);
  assert.equal(calls.length, 1);
  now += 2 * 60_000;
  assert.equal(cache.peek(query), null);
  await cache.get(query);
  assert.equal(calls.length, 2);
});

test('entries from an earlier local day are not reused after midnight', async () => {
  const calls: string[] = [];
  let now = Date.parse('2026-11-25T22:58:00Z'); // 23:58 Prague
  const cache = new CalendarCache(countingFetch(calls), { clock: () => now });
  const query = { ...base, from: '2026-11-25', to: '2026-11-27' };
  await cache.get(query);
  now += 3 * 60_000; // 00:01 Prague next day, within the TTL
  assert.equal(cache.peek(query), null);
  await cache.get(query);
  assert.equal(calls.length, 2);
});

test('fresh: true bypasses the cache and replaces the entry', async () => {
  const calls: string[] = [];
  const cache = new CalendarCache(countingFetch(calls));
  const query = { ...base, from: '2026-11-25', to: '2026-11-27' };
  await cache.get(query);
  await cache.get(query, { fresh: true });
  assert.equal(calls.length, 2);
  await cache.get(query);
  assert.equal(calls.length, 2);
});

test('a day entry and the range entry coexist; the range stays cached after it arrives', async () => {
  const calls: string[] = [];
  const cache = new CalendarCache(countingFetch(calls));
  const day = { ...base, from: '2026-11-26', to: '2026-11-26' };
  const range = { ...base, from: '2026-11-25', to: '2026-11-29' };
  const [dayData, rangeData] = await Promise.all([cache.get(day), cache.get(range)]);
  assert.equal(dayData.days.length, 1);
  assert.equal(rangeData.days.length, 5);
  assert.equal(calls.length, 2);
  // both are served from the cache afterwards, and a sibling day is sliced from the range
  assert.equal(cache.peek(day), dayData);
  assert.equal(cache.peek(range), rangeData);
  assert.equal(cache.peek({ ...base, from: '2026-11-28', to: '2026-11-28' })?.days.length, 1);
  assert.equal(calls.length, 2);
});

test('prefetch fills the cache once and skips cached or covered queries', async () => {
  const calls: string[] = [];
  const cache = new CalendarCache(countingFetch(calls));
  const next = { ...base, from: '2026-11-30', to: '2026-12-06' };
  assert.equal(await cache.prefetch(next), true);
  assert.equal(await cache.prefetch(next), false);
  assert.equal(await cache.prefetch({ ...next, from: '2026-12-01', to: '2026-12-01' }), false);
  assert.equal(calls.length, 1);
  assert.ok(cache.peek(next));
});

test('prefetch swallows errors and caches nothing', async () => {
  const cache = new CalendarCache(() =>
    Promise.resolve(jsonResponse(503, { error: 'down', code: 'INTERNAL_ERROR' })),
  );
  const next = { ...base, from: '2026-11-30', to: '2026-12-06' };
  assert.equal(await cache.prefetch(next), true);
  assert.equal(cache.peek(next), null);
});

test('sliceResponse filters days', () => {
  const sliced = sliceResponse(makeCalendar(), '2026-11-26', '2026-11-26');
  assert.equal(sliced.days.length, 1);
  assert.equal(sliced.query.to, '2026-11-26');
});
