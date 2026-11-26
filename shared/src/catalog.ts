/**
 * Static catalogue values that are part of the API contract:
 * supported sports, availability sources and search rules.
 */

/** Supported sports (URL-safe ids). Add new ids here and to `SPORTS` to extend the model. */
export const SPORT_IDS = [
  'badminton',
  'tennis',
  'squash',
  'padel',
  'table-tennis',
  'volleyball',
  'beach-volleyball',
] as const;

export type SportId = (typeof SPORT_IDS)[number];

export interface SportInfo {
  id: SportId;
  /** English display name, e.g. "Table tennis". */
  name: string;
  /** Czech display name, e.g. "Stolní tenis". */
  nameCs: string;
  /** Short decorative icon (an emoji); always shown next to the name, never alone. */
  icon: string;
}

/** Display order of the sport selectors. */
export const SPORTS: readonly SportInfo[] = [
  { id: 'badminton', name: 'Badminton', nameCs: 'Badminton', icon: '🏸' },
  { id: 'tennis', name: 'Tennis', nameCs: 'Tenis', icon: '🎾' },
  { id: 'squash', name: 'Squash', nameCs: 'Squash', icon: '🟡' },
  { id: 'padel', name: 'Padel', nameCs: 'Padel', icon: '🥎' },
  { id: 'table-tennis', name: 'Table tennis', nameCs: 'Stolní tenis', icon: '🏓' },
  { id: 'volleyball', name: 'Volleyball', nameCs: 'Volejbal', icon: '🏐' },
  { id: 'beach-volleyball', name: 'Beach volleyball', nameCs: 'Beachvolejbal', icon: '🏖️' },
];

/** Catalogue entry of a sport id. */
export function sportInfo(id: SportId): SportInfo {
  const info = SPORTS.find((sport) => sport.id === id);
  if (!info) throw new Error(`Sport ${id} is missing from SPORTS`);
  return info;
}

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
  'starez',
  'padelos',
  'reenio',
  'rezzy',
  'isportsystem',
  'komarov',
  'zltc',
  'none',
] as const;

export type AvailabilitySource = (typeof AVAILABILITY_SOURCES)[number];

/**
 * Booking systems Brno venues use (researched 2026-11-25, see docs/live-data-connectors.md),
 * whether or not SpotRadar has a connector for them. "own" = the venue's own web system,
 * "phone" = phone/e-mail booking only, "unknown" = not found out.
 */
export const BOOKING_SYSTEMS = [
  'clubspire',
  'memberzone',
  'memberpro',
  'bizzy',
  'starez',
  'playtomic',
  'reenio',
  'jdemenato',
  'hamr',
  'padelos',
  'rezervuj',
  'rezzy',
  'isportsystem',
  'own',
  'phone',
  'unknown',
] as const;

export type BookingSystem = (typeof BOOKING_SYSTEMS)[number];

/** Display names of the booking systems. */
export const BOOKING_SYSTEM_LABELS: Record<BookingSystem, string> = {
  clubspire: 'ClubSpire',
  memberzone: 'MemberZone',
  memberpro: 'MemberPro',
  bizzy: 'Bizzy',
  starez: 'STAREZ',
  playtomic: 'Playtomic',
  reenio: 'Reenio',
  jdemenato: 'JDEMENATO',
  hamr: 'HAMR',
  padelos: 'PadelOS',
  rezervuj: 'Rezervuj.cz',
  rezzy: 'Rezzy',
  isportsystem: 'iSportSystem',
  own: 'Own booking system',
  phone: 'Phone / e-mail',
  unknown: 'Unknown',
};

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

/** Max number of items returned by GET /api/geocode/suggest. */
export const GEOCODE_SUGGEST_LIMIT = 5;

/** Max length of the venue directory search `q` (after trimming). */
export const VENUE_QUERY_MAX = 100;
