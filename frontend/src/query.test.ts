import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDefaultState, stateFromSearch, stateToSearch, toCalendarQuery } from './query.ts';
import type { AppState } from './query.ts';
import { NOW } from './test-fixtures.test.ts';

test('defaults depend on the viewport and start today', () => {
  const wide = getDefaultState(NOW, true);
  assert.equal(wide.view, 'week');
  assert.equal(wide.date, '2026-11-25');
  assert.equal(wide.sport, 'badminton');
  assert.equal(getDefaultState(NOW, false).view, 'day');
});

test('empty query string yields defaults', () => {
  assert.deepEqual(stateFromSearch('', NOW, true), getDefaultState(NOW, true));
});

test('state round-trips through the URL (sport is always present)', () => {
  const state: AppState = {
    sport: 'badminton',
    view: 'month',
    date: '2026-12-01',
    origin: { lat: 49.2, lng: 16.6, label: 'Selected location', source: 'url' },
    maxDistanceKm: 5,
  };
  const search = stateToSearch(state);
  assert.equal(
    search,
    'view=month&date=2026-12-01&sport=badminton&lat=49.2&lng=16.6&maxDistanceKm=5',
  );
  assert.deepEqual(stateFromSearch(`?${search}`, NOW, true), state);
});

test('the default state serialises to view, date and sport only', () => {
  assert.equal(
    stateToSearch(getDefaultState(NOW, true)),
    'view=week&date=2026-11-25&sport=badminton',
  );
});

test('removed filters (time range, only free) in old links are ignored', () => {
  const state = stateFromSearch('?timeFrom=08:00&timeTo=10:00&free=1', NOW, true);
  assert.deepEqual(state, getDefaultState(NOW, true));
});

test('invalid values fall back to defaults', () => {
  const state = stateFromSearch(
    '?view=decade&date=2026-13-40&sport=tennis&lat=abc&lng=1&maxDistanceKm=5',
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
