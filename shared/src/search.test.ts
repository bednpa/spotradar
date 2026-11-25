import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSearchResults, distanceKm, freeCourtsAt, hasFreeCourt, roundKm } from './search.ts';
import type { FreeSlot, SearchResult, Venue } from './types.ts';

const venue = (name: string): Venue => ({
  id: name.toLowerCase(),
  name,
  district: 'Brno-střed',
  address: 'Test 1, Brno',
  location: { lat: 49.2, lng: 16.6 },
  sports: ['badminton'],
  courts: 4,
  openingHours: {
    approximate: true,
    days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
  },
  bookingUrl: 'https://example.com',
  availabilitySource: 'none',
  multisport: { category: 'unknown' },
});

const result = (
  name: string,
  extra: Partial<SearchResult> = {},
  slots: FreeSlot[] = [],
): SearchResult => ({
  venue: venue(name),
  availability: { status: slots.length ? 'live' : 'unknown', freeSlots: slots },
  ...extra,
});

test('distanceKm: zero for the same point, ~known distance in Brno', () => {
  assert.equal(distanceKm({ lat: 49.2, lng: 16.6 }, { lat: 49.2, lng: 16.6 }), 0);
  // Kuklenská → Centrum Viktoria ≈ 2.2 km
  const d = distanceKm({ lat: 49.19522, lng: 16.63242 }, { lat: 49.17627, lng: 16.61661 });
  assert.ok(d > 2.1 && d < 2.6, String(d));
  assert.equal(roundKm(2.345), 2.3);
  assert.equal(roundKm(2.35), 2.4);
});

test('freeCourtsAt finds the slot containing the time (end exclusive)', () => {
  const slots: FreeSlot[] = [
    { start: '08:00', end: '09:00', freeCourts: 2 },
    { start: '09:30', end: '10:00', freeCourts: 1 },
  ];
  assert.equal(freeCourtsAt(slots, '08:00'), 2);
  assert.equal(freeCourtsAt(slots, '08:59'), 2);
  assert.equal(freeCourtsAt(slots, '09:00'), 0);
  assert.equal(freeCourtsAt(slots, '09:45'), 1);
  assert.equal(freeCourtsAt([], '09:45'), 0);
});

test('hasFreeCourt uses freeCourtsAtTime when present, otherwise any slot', () => {
  const slot = [{ start: '08:00', end: '09:00', freeCourts: 1 }];
  assert.equal(hasFreeCourt(result('A', {}, slot)), true);
  assert.equal(hasFreeCourt(result('A')), false);
  assert.equal(hasFreeCourt(result('A', { freeCourtsAtTime: 0 }, slot)), false);
  assert.equal(hasFreeCourt(result('A', { freeCourtsAtTime: 3 }, slot)), true);
});

test('compareSearchResults: free first, then distance, then Czech name order', () => {
  const slot = [{ start: '08:00', end: '09:00', freeCourts: 1 }];
  const sorted = [
    result('Žabovřesky', { distanceKm: 1 }),
    result('Bystrc', { distanceKm: 5 }, slot),
    result('Černá Pole', { distanceKm: 2 }, slot),
    result('Antonínská', { distanceKm: 1 }),
  ].sort(compareSearchResults);
  assert.deepEqual(
    sorted.map((r) => r.venue.name),
    ['Černá Pole', 'Bystrc', 'Antonínská', 'Žabovřesky'],
  );

  const byName = [result('Čtvrť'), result('Cesta'), result('Ulice')].sort(compareSearchResults);
  assert.deepEqual(
    byName.map((r) => r.venue.name),
    ['Cesta', 'Čtvrť', 'Ulice'],
  );
});
