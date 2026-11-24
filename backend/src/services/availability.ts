import { SLOT_MINUTES, timeToMinutes, toLocalDateTime } from '@spotradar/shared';
import type {
  AvailabilityQuery,
  AvailabilityResult,
  AvailableCourt,
  GeoPoint,
  Venue,
  VenueSummary,
} from '@spotradar/shared';
import type { ReservationRepository } from '../repositories/reservationRepository.ts';
import type { VenueRepository } from '../repositories/venueRepository.ts';
import { isSlotOccupiedExternally } from './occupancy.ts';

export interface AvailabilityDeps {
  venues: VenueRepository;
  reservations: ReservationRepository;
  now: Date;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in km (haversine formula). */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True if the venue is open for the whole interval [startMin, endMin). */
export function isWithinOpeningHours(venue: Venue, startMin: number, endMin: number): boolean {
  return (
    timeToMinutes(venue.openingHours.open) <= startMin &&
    endMin <= timeToMinutes(venue.openingHours.close)
  );
}

/** True if the start of the interval is not in the future (relative to Prague local time). */
export function isStartInPast(date: string, startMin: number, now: Date): boolean {
  const local = toLocalDateTime(now);
  if (date < local.date) return true;
  return date === local.date && startMin <= local.minutes;
}

/** True if neither the simulated external occupancy nor an in-app reservation blocks the interval. */
export function isCourtFree(
  courtId: string,
  date: string,
  startMin: number,
  endMin: number,
  reservations: ReservationRepository,
): boolean {
  for (let slot = startMin; slot < endMin; slot += SLOT_MINUTES) {
    if (isSlotOccupiedExternally(courtId, date, slot)) return false;
  }
  return !reservations.hasOverlap(courtId, date, startMin, endMin);
}

export function toVenueSummary(venue: Venue): VenueSummary {
  return {
    id: venue.id,
    name: venue.name,
    cityId: venue.cityId,
    address: venue.address,
    location: venue.location,
    openingHours: venue.openingHours,
  };
}

/** Finds venues with free courts for the query. Assumes the date was already range-checked. */
export function searchAvailability(
  query: AvailabilityQuery,
  deps: AvailabilityDeps,
): AvailabilityResult[] {
  const { sport, date, durationMinutes, lat, lng, maxDistanceKm } = query;
  const startMin = timeToMinutes(query.time);
  const endMin = startMin + durationMinutes;

  if (isStartInPast(date, startMin, deps.now)) return [];

  const origin: GeoPoint | null = lat !== undefined && lng !== undefined ? { lat, lng } : null;
  const results: AvailabilityResult[] = [];

  for (const venue of deps.venues.listByCity(query.cityId)) {
    const pricePerHourCzk = venue.pricePerHourCzk[sport];
    if (pricePerHourCzk === undefined) continue;
    if (!isWithinOpeningHours(venue, startMin, endMin)) continue;

    let distanceKm: number | null = null;
    if (origin) {
      const rawDistance = haversineKm(origin, venue.location);
      if (maxDistanceKm !== undefined && rawDistance > maxDistanceKm) continue;
      distanceKm = Math.round(rawDistance * 10) / 10;
    }

    const availableCourts: AvailableCourt[] = venue.courts
      .filter(
        (court) =>
          court.sports.includes(sport) &&
          isCourtFree(court.id, date, startMin, endMin, deps.reservations),
      )
      .map((court) => ({
        id: court.id,
        name: court.name,
        indoor: court.indoor,
        surface: court.surface,
      }));
    if (availableCourts.length === 0) continue;

    results.push({
      venue: toVenueSummary(venue),
      distanceKm,
      pricePerHourCzk,
      totalPriceCzk: Math.round((pricePerHourCzk * durationMinutes) / 60),
      availableCourts,
    });
  }

  results.sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.totalPriceCzk !== b.totalPriceCzk) return a.totalPriceCzk - b.totalPriceCzk;
    return a.venue.name.localeCompare(b.venue.name, 'cs');
  });

  return results;
}
