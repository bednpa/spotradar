/**
 * Validation "schemas" for API input. Dependency-free on purpose: they run in
 * Node (backend) and in the browser (frontend) without a bundler.
 */
import {
  CALENDAR_MAX_DAYS,
  GEOCODE_QUERY_MAX,
  GEOCODE_QUERY_MIN,
  MAX_DISTANCE_KM,
  VENUE_QUERY_MAX,
  isSportId,
} from './catalog.ts';
import { daysBetween, isValidDate, isValidTime } from './dates.ts';
import type {
  CalendarQuery,
  CalendarQueryParams,
  GeocodeQuery,
  GeocodeQueryParams,
  SearchQuery,
  SearchQueryParams,
  ValidationIssue,
  VenueQuery,
  VenueQueryParams,
} from './types.ts';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function parseNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  return NUMBER_RE.test(trimmed) ? Number(trimmed) : undefined;
}

function isBlank(raw: string | undefined): raw is undefined {
  return raw === undefined || raw.trim() === '';
}

function parseSport(raw: string | undefined, issues: ValidationIssue[]): string | undefined {
  const sport = raw?.trim();
  if (isBlank(sport)) issues.push({ field: 'sport', message: 'sport is required' });
  else if (!isSportId(sport)) issues.push({ field: 'sport', message: 'unknown sport' });
  return sport;
}

/** Validates a required "YYYY-MM-DD" field; returns the trimmed value when valid. */
function parseRequiredDate(
  field: string,
  raw: string | undefined,
  issues: ValidationIssue[],
): string | undefined {
  const date = raw?.trim();
  if (isBlank(date)) {
    issues.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (!isValidDate(date)) {
    issues.push({ field, message: `${field} must be a valid YYYY-MM-DD date` });
    return undefined;
  }
  return date;
}

interface LocationParams {
  lat?: string;
  lng?: string;
  maxDistanceKm?: string;
}

interface ParsedLocation {
  lat?: number;
  lng?: number;
  maxDistanceKm?: number;
}

/** Validates lat/lng (both or neither) and maxDistanceKm (requires lat/lng); pushes issues. */
function parseLocation(params: LocationParams, issues: ValidationIssue[]): ParsedLocation {
  const hasLat = !isBlank(params.lat);
  const hasLng = !isBlank(params.lng);
  let lat: number | undefined;
  let lng: number | undefined;
  if (hasLat !== hasLng) {
    issues.push({
      field: hasLat ? 'lng' : 'lat',
      message: 'lat and lng must be provided together',
    });
  } else if (hasLat && hasLng) {
    lat = parseNumber(params.lat ?? '');
    lng = parseNumber(params.lng ?? '');
    if (lat === undefined || lat < -90 || lat > 90) {
      issues.push({ field: 'lat', message: 'lat must be a number between -90 and 90' });
      lat = undefined;
    }
    if (lng === undefined || lng < -180 || lng > 180) {
      issues.push({ field: 'lng', message: 'lng must be a number between -180 and 180' });
      lng = undefined;
    }
  }

  let maxDistanceKm: number | undefined;
  if (!isBlank(params.maxDistanceKm)) {
    const parsed = parseNumber(params.maxDistanceKm);
    if (parsed === undefined || parsed <= 0 || parsed > MAX_DISTANCE_KM) {
      issues.push({
        field: 'maxDistanceKm',
        message: `maxDistanceKm must be a number greater than 0 and at most ${MAX_DISTANCE_KM}`,
      });
    } else if (!hasLat || !hasLng) {
      issues.push({ field: 'maxDistanceKm', message: 'maxDistanceKm requires lat and lng' });
    } else {
      maxDistanceKm = parsed;
    }
  }

  const result: ParsedLocation = {};
  if (lat !== undefined && lng !== undefined) {
    result.lat = lat;
    result.lng = lng;
  }
  if (maxDistanceKm !== undefined) result.maxDistanceKm = maxDistanceKm;
  return result;
}

/**
 * Validates the raw query string of GET /api/search.
 * Empty strings are treated as "not provided". The date window (today …
 * today + SEARCH_WINDOW_DAYS) is checked separately with isDateInSearchWindow.
 */
export function parseSearchQuery(params: SearchQueryParams): ValidationResult<SearchQuery> {
  const issues: ValidationIssue[] = [];
  const sport = parseSport(params.sport, issues);
  const date = parseRequiredDate('date', params.date, issues);

  const time = params.time?.trim();
  if (!isBlank(time) && !isValidTime(time))
    issues.push({ field: 'time', message: 'time must be HH:MM (00:00–23:59)' });

  const location = parseLocation(params, issues);
  if (issues.length > 0) return { ok: false, issues };

  const value: SearchQuery = {
    sport: sport as SearchQuery['sport'],
    date: date as string,
  };
  if (!isBlank(time)) value.time = time;
  return { ok: true, value: { ...value, ...location } };
}

/**
 * Validates the raw query string of GET /api/calendar: sport, from, to
 * (from ≤ to, at most CALENDAR_MAX_DAYS days inclusive) and the optional
 * location filter. The search window is checked separately with
 * isDateInSearchWindow (both from and to must lie inside it).
 */
export function parseCalendarQuery(params: CalendarQueryParams): ValidationResult<CalendarQuery> {
  const issues: ValidationIssue[] = [];
  const sport = parseSport(params.sport, issues);
  const from = parseRequiredDate('from', params.from, issues);
  const to = parseRequiredDate('to', params.to, issues);
  if (from !== undefined && to !== undefined) {
    const span = daysBetween(from, to);
    if (span < 0) issues.push({ field: 'to', message: 'to must not be before from' });
    else if (span + 1 > CALENDAR_MAX_DAYS)
      issues.push({
        field: 'to',
        message: `the range may cover at most ${CALENDAR_MAX_DAYS} days`,
      });
  }
  const location = parseLocation(params, issues);
  if (issues.length > 0) return { ok: false, issues };

  const value: CalendarQuery = {
    sport: sport as CalendarQuery['sport'],
    from: from as string,
    to: to as string,
  };
  return { ok: true, value: { ...value, ...location } };
}

/**
 * Validates the raw query string of GET /api/venues. Both fields are optional;
 * empty strings are treated as "not provided". `q` is trimmed.
 */
export function parseVenueQuery(params: VenueQueryParams): ValidationResult<VenueQuery> {
  const issues: ValidationIssue[] = [];
  const value: VenueQuery = {};
  const sport = params.sport?.trim();
  if (!isBlank(sport)) {
    if (isSportId(sport)) value.sport = sport;
    else issues.push({ field: 'sport', message: 'unknown sport' });
  }
  const q = params.q?.trim();
  if (!isBlank(q)) {
    if (q.length > VENUE_QUERY_MAX)
      issues.push({ field: 'q', message: `q must be at most ${VENUE_QUERY_MAX} characters` });
    else value.q = q;
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value };
}

/** Validates the raw query string of GET /api/geocode and /api/geocode/suggest. `q` is trimmed. */
export function parseGeocodeQuery(params: GeocodeQueryParams): ValidationResult<GeocodeQuery> {
  const q = params.q?.trim() ?? '';
  if (q.length < GEOCODE_QUERY_MIN || q.length > GEOCODE_QUERY_MAX) {
    return {
      ok: false,
      issues: [
        {
          field: 'q',
          message: `q must be ${GEOCODE_QUERY_MIN}–${GEOCODE_QUERY_MAX} characters`,
        },
      ],
    };
  }
  return { ok: true, value: { q } };
}
