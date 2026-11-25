import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freeCourtsBetween,
  isInSeason,
  isOpenDuring,
  slotStatuses,
  summarizeSlot,
} from './calendar.ts';
import type { CalendarDay, CalendarVenue, OpeningHours, SportOffering } from './types.ts';

const hours = (open: string, close: string, sunClosed = false): OpeningHours => ({
  approximate: false,
  days: {
    mon: { open, close },
    tue: { open, close },
    wed: { open, close },
    thu: { open, close },
    fri: { open, close },
    sat: { open, close },
    sun: sunClosed ? null : { open, close },
  },
});

const offering = (openingHours?: OpeningHours): SportOffering => {
  const o: SportOffering = {
    sport: 'badminton',
    bookingUrl: 'https://example.com',
    bookingSystem: 'unknown',
    availabilitySource: 'none',
    multisport: { category: 'unknown' },
  };
  if (openingHours) o.openingHours = openingHours;
  return o;
};

const venue = (id: string, openingHours = hours('07:00', '22:00')): CalendarVenue => ({
  venue: {
    id,
    name: id,
    district: 'Brno',
    address: 'Test 1, Brno',
    location: { lat: 49.2, lng: 16.6 },
    sports: ['badminton'],
    offerings: [offering(openingHours)],
  },
  offering: offering(openingHours),
});

test('freeCourtsBetween: min over covering slots, 0 on gaps', () => {
  const slots = [
    { start: '10:00', end: '10:30', freeCourts: 3 },
    { start: '10:30', end: '11:00', freeCourts: 1 },
    { start: '12:00', end: '13:00', freeCourts: 2 },
  ];
  assert.equal(freeCourtsBetween(slots, '10:00', '11:00'), 1);
  assert.equal(freeCourtsBetween(slots, '10:00', '10:30'), 3);
  assert.equal(freeCourtsBetween(slots, '10:15', '10:45'), 1);
  assert.equal(freeCourtsBetween(slots, '11:00', '12:00'), 0);
  assert.equal(freeCourtsBetween(slots, '10:30', '12:30'), 0);
  assert.equal(freeCourtsBetween(slots, '12:00', '13:00'), 2);
  assert.equal(freeCourtsBetween(slots, '12:00', '12:00'), 0);
  assert.equal(freeCourtsBetween([], '10:00', '11:00'), 0);
});

test('freeCourtsBetween: unsorted input and end "24:00"', () => {
  const slots = [
    { start: '23:00', end: '24:00', freeCourts: 2 },
    { start: '22:00', end: '23:00', freeCourts: 4 },
  ];
  assert.equal(freeCourtsBetween(slots, '22:00', '24:00'), 2);
});

test('isOpenDuring: whole interval within opening hours; closed days', () => {
  const h = hours('07:00', '22:00', true);
  assert.equal(isOpenDuring(h, '2026-11-25', '07:00', '08:00'), true); // Wednesday
  assert.equal(isOpenDuring(h, '2026-11-25', '21:00', '22:00'), true);
  assert.equal(isOpenDuring(h, '2026-11-25', '21:30', '22:30'), false);
  assert.equal(isOpenDuring(h, '2026-11-25', '06:00', '07:00'), false);
  assert.equal(isOpenDuring(h, '2026-11-29', '10:00', '11:00'), false); // Sunday closed
});

