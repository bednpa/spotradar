import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVenuesByName,
  foldText,
  formatTimeAgo,
  googleMapsUrl,
  matchesVenueQuery,
} from './venues.ts';
import type { Venue } from './types.ts';

const venue = (
  name: string,
  district = 'Brno-Líšeň',
  address = 'Úlehlova 3050/16, Brno',
): Venue => ({
  id: name.toLowerCase(),
  name,
  district,
  address,
  location: { lat: 49.2, lng: 16.6 },
  sports: ['badminton'],
  openingHours: {
    approximate: true,
    days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
  },
  bookingUrl: 'https://example.com',
  availabilitySource: 'none',
  multisport: { category: 'unknown' },
});

test('foldText lower-cases and strips Czech diacritics', () => {
  assert.equal(foldText('Líšeň ŽIDENICE Tuřanka'), 'lisen zidenice turanka');
});

test('matchesVenueQuery: name, district and address, diacritics-insensitive', () => {
  const v = venue('Badminton Líšeň');
  assert.equal(matchesVenueQuery(v, 'lisen'), true);
  assert.equal(matchesVenueQuery(v, 'ÚLEHLOVA'), true);
  assert.equal(matchesVenueQuery(v, 'brno-lisen'), true);
  assert.equal(matchesVenueQuery(v, 'badminton lisen'), true); // every word must match
  assert.equal(matchesVenueQuery(v, 'badminton jehnice'), false);
  assert.equal(matchesVenueQuery(v, 'squash'), false);
});

test('matchesVenueQuery: blank query matches everything', () => {
  assert.equal(matchesVenueQuery(venue('X'), ''), true);
  assert.equal(matchesVenueQuery(venue('X'), '   '), true);
});

test('compareVenuesByName uses Czech collation', () => {
  const names = ['Hala Sprint', 'Centrum Viktoria', 'Badminton Jehnice']
    .map((n) => venue(n))
    .sort(compareVenuesByName)
    .map((v) => v.name);
  // In Czech "Ch" sorts after "H", "C" before "H".
  assert.deepEqual(names, ['Badminton Jehnice', 'Centrum Viktoria', 'Hala Sprint']);
});

test('googleMapsUrl builds an encoded search link from name and address', () => {
  assert.equal(
    googleMapsUrl({ name: 'Hala Sprint', address: 'Sportovní 2A, Brno' }),
    'https://www.google.com/maps/search/?api=1&query=Hala%20Sprint%2C%20Sportovn%C3%AD%202A%2C%20Brno',
  );
});

test('formatTimeAgo: minutes, hours, days and edge cases', () => {
  const now = new Date('2026-11-25T15:00:00Z');
  assert.equal(formatTimeAgo('2026-11-25T14:59:30Z', now), 'just now');
  assert.equal(formatTimeAgo('2026-11-25T15:00:10Z', now), 'just now'); // future → just now
  assert.equal(formatTimeAgo('2026-11-25T14:59:00Z', now), '1 min ago');
  assert.equal(formatTimeAgo('2026-11-25T14:15:00Z', now), '45 min ago');
  assert.equal(formatTimeAgo('2026-11-25T13:00:00Z', now), '2 h ago');
  assert.equal(formatTimeAgo('2026-11-24T14:00:00Z', now), '1 day ago');
  assert.equal(formatTimeAgo('2026-11-22T15:00:00Z', now), '3 days ago');
  assert.equal(formatTimeAgo('not a date', now), '');
});
