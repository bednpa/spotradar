/**
 * Validation "schemas" for API input. Dependency-free on purpose: they run in
 * Node (backend) and in the browser (frontend) without a bundler.
 */
import { GEOCODE_QUERY_MAX, GEOCODE_QUERY_MIN, MAX_DISTANCE_KM, isSportId } from './catalog.ts';
import { isValidDate, isValidTime } from './dates.ts';
import type {
  GeocodeQuery,
  GeocodeQueryParams,
  SearchQuery,
  SearchQueryParams,
  ValidationIssue,
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

/**
 * Validates the raw query string of GET /api/search.
 * Empty strings are treated as "not provided". The date window (today …
 * today + SEARCH_WINDOW_DAYS) is checked separately with isDateInSearchWindow.
 */
export function parseSearchQuery(params: SearchQueryParams): ValidationResult<SearchQuery> {
  const issues: ValidationIssue[] = [];

  const sport = params.sport?.trim();
  if (isBlank(sport)) issues.push({ field: 'sport', message: 'sport is required' });
  else if (!isSportId(sport)) issues.push({ field: 'sport', message: 'unknown sport' });

  const date = params.date?.trim();
  if (isBlank(date)) issues.push({ field: 'date', message: 'date is required' });
  else if (!isValidDate(date))
    issues.push({
      field: 'date',
      message: 'date must be a valid YYYY-MM-DD date',
    });

  const time = params.time?.trim();
  if (!isBlank(time) && !isValidTime(time))
    issues.push({ field: 'time', message: 'time must be HH:MM (00:00–23:59)' });

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
      issues.push({
        field: 'lat',
        message: 'lat must be a number between -90 and 90',
      });
      lat = undefined;
    }
    if (lng === undefined || lng < -180 || lng > 180) {
      issues.push({
        field: 'lng',
        message: 'lng must be a number between -180 and 180',
      });
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
      issues.push({
        field: 'maxDistanceKm',
        message: 'maxDistanceKm requires lat and lng',
      });
    } else {
      maxDistanceKm = parsed;
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const value: SearchQuery = {
    sport: sport as SearchQuery['sport'],
    date: date as string,
  };
  if (!isBlank(time)) value.time = time;
  if (lat !== undefined && lng !== undefined) {
    value.lat = lat;
    value.lng = lng;
  }
  if (maxDistanceKm !== undefined) value.maxDistanceKm = maxDistanceKm;
  return { ok: true, value };
}

/** Validates the raw query string of GET /api/geocode. `q` is trimmed. */
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
