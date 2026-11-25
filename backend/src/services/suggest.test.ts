import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../errors.ts';
import { fakeClock, jsonResponse, recordingFetch } from '../testHelpers.ts';
import { buildLabel, createSuggester } from './suggest.ts';

function feature(props: Record<string, unknown>, lon = 16.6, lat = 49.2) {
  return { properties: { countrycode: 'CZ', ...props }, geometry: { coordinates: [lon, lat] } };
}

function setup(respond: Parameters<typeof recordingFetch>[0], timeoutMs?: number) {
  const clock = fakeClock();
  const sleeps: number[] = [];
  const fetchFn = recordingFetch(respond);
  const suggester = createSuggester({
    fetch: fetchFn,
    now: clock.now,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { suggester, fetchFn, sleeps, clock };
}

async function rejectsUnavailable(promise: Promise<unknown>): Promise<void> {
  await assert.rejects(
    promise,
    (err: unknown) => err instanceof HttpError && err.code === 'GEOCODER_UNAVAILABLE',
  );
}

describe('buildLabel', () => {
  it('builds "street, district, city" for a street', () => {
    assert.equal(
      buildLabel({ name: 'Kuklenská', type: 'street', district: 'Židenice', city: 'Brno' }),
      'Kuklenská, Židenice, Brno',
    );
  });

  it('builds "street number, district, city" for an address and drops district equal to city', () => {
    assert.equal(
      buildLabel({
        street: 'Václavské náměstí',
        housenumber: '12',
        district: 'Praha',
        city: 'Praha',
      }),
      'Václavské náměstí 12, Praha',
    );
  });

  it('keeps a POI name next to its street and de-duplicates parts', () => {
    assert.equal(
      buildLabel({
        name: 'SportCentrum Kuklenská',
        street: 'Kuklenská',
        district: 'Židenice',
        city: 'Brno',
      }),
      'SportCentrum Kuklenská, Kuklenská, Židenice, Brno',
    );
    assert.equal(buildLabel({ name: 'Brno', city: 'Brno' }), 'Brno');
  });

  it('falls back to locality and appends the house number to a named place', () => {
    assert.equal(
      buildLabel({ name: 'Obchod', housenumber: '5', locality: 'Vesnice' }),
      'Obchod 5, Vesnice',
    );
  });
});

describe('suggester', () => {
  it('queries Photon with Brno bias, Czech bbox and the polite User-Agent', async () => {
    const { suggester, fetchFn } = setup(() => jsonResponse({ features: [] }));
    await suggester.suggest('Kuklensk');
    const call = fetchFn.calls[0];
    assert.equal(`${call?.url.origin}${call?.url.pathname}`, 'https://photon.komoot.io/api/');
    assert.equal(call?.url.searchParams.get('q'), 'Kuklensk');
    assert.equal(call?.url.searchParams.get('limit'), '5');
    assert.equal(call?.url.searchParams.get('lat'), '49.1951');
    assert.equal(call?.url.searchParams.get('lon'), '16.6068');
    assert.equal(call?.url.searchParams.get('bbox'), '12.09,48.55,18.86,51.06');
    assert.deepEqual(call?.init?.headers, {
      'user-agent': 'SpotRadar/1.0',
      accept: 'application/json',
    });
    assert.ok(call?.init?.signal instanceof AbortSignal);
  });

  it('maps features to suggestions, keeps only CZ and drops duplicate labels', async () => {
    const { suggester } = setup(() =>
      jsonResponse({
        features: [
          feature({ name: 'Kuklenská', district: 'Židenice', city: 'Brno' }, 16.634, 49.194),
          feature({ name: 'Kuklenská', district: 'Židenice', city: 'Brno' }, 16.7, 49.3),
          feature({ name: 'Kuklenská', city: 'Bratislava', countrycode: 'SK' }),
          { properties: { name: 'Broken', countrycode: 'CZ' }, geometry: {} },
          feature(
            { name: 'Kuklenská', district: 'Pražské Předměstí', city: 'Hradec Králové' },
            15.8,
            50.2,
          ),
        ],
      }),
    );
    assert.deepEqual(await suggester.suggest('Kuklensk'), [
      { lat: 49.194, lng: 16.634, label: 'Kuklenská, Židenice, Brno' },
      { lat: 50.2, lng: 15.8, label: 'Kuklenská, Pražské Předměstí, Hradec Králové' },
    ]);
  });

  it('returns at most 5 suggestions', async () => {
    const { suggester } = setup(() =>
      jsonResponse({
        features: Array.from({ length: 8 }, (_, i) =>
          feature({ name: `Street ${i}`, city: 'Brno' }),
        ),
      }),
    );
    assert.equal((await suggester.suggest('street')).length, 5);
  });

  it('returns an empty list when nothing matches', async () => {
    const { suggester } = setup(() => jsonResponse({ features: [] }));
    assert.deepEqual(await suggester.suggest('zzzzqq'), []);
  });

  it('caches results (also empty ones) by normalized query', async () => {
    const { suggester, fetchFn } = setup(() => jsonResponse({ features: [] }));
    await suggester.suggest('Kuklenská');
    await suggester.suggest('  kuklenská ');
    assert.equal(fetchFn.calls.length, 1);
    await suggester.suggest('Lidická');
    assert.equal(fetchFn.calls.length, 2);
  });

  it('spaces upstream calls at least 300 ms apart, also for concurrent callers', async () => {
    const { suggester, fetchFn, sleeps } = setup(() => jsonResponse({ features: [] }));
    await Promise.all([suggester.suggest('aa'), suggester.suggest('bb'), suggester.suggest('cc')]);
    assert.equal(fetchFn.calls.length, 3);
    assert.deepEqual(sleeps, [300, 300]);
  });

  it('answers GEOCODER_UNAVAILABLE on HTTP errors, bad bodies and network failures, and does not cache them', async () => {
    let behavior: () => Response | Promise<Response> = () => jsonResponse({ error: 'x' }, 500);
    const { suggester, fetchFn } = setup(() => behavior());
    await rejectsUnavailable(suggester.suggest('failing'));
    behavior = () => jsonResponse({ nope: true });
    await rejectsUnavailable(suggester.suggest('failing'));
    behavior = () => Promise.reject(new Error('network down'));
    await rejectsUnavailable(suggester.suggest('failing'));
    behavior = () => jsonResponse({ features: [feature({ name: 'Recovered', city: 'Brno' })] });
    assert.equal((await suggester.suggest('failing')).length, 1);
    assert.equal(fetchFn.calls.length, 4);
  });

  it('answers GEOCODER_UNAVAILABLE when the upstream times out', async () => {
    const { suggester } = setup(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      20,
    );
    await rejectsUnavailable(suggester.suggest('slow'));
  });
});
