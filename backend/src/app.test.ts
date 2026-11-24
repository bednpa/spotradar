import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { ApiError, GeocodeResponse, HealthResponse, SearchResponse } from '@spotradar/shared';
import { createApp } from './app.ts';
import { createAvailabilityService } from './connectors/availabilityService.ts';
import { VENUE_RECORDS } from './data/venues.ts';
import { createVenueRepository } from './repositories/venueRepository.ts';
import { createGeocoder } from './services/geocode.ts';
import {
  FIXED_NOW,
  TODAY,
  TOMORROW,
  fakeConnector,
  jsonResponse,
  recordingFetch,
  silentLogger,
  slot,
} from './testHelpers.ts';

const BRNO_HIT = [{ lat: '49.2', lon: '16.6', display_name: 'Brno, Česko' }];

let geocodeBehavior: () => Response | Promise<Response> = () => jsonResponse(BRNO_HIT);
let baseUrl = '';
let staticDir = '';
let close: () => Promise<void> = () => Promise.resolve();

const connector = fakeConnector('clubspire', (venue) => {
  if (venue.id === 'kuklenska') {
    return Promise.resolve([
      slot('07:00', '08:00', 1), // already ended on "today" (now = 09:00)
      slot('10:00', '11:00', 3),
    ]);
  }
  return Promise.reject(new Error('viktoria is down'));
});

