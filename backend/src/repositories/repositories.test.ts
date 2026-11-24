import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SPORT_IDS } from '@spotradar/shared';
import type { Reservation } from '@spotradar/shared';
import { SEED_VENUES } from '../data/seedVenues.ts';
import { createInMemoryReservationRepository } from './reservationRepository.ts';
import { createVenueRepository } from './venueRepository.ts';

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'r1',
    venueId: 'v',
    venueName: 'V',
    courtId: 'c1',
    courtName: 'C1',
    sport: 'tennis',
    date: '2026-11-25',
    time: '10:00',
    durationMinutes: 60,
    customerName: 'Jan',
    customerEmail: 'jan@example.com',
    totalPriceCzk: 300,
    createdAt: '2026-11-24T08:00:00.000Z',
    ...overrides,
  };
}

describe('venue repository', () => {
  const repo = createVenueRepository(SEED_VENUES);

  it('lists venues by city and gets them by id', () => {
    assert.equal(repo.listByCity('brno').length, SEED_VENUES.length);
    assert.deepEqual(repo.listByCity('praha'), []);
    assert.equal(repo.getById('venue-lesna-racket-club')?.name, 'Lesná Racket Club');
    assert.equal(repo.getById('missing'), undefined);
  });
});

describe('seed data', () => {
  it('has unique venue and court ids', () => {
    const venueIds = SEED_VENUES.map((v) => v.id);
    assert.equal(new Set(venueIds).size, venueIds.length);
    const courtIds = SEED_VENUES.flatMap((v) => v.courts.map((c) => c.id));
    assert.equal(new Set(courtIds).size, courtIds.length);
  });

  it('covers every sport and keeps prices consistent with courts', () => {
    for (const sport of SPORT_IDS) {
      assert.ok(
        SEED_VENUES.some((v) => v.pricePerHourCzk[sport] !== undefined && v.courts.some((c) => c.sports.includes(sport))),
        `no venue for ${sport}`,
      );
    }
    for (const venue of SEED_VENUES) {
      assert.ok(venue.courts.length >= 2 && venue.courts.length <= 6, venue.id);
      for (const [sport, price] of Object.entries(venue.pricePerHourCzk)) {
        assert.ok(price !== undefined && price >= 150 && price <= 700, `${venue.id} ${sport}`);
        assert.ok(
          venue.courts.some((c) => (c.sports as string[]).includes(sport)),
          `${venue.id} has price but no court for ${sport}`,
        );
      }
    }
  });
});

describe('in-memory reservation repository', () => {
  it('stores and finds reservations, and clears them', () => {
    const repo = createInMemoryReservationRepository();
    const r = reservation();
    assert.equal(repo.create(r), r);
    assert.deepEqual(repo.findById('r1'), r);
    assert.equal(repo.findById('nope'), undefined);
    repo.clear();
    assert.equal(repo.findById('r1'), undefined);
  });

  it('detects overlaps per court and date, treating the end as exclusive', () => {
    const repo = createInMemoryReservationRepository();
    repo.create(reservation()); // c1, 2026-11-25, 10:00-11:00
    assert.equal(repo.hasOverlap('c1', '2026-11-25', 600, 660), true);
    assert.equal(repo.hasOverlap('c1', '2026-11-25', 630, 690), true);
    assert.equal(repo.hasOverlap('c1', '2026-11-25', 570, 630), true);
    assert.equal(repo.hasOverlap('c1', '2026-11-25', 540, 600), false);
    assert.equal(repo.hasOverlap('c1', '2026-11-25', 660, 720), false);
    assert.equal(repo.hasOverlap('c2', '2026-11-25', 600, 660), false);
    assert.equal(repo.hasOverlap('c1', '2026-11-26', 600, 660), false);
  });
});
