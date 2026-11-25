import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from './api.ts';
import {
  calendarData,
  calendarErrorState,
  calendarStatusText,
  geocodeErrorMessage,
  geolocationErrorMessage,
  isCalendarBusy,
  isDistanceFilterEnabled,
  loadingStateFor,
  locationStatusText,
} from './state.ts';
import { makeCalendar } from './test-fixtures.test.ts';

test('partial state: data is usable and the region is busy until the range failed', () => {
  const data = makeCalendar();
  const partial = {
    status: 'partial',
    data,
    pendingFrom: '2026-11-25',
    pendingTo: '2026-11-27',
    error: null,
  } as const;
  assert.equal(calendarData(partial), data);
  assert.equal(calendarData({ status: 'success', data }), data);
  assert.equal(calendarData({ status: 'loading' }), null);
  assert.equal(isCalendarBusy(partial), true);
  assert.equal(isCalendarBusy({ ...partial, error: 'x' }), false);
  assert.equal(isCalendarBusy({ status: 'loading' }), true);
  assert.equal(isCalendarBusy({ status: 'success', data }), false);
});

test('live region text: loading, loading the rest, and empty when done or failed', () => {
  const data = makeCalendar();
  const partial = {
    status: 'partial',
    data,
    pendingFrom: '2026-11-25',
    pendingTo: '2026-11-27',
    error: null,
  } as const;
  assert.equal(calendarStatusText({ status: 'loading' }, 'week'), 'Loading availability…');
  assert.equal(calendarStatusText(partial, 'week'), 'Loading the rest of the week…');
  assert.equal(calendarStatusText(partial, 'month'), 'Loading the rest of the month…');
  assert.equal(calendarStatusText({ ...partial, error: 'x' }, 'week'), '');
  assert.equal(calendarStatusText({ status: 'success', data }, 'week'), '');
  assert.equal(calendarStatusText({ status: 'outside' }, 'week'), '');
});

test('retrying keeps a visible day on screen, other states restart from the skeleton', () => {
  const data = makeCalendar();
  const range = { from: '2026-11-25', to: '2026-11-27' };
  const failed = {
    status: 'partial',
    data,
    pendingFrom: range.from,
    pendingTo: range.to,
    error: 'Boom',
  } as const;
  assert.deepEqual(loadingStateFor(failed, range), { ...failed, error: null });
  // a partial state of another range is not reused
  assert.deepEqual(loadingStateFor(failed, { from: '2026-11-30', to: '2026-12-06' }), {
    status: 'loading',
  });
  assert.deepEqual(loadingStateFor({ status: 'error', message: 'x', issues: [] }, range), {
    status: 'loading',
  });
  assert.deepEqual(loadingStateFor({ status: 'loading' }, range), { status: 'loading' });
});

test('geolocation error messages', () => {
  assert.match(geolocationErrorMessage(1), /denied/);
  assert.match(geolocationErrorMessage(2), /not available/);
  assert.match(geolocationErrorMessage(3), /too long/);
});

test('geocode error messages', () => {
  assert.match(
    geocodeErrorMessage(new ApiRequestError(404, 'LOCATION_NOT_FOUND', 'x')),
    /Address not found/,
  );
  assert.match(
    geocodeErrorMessage(new ApiRequestError(502, 'GEOCODER_UNAVAILABLE', 'x')),
    /unavailable/,
  );
  assert.match(
    geocodeErrorMessage(new ApiRequestError(400, 'VALIDATION_ERROR', 'x')),
    /2 characters/,
  );
  assert.equal(geocodeErrorMessage(new ApiRequestError(0, 'NETWORK_ERROR', 'offline')), 'offline');
  assert.match(geocodeErrorMessage(new Error('boom')), /Something went wrong/);
});

test('calendarErrorState maps API errors', () => {
  const range = calendarErrorState(new ApiRequestError(422, 'DATE_OUT_OF_RANGE', 'x'));
  assert.equal(range.status, 'error');
  if (range.status === 'error') assert.match(range.message, /14 days/);

  const issues = [{ field: 'to', message: 'bad' }];
  const validation = calendarErrorState(new ApiRequestError(400, 'VALIDATION_ERROR', 'x', issues));
  if (validation.status === 'error') assert.deepEqual(validation.issues, issues);

  const server = calendarErrorState(new ApiRequestError(500, 'INTERNAL_ERROR', 'Internal error'));
  if (server.status === 'error') assert.equal(server.message, 'Internal error');

  const unknown = calendarErrorState(new Error('x'));
  if (unknown.status === 'error') assert.match(unknown.message, /Something went wrong/);
});

test('locationStatusText and distance filter', () => {
  const origin = { lat: 1, lng: 2, label: 'Brno, Česko', source: 'address' } as const;
  assert.equal(locationStatusText({ status: 'idle' }), '');
  assert.match(locationStatusText({ status: 'locating' }), /Finding/);
  assert.match(locationStatusText({ status: 'resolving' }), /Looking up/);
  assert.equal(locationStatusText({ status: 'set', origin }), 'Searching near: Brno, Česko');
  assert.equal(locationStatusText({ status: 'error', message: 'nope' }), 'nope');
  assert.equal(isDistanceFilterEnabled({ status: 'set', origin }), true);
  assert.equal(isDistanceFilterEnabled({ status: 'idle' }), false);
  assert.equal(isDistanceFilterEnabled({ status: 'error', message: 'x' }), false);
});
