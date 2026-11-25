import {
  compareSearchResults,
  daysBetween,
  distanceKm,
  freeCourtsAt,
  minutesToTime,
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

/**
 * Venues that only accept bookings `leadMinutes` ahead (X-Arena: 120): nothing starting before
 * now + lead, rounded up to the next full hour (Bizzy cells start on the hour; rounding up never
 * reports a too-early cell as free), is free. Slots crossing the cutoff are shortened to start
 * there. Applied at answer time, after the cache, so cached data never keeps a stale cutoff.
 */
export function withoutTooSoonSlots(
  slots: FreeSlot[],
  date: string,
  now: Date,
  leadMinutes: number | undefined,
): FreeSlot[] {
  if (!leadMinutes || leadMinutes <= 0) return slots;
  const local = toLocalDateTime(now);
  const offsetDays = daysBetween(local.date, date);
  if (offsetDays < 0) return [];
  const cutoff = Math.ceil((local.minutes + leadMinutes - offsetDays * 24 * 60) / 60) * 60;
  if (cutoff <= 0) return slots;
  return slots
    .filter((slot) => timeToMinutes(slot.end) > cutoff)
    .map((slot) =>
      timeToMinutes(slot.start) < cutoff ? { ...slot, start: minutesToTime(cutoff) } : slot,
    );
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
  const leadMinutes = venue.source.type === 'bizzy' ? venue.source.minLeadMinutes : undefined;
  const freeSlots =
    availability.status === 'live'
      ? withoutTooSoonSlots(
          withoutPastSlots(availability.freeSlots, date, now),
          date,
          now,
          leadMinutes,
        )
      : [];
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
