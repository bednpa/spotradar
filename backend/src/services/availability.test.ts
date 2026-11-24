import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, minutesToTime } from '@spotradar/shared';
import type { AvailabilityQuery, SportId, Venue } from '@spotradar/shared';
import { createInMemoryReservationRepository } from '../repositories/reservationRepository.ts';
import { createVenueRepository } from '../repositories/venueRepository.ts';
import { FIXED_NOW, TODAY, freshRepos } from '../testHelpers.ts';
import {
  haversineKm,
  isCourtFree,
  isStartInPast,
  isWithinOpeningHours,
  searchAvailability,
} from './availability.ts';

const COURT_ID = 'venue-test-court-1';

function testVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'venue-test',
    name: 'Test Venue',
    cityId: 'brno',
    address: 'Testovací 1, Brno',
    location: { lat: 49.2, lng: 16.6 },
    openingHours: { open: '10:00', close: '12:00' },
    pricePerHourCzk: { tennis: 333 },
    courts: [
      { id: COURT_ID, name: 'Court 1', sports: ['tennis'], indoor: false, surface: 'clay' },
    ],
    ...overrides,
  };
}

function query(overrides: Partial<AvailabilityQuery> = {}): AvailabilityQuery {
  return {
    sport: 'tennis',
    date: '2026-11-25',
    time: '10:00',
    durationMinutes: 60,
    cityId: 'brno',
    ...overrides,
  };
}

function setup(venues: Venue[]) {
  return { venues: createVenueRepository(venues), reservations: createInMemoryReservationRepository(), now: FIXED_NOW };
}

/** First date in the booking window (from tomorrow) for which the predicate holds. */
function findDate(predicate: (date: string) => boolean): string {
  for (let i = 1; i < 13; i++) {
    const date = addDays(TODAY, i);
    if (predicate(date)) return date;
  }
  throw new Error('no suitable date found');
}

describe('haversineKm', () => {
  it('is zero for identical points and symmetric', () => {
    const a = { lat: 49.1951, lng: 16.6068 };
    const b = { lat: 50.0755, lng: 14.4378 };
    assert.equal(haversineKm(a, a), 0);
    assert.equal(haversineKm(a, b), haversineKm(b, a));
  });

  it('computes the Brno-Prague distance (about 185 km)', () => {
    const d = haversineKm({ lat: 49.1951, lng: 16.6068 }, { lat: 50.0755, lng: 14.4378 });
    assert.ok(d > 180 && d < 190, `distance ${d}`);
  });

  it('computes one degree of latitude as about 111 km', () => {
    const d = haversineKm({ lat: 49, lng: 16 }, { lat: 50, lng: 16 });
    assert.ok(Math.abs(d - 111.2) < 0.5, `distance ${d}`);
  });
});

describe('helpers', () => {
  it('isWithinOpeningHours checks both edges', () => {
    const v = testVenue();
    assert.equal(isWithinOpeningHours(v, 600, 660), true);
    assert.equal(isWithinOpeningHours(v, 660, 720), true);
    assert.equal(isWithinOpeningHours(v, 570, 630), false);
    assert.equal(isWithinOpeningHours(v, 690, 750), false);
  });

  it('isStartInPast compares against Prague local time', () => {
    // FIXED_NOW is 09:00 in Prague on 2026-11-24
    assert.equal(isStartInPast(TODAY, 8 * 60, FIXED_NOW), true);
    assert.equal(isStartInPast(TODAY, 9 * 60, FIXED_NOW), true);
    assert.equal(isStartInPast(TODAY, 9 * 60 + 30, FIXED_NOW), false);
    assert.equal(isStartInPast('2026-11-25', 7 * 60, FIXED_NOW), false);
  });
});

