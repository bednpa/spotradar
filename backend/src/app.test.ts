import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { MAX_BODY_BYTES, addDays, toLocalDateTime } from '@spotradar/shared';
import type {
  ApiError,
  AvailabilityResponse,
  CreateReservationRequest,
  HealthResponse,
  Reservation,
  ValidationIssue,
} from '@spotradar/shared';
import { createApp } from './app.ts';
import { FIXED_NOW, TODAY, findFreeSlot, freshRepos } from './testHelpers.ts';
import type { FreeSlot } from './testHelpers.ts';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
    server.closeAllConnections();
  });
}

/** GET with an untouched request target (fetch would normalize it). */
function rawGet(baseUrl: string, rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl);
    const req = request({ host: u.hostname, port: u.port, path: rawPath, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

function bodyFor(slot: FreeSlot, overrides: Partial<CreateReservationRequest> = {}): CreateReservationRequest {
  return {
    venueId: slot.venue.id,
    courtId: slot.court.id,
    sport: slot.sport,
    date: slot.date,
    time: slot.time,
    durationMinutes: slot.durationMinutes,
    customerName: 'Jana Nováková',
    customerEmail: 'jana@example.com',
    ...overrides,
  };
}

describe('HTTP API', () => {
  const repos = freshRepos();
  let server: Server;
  let baseUrl: string;
  let tmp: string;
  let distDir: string;

  before(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'spotradar-test-'));
    distDir = path.join(tmp, 'dist');
    await mkdir(path.join(distDir, 'assets'), { recursive: true });
    await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>SpotRadar test</title>');
    await writeFile(path.join(distDir, 'assets', 'app.js'), 'console.log("app");');
    await writeFile(path.join(distDir, 'assets', 'style.css'), 'body{}');
    await writeFile(path.join(tmp, 'secret.txt'), 'TOP-SECRET');

    server = createApp({ ...repos, now: () => FIXED_NOW, staticDir: distDir });
    baseUrl = await listen(server);
  });

  after(async () => {
    await close(server);
    await rm(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    repos.reservations.clear();
  });

  async function get(pathAndQuery: string): Promise<Response> {
    return fetch(`${baseUrl}${pathAndQuery}`);
  }

  async function post(pathname: string, body: string, contentType = 'application/json'): Promise<Response> {
    return fetch(`${baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body,
    });
  }

  async function expectError(res: Response, status: number, code: string): Promise<ApiError> {
    assert.equal(res.status, status);
    assert.match(res.headers.get('content-type') ?? '', /^application\/json; charset=utf-8$/i);
    const body = (await res.json()) as ApiError;
    assert.equal(body.code, code);
    assert.equal(typeof body.error, 'string');
    return body;
  }

  describe('GET /api/health', () => {
    it('returns 200 ok', async () => {
      const res = await get('/api/health');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /application\/json; charset=utf-8/i);
      assert.deepEqual((await res.json()) as HealthResponse, { status: 'ok' });
    });
  });

  describe('GET /api/availability', () => {
    it('returns 200 with results for a free slot', async () => {
      const slot = findFreeSlot('tennis', repos);
      const res = await get(
        `/api/availability?sport=tennis&date=${slot.date}&time=${slot.time}&durationMinutes=60`,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as AvailabilityResponse;
      assert.deepEqual(body.query, {
        sport: 'tennis',
        date: slot.date,
        time: slot.time,
        durationMinutes: 60,
        cityId: 'brno',
      });
      assert.ok(body.results.length >= 1);
      const ids = body.results.flatMap((r) => r.availableCourts.map((c) => c.id));
      assert.ok(ids.includes(slot.court.id));
      for (const r of body.results) {
        assert.equal(r.distanceKm, null);
        assert.ok(r.availableCourts.length > 0);
      }
      const prices = body.results.map((r) => r.totalPriceCzk);
      assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
    });

    it('sorts by distance and reports it when a location is given', async () => {
      const slot = findFreeSlot('badminton', repos);
      const res = await get(
        `/api/availability?sport=badminton&date=${slot.date}&time=${slot.time}&lat=49.1951&lng=16.6068&maxDistanceKm=20`,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as AvailabilityResponse;
      assert.ok(body.results.length >= 1);
      const distances = body.results.map((r) => r.distanceKm);
      for (const d of distances) assert.ok(d !== null && d <= 20);
      const nums = distances.map((d) => d ?? 0);
      assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
    });

    it('returns an empty list when nothing is within maxDistanceKm', async () => {
      const slot = findFreeSlot('tennis', repos);
      const res = await get(
        `/api/availability?sport=tennis&date=${slot.date}&time=${slot.time}&lat=50.0755&lng=14.4378&maxDistanceKm=0.1`,
      );
      assert.equal(res.status, 200);
      const body = (await res.json()) as AvailabilityResponse;
      assert.deepEqual(body.results, []);
    });

    it('returns an empty list for a time outside opening hours', async () => {
      const date = addDays(toLocalDateTime(FIXED_NOW).date, 1);
      const res = await get(`/api/availability?sport=tennis&date=${date}&time=03:00`);
      assert.equal(res.status, 200);
      assert.deepEqual(((await res.json()) as AvailabilityResponse).results, []);
    });

    it('returns 400 VALIDATION_ERROR with details for invalid input', async () => {
      const res = await get('/api/availability?sport=chess&date=2026-13-40&time=10:15&durationMinutes=45');
      const err = await expectError(res, 400, 'VALIDATION_ERROR');
      const fields = (err.details as ValidationIssue[]).map((i) => i.field).sort();
      assert.deepEqual(fields, ['date', 'durationMinutes', 'sport', 'time']);
    });

    it('returns 400 when required params are missing', async () => {
      const err = await expectError(await get('/api/availability'), 400, 'VALIDATION_ERROR');
      const fields = (err.details as ValidationIssue[]).map((i) => i.field);
      assert.ok(fields.includes('sport') && fields.includes('date') && fields.includes('time'));
    });

    it('returns 400 for maxDistanceKm without a location', async () => {
      const res = await get(`/api/availability?sport=tennis&date=${TODAY}&time=10:00&maxDistanceKm=5`);
      const err = await expectError(res, 400, 'VALIDATION_ERROR');
      assert.ok((err.details as ValidationIssue[]).some((i) => i.field === 'maxDistanceKm'));
    });

    it('uses the first value of repeated params', async () => {
      const res = await get('/api/availability?sport=tennis&sport=chess&date=2026-11-25&time=03:00');
      assert.equal(res.status, 200);
      assert.equal(((await res.json()) as AvailabilityResponse).query.sport, 'tennis');
    });

    it('returns 422 DATE_OUT_OF_RANGE outside the booking window', async () => {
      await expectError(
        await get('/api/availability?sport=tennis&date=2026-11-23&time=10:00'),
        422,
        'DATE_OUT_OF_RANGE',
      );
      await expectError(
        await get('/api/availability?sport=tennis&date=2026-12-08&time=10:00'),
        422,
        'DATE_OUT_OF_RANGE',
      );
      const last = await get('/api/availability?sport=tennis&date=2026-12-07&time=10:00');
      assert.equal(last.status, 200);
    });

    it('returns no results for a start time that already passed today', async () => {
      const res = await get(`/api/availability?sport=tennis&date=${TODAY}&time=09:00`);
      assert.equal(res.status, 200);
      assert.deepEqual(((await res.json()) as AvailabilityResponse).results, []);
    });
  });

  describe('POST /api/reservations', () => {
    it('creates a reservation (201), then the same slot is 409 and gone from availability', async () => {
      const slot = findFreeSlot('tennis', repos);
      const res = await post('/api/reservations', JSON.stringify(bodyFor(slot)));
      assert.equal(res.status, 201);
      const reservation = (await res.json()) as Reservation;
      assert.match(reservation.id, /^[0-9a-f-]{36}$/);
      assert.equal(reservation.venueName, slot.venue.name);
      assert.equal(reservation.courtName, slot.court.name);
      assert.equal(reservation.totalPriceCzk, slot.venue.pricePerHourCzk.tennis);
      assert.equal(reservation.customerEmail, 'jana@example.com');
      assert.ok(!Number.isNaN(Date.parse(reservation.createdAt)));

      await expectError(
        await post('/api/reservations', JSON.stringify(bodyFor(slot))),
        409,
        'SLOT_UNAVAILABLE',
      );

      const avail = await get(
        `/api/availability?sport=tennis&date=${slot.date}&time=${slot.time}&durationMinutes=60`,
      );
      const body = (await avail.json()) as AvailabilityResponse;
      const ids = body.results.flatMap((r) => r.availableCourts.map((c) => c.id));
      assert.ok(!ids.includes(slot.court.id));

      const fetched = await get(`/api/reservations/${reservation.id}`);
      assert.equal(fetched.status, 200);
      assert.deepEqual(await fetched.json(), reservation);
    });

    it('returns 409 for a slot occupied by the simulated external bookings', async () => {
      // find a court/time that is not offered by availability although the venue is open
      const venue = repos.venues.getById('venue-lesna-racket-club');
      assert.ok(venue);
      const court = venue.courts[0];
      assert.ok(court);
      let conflict: string | undefined;
      for (let h = 10; h <= 19 && conflict === undefined; h++) {
        const time = `${String(h).padStart(2, '0')}:00`;
        const res = await get(`/api/availability?sport=tennis&date=2026-11-25&time=${time}`);
        const body = (await res.json()) as AvailabilityResponse;
        const free = body.results
          .filter((r) => r.venue.id === venue.id)
          .flatMap((r) => r.availableCourts.map((c) => c.id));
        if (!free.includes(court.id)) conflict = time;
      }
      assert.ok(conflict !== undefined, 'expected a time where court 1 is not free');
      const payload: CreateReservationRequest = {
        venueId: venue.id,
        courtId: court.id,
        sport: 'tennis',
        date: '2026-11-25',
        time: conflict,
        durationMinutes: 60,
        customerName: 'Jan',
        customerEmail: 'jan@example.com',
      };
      await expectError(await post('/api/reservations', JSON.stringify(payload)), 409, 'SLOT_UNAVAILABLE');
    });

    const base: CreateReservationRequest = {
      venueId: 'venue-lesna-racket-club',
      courtId: 'venue-lesna-racket-club-court-1',
      sport: 'tennis',
      date: '2026-11-25',
      time: '10:00',
      durationMinutes: 60,
      customerName: 'Jan',
      customerEmail: 'jan@example.com',
    };

    it('returns 404 VENUE_NOT_FOUND', async () => {
      await expectError(
        await post('/api/reservations', JSON.stringify({ ...base, venueId: 'nope' })),
        404,
        'VENUE_NOT_FOUND',
      );
    });

    it('returns 404 COURT_NOT_FOUND', async () => {
      await expectError(
        await post('/api/reservations', JSON.stringify({ ...base, courtId: 'nope' })),
        404,
        'COURT_NOT_FOUND',
      );
    });

    it('returns 422 SPORT_NOT_OFFERED', async () => {
      await expectError(
        await post('/api/reservations', JSON.stringify({ ...base, sport: 'padel' })),
        422,
        'SPORT_NOT_OFFERED',
      );
    });

    it('returns 422 OUTSIDE_OPENING_HOURS', async () => {
      await expectError(
        await post('/api/reservations', JSON.stringify({ ...base, time: '06:00' })),
        422,
        'OUTSIDE_OPENING_HOURS',
      );
    });

    it('returns 422 SLOT_IN_PAST', async () => {
      await expectError(
        await post('/api/reservations', JSON.stringify({ ...base, date: TODAY, time: '08:00' })),
        422,
        'SLOT_IN_PAST',
      );
    });

    it('returns 422 DATE_OUT_OF_RANGE', async () => {
      await expectError(
        await post('/api/reservations', JSON.stringify({ ...base, date: '2026-12-08' })),
        422,
        'DATE_OUT_OF_RANGE',
      );
    });

    it('returns 400 VALIDATION_ERROR for an invalid body', async () => {
      const err = await expectError(
        await post('/api/reservations', JSON.stringify({ venueId: 'x', customerEmail: 'nope' })),
        400,
        'VALIDATION_ERROR',
      );
      const fields = (err.details as ValidationIssue[]).map((i) => i.field);
      assert.ok(fields.includes('courtId'));
      assert.ok(fields.includes('customerEmail'));
    });

    it('returns 400 for a JSON body that is not an object', async () => {
      await expectError(await post('/api/reservations', '[1,2]'), 400, 'VALIDATION_ERROR');
    });

    it('returns 400 for malformed JSON', async () => {
      const err = await expectError(await post('/api/reservations', '{not json'), 400, 'VALIDATION_ERROR');
      assert.deepEqual(err.details, [{ field: 'body', message: 'invalid JSON' }]);
    });

    it('returns 400 for an empty body', async () => {
      await expectError(await post('/api/reservations', ''), 400, 'VALIDATION_ERROR');
    });

    it('returns 413 PAYLOAD_TOO_LARGE for a big body', async () => {
      const big = JSON.stringify({ ...base, customerName: 'x'.repeat(MAX_BODY_BYTES + 100) });
      await expectError(await post('/api/reservations', big), 413, 'PAYLOAD_TOO_LARGE');
    });
  });

  describe('GET /api/reservations/:id', () => {
    it('returns 404 RESERVATION_NOT_FOUND for an unknown id', async () => {
      await expectError(await get('/api/reservations/does-not-exist'), 404, 'RESERVATION_NOT_FOUND');
    });
  });

  describe('routing', () => {
    it('returns 404 NOT_FOUND for unknown API routes', async () => {
      await expectError(await get('/api/nope'), 404, 'NOT_FOUND');
      await expectError(await get('/api'), 404, 'NOT_FOUND');
      await expectError(await get('/api/health/extra'), 404, 'NOT_FOUND');
    });

    it('returns 405 METHOD_NOT_ALLOWED for a known path with the wrong method', async () => {
      const res = await fetch(`${baseUrl}/api/health`, { method: 'POST' });
      await expectError(res, 405, 'METHOD_NOT_ALLOWED');
      assert.equal(res.headers.get('allow'), 'GET');
      await expectError(await get('/api/reservations'), 405, 'METHOD_NOT_ALLOWED');
      await expectError(
        await fetch(`${baseUrl}/api/reservations/abc`, { method: 'DELETE' }),
        405,
        'METHOD_NOT_ALLOWED',
      );
      await expectError(
        await fetch(`${baseUrl}/api/availability`, { method: 'POST', body: '{}' }),
        405,
        'METHOD_NOT_ALLOWED',
      );
    });
  });

  describe('static files', () => {
    it('serves index.html at /', async () => {
      const res = await get('/');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
      assert.match(await res.text(), /SpotRadar test/);
    });

    it('serves assets with the right content type', async () => {
      const js = await get('/assets/app.js');
      assert.equal(js.status, 200);
      assert.match(js.headers.get('content-type') ?? '', /^text\/javascript/);
      assert.equal(await js.text(), 'console.log("app");');
      const css = await get('/assets/style.css');
      assert.match(css.headers.get('content-type') ?? '', /^text\/css/);
    });

    it('falls back to index.html for unknown paths (SPA)', async () => {
      const res = await get('/some/client/route');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
      assert.match(await res.text(), /SpotRadar test/);
    });

    it('returns 404 (not index.html) for missing files with an extension', async () => {
      const res = await get('/app/missing.js');
      assert.equal(res.status, 404);
      assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
    });

    it('answers HEAD without a body', async () => {
      const res = await fetch(`${baseUrl}/`, { method: 'HEAD' });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), '');
    });

    it('does not allow path traversal', async () => {
      const encoded = await rawGet(baseUrl, '/..%2fsecret.txt');
      assert.equal(encoded.status, 403);
      assert.ok(!encoded.body.includes('TOP-SECRET'));
      for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/%00']) {
        const r = await rawGet(baseUrl, p);
        assert.ok(!r.body.includes('TOP-SECRET'), p);
        assert.notEqual(r.status, 500, p);
      }
    });

    it('rejects non-GET methods outside /api with 405', async () => {
      const res = await fetch(`${baseUrl}/`, { method: 'POST', body: 'x' });
      await expectError(res, 405, 'METHOD_NOT_ALLOWED');
    });
  });
});

describe('static files when the frontend is not built', () => {
  let server: Server;
  let baseUrl: string;
  let tmp: string;

  before(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'spotradar-empty-'));
    const repos = freshRepos();
    server = createApp({ ...repos, now: () => FIXED_NOW, staticDir: path.join(tmp, 'missing') });
    baseUrl = await listen(server);
  });

  after(async () => {
    await close(server);
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns 404 "Frontend not built"', async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await res.text(), 'Frontend not built');
  });

  it('still serves the API', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
  });
});
