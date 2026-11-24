/** Form values ↔ SearchQuery ↔ URL query string. Pure functions. */
import { DEFAULT_SPORT_ID, addDays, getSearchWindow, parseSearchQuery } from '@spotradar/shared';
import type { SearchQuery, SearchQueryParams, ValidationResult } from '@spotradar/shared';
import { formatShortDate } from './format.ts';

/** Where the search origin came from. */
export interface Origin {
  lat: number;
  lng: number;
  label: string;
  source: 'geolocation' | 'address' | 'url';
}

/** Raw (string) values of the search form. */
export interface FormValues {
  sport: string;
  date: string;
  /** "" = any time */
  time: string;
  /** "" = any distance; only meaningful together with an origin. */
  maxDistanceKm: string;
  origin: Origin | null;
}

export function getDefaultFormValues(now: Date): FormValues {
  return {
    sport: DEFAULT_SPORT_ID,
    date: getSearchWindow(now).from,
    time: '',
    maxDistanceKm: '',
    origin: null,
  };
}

export interface DateChip {
  date: string;
  label: string;
}

/** "Today", "Tomorrow" and the following 5 days labelled e.g. "Thu 27 Nov". */
export function getDateChips(now: Date): DateChip[] {
  const today = getSearchWindow(now).from;
  const chips: DateChip[] = [
    { date: today, label: 'Today' },
    { date: addDays(today, 1), label: 'Tomorrow' },
  ];
  for (let offset = 2; offset <= 6; offset++) {
    const date = addDays(today, offset);
    chips.push({ date, label: formatShortDate(date) });
  }
  return chips;
}

/** Raw API params for the form values; blank values are omitted. */
export function formToParams(values: FormValues): SearchQueryParams {
  const params: SearchQueryParams = { sport: values.sport, date: values.date };
  if (values.time !== '') params.time = values.time;
  if (values.origin) {
    params.lat = String(values.origin.lat);
    params.lng = String(values.origin.lng);
  }
  if (values.maxDistanceKm !== '') params.maxDistanceKm = values.maxDistanceKm;
  return params;
}

/** Validates the form with the shared contract schema. A distance without an origin is invalid. */
export function buildSearchQuery(values: FormValues): ValidationResult<SearchQuery> {
  return parseSearchQuery(formToParams(values));
}

/** SearchQuery → URLSearchParams (used for both the API call and the page URL). */
export function queryToSearchParams(query: SearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('sport', query.sport);
  params.set('date', query.date);
  if (query.time !== undefined) params.set('time', query.time);
  if (query.lat !== undefined && query.lng !== undefined) {
    params.set('lat', String(query.lat));
    params.set('lng', String(query.lng));
  }
  if (query.maxDistanceKm !== undefined) params.set('maxDistanceKm', String(query.maxDistanceKm));
  return params;
}

/**
 * Restores form values from a page query string. Returns null when the URL holds
 * no search (no `date` parameter). An origin from the URL is labelled generically.
 */
export function formFromQueryString(search: string, now: Date): FormValues | null {
  const params = new URLSearchParams(search);
  if (!params.has('date')) return null;
  const defaults = getDefaultFormValues(now);
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const hasOrigin =
    params.get('lat') !== null &&
    params.get('lng') !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng);
  return {
    sport: params.get('sport') ?? defaults.sport,
    date: params.get('date') ?? defaults.date,
    time: params.get('time') ?? '',
    maxDistanceKm: hasOrigin ? (params.get('maxDistanceKm') ?? '') : '',
    origin: hasOrigin ? { lat, lng, label: 'Selected location', source: 'url' } : null,
  };
}