describe('searchAvailability', () => {
  it('only returns venues that offer the sport and have a matching court', () => {
    const noPrice = testVenue({ id: 'venue-a', name: 'No price', pricePerHourCzk: {} });
    const noCourt = testVenue({
      id: 'venue-b',
      name: 'No court',
      pricePerHourCzk: { tennis: 100 },
      courts: [{ id: 'venue-b-court-1', name: 'C', sports: ['squash'], indoor: true, surface: 'wood' }],
    });
    const deps = setup([noPrice, noCourt]);
    assert.deepEqual(searchAvailability(query(), deps), []);
  });

  it('filters by city', () => {
    const date = findDate((d) => isCourtFree(COURT_ID, d, 600, 660, createInMemoryReservationRepository()));
    const deps = setup([testVenue()]);
    assert.equal(searchAvailability(query({ date }), deps).length, 1);
    // a city without venues (cast: the contract only knows "brno")
    const otherCity = 'praha' as AvailabilityQuery['cityId'];
    assert.equal(searchAvailability(query({ date, cityId: otherCity }), deps).length, 0);
  });

  it('handles opening hours edges', () => {
    const deps = setup([testVenue()]);
    const date60 = findDate((d) => isCourtFree(COURT_ID, d, 600, 660, deps.reservations));
    const dateLate = findDate((d) => isCourtFree(COURT_ID, d, 660, 720, deps.reservations));
    const date90 = findDate((d) => isCourtFree(COURT_ID, d, 630, 720, deps.reservations));

    // starts exactly at opening
    assert.equal(searchAvailability(query({ date: date60, time: '10:00' }), deps).length, 1);
    // ends exactly at closing
    assert.equal(searchAvailability(query({ date: dateLate, time: '11:00' }), deps).length, 1);
    assert.equal(
      searchAvailability(query({ date: date90, time: '10:30', durationMinutes: 90 }), deps).length,
      1,
    );
    // starts before opening, ends after closing
    assert.equal(searchAvailability(query({ date: date60, time: '09:30' }), deps).length, 0);
    assert.equal(searchAvailability(query({ date: dateLate, time: '11:30' }), deps).length, 0);
    assert.equal(
      searchAvailability(query({ date: date90, time: '11:00', durationMinutes: 90 }), deps).length,
      0,
    );
  });

  it('computes the total price rounded to whole CZK', () => {
    const deps = setup([testVenue({ openingHours: { open: '07:00', close: '22:00' } })]);
    const date = findDate((d) => isCourtFree(COURT_ID, d, 600, 690, deps.reservations));
    const [result] = searchAvailability(query({ date, time: '10:00', durationMinutes: 90 }), deps);
    assert.ok(result);
    assert.equal(result.pricePerHourCzk, 333);
    assert.equal(result.totalPriceCzk, 500); // 499.5 rounded
    assert.deepEqual(result.availableCourts, [
      { id: COURT_ID, name: 'Court 1', indoor: false, surface: 'clay' },
    ]);
    assert.equal(result.distanceKm, null);
  });

  it('returns nothing for a start in the past today and works later today', () => {
    const deps = setup([testVenue({ openingHours: { open: '07:00', close: '22:00' } })]);
    assert.deepEqual(searchAvailability(query({ date: TODAY, time: '08:30' }), deps), []);
    assert.deepEqual(searchAvailability(query({ date: TODAY, time: '09:00' }), deps), []);
    let freeStart: number | undefined;
    for (let start = 9 * 60 + 30; start <= 20 * 60; start += 30) {
      if (isCourtFree(COURT_ID, TODAY, start, start + 60, deps.reservations)) {
        freeStart = start;
        break;
      }
    }
    assert.ok(freeStart !== undefined, 'a free slot later today should exist');
    const results = searchAvailability(query({ date: TODAY, time: minutesToTime(freeStart) }), deps);
    assert.equal(results.length, 1);
  });

  it('hides courts with an overlapping in-app reservation but not adjacent ones', () => {
    const deps = setup([testVenue({ openingHours: { open: '07:00', close: '22:00' } })]);
    const date = findDate((d) => isCourtFree(COURT_ID, d, 600, 660, deps.reservations));
    assert.equal(searchAvailability(query({ date }), deps).length, 1);

    const base = {
      venueId: 'venue-test',
      courtId: COURT_ID,
      sport: 'tennis' as SportId,
      date,
      durationMinutes: 60 as const,
      customerName: 'Test',
      customerEmail: 't@example.com',
      venueName: 'Test Venue',
      courtName: 'Court 1',
      totalPriceCzk: 333,
      createdAt: FIXED_NOW.toISOString(),
    };
    // adjacent: starts when our slot ends
    deps.reservations.create({ ...base, id: 'adjacent', time: '11:00' });
    assert.equal(searchAvailability(query({ date }), deps).length, 1);
    // overlapping by 30 minutes
    deps.reservations.create({ ...base, id: 'overlap', time: '10:30' });
    assert.equal(searchAvailability(query({ date }), deps).length, 0);
  });

  it('computes distance, filters by maxDistanceKm and sorts by distance', () => {
    const near = testVenue({
      id: 'venue-near',
      name: 'Near',
      location: { lat: 49.2, lng: 16.61 },
      pricePerHourCzk: { tennis: 500 },
      courts: [{ id: 'venue-near-court-1', name: 'N1', sports: ['tennis'], indoor: false, surface: 'clay' }],
      openingHours: { open: '07:00', close: '22:00' },
    });
    const far = testVenue({
      id: 'venue-far',
      name: 'Far',
      location: { lat: 49.3, lng: 16.8 },
      pricePerHourCzk: { tennis: 100 },
      courts: [{ id: 'venue-far-court-1', name: 'F1', sports: ['tennis'], indoor: false, surface: 'clay' }],
      openingHours: { open: '07:00', close: '22:00' },
    });
    const deps = setup([far, near]);
    const date = findDate(
      (d) =>
        isCourtFree('venue-near-court-1', d, 600, 660, deps.reservations) &&
        isCourtFree('venue-far-court-1', d, 600, 660, deps.reservations),
    );
    const origin = { lat: 49.2, lng: 16.6 };

    const sorted = searchAvailability(query({ date, ...origin }), deps);
    assert.deepEqual(sorted.map((r) => r.venue.id), ['venue-near', 'venue-far']);
    assert.equal(sorted[0]?.distanceKm, Math.round(haversineKm(origin, near.location) * 10) / 10);
    assert.equal(sorted[0]?.distanceKm, 0.7);

    const filtered = searchAvailability(query({ date, ...origin, maxDistanceKm: 5 }), deps);
    assert.deepEqual(filtered.map((r) => r.venue.id), ['venue-near']);

    const none = searchAvailability(query({ date, ...origin, maxDistanceKm: 0.1 }), deps);
    assert.deepEqual(none, []);

    // without a location: sorted by price ascending
    const byPrice = searchAvailability(query({ date }), deps);
    assert.deepEqual(byPrice.map((r) => r.venue.id), ['venue-far', 'venue-near']);
    assert.equal(byPrice[0]?.distanceKm, null);
  });

  it('breaks price ties by venue name', () => {
    const mk = (id: string, name: string): Venue =>
      testVenue({
        id,
        name,
        openingHours: { open: '07:00', close: '22:00' },
        courts: [{ id: `${id}-court-1`, name: 'C', sports: ['tennis'], indoor: false, surface: 'clay' }],
      });
    const deps = setup([mk('venue-z', 'Žába'), mk('venue-a', 'Alfa'), mk('venue-c', 'Čáp')]);
    const date = findDate((d) =>
      ['venue-z', 'venue-a', 'venue-c'].every((id) => isCourtFree(`${id}-court-1`, d, 600, 660, deps.reservations)),
    );
    const names = searchAvailability(query({ date }), deps).map((r) => r.venue.name);
    assert.deepEqual(names, ['Alfa', 'Čáp', 'Žába']);
  });
});

describe('searchAvailability with the seed data', () => {
  const sports: SportId[] = ['tennis', 'badminton', 'squash', 'table-tennis', 'padel', 'beach-volleyball'];

  for (const sport of sports) {
    it(`finds venues for ${sport} that really offer it`, () => {
      const repos = freshRepos();
      let found = 0;
      for (let i = 1; i < 8 && found === 0; i++) {
        const date = addDays(TODAY, i);
        for (const time of ['10:00', '11:00', '12:00', '13:00', '14:00']) {
          const results = searchAvailability(query({ sport, date, time }), { ...repos, now: FIXED_NOW });
          for (const r of results) {
            found++;
            const venue = repos.venues.getById(r.venue.id);
            assert.ok(venue);
            assert.ok(venue.pricePerHourCzk[sport] !== undefined);
            assert.equal(r.pricePerHourCzk, venue.pricePerHourCzk[sport]);
            for (const c of r.availableCourts) {
              const court = venue.courts.find((x) => x.id === c.id);
              assert.ok(court?.sports.includes(sport));
            }
          }
        }
      }
      assert.ok(found > 0, `expected at least one result for ${sport}`);
    });
  }
});
