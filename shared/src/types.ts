/**
 * API DTOs – the single source of truth for request/response shapes.
 * Dates are "YYYY-MM-DD", times are "HH:MM" (local time in Europe/Prague).
 */
import type { CityId, DurationMinutes, GeoPoint, SportId } from './catalog.ts';
import type { ErrorCode } from './errors.ts';

/** GET /api/health → 200 */
export interface HealthResponse {
  status: 'ok';
}

export interface OpeningHours {
  /** "HH:MM", inclusive */
  open: string;
  /** "HH:MM", exclusive – a reservation must end at or before this time */
  close: string;
}

export interface VenueSummary {
  id: string;
  name: string;
  cityId: CityId;
  address: string;
  location: GeoPoint;
  openingHours: OpeningHours;
}

export interface Court {
  id: string;
  name: string;
  sports: SportId[];
  indoor: boolean;
  surface: string;
}

export interface Venue extends VenueSummary {
  /** Price per hour in CZK for each sport the venue offers. */
  pricePerHourCzk: Partial<Record<SportId, number>>;
  courts: Court[];
}

/** Parsed query of GET /api/availability. */
export interface AvailabilityQuery {
  sport: SportId;
  date: string;
  time: string;
  durationMinutes: DurationMinutes;
  cityId: CityId;
  /** lat and lng are either both present or both absent. */
  lat?: number;
  lng?: number;
  /** Only allowed together with lat/lng. */
  maxDistanceKm?: number;
}

/**
 * Raw query string parameters of GET /api/availability (all strings).
 * Names: sport, date, time, durationMinutes, cityId, lat, lng, maxDistanceKm.
 */
export type AvailabilityQueryParams = Partial<Record<keyof AvailabilityQuery, string>>;

export interface AvailableCourt {
  id: string;
  name: string;
  indoor: boolean;
  surface: string;
}

export interface AvailabilityResult {
  venue: VenueSummary;
  /** Distance from the user's location in km (1 decimal), null if no location given. */
  distanceKm: number | null;
  pricePerHourCzk: number;
  /** pricePerHourCzk * durationMinutes / 60, rounded to whole CZK. */
  totalPriceCzk: number;
  /** Courts free for the whole requested interval (never empty). */
  availableCourts: AvailableCourt[];
}

/** GET /api/availability → 200 */
export interface AvailabilityResponse {
  query: AvailabilityQuery;
  /** Sorted by distanceKm ascending when a location is given, otherwise by totalPriceCzk, then venue name. */
  results: AvailabilityResult[];
}

/** POST /api/reservations body */
export interface CreateReservationRequest {
  venueId: string;
  courtId: string;
  sport: SportId;
  date: string;
  time: string;
  durationMinutes: DurationMinutes;
  customerName: string;
  customerEmail: string;
}

/** POST /api/reservations → 201, GET /api/reservations/:id → 200 */
export interface Reservation extends CreateReservationRequest {
  id: string;
  venueName: string;
  courtName: string;
  totalPriceCzk: number;
  /** ISO 8601 timestamp */
  createdAt: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Unified error body for every non-2xx API response. */
export interface ApiError {
  error: string;
  code: ErrorCode;
  /** For VALIDATION_ERROR: ValidationIssue[] */
  details?: unknown;
}
