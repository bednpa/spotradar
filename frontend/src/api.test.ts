import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiRequestError,
  calendarQueryToParams,
  fetchCalendar,
  fetchVenues,
  geocodeAddress,
  suggestAddresses,
  toValidationIssues,
  venueQueryToParams,
} from './api.ts';
import type { FetchFn } from './api.ts';
import { QUERY, jsonResponse, makeCalendar, makeVenue } from './test-fixtures.test.ts';

function fetchReturning(response: Response, calls: string[] = []): FetchFn {
  return (input) => {
    calls.push(input);
    return Promise.resolve(response);
  };
}

test('fetchCalendar calls /api/calendar with the query and returns the body', async () => {
  const calls: string[] = [];
  const body = makeCalendar();
  const result = await fetchCalendar(
    { ...QUERY, lat: 49.2, lng: 16.6, maxDistanceKm: 5 },
    fetchReturning(jsonResponse(200, body), calls),
  );
  assert.deepEqual(result, body);
  assert.equal(
    calls[0],
    '/api/calendar?sport=badminton&from=2026-11-25&to=2026-11-27&lat=49.2&lng=16.6&maxDistanceKm=5',
  );
});

test('calendarQueryToParams omits the location when absent', () => {
  assert.equal(
    calendarQueryToParams(QUERY).toString(),
    'sport=badminton&from=2026-11-25&to=2026-11-27',
  );
});

test('fetchCalendar parses a 400 VALIDATION_ERROR with details', async () => {
  const response = jsonResponse(400, {
    error: 'Invalid query',
    code: 'VALIDATION_ERROR',
    details: [{ field: 'to', message: 'bad' }, { nope: true }],
  });
  await assert.rejects(fetchCalendar(QUERY, fetchReturning(response)), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 400);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.deepEqual(error.details, [{ field: 'to', message: 'bad' }]);
    return true;
  });
});

test('fetchCalendar parses a 422 DATE_OUT_OF_RANGE', async () => {
  const response = jsonResponse(422, { error: 'Date out of range', code: 'DATE_OUT_OF_RANGE' });
  await assert.rejects(fetchCalendar(QUERY, fetchReturning(response)), (error: unknown) => {
    assert.ok(error instanceof ApiRequestError);
    assert.equal(error.status, 422);
    assert.equal(error.code, 'DATE_OUT_OF_RANGE');
    return true;
  });
});

test('geocodeAddress returns the resolved place', async () => {
  const calls: string[] = [];
  const body = { lat: 49.1951, lng: 16.6068, label: 'Brno, Česko' };
  const result = await geocodeAddress(
    'Brno centrum',
    fetchReturning(jsonResponse(200, body), calls),
  );
  assert.deepEqual(result, body);
  assert.equal(calls[0], '/api/geocode?q=Brno+centrum');
});

test('geocodeAddress maps 404 and 502', async () => {
  const notFound = jsonResponse(404, { error: 'nope', code: 'LOCATION_NOT_FOUND' });
  await assert.rejects(geocodeAddress('nowhere', fetchReturning(notFound)), (e: unknown) => {
    assert.ok(e instanceof ApiRequestError);
    assert.equal(e.code, 'LOCATION_NOT_FOUND');
    return true;
  });
  const down = jsonResponse(502, { error: 'down', code: 'GEOCODER_UNAVAILABLE' });
  await assert.rejects(geocodeAddress('Brno', fetchReturning(down)), (e: unknown) => {
    assert.ok(e instanceof ApiRequestError);
    assert.equal(e.code, 'GEOCODER_UNAVAILABLE');
    assert.equal(e.status, 502);
    return true;
  });
});

test('network failure and malformed bodies become client errors', async () => {
  const failing: FetchFn = () => Promise.reject(new TypeError('offline'));
  await assert.rejects(fetchCalendar(QUERY, failing), (e: unknown) => {
    assert.ok(e instanceof ApiRequestError);
    assert.equal(e.code, 'NETWORK_ERROR');
    assert.equal(e.status, 0);
    return true;
  });
  await assert.rejects(
    fetchCalendar(QUERY, fetchReturning(jsonResponse(200, { unexpected: true }))),
    (e: unknown) => e instanceof ApiRequestError && e.code === 'INVALID_RESPONSE',
  );
  await assert.rejects(
    fetchCalendar(QUERY, fetchReturning(new Response('<html>', { status: 500 }))),
    (e: unknown) =>
      e instanceof ApiRequestError && e.code === 'INVALID_RESPONSE' && e.status === 500,
  );
  await assert.rejects(
    geocodeAddress('x', fetchReturning(jsonResponse(200, { lat: 'a' }))),
    (e: unknown) => e instanceof ApiRequestError && e.code === 'INVALID_RESPONSE',
  );
});

