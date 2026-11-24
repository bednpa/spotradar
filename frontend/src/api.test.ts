import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError, createReservation, searchAvailability } from './api.ts';
import type { FetchFn } from './api.ts';
import { QUERY, RESERVATION, jsonResponse, makeResponse } from './test-fixtures.test.ts';

function recordingFetch(response: Response | Error): { fetchFn: FetchFn; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  return { fetchFn, calls };
}

async function rejection(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiRequestError, 'expected ApiRequestError');
    return error;
  }
  assert.fail('expected the promise to reject');
}

test('searchAvailability calls the relative endpoint and returns the response', async () => {
  const body = makeResponse();
  const { fetchFn, calls } = recordingFetch(jsonResponse(200, body));
  const result = await searchAvailability(QUERY, fetchFn);
  assert.deepEqual(result, body);
  assert.equal(
    calls[0]?.url,
    '/api/availability?sport=tennis&date=2026-11-25&time=18%3A00&durationMinutes=90&cityId=brno',
  );
});

test('searchAvailability returns an empty result list', async () => {
  const { fetchFn } = recordingFetch(jsonResponse(200, makeResponse([])));
  const result = await searchAvailability(QUERY, fetchFn);
  assert.deepEqual(result.results, []);
});

test('searchAvailability maps a 400 VALIDATION_ERROR with details', async () => {
  const { fetchFn } = recordingFetch(
    jsonResponse(400, {
      error: 'Invalid query',
      code: 'VALIDATION_ERROR',
      details: [{ field: 'date', message: 'date is required' }, { bogus: true }],
    }),
  );
  const error = await rejection(searchAvailability(QUERY, fetchFn));
  assert.equal(error.status, 400);
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.equal(error.message, 'Invalid query');
  assert.deepEqual(error.details, [{ field: 'date', message: 'date is required' }]);
});

test('searchAvailability maps 422 DATE_OUT_OF_RANGE', async () => {
  const { fetchFn } = recordingFetch(
    jsonResponse(422, { error: 'Date is outside the booking window', code: 'DATE_OUT_OF_RANGE' }),
  );
  const error = await rejection(searchAvailability(QUERY, fetchFn));
  assert.equal(error.status, 422);
  assert.equal(error.code, 'DATE_OUT_OF_RANGE');
  assert.deepEqual(error.details, []);
});

test('network failure becomes a friendly NETWORK_ERROR', async () => {
  const { fetchFn } = recordingFetch(new TypeError('fetch failed'));
  const error = await rejection(searchAvailability(QUERY, fetchFn));
  assert.equal(error.status, 0);
  assert.equal(error.code, 'NETWORK_ERROR');
  assert.match(error.message, /Cannot reach the server/);
});

test('non-JSON error body becomes INVALID_RESPONSE with the HTTP status', async () => {
  const { fetchFn } = recordingFetch(new Response('<html>Bad gateway</html>', { status: 502 }));
  const error = await rejection(searchAvailability(QUERY, fetchFn));
  assert.equal(error.status, 502);
  assert.equal(error.code, 'INVALID_RESPONSE');
  assert.match(error.message, /HTTP 502/);
});

test('non-JSON success body becomes INVALID_RESPONSE', async () => {
  const { fetchFn } = recordingFetch(new Response('ok', { status: 200 }));
  const error = await rejection(searchAvailability(QUERY, fetchFn));
  assert.equal(error.code, 'INVALID_RESPONSE');
});

test('JSON success body of the wrong shape is rejected', async () => {
  const { fetchFn } = recordingFetch(jsonResponse(200, { hello: 'world' }));
  const error = await rejection(searchAvailability(QUERY, fetchFn));
  assert.equal(error.code, 'INVALID_RESPONSE');
});

test('createReservation POSTs JSON and returns the reservation', async () => {
  const { fetchFn, calls } = recordingFetch(jsonResponse(201, RESERVATION));
  const request = {
    venueId: 'v1',
    courtId: 'c1',
    sport: 'tennis' as const,
    date: '2026-11-25',
    time: '18:00',
    durationMinutes: 90 as const,
    customerName: 'Jana Nováková',
    customerEmail: 'jana@example.com',
  };
  const reservation = await createReservation(request, fetchFn);
  assert.equal(reservation.id, 'r-123');
  assert.equal(calls[0]?.url, '/api/reservations');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), request);
});

test('createReservation maps 409 SLOT_UNAVAILABLE', async () => {
  const { fetchFn } = recordingFetch(
    jsonResponse(409, { error: 'Court is already booked', code: 'SLOT_UNAVAILABLE' }),
  );
  const error = await rejection(
    createReservation(
      {
        venueId: 'v1',
        courtId: 'c1',
        sport: 'tennis',
        date: '2026-11-25',
        time: '18:00',
        durationMinutes: 60,
        customerName: 'Jana',
        customerEmail: 'jana@example.com',
      },
      fetchFn,
    ),
  );
  assert.equal(error.status, 409);
  assert.equal(error.code, 'SLOT_UNAVAILABLE');
});
