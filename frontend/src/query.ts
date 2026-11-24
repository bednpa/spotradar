/** Search form values, defaults and conversion to the API query. */
import {
  DEFAULT_CITY_ID,
  DEFAULT_DURATION_MINUTES,
  SLOT_MINUTES,
  SPORTS,
  addDays,
  minutesToTime,
  parseAvailabilityQuery,
  toLocalDateTime,
} from '@spotradar/shared';
import type {
  AvailabilityQuery,
  AvailabilityQueryParams,
  ValidationResult,
} from '@spotradar/shared';

/** Seed venues open at 07:00 at the earliest and close by 22:00, so later starts can't fit 60 min. */
export const FIRST_START_MINUTES = 7 * 60;
export const LAST_START_MINUTES = 21 * 60;
export const FALLBACK_TIME = '18:00';

/** "07:00", "07:30", … "21:00" */
export const TIME_OPTIONS: readonly string[] = buildTimeOptions();

function buildTimeOptions(): string[] {
  const options: string[] = [];
  for (let m = FIRST_START_MINUTES; m <= LAST_START_MINUTES; m += SLOT_MINUTES) {
    options.push(minutesToTime(m));
  }
  return options;
}

/** Raw (string) values of the search form. */
export interface SearchFormValues {
  sport: string;
  date: string;
  time: string;
  durationMinutes: string;
  /** Empty when no location is set. */
  lat: string;
  lng: string;
  /** Empty = any distance. */
  maxDistanceKm: string;
}

/**
 * Default date and start time: today and the next half-hour slot after `now`
 * (clamped to the first bookable slot). When no slot is left today (after 20:30),
 * tomorrow at 18:00.
 */
export function getDefaultDateTime(now: Date): { date: string; time: string } {
  const local = toLocalDateTime(now);
  const next = (Math.floor(local.minutes / SLOT_MINUTES) + 1) * SLOT_MINUTES;
  if (next > LAST_START_MINUTES) {
    return { date: addDays(local.date, 1), time: FALLBACK_TIME };
  }
  return { date: local.date, time: minutesToTime(Math.max(next, FIRST_START_MINUTES)) };
}

export function getDefaultFormValues(now: Date): SearchFormValues {
  const { date, time } = getDefaultDateTime(now);
  return {
    sport: SPORTS[0]?.id ?? '',
    date,
    time,
    durationMinutes: String(DEFAULT_DURATION_MINUTES),
    lat: '',
    lng: '',
    maxDistanceKm: '',
  };
}

/** Builds the raw query params; distance is only sent together with a location. */
export function formValuesToParams(values: SearchFormValues): AvailabilityQueryParams {
  const params: AvailabilityQueryParams = {
    sport: values.sport,
    date: values.date,
    time: values.time,
    durationMinutes: values.durationMinutes,
    cityId: DEFAULT_CITY_ID,
  };
  const hasLocation = values.lat.trim() !== '' && values.lng.trim() !== '';
  if (hasLocation) {
    params.lat = values.lat;
    params.lng = values.lng;
    if (values.maxDistanceKm.trim() !== '') params.maxDistanceKm = values.maxDistanceKm;
  }
  return params;
}

/** Validates the form with the shared contract validator. */
export function buildSearchQuery(values: SearchFormValues): ValidationResult<AvailabilityQuery> {
  return parseAvailabilityQuery(formValuesToParams(values));
}

/** Serialises a validated query for GET /api/availability. */
export function queryToSearchParams(query: AvailabilityQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('sport', query.sport);
  params.set('date', query.date);
  params.set('time', query.time);
  params.set('durationMinutes', String(query.durationMinutes));
  params.set('cityId', query.cityId);
  if (query.lat !== undefined && query.lng !== undefined) {
    params.set('lat', String(query.lat));
    params.set('lng', String(query.lng));
    if (query.maxDistanceKm !== undefined) params.set('maxDistanceKm', String(query.maxDistanceKm));
  }
  return params;
}
