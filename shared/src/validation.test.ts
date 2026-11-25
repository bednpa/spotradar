import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VENUE_QUERY_MAX } from './catalog.ts';
import {
  parseCalendarQuery,
  parseGeocodeQuery,
  parseSearchQuery,
  parseVenueQuery,
} from './validation.ts';
import type { ValidationIssue } from './types.ts';

function fields(issues: ValidationIssue[]): string[] {
  return issues.map((i) => i.field).sort();
}

test('parseSearchQuery: minimal valid query (time optional)', () => {
  assert.deepEqual(parseSearchQuery({ sport: 'badminton', date: '2026-11-25' }), {
    ok: true,
    value: { sport: 'badminton', date: '2026-11-25' },
  });
});

test('parseSearchQuery: full valid query is trimmed and parsed', () => {
  const result = parseSearchQuery({
    sport: ' badminton ',
    date: '2026-11-25',
    time: '18:15',
    lat: '49.19',
    lng: '16.6',
    maxDistanceKm: '5',
  });
  assert.deepEqual(result, {
    ok: true,
    value: {
      sport: 'badminton',
      date: '2026-11-25',
      time: '18:15',
      lat: 49.19,
      lng: 16.6,
      maxDistanceKm: 5,
    },
  });
});

test('parseSearchQuery: empty strings are treated as not provided', () => {
  const result = parseSearchQuery({
    sport: 'badminton',
    date: '2026-11-25',
    time: '',
    lat: '',
    lng: ' ',
    maxDistanceKm: '',
  });
  assert.deepEqual(result, { ok: true, value: { sport: 'badminton', date: '2026-11-25' } });
});

test('parseSearchQuery: missing required fields', () => {
  const result = parseSearchQuery({});
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(fields(result.issues), ['date', 'sport']);
});

test('parseSearchQuery: unknown sport, bad date and time', () => {
  const result = parseSearchQuery({ sport: 'golf', date: '2026-02-30', time: '25:00' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(fields(result.issues), ['date', 'sport', 'time']);
});

test('parseSearchQuery: lat and lng must come together', () => {
  const onlyLat = parseSearchQuery({ sport: 'badminton', date: '2026-11-25', lat: '49.2' });
  assert.equal(onlyLat.ok, false);
  if (!onlyLat.ok) assert.deepEqual(fields(onlyLat.issues), ['lng']);
  const onlyLng = parseSearchQuery({ sport: 'badminton', date: '2026-11-25', lng: '16.6' });
  assert.equal(onlyLng.ok, false);
  if (!onlyLng.ok) assert.deepEqual(fields(onlyLng.issues), ['lat']);
});

test('parseSearchQuery: lat/lng ranges and number format', () => {
  const result = parseSearchQuery({
    sport: 'badminton',
    date: '2026-11-25',
    lat: '91',
    lng: 'abc',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(fields(result.issues), ['lat', 'lng']);
});

test('parseSearchQuery: maxDistanceKm requires lat/lng and a sane value', () => {
  const noOrigin = parseSearchQuery({ sport: 'badminton', date: '2026-11-25', maxDistanceKm: '5' });
  assert.equal(noOrigin.ok, false);
  if (!noOrigin.ok) assert.match(noOrigin.issues[0]?.message ?? '', /requires lat and lng/);

  for (const bad of ['0', '-1', '101', 'far']) {
    const r = parseSearchQuery({
      sport: 'badminton',
      date: '2026-11-25',
      lat: '49.2',
      lng: '16.6',
      maxDistanceKm: bad,
    });
    assert.equal(r.ok, false, bad);
  }
});

test('parseCalendarQuery: valid range with location', () => {
  assert.deepEqual(
    parseCalendarQuery({
      sport: 'badminton',
      from: '2026-11-25',
      to: ' 2026-12-01 ',
      lat: '49.2',
      lng: '16.6',
      maxDistanceKm: '10',
    }),
    {
      ok: true,
      value: {
        sport: 'badminton',
        from: '2026-11-25',
        to: '2026-12-01',
        lat: 49.2,
        lng: 16.6,
        maxDistanceKm: 10,
      },
    },
  );
  assert.deepEqual(
    parseCalendarQuery({ sport: 'badminton', from: '2026-11-25', to: '2026-11-25' }),
    { ok: true, value: { sport: 'badminton', from: '2026-11-25', to: '2026-11-25' } },
  );
});

test('parseCalendarQuery: missing and invalid fields', () => {
  const missing = parseCalendarQuery({});
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.deepEqual(fields(missing.issues), ['from', 'sport', 'to']);

  const bad = parseCalendarQuery({ sport: 'golf', from: '2026-13-01', to: 'x', lat: '49' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(fields(bad.issues), ['from', 'lng', 'sport', 'to']);
});

test('parseCalendarQuery and parseVenueQuery accept every new sport id', () => {
  for (const sport of [
    'tennis',
    'squash',
    'padel',
    'table-tennis',
    'volleyball',
    'beach-volleyball',
  ]) {
    const calendar = parseCalendarQuery({ sport, from: '2026-11-25', to: '2026-11-25' });
    assert.equal(calendar.ok, true, sport);
    const venues = parseVenueQuery({ sport });
    assert.equal(venues.ok, true, sport);
  }
});

test('parseCalendarQuery: to before from and too long ranges', () => {
  const reversed = parseCalendarQuery({ sport: 'badminton', from: '2026-11-25', to: '2026-11-24' });
  assert.equal(reversed.ok, false);
  if (!reversed.ok) assert.deepEqual(fields(reversed.issues), ['to']);

  // 15 days (CALENDAR_MAX_DAYS) is fine, 16 is not.
  assert.equal(
    parseCalendarQuery({ sport: 'badminton', from: '2026-11-25', to: '2026-12-09' }).ok,
    true,
  );
  const long = parseCalendarQuery({ sport: 'badminton', from: '2026-11-25', to: '2026-12-10' });
  assert.equal(long.ok, false);
  if (!long.ok) assert.match(long.issues[0]?.message ?? '', /at most 15 days/);
});

test('parseVenueQuery: everything optional, blanks ignored, q trimmed', () => {
  assert.deepEqual(parseVenueQuery({}), { ok: true, value: {} });
  assert.deepEqual(parseVenueQuery({ sport: ' ', q: '  ' }), { ok: true, value: {} });
  assert.deepEqual(parseVenueQuery({ sport: 'badminton', q: '  Líšeň ' }), {
    ok: true,
    value: { sport: 'badminton', q: 'Líšeň' },
  });
});

test('parseVenueQuery: unknown sport and too long q are rejected', () => {
  const result = parseVenueQuery({ sport: 'curling', q: 'x'.repeat(VENUE_QUERY_MAX + 1) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(fields(result.issues), ['q', 'sport']);
  assert.equal(parseVenueQuery({ q: 'x'.repeat(VENUE_QUERY_MAX) }).ok, true);
});

test('parseGeocodeQuery trims and checks length', () => {
  assert.deepEqual(parseGeocodeQuery({ q: '  Lidická 1, Brno ' }), {
    ok: true,
    value: { q: 'Lidická 1, Brno' },
  });
  for (const bad of [undefined, '', ' a ', 'x'.repeat(201)]) {
    const r = parseGeocodeQuery({ q: bad });
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(fields(r.issues), ['q']);
  }
});
