import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiRequestError } from './api.ts';
import {
  geocodeErrorMessage,
  geolocationErrorMessage,
  isDistanceFilterEnabled,
  locationStatusText,
  searchErrorState,
  searchInvalidState,
} from './state.ts';

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

test('searchErrorState maps API errors', () => {
  const range = searchErrorState(new ApiRequestError(422, 'DATE_OUT_OF_RANGE', 'x'));
  assert.equal(range.status, 'error');
  if (range.status === 'error') assert.match(range.message, /14 days/);

  const issues = [{ field: 'time', message: 'bad' }];
  const validation = searchErrorState(new ApiRequestError(400, 'VALIDATION_ERROR', 'x', issues));
  if (validation.status === 'error') assert.deepEqual(validation.issues, issues);

  const network = searchErrorState(new ApiRequestError(0, 'NETWORK_ERROR', 'Cannot reach'));
  if (network.status === 'error') assert.equal(network.message, 'Cannot reach');

  const unknown = searchErrorState(new Error('x'));
  if (unknown.status === 'error') assert.match(unknown.message, /Something went wrong/);
});

test('searchInvalidState carries issues', () => {
  const state = searchInvalidState([{ field: 'a', message: 'b' }]);
  assert.equal(state.status, 'error');
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