test('fetchVenues calls /api/venues with the filters and returns the body', async () => {
  const calls: string[] = [];
  const body = {
    query: { q: 'lisen' },
    venues: [{ venue: makeVenue('lisen', 'Badminton Líšeň'), liveAvailability: false }],
  };
  const result = await fetchVenues(
    { q: ' lisen ', sport: 'badminton' },
    fetchReturning(jsonResponse(200, body), calls),
  );
  assert.deepEqual(result, body);
  assert.equal(calls[0], '/api/venues?sport=badminton&q=lisen');

  await fetchVenues({}, fetchReturning(jsonResponse(200, { query: {}, venues: [] }), calls));
  assert.equal(calls[1], '/api/venues');
});

test('venueQueryToParams only includes set filters', () => {
  assert.equal(venueQueryToParams({}).toString(), '');
  assert.equal(venueQueryToParams({ q: '   ' }).toString(), '');
  assert.equal(venueQueryToParams({ q: 'a b' }).toString(), 'q=a+b');
});

test('fetchVenues maps a 400 VALIDATION_ERROR and rejects malformed bodies', async () => {
  const invalid = jsonResponse(400, {
    error: 'Invalid query',
    code: 'VALIDATION_ERROR',
    details: [{ field: 'q', message: 'too long' }],
  });
  await assert.rejects(fetchVenues({ q: 'x' }, fetchReturning(invalid)), (e: unknown) => {
    assert.ok(e instanceof ApiRequestError);
    assert.equal(e.status, 400);
    assert.equal(e.code, 'VALIDATION_ERROR');
    assert.deepEqual(e.details, [{ field: 'q', message: 'too long' }]);
    return true;
  });
  const server = jsonResponse(500, { error: 'Internal error', code: 'INTERNAL_ERROR' });
  await assert.rejects(
    fetchVenues({}, fetchReturning(server)),
    (e: unknown) => e instanceof ApiRequestError && e.code === 'INTERNAL_ERROR',
  );
  await assert.rejects(
    fetchVenues({}, fetchReturning(jsonResponse(200, { venues: [{ venue: 1 }] }))),
    (e: unknown) => e instanceof ApiRequestError && e.code === 'INVALID_RESPONSE',
  );
  const offline: FetchFn = () => Promise.reject(new TypeError('offline'));
  await assert.rejects(
    fetchVenues({}, offline),
    (e: unknown) => e instanceof ApiRequestError && e.code === 'NETWORK_ERROR',
  );
});

test('suggestAddresses returns the suggestions (also an empty list)', async () => {
  const calls: string[] = [];
  const suggestions = [{ lat: 49.19, lng: 16.63, label: 'Kuklenská, Brno' }];
  const result = await suggestAddresses(
    'kukl',
    fetchReturning(jsonResponse(200, { suggestions }), calls),
  );
  assert.deepEqual(result, suggestions);
  assert.equal(calls[0], '/api/geocode/suggest?q=kukl');
  assert.deepEqual(
    await suggestAddresses('nowhere', fetchReturning(jsonResponse(200, { suggestions: [] }))),
    [],
  );
});

test('suggestAddresses maps 400 and 502 and rejects malformed bodies', async () => {
  const bad = jsonResponse(400, { error: 'bad', code: 'VALIDATION_ERROR' });
  await assert.rejects(
    suggestAddresses('a', fetchReturning(bad)),
    (e: unknown) => e instanceof ApiRequestError && e.code === 'VALIDATION_ERROR',
  );
  const down = jsonResponse(502, { error: 'down', code: 'GEOCODER_UNAVAILABLE' });
  await assert.rejects(suggestAddresses('fail', fetchReturning(down)), (e: unknown) => {
    assert.ok(e instanceof ApiRequestError);
    assert.equal(e.status, 502);
    assert.equal(e.code, 'GEOCODER_UNAVAILABLE');
    return true;
  });
  await assert.rejects(
    suggestAddresses('ab', fetchReturning(jsonResponse(200, { suggestions: [{ lat: 'x' }] }))),
    (e: unknown) => e instanceof ApiRequestError && e.code === 'INVALID_RESPONSE',
  );
});

test('toValidationIssues tolerates non-arrays', () => {
  assert.deepEqual(toValidationIssues(undefined), []);
  assert.deepEqual(toValidationIssues('x'), []);
});
