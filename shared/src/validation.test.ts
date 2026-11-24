import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAvailabilityQuery, parseCreateReservationRequest } from './validation.ts';
import type { ValidationIssue } from './types.ts';

function fields(issues: ValidationIssue[]): string[] {
  return issues.map((i) => i.field).sort();
}

test('parseAvailabilityQuery: minimal valid query gets defaults', () => {
  const result = parseAvailabilityQuery({ sport: 'tennis', date: '2026-11-25', time: '18:00' });
  assert.deepEqual(result, {
    ok: true,
    value: {
      sport: 'tennis',
      date: '2026-11-25',
      time: '18:00',
      durationMinutes: 60,
      cityId: 'brno',
    },
  });
});

test('parseAvailabilityQuery: full valid query with location', () => {
  const result = parseAvailabilityQuery({
    sport: 'badminton',
    date: '2026-11-25',
    time: '07:30',
    durationMinutes: '90',
    cityId: 'brno',
    lat: '49.2',
    lng: '16.61',
    maxDistanceKm: '5',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.durationMinutes, 90);
    assert.equal(result.value.lat, 49.2);
    assert.equal(result.value.lng, 16.61);
    assert.equal(result.value.maxDistanceKm, 5);
  }
});

test('parseAvailabilityQuery: empty strings count as missing', () => {
  const result = parseAvailabilityQuery({
    sport: 'squash',
    date: '2026-11-25',
    time: '10:00',
    lat: '',
    lng: '',
    maxDistanceKm: '',
    durationMinutes: '',
  });
  assert.equal(result.ok, true);
});

test('parseAvailabilityQuery: missing required fields', () => {
  const result = parseAvailabilityQuery({});
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(fields(result.issues), ['date', 'sport', 'time']);
});

test('parseAvailabilityQuery: invalid values', () => {
  const result = parseAvailabilityQuery({
    sport: 'football',
    date: '2026-02-30',
    time: '18:15',
    durationMinutes: '45',
    cityId: 'praha',
  });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.deepEqual(fields(result.issues), ['cityId', 'date', 'durationMinutes', 'sport', 'time']);
});

test('parseAvailabilityQuery: lat without lng is rejected', () => {
  const result = parseAvailabilityQuery({
    sport: 'tennis',
    date: '2026-11-25',
    time: '18:00',
    lat: '49.2',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(fields(result.issues), ['lng']);
});

test('parseAvailabilityQuery: out-of-range coordinates and distance', () => {
  const result = parseAvailabilityQuery({
    sport: 'tennis',
    date: '2026-11-25',
    time: '18:00',
    lat: '91',
    lng: 'abc',
    maxDistanceKm: '0',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(fields(result.issues), ['lat', 'lng', 'maxDistanceKm']);
});

test('parseAvailabilityQuery: maxDistanceKm requires a location', () => {
  const result = parseAvailabilityQuery({
    sport: 'tennis',
    date: '2026-11-25',
    time: '18:00',
    maxDistanceKm: '5',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(fields(result.issues), ['maxDistanceKm']);
});

const validReservation = {
  venueId: 'v1',
  courtId: 'c1',
  sport: 'tennis',
  date: '2026-11-25',
  time: '18:00',
  durationMinutes: 60,
  customerName: '  Jana Nováková ',
  customerEmail: 'jana@example.com',
};

test('parseCreateReservationRequest: valid body is trimmed', () => {
  const result = parseCreateReservationRequest(validReservation);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.customerName, 'Jana Nováková');
});

test('parseCreateReservationRequest: rejects non-object bodies', () => {
  for (const body of [null, 'x', 42, []]) {
    const result = parseCreateReservationRequest(body);
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(fields(result.issues), ['body']);
  }
});

test('parseCreateReservationRequest: reports every invalid field', () => {
  const result = parseCreateReservationRequest({
    venueId: '',
    courtId: 5,
    sport: 'golf',
    date: '25.11.2026',
    time: '18:10',
    durationMinutes: '60',
    customerName: 'J',
    customerEmail: 'not-an-email',
  });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.deepEqual(fields(result.issues), [
      'courtId',
      'customerEmail',
      'customerName',
      'date',
      'durationMinutes',
      'sport',
      'time',
      'venueId',
    ]);
});

test('parseCreateReservationRequest: rejects overly long ids', () => {
  const result = parseCreateReservationRequest({ ...validReservation, venueId: 'x'.repeat(101) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(fields(result.issues), ['venueId']);
});
