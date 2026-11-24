import { addDays, toLocalDateTime } from '@spotradar/shared';
import type { AvailableCourt, SportId, Venue } from '@spotradar/shared';
import { SEED_VENUES } from './data/seedVenues.ts';
import { createInMemoryReservationRepository } from './repositories/reservationRepository.ts';
import type { ReservationRepository } from './repositories/reservationRepository.ts';
import { createVenueRepository } from './repositories/venueRepository.ts';
import type { VenueRepository } from './repositories/venueRepository.ts';
import { searchAvailability } from './services/availability.ts';

/** 2026-11-24 09:00 in Europe/Prague. */
export const FIXED_NOW = new Date('2026-11-24T08:00:00Z');
export const TODAY = '2026-11-24';

export function freshRepos(): { venues: VenueRepository; reservations: ReservationRepository } {
  return {
    venues: createVenueRepository(SEED_VENUES),
    reservations: createInMemoryReservationRepository(),
  };
}

export interface FreeSlot {
  sport: SportId;
  date: string;
  time: string;
  durationMinutes: 60 | 90 | 120;
  venue: Venue;
  court: AvailableCourt;
}

/** Finds a slot (from tomorrow on) where at least one court is free, using the real search. */
export function findFreeSlot(
  sport: SportId,
  repos: { venues: VenueRepository; reservations: ReservationRepository },
  skip = 0,
): FreeSlot {
  let skipped = 0;
  const tomorrow = addDays(toLocalDateTime(FIXED_NOW).date, 1);
  for (let d = 0; d < 7; d++) {
    const date = addDays(tomorrow, d);
    for (const time of ['10:00', '10:30', '11:00', '11:30', '12:00', '13:00', '14:00', '15:00']) {
      const results = searchAvailability(
        { sport, date, time, durationMinutes: 60, cityId: 'brno' },
        { ...repos, now: FIXED_NOW },
      );
      const first = results[0];
      const court = first?.availableCourts[0];
      if (first && court) {
        if (skipped < skip) {
          skipped++;
          continue;
        }
        const venue = repos.venues.getById(first.venue.id);
        if (venue) return { sport, date, time, durationMinutes: 60, venue, court };
      }
    }
  }
  throw new Error(`No free slot found for ${sport}`);
}
