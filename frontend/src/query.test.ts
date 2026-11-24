import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchQuery,
  formFromQueryString,
  formToParams,
  getDateChips,
  getDefaultFormValues,
  queryToSearchParams,
} from './query.ts';
import type { FormValues } from './query.ts';

const NOW = new Date('2026-11-24T10:00:00Z');

function values(overrides: Partial<FormValues> = {}): FormValues {
  return { ...getDefaultFormValues(NOW), ...overrides };
}

test('default form: badminton, today, any time, no origin', () => {
  assert.deepEqual(getDefaultFormValues(NOW), {
    sport: 'badminton',
    date: '2026-11-24',
    time: '',
    maxDistanceKm: '',
    origin: null,
  });
});

test('date chips: Today, Tomorrow, then labelled weekdays', () => {
  const chips = getDateChips(NOW);
  assert.equal(chips.length, 7);
  assert.deepEqual(chips[0], { date: '2026-11-24', label: 'Today' });
  assert.deepEqual(chips[1], { date: '2026-11-25', label: 'Tomorrow' });
  assert.deepEqual(chips[2], { date: '2026-11-26', label: 'Thu 26 Nov' });
  assert.equal(chips[6]?.date, '2026-11-30');
});

test('time is optional', () => {
  const result = buildSearchQuery(values());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.time, undefined);
  const withTime = buildSearchQuery(values({ time: '18:00' }));
  assert.equal(withTime.ok && withTime.value.time, '18:00');
});

test('invalid time is rejected', () => {
  const result = buildSearchQuery(values({ time: '25:99' }));
  assert.equal(result.ok, false);
});

test('distance requires an origin', () => {
  const result = buildSearchQuery(values({ maxDistanceKm: '5' }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issues[0]?.field, 'maxDistanceKm');
});

test('origin and distance produce lat/lng/maxDistanceKm', () => {
  const origin = { lat: 49.19, lng: 16.6, label: 'Brno', source: 'address' } as const;
  const result = buildSearchQuery(values({ origin, maxDistanceKm: '5', time: '18:00' }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value, {
      sport: 'badminton',
      date: '2026-11-24',
      time: '18:00',
      lat: 49.19,
      lng: 16.6,
      maxDistanceKm: 5,
    });
    assert.equal(
      queryToSearchParams(result.value).toString(),
      'sport=badminton&date=2026-11-24&time=18%3A00&lat=49.19&lng=16.6&maxDistanceKm=5',
    );
  }
});

test('formToParams omits blank values', () => {
  assert.deepEqual(formToParams(values()), { sport: 'badminton', date: '2026-11-24' });
});

test('formFromQueryString restores the form or returns null', () => {
  assert.equal(formFromQueryString('', NOW), null);
  const restored = formFromQueryString(
    '?sport=badminton&date=2026-11-25&time=18:00&lat=49.2&lng=16.6&maxDistanceKm=5',
    NOW,
  );
  assert.equal(restored?.date, '2026-11-25');
  assert.equal(restored?.time, '18:00');
  assert.equal(restored?.maxDistanceKm, '5');
  assert.equal(restored?.origin?.lat, 49.2);
  const noOrigin = formFromQueryString('?date=2026-11-25&maxDistanceKm=5', NOW);
  assert.equal(noOrigin?.origin, null);
  assert.equal(noOrigin?.maxDistanceKm, '');
});