test('slotStatuses: states, ordering and summary', () => {
  const venues: CalendarVenue[] = [
    venue('a'),
    venue('b'),
    venue('c'),
    venue('d', hours('14:00', '22:00')),
    venue('e'),
  ];
  const day: CalendarDay = {
    date: '2026-11-25',
    venues: [
      { venueId: 'a', availability: { status: 'live', freeSlots: [] } },
      { venueId: 'b', availability: { status: 'unknown', freeSlots: [] } },
      {
        venueId: 'c',
        availability: {
          status: 'live',
          freeSlots: [{ start: '10:00', end: '11:00', freeCourts: 2 }],
        },
      },
      { venueId: 'd', availability: { status: 'unavailable', freeSlots: [] } },
      {
        venueId: 'e',
        availability: {
          status: 'live',
          freeSlots: [{ start: '09:00', end: '12:00', freeCourts: 1 }],
        },
      },
      { venueId: 'ghost', availability: { status: 'unknown', freeSlots: [] } },
    ],
  };
  const statuses = slotStatuses(day, venues, '10:00', '11:00');
  assert.deepEqual(statuses, [
    { venueId: 'c', state: 'free', freeCourts: 2 },
    { venueId: 'e', state: 'free', freeCourts: 1 },
    { venueId: 'b', state: 'check' },
    { venueId: 'a', state: 'full' },
    { venueId: 'd', state: 'closed' },
  ]);
  assert.deepEqual(summarizeSlot(statuses), { freeVenues: 2, checkVenues: 1, freeCourts: 3 });

  // Outside opening hours with no live slot → closed.
  const late = slotStatuses(day, venues, '22:00', '23:00');
  assert.ok(late.every((s) => s.state === 'closed'));
  assert.deepEqual(summarizeSlot(late), { freeVenues: 0, checkVenues: 0, freeCourts: 0 });
});

test('isInSeason: inclusive bounds, year-end wrap, no season = all year', () => {
  const summer = { from: '05-01', to: '09-30' };
  assert.equal(isInSeason(summer, '2026-05-01'), true);
  assert.equal(isInSeason(summer, '2026-09-30'), true);
  assert.equal(isInSeason(summer, '2026-11-25'), false);
  const winter = { from: '10-01', to: '04-30' };
  assert.equal(isInSeason(winter, '2026-11-25'), true);
  assert.equal(isInSeason(winter, '2027-01-15'), true);
  assert.equal(isInSeason(winter, '2026-06-01'), false);
  assert.equal(isInSeason(undefined, '2026-06-01'), true);
});

test('isOpenDuring: out of season is closed, unknown hours count as possibly open (07–22)', () => {
  const outdoor: OpeningHours = {
    ...hours('08:00', '21:00'),
    season: { from: '05-01', to: '09-30' },
  };
  assert.equal(isOpenDuring(outdoor, '2026-11-25', '10:00', '11:00'), false);
  assert.equal(isOpenDuring(outdoor, '2026-06-03', '10:00', '11:00'), true);
  assert.equal(isOpenDuring(undefined, '2026-11-25', '07:00', '08:00'), true);
  assert.equal(isOpenDuring(undefined, '2026-11-29', '21:00', '22:00'), true);
  assert.equal(isOpenDuring(undefined, '2026-11-25', '03:00', '04:00'), false);
  assert.equal(isOpenDuring(undefined, '2026-11-25', '22:00', '23:00'), false);
});

test('slotStatuses: unknown hours → check during the daytime window, never free by hours', () => {
  const unknownHours: CalendarVenue = { ...venue('u'), offering: offering() };
  const day: CalendarDay = {
    date: '2026-11-25',
    venues: [{ venueId: 'u', availability: { status: 'unknown', freeSlots: [] } }],
  };
  assert.deepEqual(slotStatuses(day, [unknownHours], '10:00', '11:00'), [
    { venueId: 'u', state: 'check' },
  ]);
  assert.deepEqual(slotStatuses(day, [unknownHours], '23:00', '24:00'), [
    { venueId: 'u', state: 'closed' },
  ]);
});

test('slotStatuses: out of season is closed even when live data lists free courts', () => {
  const summer: OpeningHours = {
    ...hours('07:00', '22:00'),
    season: { from: '05-01', to: '09-30' },
  };
  const beach = venue('beach', summer);
  const live = (date: string): CalendarDay => ({
    date,
    venues: [
      {
        venueId: 'beach',
        availability: {
          status: 'live',
          freeSlots: [{ start: '10:00', end: '11:00', freeCourts: 5 }],
        },
      },
    ],
  });
  assert.deepEqual(slotStatuses(live('2026-11-25'), [beach], '10:00', '11:00'), [
    { venueId: 'beach', state: 'closed' },
  ]);
  assert.deepEqual(slotStatuses(live('2026-06-03'), [beach], '10:00', '11:00'), [
    { venueId: 'beach', state: 'free', freeCourts: 5 },
  ]);
});
