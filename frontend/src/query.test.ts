import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_OPTIONS,
  buildSearchQuery,
  formValuesToParams,
  getDefaultDateTime,
  getDefaultFormValues,
  queryToSearchParams,
} from './query.ts';
import type { SearchFormValues } from './query.ts';

const VALID: SearchFormValues = {
  sport: 'tennis',
  date: '2026-11-25',
  time: '18:00',
  durationMinutes: '90',
  lat: '',
  lng: '',
  maxDistanceKm: '',
};

test('time options run from 07:00 to 21:00 in half-hour steps', () => {
  assert.equal(TIME_OPTIONS[0], '07:00');
  assert.equal(TIME_OPTIONS[1], '07:30');
  assert.equal(TIME_OPTIONS.at(-1), '21:00');
  assert.equal(TIME_OPTIONS.length, 29);
});

test('default time is the next half-hour slot after now (Prague time)', () => {
  // 10:10 UTC = 11:10 in Prague (CET)
  assert.deepEqual(getDefaultDateTime(new Date('2026-11-24T10:10:00Z')), {
    date: '2026-11-24',
    time: '11:30',
  });
  // exactly on a slot -> the next one
  assert.deepEqual(getDefaultDateTime(new Date('2026-11-24T10:00:00Z')), {
    date: '2026-11-24',
    time: '11:30',
  });
});

test('default time is clamped to 07:00 early in the morning', () => {
  // 23:30 UTC = 00:30 next day in Prague
  assert.deepEqual(getDefaultDateTime(new Date('2026-11-24T23:30:00Z')), {
    date: '2026-11-25',
    time: '07:00',
  });
});

test('default moves to tomorrow 18:00 when no slot is left today', () => {
  // 22:40 UTC = 23:40 in Prague
  assert.deepEqual(getDefaultDateTime(new Date('2026-11-24T22:40:00Z')), {
    date: '2026-11-25',
    time: '18:00',
  });
  // 20:00 UTC = 21:00 Prague -> next slot 21:30 is not offered
  assert.deepEqual(getDefaultDateTime(new Date('2026-11-24T20:00:00Z')), {
    date: '2026-11-25',
    time: '18:00',
  });
});

test('last slot of the day is still offered today', () => {
  // 19:45 UTC = 20:45 Prague
  assert.deepEqual(getDefaultDateTime(new Date('2026-11-24T19:45:00Z')), {
    date: '2026-11-24',
    time: '21:00',
  });
});

test('default form values have no location and 60 minute duration', () => {
  const values = getDefaultFormValues(new Date('2026-11-24T10:10:00Z'));
  assert.equal(values.sport, 'tennis');
  assert.equal(values.durationMinutes, '60');
  assert.equal(values.lat, '');
  assert.equal(values.maxDistanceKm, '');
});

test('max distance is dropped when no location is set', () => {
  const params = formValuesToParams({ ...VALID, maxDistanceKm: '5' });
  assert.equal(params.maxDistanceKm, undefined);
  assert.equal(params.lat, undefined);
  assert.equal(params.cityId, 'brno');
});

test('buildSearchQuery accepts a valid form and keeps location + distance', () => {
  const result = buildSearchQuery({ ...VALID, lat: '49.19500', lng: '16.60800', maxDistanceKm: '5' });
  assert.ok(result.ok);
  assert.deepEqual(result.value, {
    sport: 'tennis',
    date: '2026-11-25',
    time: '18:00',
    durationMinutes: 90,
    cityId: 'brno',
    lat: 49.195,
    lng: 16.608,
    maxDistanceKm: 5,
  });
});

test('buildSearchQuery reports issues for an invalid form', () => {
  const result = buildSearchQuery({ ...VALID, date: '', time: '18:15' });
  assert.ok(!result.ok);
  assert.deepEqual(result.issues.map((i) => i.field).sort(), ['date', 'time']);
});

test('queryToSearchParams serialises optional fields only when present', () => {
  const plain = queryToSearchParams({
    sport: 'padel',
    date: '2026-11-25',
    time: '18:00',
    durationMinutes: 60,
    cityId: 'brno',
  });
  assert.equal(
    plain.toString(),
    'sport=padel&date=2026-11-25&time=18%3A00&durationMinutes=60&cityId=brno',
  );

  const located = queryToSearchParams({
    sport: 'padel',
    date: '2026-11-25',
    time: '18:00',
    durationMinutes: 60,
    cityId: 'brno',
    lat: 49.2,
    lng: 16.6,
    maxDistanceKm: 5,
  });
  assert.equal(located.get('lat'), '49.2');
  assert.equal(located.get('lng'), '16.6');
  assert.equal(located.get('maxDistanceKm'), '5');
});
