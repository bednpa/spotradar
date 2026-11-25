import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDefaultState,
  parseGotoDate,
  stateFromSearch,
  stateToSearch,
  toCalendarQuery,
} from './query.ts';
import type { AppState } from './query.ts';
import { NOW } from './test-fixtures.test.ts';

test('defaults depend on the viewport and start today', () => {
  const wide = getDefaultState(NOW, true);
  assert.equal(wide.view, 'week');
  assert.equal(wide.date, '2026-11-25');
  assert.equal(wide.fromHour, 6);
  assert.equal(wide.toHour, 23);
  assert.equal(getDefaultState(NOW, false).view, 'day');
});

test('empty query string yields defaults', () => {
  assert.deepEqual(stateFromSearch('', NOW, true), getDefaultState(NOW, true));
});

test('state round-trips through the URL', () => {
  const state: AppState = {
    sport: 'badminton',
    view: 'month',
    date: '2026-12-01',
    fromHour: 8,
    toHour: 21,
    origin: { lat: 49.2, lng: 16.6, label: 'Selected location', source: 'url' },
    maxDistanceKm: 5,
    onlyFree: true,
  };
  const search = stateToSearch(state);
  assert.equal(
    search,
    'view=month&date=2026-12-01&timeFrom=08%3A00&timeTo=21%3A00&lat=49.2&lng=16.6&maxDistanceKm=5&free=1',
  );
  assert.deepEqual(stateFromSearch(`?${search}`, NOW, true), state);
});

test('defaults are omitted from the URL', () => {
  assert.equal(stateToSearch(getDefaultState(NOW, true)), 'view=week&date=2026-11-25');
});

test('invalid values fall back to defaults', () => {
  const state = stateFromSearch(
    '?view=decade&date=2026-13-40&sport=tennis&timeFrom=25:00&timeTo=nope&lat=abc&lng=1&maxDistanceKm=5',
    NOW,
    true,
  );
  assert.deepEqual(state, getDefaultState(NOW, true));
});

test('distance needs an origin and must be within bounds', () => {
  assert.equal(stateFromSearch('?maxDistanceKm=5', NOW, true).maxDistanceKm, null);
  assert.equal(stateFromSearch('?lat=49&lng=16&maxDistanceKm=500', NOW, true).maxDistanceKm, null);
  assert.equal(stateFromSearch('?lat=49&lng=16&maxDistanceKm=10', NOW, true).maxDistanceKm, 10);
});

test('inverted time range is reset', () => {
  const state = stateFromSearch('?timeFrom=20:00&timeTo=10:00', NOW, true);
  assert.equal(state.fromHour, 6);
  assert.equal(state.toHour, 23);
});

test('parseGotoDate accepts only real dates inside the search window', () => {
  assert.equal(parseGotoDate('2026-11-25', NOW), '2026-11-25');
  assert.equal(parseGotoDate('2026-12-09', NOW), '2026-12-09');
  assert.equal(parseGotoDate('2026-12-10', NOW), null);
  assert.equal(parseGotoDate('2026-11-24', NOW), null);
  assert.equal(parseGotoDate('2026-02-31', NOW), null);
  assert.equal(parseGotoDate('', NOW), null);
  assert.equal(parseGotoDate('nope', NOW), null);
});

test('toCalendarQuery includes location only when set', () => {
  const base = getDefaultState(NOW, true);
  const range = { from: '2026-11-25', to: '2026-11-29' };
  assert.deepEqual(toCalendarQuery(base, range), {
    sport: 'badminton',
    from: '2026-11-25',
    to: '2026-11-29',
  });
  const located: AppState = {
    ...base,
    origin: { lat: 1, lng: 2, label: 'x', source: 'address' },
    maxDistanceKm: 10,
  };
  assert.deepEqual(toCalendarQuery(located, range), {
    sport: 'badminton',
    from: '2026-11-25',
    to: '2026-11-29',
    lat: 1,
    lng: 2,
    maxDistanceKm: 10,
  });
});
