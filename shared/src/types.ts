/**
 * API DTOs – the single source of truth for request/response shapes.
 * Dates are "YYYY-MM-DD", times are "HH:MM" (local time in Europe/Prague).
 */
import type { AvailabilitySource, GeoPoint, SportId } from './catalog.ts';
import type { ErrorCode } from './errors.ts';

/** GET /api/health → 200 */
export interface HealthResponse {
  status: 'ok';
}

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DayOpeningHours {
  /** "HH:MM" */
  open: string;
  /** "HH:MM" */
  close: string;
}

export interface OpeningHours {
  /** True when the hours are an estimate (not confirmed by the venue). */
  approximate: boolean;
  /** null = closed that day. */
  days: Record<Weekday, DayOpeningHours | null>;
}

/** Public venue information (what the API returns). */
export interface Venue {
  id: string;
  name: string;
  /** City district, e.g. "Brno-Židenice". */
  district: string;
  address: string;
  location: GeoPoint;
  sports: SportId[];
  /** Number of courts for the sport; absent when not known. */
  courts?: number;
  openingHours: OpeningHours;
  /** The venue's own booking page – SpotRadar never books anything itself. */
  bookingUrl: string;
  phone?: string;
  availabilitySource: AvailabilitySource;
}

/**
 * Backend-only connector configuration for a venue's booking system
 * (stored in the venue data file, never sent to clients).
 */
export type AvailabilitySourceConfig =
  | { type: 'clubspire'; baseUrl: string; tabIdx: number }
  | { type: 'bizzy'; scheduleUrl: string }
  | { type: 'memberzone'; url: string }
  | { type: 'memberpro'; url: string }
  | { type: 'none' };

/** Parsed query of GET /api/search. */
export interface SearchQuery {
  sport: SportId;
  date: string;
  /** Optional "HH:MM". */
  time?: string;
  /** lat and lng are either both present or both absent. */
  lat?: number;
  lng?: number;
  /** Only allowed together with lat/lng. */
  maxDistanceKm?: number;
}

/** Raw query string parameters of GET /api/search (all strings). */
export type SearchQueryParams = Partial<Record<keyof SearchQuery, string>>;

/** A time interval on the requested date with at least one free court. */
export interface FreeSlot {
  /** "HH:MM", inclusive */
  start: string;
  /** "HH:MM", exclusive */
  end: string;
  /** Number of courts free for the whole interval (always ≥ 1). */
  freeCourts: number;
}

/**
 * - live: read from the venue's booking page,
 * - unavailable: a connector exists but reading the page failed,
 * - unknown: no connector for this booking system yet.
 */
export type AvailabilityStatus = 'live' | 'unavailable' | 'unknown';

export interface VenueAvailability {
  status: AvailabilityStatus;
  /** ISO 8601 timestamp of when the data was read (status "live" only). */
  checkedAt?: string;
  /** Free slots for the day sorted by start; empty unless status is "live". */
  freeSlots: FreeSlot[];
}

export interface SearchResult {
  venue: Venue;
  /** Distance from the origin in km (1 decimal); present only when lat/lng were given. */
  distanceKm?: number;
  availability: VenueAvailability;
  /**
   * Free courts in the slot containing the requested time; present only when
   * `time` was given and availability status is "live" (0 = nothing free then).
   */
  freeCourtsAtTime?: number;
}

/** GET /api/search → 200 */
export interface SearchResponse {
  query: SearchQuery;
  /**
   * Sorted: venues with a free court first (at `time` when given, otherwise
   * anywhere during the day), then by distanceKm when an origin was given,
   * otherwise by venue name.
   */
  results: SearchResult[];
}

/** Parsed query of GET /api/geocode. */
export interface GeocodeQuery {
  /** Trimmed free-text address. */
  q: string;
}

export type GeocodeQueryParams = Partial<Record<keyof GeocodeQuery, string>>;

/** GET /api/geocode → 200 */
export interface GeocodeResponse {
  lat: number;
  lng: number;
  /** Human-readable place name. */
  label: string;
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
