/**
 * Static catalogue values that are part of the API contract:
 * supported sports, cities, durations and booking rules.
 */

export const SPORT_IDS = [
  'tennis',
  'badminton',
  'squash',
  'table-tennis',
  'padel',
  'beach-volleyball',
] as const;

export type SportId = (typeof SPORT_IDS)[number];

export interface SportInfo {
  id: SportId;
  name: string;
}

export const SPORTS: readonly SportInfo[] = [
  { id: 'tennis', name: 'Tennis' },
  { id: 'badminton', name: 'Badminton' },
  { id: 'squash', name: 'Squash' },
  { id: 'table-tennis', name: 'Table tennis' },
  { id: 'padel', name: 'Padel' },
  { id: 'beach-volleyball', name: 'Beach volleyball' },
];

export function isSportId(value: unknown): value is SportId {
  return typeof value === 'string' && (SPORT_IDS as readonly string[]).includes(value);
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const CITY_IDS = ['brno'] as const;

export type CityId = (typeof CITY_IDS)[number];

export interface CityInfo {
  id: CityId;
  name: string;
  center: GeoPoint;
}

export const CITIES: readonly CityInfo[] = [
  { id: 'brno', name: 'Brno', center: { lat: 49.1951, lng: 16.6068 } },
];

export const DEFAULT_CITY_ID: CityId = 'brno';

export function isCityId(value: unknown): value is CityId {
  return typeof value === 'string' && (CITY_IDS as readonly string[]).includes(value);
}

/** Allowed reservation lengths in minutes. */
export const DURATIONS_MINUTES = [60, 90, 120] as const;

export type DurationMinutes = (typeof DURATIONS_MINUTES)[number];

export const DEFAULT_DURATION_MINUTES: DurationMinutes = 60;

export function isDurationMinutes(value: unknown): value is DurationMinutes {
  return typeof value === 'number' && (DURATIONS_MINUTES as readonly number[]).includes(value);
}

/** Start times are aligned to this grid (HH:00 or HH:30). */
export const SLOT_MINUTES = 30;

/** Bookable dates: today (Europe/Prague) up to today + BOOKING_WINDOW_DAYS - 1. */
export const BOOKING_WINDOW_DAYS = 14;

/** All dates/times in the API are local wall-clock values in this zone. */
export const TIME_ZONE = 'Europe/Prague';

/** Suggested values for the "max distance" filter in the UI. */
export const DISTANCE_OPTIONS_KM = [2, 5, 10, 20] as const;

/** Upper bound accepted by the API for maxDistanceKm. */
export const MAX_DISTANCE_KM = 100;
