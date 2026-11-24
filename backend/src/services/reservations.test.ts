import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CreateReservationRequest } from '@spotradar/shared';
import { timeToMinutes, minutesToTime } from '@spotradar/shared';
import { HttpError } from '../errors.ts';
import { FIXED_NOW, TODAY, findFreeSlot, freshRepos } from '../testHelpers.ts';
import type { FreeSlot } from '../testHelpers.ts';
import { searchAvailability } from './availability.ts';
import { isSlotOccupiedExternally } from './occupancy.ts';
import { createReservation } from './reservations.ts';

function requestFor(slot: FreeSlot): CreateReservationRequest {
  return {
    venueId: slot.venue.id,
    courtId: slot.court.id,
    sport: slot.sport,
    date: slot.date,
    time: slot.time,
    durationMinutes: slot.durationMinutes,
    customerName: 'Jana Nováková',
    customerEmail: 'jana@example.com',
  };
}

function expectCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => err instanceof HttpError && err.code === code);
}

describe('createReservation', () => {
  it('creates and stores a reservation, and the slot disappears from availability', () => {
    const repos = freshRepos();
    const slot = findFreeSlot('tennis', repos);
    const deps = { ...repos, now: FIXED_NOW };
    const reservation = createReservation(requestFor(slot), deps);

    assert.match(reservation.id, /^[0-9a-f-]{36}$/);
    assert.equal(reservation.venueName, slot.venue.name);
    assert.equal(reservation.courtName, slot.court.name);
    assert.equal(reservation.totalPriceCzk, slot.venue.pricePerHourCzk.tennis);
    assert.equal(reservation.createdAt, FIXED_NOW.toISOString());
    assert.deepEqual(repos.reservations.findById(reservation.id), reservation);

    const results = searchAvailability(
      { sport: 'tennis', date: slot.date, time: slot.time, durationMinutes: 60, cityId: 'brno' },
      deps,
    );
    const ids = results.flatMap((r) => r.availableCourts.map((c) => c.id));
    assert.ok(!ids.includes(slot.court.id));
  });

  it('rejects the same slot twice with SLOT_UNAVAILABLE', () => {
    const repos = freshRepos();
    const slot = findFreeSlot('badminton', repos);
    const deps = { ...repos, now: FIXED_NOW };
    createReservation(requestFor(slot), deps);
    expectCode(() => createReservation(requestFor(slot), deps), 'SLOT_UNAVAILABLE');
  });

  it('rejects overlapping reservations (shifted by 30 minutes)', () => {
    const repos = freshRepos();
    const slot = findFreeSlot('tennis', repos);
    const deps = { ...repos, now: FIXED_NOW };
    createReservation(requestFor(slot), deps);
    const shifted = { ...requestFor(slot), time: minutesToTime(timeToMinutes(slot.time) + 30) };
    expectCode(() => createReservation(shifted, deps), 'SLOT_UNAVAILABLE');
  });

  it('rejects slots occupied by the simulated external bookings', () => {
    const repos = freshRepos();
    const venue = repos.venues.getById('venue-lesna-racket-club');
    assert.ok(venue);
    const court = venue.courts[0];
    assert.ok(court);
    const date = '2026-11-25';
    let occupiedStart: number | undefined;
    for (let start = 10 * 60; start <= 19 * 60; start += 30) {
      if (isSlotOccupiedExternally(court.id, date, start)) {
        occupiedStart = start;
        break;
      }
    }
    assert.ok(occupiedStart !== undefined, 'expected an occupied slot');
    const req: CreateReservationRequest = {
      venueId: venue.id,
      courtId: court.id,
      sport: 'tennis',
      date,
      time: minutesToTime(occupiedStart),
      durationMinutes: 60,
      customerName: 'Jan',
      customerEmail: 'jan@example.com',
    };
    expectCode(() => createReservation(req, { ...repos, now: FIXED_NOW }), 'SLOT_UNAVAILABLE');
  });

  describe('error codes', () => {
    const base: CreateReservationRequest = {
      venueId: 'venue-lesna-racket-club',
      courtId: 'venue-lesna-racket-club-court-1',
      sport: 'tennis',
      date: '2026-11-25',
      time: '10:00',
      durationMinutes: 60,
      customerName: 'Jan',
      customerEmail: 'jan@example.com',
    };

    it('VENUE_NOT_FOUND', () => {
      const deps = { ...freshRepos(), now: FIXED_NOW };
      expectCode(() => createReservation({ ...base, venueId: 'nope' }, deps), 'VENUE_NOT_FOUND');
    });

    it('COURT_NOT_FOUND (court of another venue)', () => {
      const deps = { ...freshRepos(), now: FIXED_NOW };
      expectCode(
        () => createReservation({ ...base, courtId: 'venue-centrum-sport-hall-court-1' }, deps),
        'COURT_NOT_FOUND',
      );
    });

    it('SPORT_NOT_OFFERED (court does not support the sport)', () => {
      const deps = { ...freshRepos(), now: FIXED_NOW };
      expectCode(() => createReservation({ ...base, sport: 'padel' }, deps), 'SPORT_NOT_OFFERED');
      expectCode(() => createReservation({ ...base, sport: 'squash' }, deps), 'SPORT_NOT_OFFERED');
    });

    it('DATE_OUT_OF_RANGE', () => {
      const deps = { ...freshRepos(), now: FIXED_NOW };
      expectCode(() => createReservation({ ...base, date: '2026-11-23' }, deps), 'DATE_OUT_OF_RANGE');
      expectCode(() => createReservation({ ...base, date: '2026-12-08' }, deps), 'DATE_OUT_OF_RANGE');
    });

    it('SLOT_IN_PAST', () => {
      const deps = { ...freshRepos(), now: FIXED_NOW };
      expectCode(() => createReservation({ ...base, date: TODAY, time: '08:30' }, deps), 'SLOT_IN_PAST');
      expectCode(() => createReservation({ ...base, date: TODAY, time: '09:00' }, deps), 'SLOT_IN_PAST');
    });

    it('OUTSIDE_OPENING_HOURS', () => {
      const deps = { ...freshRepos(), now: FIXED_NOW };
      expectCode(() => createReservation({ ...base, time: '06:00' }, deps), 'OUTSIDE_OPENING_HOURS');
      expectCode(
        () => createReservation({ ...base, time: '21:30', durationMinutes: 60 }, deps),
        'OUTSIDE_OPENING_HOURS',
      );
      expectCode(
        () => createReservation({ ...base, time: '21:00', durationMinutes: 90 }, deps),
        'OUTSIDE_OPENING_HOURS',
      );
    });

    it('checks in the documented order (venue before court before sport)', () => {
      const deps = { ...freshRepos(), now: FIXED_NOW };
      expectCode(
        () => createReservation({ ...base, venueId: 'nope', courtId: 'nope', sport: 'padel' }, deps),
        'VENUE_NOT_FOUND',
      );
      expectCode(
        () => createReservation({ ...base, courtId: 'nope', sport: 'padel' }, deps),
        'COURT_NOT_FOUND',
      );
      expectCode(
        () => createReservation({ ...base, sport: 'padel', date: '2030-01-01' }, deps),
        'SPORT_NOT_OFFERED',
      );
    });
  });
});
