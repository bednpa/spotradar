import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../errors.ts';
import { fakeClock, jsonResponse, recordingFetch } from '../testHelpers.ts';
import { createGeocoder } from './geocode.ts';

const BRNO_HIT = [
  { lat: '49.1922443', lon: '16.6113382', display_name: 'Brno, Jihomoravský kraj, Česko' },
];

function setup(respond: Parameters<typeof recordingFetch>[0]) {
  const clock = fakeClock();
  const sleeps: number[] = [];
  const fetchFn = recordingFetch(respond);
  const geocoder = createGeocoder({
    fetch: fetchFn,
    now: clock.now,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    },
  });
  return { geocoder, fetchFn, sleeps, clock };
}

async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (err: unknown) => err instanceof HttpError && err.code === code);
}

describe('geocoder', () => {
  it('queries Nominatim and maps the first hit', async () => {
    const { geocoder, fetchFn } = setup(() => jsonResponse(BRNO_HIT));
    assert.deepEqual(await geocoder.geocode('Brno Česká 1'), {
      lat: 49.1922443,
      lng: 16.6113382,
      label: 'Brno, Jihomoravský kraj, Česko',
    });
    const call = fetchFn.calls[0];
    assert.equal(
      `${call?.url.origin}${call?.url.pathname}`,
      'https://nominatim.openstreetmap.org/search',
    );
    assert.equal(call?.url.searchParams.get('format'), 'jsonv2');
    assert.equal(call?.url.searchParams.get('limit'), '1');
    assert.equal(call?.url.searchParams.get('countrycodes'), 'cz');
    assert.equal(call?.url.searchParams.get('q'), 'Brno Česká 1');
    assert.equal(call?.url.searchParams.has('bounded'), false);
    assert.deepEqual(call?.init?.headers, {
      'user-agent': 'SpotRadar/1.0',
      accept: 'application/json',
    });
    assert.ok(call?.init?.signal instanceof AbortSignal);
  });

  it('answers LOCATION_NOT_FOUND for an empty result and caches it', async () => {
    const { geocoder, fetchFn } = setup(() => jsonResponse([]));
    await rejectsWith(geocoder.geocode('nowhere'), 'LOCATION_NOT_FOUND');
    await rejectsWith(geocoder.geocode('  NoWhere '), 'LOCATION_NOT_FOUND');
    assert.equal(fetchFn.calls.length, 1);
  });

  it('answers GEOCODER_UNAVAILABLE for HTTP errors, network errors, timeouts and bad JSON', async () => {
    const cases: Parameters<typeof recordingFetch>[0][] = [
      () => jsonResponse({ error: 'x' }, 500),
      () => Promise.reject(new Error('ECONNRESET')),
      () => new Response('<html>not json</html>', { status: 200 }),
      () => jsonResponse({ not: 'an array' }),
      () => jsonResponse([{ lat: 'abc', lon: '1', display_name: 'x' }]),
    ];
    for (const respond of cases) {
      const { geocoder } = setup(respond);
      await rejectsWith(geocoder.geocode('Brno'), 'GEOCODER_UNAVAILABLE');
    }
  });

  it('aborts after the timeout', async () => {
    const clock = fakeClock();
    const geocoder = createGeocoder({
      now: clock.now,
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    await rejectsWith(geocoder.geocode('Brno'), 'GEOCODER_UNAVAILABLE');
  });

  it('does not cache failures', async () => {
    let fail = true;
    const { geocoder, fetchFn } = setup(() =>
      fail ? jsonResponse({}, 503) : jsonResponse(BRNO_HIT),
    );
    await rejectsWith(geocoder.geocode('Brno'), 'GEOCODER_UNAVAILABLE');
    fail = false;
    assert.equal((await geocoder.geocode('Brno')).lat, 49.1922443);
    assert.equal(fetchFn.calls.length, 2);
  });

  it('serves repeated queries from the cache (normalized key)', async () => {
    const { geocoder, fetchFn } = setup(() => jsonResponse(BRNO_HIT));
    await geocoder.geocode('Brno  Centrum');
    await geocoder.geocode(' brno centrum ');
    await geocoder.geocode('BRNO CENTRUM');
    assert.equal(fetchFn.calls.length, 1);
    await geocoder.geocode('Brno Líšeň');
    assert.equal(fetchFn.calls.length, 2);
  });

  it('shares one upstream request between concurrent identical queries', async () => {
    const { geocoder, fetchFn } = setup(() => jsonResponse(BRNO_HIT));
    await Promise.all([geocoder.geocode('Brno'), geocoder.geocode('brno')]);
    assert.equal(fetchFn.calls.length, 1);
  });

  it('spaces upstream requests at least 1 s apart by waiting, not rejecting', async () => {
    const { geocoder, fetchFn, sleeps, clock } = setup(() => jsonResponse(BRNO_HIT));
    const results = await Promise.all(['a1', 'b2', 'c3'].map((q) => geocoder.geocode(q)));
    assert.equal(results.length, 3);
    assert.equal(fetchFn.calls.length, 3);
    assert.deepEqual(sleeps, [1000, 1000]);
    // 3 requests -> the clock advanced by two full intervals in total
    assert.equal(clock.now().getTime() - new Date('2026-11-24T08:00:00Z').getTime(), 2000);
  });

  it('does not wait when the previous request is old enough', async () => {
    const { geocoder, sleeps, clock } = setup(() => jsonResponse(BRNO_HIT));
    await geocoder.geocode('a1');
    clock.advance(1500);
    await geocoder.geocode('b2');
    assert.deepEqual(sleeps, []);
  });

  it('only waits for the remaining part of the interval', async () => {
    const { geocoder, sleeps, clock } = setup(() => jsonResponse(BRNO_HIT));
    await geocoder.geocode('a1');
    clock.advance(400);
    await geocoder.geocode('b2');
    assert.deepEqual(sleeps, [600]);
  });
});