before(async () => {
  staticDir = await mkdtemp(path.join(os.tmpdir(), 'spotradar-static-'));
  await writeFile(path.join(staticDir, 'index.html'), '<!doctype html><title>SpotRadar</title>');
  await mkdir(path.join(staticDir, 'assets'));
  await writeFile(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');

  const server = createApp({
    venues: createVenueRepository(VENUE_RECORDS),
    availability: createAvailabilityService({
      connectors: [connector],
      now: () => FIXED_NOW,
      logger: silentLogger,
    }),
    geocoder: createGeocoder({
      fetch: recordingFetch(() => geocodeBehavior()),
      now: () => FIXED_NOW,
      sleep: () => Promise.resolve(),
    }),
    now: () => FIXED_NOW,
    staticDir,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
});

after(async () => {
  await close();
  await rm(staticDir, { recursive: true, force: true });
});

async function get<T>(pathAndQuery: string): Promise<{ status: number; body: T }> {
  const res = await fetch(baseUrl + pathAndQuery);
  return { status: res.status, body: (await res.json()) as T };
}

describe('GET /api/health', () => {
  it('returns 200 { status: "ok" }', async () => {
    const { status, body } = await get<HealthResponse>('/api/health');
    assert.equal(status, 200);
    assert.deepEqual(body, { status: 'ok' });
  });

  it('rejects other methods with 405 and an Allow header', async () => {
    const res = await fetch(`${baseUrl}/api/health`, { method: 'POST' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET');
    assert.equal(((await res.json()) as ApiError).code, 'METHOD_NOT_ALLOWED');
  });
});

describe('routing', () => {
  it('answers unknown API routes with 404 NOT_FOUND in the unified format', async () => {
    const { status, body } = await get<ApiError>('/api/nope');
    assert.equal(status, 404);
    assert.equal(body.code, 'NOT_FOUND');
    assert.equal(typeof body.error, 'string');
  });

  it('no longer serves the removed availability and reservation endpoints', async () => {
    assert.equal((await get<ApiError>('/api/availability?sport=badminton')).status, 404);
    assert.equal((await get<ApiError>('/api/reservations')).status, 404);
  });

  it('serves static files and falls back to index.html for SPA routes', async () => {
    const asset = await fetch(`${baseUrl}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
    const spa = await fetch(`${baseUrl}/some/client/route`);
    assert.equal(spa.status, 200);
    assert.match(await spa.text(), /SpotRadar/);
    assert.equal((await fetch(`${baseUrl}/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/`, { method: 'POST' })).status, 405);
  });
});

describe('GET /api/search', () => {
  it('returns venues with availability and never exposes the connector source', async () => {
    const { status, body } = await get<SearchResponse>(
      `/api/search?sport=badminton&date=${TOMORROW}`,
    );
    assert.equal(status, 200);
    assert.deepEqual(body.query, { sport: 'badminton', date: TOMORROW });
    assert.equal(body.results.length, VENUE_RECORDS.length);
    assert.equal(JSON.stringify(body).includes('"source"'), false);
    assert.equal(JSON.stringify(body).includes('baseUrl'), false);

    const byId = new Map(body.results.map((r) => [r.venue.id, r]));
    const kuklenska = byId.get('kuklenska');
    assert.equal(kuklenska?.availability.status, 'live');
    assert.equal(kuklenska?.availability.checkedAt, FIXED_NOW.toISOString());
    assert.equal(kuklenska?.availability.freeSlots.length, 2);
    assert.equal(byId.get('centrum-viktoria')?.availability.status, 'unavailable');
    assert.equal(byId.get('hala-sprint')?.availability.status, 'unknown');
    assert.equal(
      kuklenska?.venue.bookingUrl,
      'https://kuklenska.clubspire.cz/timeline/day?tabIdx=0',
    );
    assert.equal(body.results[0]?.venue.id, 'kuklenska'); // the only venue with free courts
  });

  it('applies time, origin and maxDistanceKm', async () => {
    const { status, body } = await get<SearchResponse>(
      `/api/search?sport=badminton&date=${TOMORROW}&time=10:30&lat=49.1951&lng=16.6068&maxDistanceKm=3`,
    );
    assert.equal(status, 200);
    assert.deepEqual(body.query, {
      sport: 'badminton',
      date: TOMORROW,
      time: '10:30',
      lat: 49.1951,
      lng: 16.6068,
      maxDistanceKm: 3,
    });
    assert.ok(body.results.length > 0 && body.results.length < VENUE_RECORDS.length);
    assert.ok(body.results.every((r) => typeof r.distanceKm === 'number' && r.distanceKm <= 3));
    const kuklenska = body.results.find((r) => r.venue.id === 'kuklenska');
    assert.equal(kuklenska?.freeCourtsAtTime, 3);
    const unknown = body.results.find((r) => r.availability.status === 'unknown');
    assert.equal(unknown?.freeCourtsAtTime, undefined);
  });

  it("drops today's slots that already ended", async () => {
    const { status, body } = await get<SearchResponse>(`/api/search?sport=badminton&date=${TODAY}`);
    assert.equal(status, 200);
    const kuklenska = body.results.find((r) => r.venue.id === 'kuklenska');
    assert.deepEqual(kuklenska?.availability.freeSlots, [slot('10:00', '11:00', 3)]);
  });

  it('returns 200 with an empty list when no venue is within range', async () => {
    const { status, body } = await get<SearchResponse>(
      `/api/search?sport=badminton&date=${TOMORROW}&lat=50.0755&lng=14.4378&maxDistanceKm=5`,
    );
    assert.equal(status, 200);
    assert.deepEqual(body.results, []);
  });

  it('returns 400 VALIDATION_ERROR with issues for invalid input', async () => {
    const cases = [
      '/api/search',
      '/api/search?sport=tennis&date=2026-11-25',
      `/api/search?sport=badminton&date=25.11.2026`,
      `/api/search?sport=badminton&date=${TOMORROW}&time=25:00`,
      `/api/search?sport=badminton&date=${TOMORROW}&lat=49.1`,
      `/api/search?sport=badminton&date=${TOMORROW}&maxDistanceKm=5`,
    ];
    for (const url of cases) {
      const { status, body } = await get<ApiError>(url);
      assert.equal(status, 400, url);
      assert.equal(body.code, 'VALIDATION_ERROR', url);
      assert.ok(Array.isArray(body.details) && body.details.length > 0, url);
    }
  });

  it('returns 422 DATE_OUT_OF_RANGE outside today … today + 14 days', async () => {
    for (const date of ['2026-11-23', '2026-12-09']) {
      const { status, body } = await get<ApiError>(`/api/search?sport=badminton&date=${date}`);
      assert.equal(status, 422, date);
      assert.equal(body.code, 'DATE_OUT_OF_RANGE', date);
    }
    // boundaries are accepted
    assert.equal(
      (await get<SearchResponse>('/api/search?sport=badminton&date=2026-11-24')).status,
      200,
    );
    assert.equal(
      (await get<SearchResponse>('/api/search?sport=badminton&date=2026-12-08')).status,
      200,
    );
  });

  it('rejects other methods with 405', async () => {
    const res = await fetch(`${baseUrl}/api/search`, { method: 'POST' });
    assert.equal(res.status, 405);
  });
});

describe('GET /api/geocode', () => {
  it('returns 200 with lat, lng and label', async () => {
    geocodeBehavior = () => jsonResponse(BRNO_HIT);
    const { status, body } = await get<GeocodeResponse>(
      `/api/geocode?q=${encodeURIComponent('Brno Údolní')}`,
    );
    assert.equal(status, 200);
    assert.deepEqual(body, { lat: 49.2, lng: 16.6, label: 'Brno, Česko' });
  });

  it('returns 400 for a missing or too short q', async () => {
    for (const url of [
      '/api/geocode',
      '/api/geocode?q=',
      '/api/geocode?q=a',
      `/api/geocode?q=${'x'.repeat(201)}`,
    ]) {
      const { status, body } = await get<ApiError>(url);
      assert.equal(status, 400, url);
      assert.equal(body.code, 'VALIDATION_ERROR', url);
    }
  });

  it('returns 404 LOCATION_NOT_FOUND when Nominatim finds nothing', async () => {
    geocodeBehavior = () => jsonResponse([]);
    const { status, body } = await get<ApiError>('/api/geocode?q=zzzzqqqq');
    assert.equal(status, 404);
    assert.equal(body.code, 'LOCATION_NOT_FOUND');
  });

  it('returns 502 GEOCODER_UNAVAILABLE when Nominatim fails', async () => {
    geocodeBehavior = () => jsonResponse({ error: 'boom' }, 500);
    const failed = await get<ApiError>('/api/geocode?q=failing+street');
    assert.equal(failed.status, 502);
    assert.equal(failed.body.code, 'GEOCODER_UNAVAILABLE');

    geocodeBehavior = () => Promise.reject(new Error('network down'));
    const network = await get<ApiError>('/api/geocode?q=another+failing+street');
    assert.equal(network.status, 502);
    assert.equal(network.body.code, 'GEOCODER_UNAVAILABLE');
  });
});
