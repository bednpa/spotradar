import {
  compareSearchResults,
  distanceKm,
  freeCourtsAt,
  roundKm,
  timeToMinutes,
  toLocalDateTime,
} from '@spotradar/shared';
import type {
  FreeSlot,
  SearchQuery,
  SearchResult,
  SportId,
  VenueAvailability,
} from '@spotradar/shared';
import type { AvailabilityService } from '../connectors/availabilityService.ts';
import { toPublicVenue } from '../repositories/venueRepository.ts';
import type { VenueRecord, VenueRepository } from '../repositories/venueRepository.ts';

export interface SearchDeps {
  venues: VenueRepository;
  availability: AvailabilityService;
  now: () => Date;
}

/** Drops slots that already ended when the searched date is today. */
export function withoutPastSlots(slots: FreeSlot[], date: string, now: Date): FreeSlot[] {
  const local = toLocalDateTime(now);
  if (local.date !== date) return slots;
  return slots.filter((slot) => timeToMinutes(slot.end) > local.minutes);
}

export interface VenueCandidate {
  venue: VenueRecord;
  /** Rounded distance from the origin; undefined without an origin. */
  distance: number | undefined;
}

/** Venues offering the sport, within maxDistanceKm of the origin (when given). */
export function selectVenues(
  venues: VenueRepository,
  query: { sport: SportId; lat?: number; lng?: number; maxDistanceKm?: number },
): VenueCandidate[] {
  const origin =
    query.lat !== undefined && query.lng !== undefined
      ? { lat: query.lat, lng: query.lng }
      : undefined;

  return venues
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
}

/** Availability of one venue on one date; never rejects, past slots of today removed. */
export async function getDayAvailability(
  availabilityService: AvailabilityService,
  venue: VenueRecord,
  date: string,
  now: Date,
): Promise<VenueAvailability> {
  let availability: VenueAvailability;
  try {
    availability = await availabilityService.getAvailability(venue, date);
  } catch {
    // The service should never reject; a failing connector must not fail the request.
    availability = { status: 'unavailable', freeSlots: [] };
  }
  const freeSlots =
    availability.status === 'live' ? withoutPastSlots(availability.freeSlots, date, now) : [];
  return { ...availability, freeSlots };
}

export async function searchVenues(query: SearchQuery, deps: SearchDeps): Promise<SearchResult[]> {
  const now = deps.now();
  const candidates = selectVenues(deps.venues, query);

  const results = await Promise.all(
    candidates.map(async ({ venue, distance }): Promise<SearchResult> => {
      const availability = await getDayAvailability(deps.availability, venue, query.date, now);
      const freeSlots = availability.freeSlots;
      const result: SearchResult = {
        venue: toPublicVenue(venue),
        availability,
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
