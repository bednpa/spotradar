import {
  compareSearchResults,
  distanceKm,
  freeCourtsAt,
  roundKm,
  timeToMinutes,
  toLocalDateTime,
} from '@spotradar/shared';
import type { FreeSlot, SearchQuery, SearchResult, VenueAvailability } from '@spotradar/shared';
import type { AvailabilityService } from '../connectors/availabilityService.ts';
import { toPublicVenue } from '../repositories/venueRepository.ts';
import type { VenueRepository } from '../repositories/venueRepository.ts';

export interface SearchDeps {
  venues: VenueRepository;
  availability: AvailabilityService;
  now: () => Date;
}

/** Drops slots that already ended when the searched date is today. */
function withoutPastSlots(slots: FreeSlot[], date: string, now: Date): FreeSlot[] {
  const local = toLocalDateTime(now);
  if (local.date !== date) return slots;
  return slots.filter((slot) => timeToMinutes(slot.end) > local.minutes);
}

export async function searchVenues(query: SearchQuery, deps: SearchDeps): Promise<SearchResult[]> {
  const now = deps.now();
  const origin =
    query.lat !== undefined && query.lng !== undefined
      ? { lat: query.lat, lng: query.lng }
      : undefined;

  const candidates = deps.venues
    .getAll()
    .filter((venue) => venue.sports.includes(query.sport))
    .map((venue) => ({
      venue,
      distance: origin ? roundKm(distanceKm(origin, venue.location)) : undefined,
    }))
    .filter(
      ({ distance }) =>
        query.maxDistanceKm === undefined ||
        distance === undefined ||
        distance <= query.maxDistanceKm,
    );

  const results = await Promise.all(
    candidates.map(async ({ venue, distance }): Promise<SearchResult> => {
      let availability: VenueAvailability;
      try {
        availability = await deps.availability.getAvailability(venue, query.date);
      } catch {
        // The service should never reject; a failing connector must not fail the search.
        availability = { status: 'unavailable', freeSlots: [] };
      }
      const freeSlots =
        availability.status === 'live'
          ? withoutPastSlots(availability.freeSlots, query.date, now)
          : [];
      const result: SearchResult = {
        venue: toPublicVenue(venue),
        availability: { ...availability, freeSlots },
      };
      if (distance !== undefined) result.distanceKm = distance;
      if (query.time !== undefined && availability.status === 'live') {
        result.freeCourtsAtTime = freeCourtsAt(freeSlots, query.time);
      }
      return result;
    }),
  );

  return results.sort(compareSearchResults);
}
