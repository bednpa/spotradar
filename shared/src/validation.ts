/**
 * Validation "schemas" for API input. Dependency-free on purpose: they run in
 * Node (backend) and in the browser (frontend) without a bundler.
 */
import {
  DEFAULT_CITY_ID,
  DEFAULT_DURATION_MINUTES,
  MAX_DISTANCE_KM,
  isCityId,
  isDurationMinutes,
  isSportId,
} from './catalog.ts';
import { isValidDate, isValidSlotTime } from './dates.ts';
import type {
  AvailabilityQuery,
  AvailabilityQueryParams,
  CreateReservationRequest,
  ValidationIssue,
} from './types.ts';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

export const CUSTOMER_NAME_MIN = 2;
export const CUSTOMER_NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const ID_MAX = 100;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function parseNumber(raw: string): number | undefined {
  const trimmed = raw.trim();
  return NUMBER_RE.test(trimmed) ? Number(trimmed) : undefined;
}

function isBlank(raw: string | undefined): raw is undefined {
  return raw === undefined || raw.trim() === '';
}

/**
 * Validates the raw query string of GET /api/availability.
 * Empty strings are treated as "not provided".
 */
export function parseAvailabilityQuery(
  params: AvailabilityQueryParams,
): ValidationResult<AvailabilityQuery> {
  const issues: ValidationIssue[] = [];

  const sport = params.sport?.trim();
  if (isBlank(sport)) issues.push({ field: 'sport', message: 'sport is required' });
  else if (!isSportId(sport)) issues.push({ field: 'sport', message: 'unknown sport' });

  const date = params.date?.trim();
  if (isBlank(date)) issues.push({ field: 'date', message: 'date is required' });
  else if (!isValidDate(date))
    issues.push({ field: 'date', message: 'date must be a valid YYYY-MM-DD date' });

  const time = params.time?.trim();
  if (isBlank(time)) issues.push({ field: 'time', message: 'time is required' });
  else if (!isValidSlotTime(time))
    issues.push({ field: 'time', message: 'time must be HH:00 or HH:30' });

  let durationMinutes: number = DEFAULT_DURATION_MINUTES;
  if (!isBlank(params.durationMinutes)) {
    const parsed = parseNumber(params.durationMinutes);
    if (parsed === undefined || !isDurationMinutes(parsed))
      issues.push({ field: 'durationMinutes', message: 'durationMinutes must be 60, 90 or 120' });
    else durationMinutes = parsed;
  }

  const cityId = isBlank(params.cityId) ? DEFAULT_CITY_ID : params.cityId.trim();
  if (!isCityId(cityId)) issues.push({ field: 'cityId', message: 'unknown city' });

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

  if (issues.length > 0) return { ok: false, issues };

  const value: AvailabilityQuery = {
    sport: sport as AvailabilityQuery['sport'],
    date: date as string,
    time: time as string,
    durationMinutes: durationMinutes as AvailabilityQuery['durationMinutes'],
    cityId: cityId as AvailabilityQuery['cityId'],
  };
  if (lat !== undefined && lng !== undefined) {
    value.lat = lat;
    value.lng = lng;
  }
  if (maxDistanceKm !== undefined) value.maxDistanceKm = maxDistanceKm;
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireId(
  body: Record<string, unknown>,
  field: string,
  issues: ValidationIssue[],
): string | undefined {
  const raw = body[field];
  if (typeof raw !== 'string' || raw.trim() === '') {
    issues.push({ field, message: `${field} is required` });
    return undefined;
  }
  if (raw.length > ID_MAX) {
    issues.push({ field, message: `${field} is too long` });
    return undefined;
  }
  return raw.trim();
}

/** Validates the JSON body of POST /api/reservations. Strings are trimmed. */
export function parseCreateReservationRequest(
  body: unknown,
): ValidationResult<CreateReservationRequest> {
  if (!isRecord(body)) {
    return { ok: false, issues: [{ field: 'body', message: 'body must be a JSON object' }] };
  }
  const issues: ValidationIssue[] = [];

  const venueId = requireId(body, 'venueId', issues);
  const courtId = requireId(body, 'courtId', issues);

  const sport = body.sport;
  if (!isSportId(sport)) issues.push({ field: 'sport', message: 'unknown or missing sport' });

  const date = body.date;
  if (typeof date !== 'string' || !isValidDate(date))
    issues.push({ field: 'date', message: 'date must be a valid YYYY-MM-DD date' });

  const time = body.time;
  if (typeof time !== 'string' || !isValidSlotTime(time))
    issues.push({ field: 'time', message: 'time must be HH:00 or HH:30' });

  const durationMinutes = body.durationMinutes;
  if (!isDurationMinutes(durationMinutes))
    issues.push({ field: 'durationMinutes', message: 'durationMinutes must be 60, 90 or 120' });

  const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : '';
  if (customerName.length < CUSTOMER_NAME_MIN || customerName.length > CUSTOMER_NAME_MAX)
    issues.push({
      field: 'customerName',
      message: `customerName must be ${CUSTOMER_NAME_MIN}–${CUSTOMER_NAME_MAX} characters`,
    });

  const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim() : '';
  if (customerEmail.length > EMAIL_MAX || !EMAIL_RE.test(customerEmail))
    issues.push({ field: 'customerEmail', message: 'customerEmail must be a valid e-mail address' });

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    value: {
      venueId: venueId as string,
      courtId: courtId as string,
      sport: sport as CreateReservationRequest['sport'],
      date: date as string,
      time: time as string,
      durationMinutes: durationMinutes as CreateReservationRequest['durationMinutes'],
      customerName,
      customerEmail,
    },
  };
}
