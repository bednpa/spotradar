/**
 * Pure search helpers shared by backend (filtering/sorting) and frontend (display).
 */
import type { GeoPoint } from './catalog.ts';
import { timeToMinutes } from './dates.ts';
import type { FreeSlot, SearchResult } from './types.ts';

const EARTH_RADIUS_KM = 6371;

/** Great-circle (haversine) distance in km. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rounds a distance to 1 decimal place. */
export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

/** Free courts in the slot that contains `time` (start ≤ time < end); 0 when none. */
export function freeCourtsAt(slots: readonly FreeSlot[], time: string): number {
  const t = timeToMinutes(time);
  const slot = slots.find((s) => timeToMinutes(s.start) <= t && t < timeToMinutes(s.end));
  return slot?.freeCourts ?? 0;
}

/** True when the result has a free court at the requested time (or anytime when no time is given). */
export function hasFreeCourt(result: SearchResult): boolean {
  if (result.freeCourtsAtTime !== undefined) return result.freeCourtsAtTime > 0;
  return result.availability.freeSlots.length > 0;
}

/**
 * Sort order of GET /api/search: venues with a free court first, then by
 * distanceKm (when present on both), then by venue name (Czech collation).
 */
export function compareSearchResults(a: SearchResult, b: SearchResult): number {
  const freeA = hasFreeCourt(a) ? 0 : 1;
  const freeB = hasFreeCourt(b) ? 0 : 1;
  if (freeA !== freeB) return freeA - freeB;
  if (a.distanceKm !== undefined && b.distanceKm !== undefined && a.distanceKm !== b.distanceKm) {
    return a.distanceKm - b.distanceKm;
  }
  return a.venue.name.localeCompare(b.venue.name, 'cs');
}
