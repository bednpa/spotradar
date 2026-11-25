/**
 * Static catalogue values that are part of the API contract:
 * supported sports, availability sources and search rules.
 */

/** Supported sports. Only badminton for now – add new ids here to extend the model. */
export const SPORT_IDS = ['badminton'] as const;

export type SportId = (typeof SPORT_IDS)[number];

export interface SportInfo {
  id: SportId;
  name: string;
}

export const SPORTS: readonly SportInfo[] = [{ id: 'badminton', name: 'Badminton' }];

export const DEFAULT_SPORT_ID: SportId = 'badminton';

export function isSportId(value: unknown): value is SportId {
  return typeof value === 'string' && (SPORT_IDS as readonly string[]).includes(value);
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Centre of Brno – default map/geocoding bias. */
export const BRNO_CENTER: GeoPoint = { lat: 49.1951, lng: 16.6068 };

/** Booking systems a venue can use. "none" = no public booking system known. */
export const AVAILABILITY_SOURCES = [
  'clubspire',
  'bizzy',
  'memberzone',
  'memberpro',
  'none',
] as const;

export type AvailabilitySource = (typeof AVAILABILITY_SOURCES)[number];

/** Searchable dates: today (Europe/Prague) up to and including today + SEARCH_WINDOW_DAYS. */
export const SEARCH_WINDOW_DAYS = 14;

/** Max number of days (inclusive range) one GET /api/calendar request may cover = whole search window. */
export const CALENDAR_MAX_DAYS = SEARCH_WINDOW_DAYS + 1;

/** Calendar views offered by the UI. */
export const CALENDAR_VIEWS = ['day', 'week', 'month', 'year'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/** All dates/times in the API are local wall-clock values in this zone. */
export const TIME_ZONE = 'Europe/Prague';

/** Suggested values for the "max distance" filter in the UI. */
export const DISTANCE_OPTIONS_KM = [2, 5, 10, 20] as const;

/** Upper bound accepted by the API for maxDistanceKm. */
export const MAX_DISTANCE_KM = 100;

/** Accepted length of the geocoding query `q` (after trimming). */
export const GEOCODE_QUERY_MIN = 2;
export const GEOCODE_QUERY_MAX = 200;
