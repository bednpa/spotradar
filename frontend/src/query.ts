/** App state ↔ URL query string ↔ CalendarQuery. Pure functions. */
import {
  CALENDAR_VIEWS,
  DEFAULT_SPORT_ID,
  MAX_DISTANCE_KM,
  getSearchWindow,
  isDateInSearchWindow,
  isSportId,
  isValidDate,
} from '@spotradar/shared';
import type { CalendarQuery, CalendarView, SportId } from '@spotradar/shared';
import { DEFAULT_FROM_HOUR, DEFAULT_TO_HOUR } from './calendar-range.ts';
import type { DateRange } from './calendar-range.ts';
import { hourLabel } from './format.ts';

/** Where the location filter came from. */
export interface Origin {
  lat: number;
  lng: number;
  label: string;
  source: 'geolocation' | 'address' | 'url';
}

export interface AppState {
  sport: SportId;
  view: CalendarView;
  /** Anchor date "YYYY-MM-DD" of the shown period (may lie outside the searchable window). */
  date: string;
  /** First visible hour row (0-23). */
  fromHour: number;
  /** End (exclusive) of the last visible hour row (1-24). */
  toHour: number;
  origin: Origin | null;
  /** Only with an origin. */
  maxDistanceKm: number | null;
  /** Hide "check on website" hours in the grid. */
  onlyFree: boolean;
}

export function isCalendarView(value: unknown): value is CalendarView {
  return typeof value === 'string' && (CALENDAR_VIEWS as readonly string[]).includes(value);
}

/** Week on wide screens, Day on narrow ones. */
export function defaultView(wide: boolean): CalendarView {
  return wide ? 'week' : 'day';
}

export function getDefaultState(now: Date, wide: boolean): AppState {
  return {
    sport: DEFAULT_SPORT_ID,
    view: defaultView(wide),
    date: getSearchWindow(now).from,
    fromHour: DEFAULT_FROM_HOUR,
    toHour: DEFAULT_TO_HOUR,
    origin: null,
    maxDistanceKm: null,
    onlyFree: false,
  };
}

function parseHour(value: string | null, round: 'floor' | 'ceil'): number | null {
  if (value === null) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes > 24 * 60) return null;
  return round === 'floor' ? Math.floor(minutes / 60) : Math.ceil(minutes / 60);
}

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Restores the state from a page query string; invalid or missing values fall back to defaults. */
export function stateFromSearch(search: string, now: Date, wide: boolean): AppState {
  const defaults = getDefaultState(now, wide);
  const params = new URLSearchParams(search);

  const view = params.get('view');
  const date = params.get('date');
  const sport = params.get('sport');
  let fromHour = parseHour(params.get('timeFrom'), 'floor') ?? defaults.fromHour;
  let toHour = parseHour(params.get('timeTo'), 'ceil') ?? defaults.toHour;
  if (fromHour > 23 || toHour < 1 || fromHour >= toHour) {
    fromHour = defaults.fromHour;
    toHour = defaults.toHour;
  }

  const lat = parseNumber(params.get('lat'));
  const lng = parseNumber(params.get('lng'));
  const origin: Origin | null =
    lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { lat, lng, label: 'Selected location', source: 'url' }
      : null;
  const km = parseNumber(params.get('maxDistanceKm'));

  return {
    sport: isSportId(sport) ? sport : defaults.sport,
    view: isCalendarView(view) ? view : defaults.view,
    date: date !== null && isValidDate(date) ? date : defaults.date,
    fromHour,
    toHour,
    origin,
    maxDistanceKm: origin && km !== null && km > 0 && km <= MAX_DISTANCE_KM ? km : null,
    onlyFree: params.get('free') === '1',
  };
}

/** Date typed into "Go to date": must be a real date inside the searchable window, else null. */
export function parseGotoDate(value: string, now: Date): string | null {
  return isValidDate(value) && isDateInSearchWindow(value, now) ? value : null;
}

/** State → query string without the leading "?". Defaults are omitted (view and date always present). */
export function stateToSearch(state: AppState): string {
  const params = new URLSearchParams();
  params.set('view', state.view);
  params.set('date', state.date);
  if (state.sport !== DEFAULT_SPORT_ID) params.set('sport', state.sport);
  if (state.fromHour !== DEFAULT_FROM_HOUR) params.set('timeFrom', hourLabel(state.fromHour));
  if (state.toHour !== DEFAULT_TO_HOUR) params.set('timeTo', hourLabel(state.toHour));
  if (state.origin) {
    params.set('lat', String(state.origin.lat));
    params.set('lng', String(state.origin.lng));
    if (state.maxDistanceKm !== null) params.set('maxDistanceKm', String(state.maxDistanceKm));
  }
  if (state.onlyFree) params.set('free', '1');
  return params.toString();
}

/** CalendarQuery for the given (already window-clamped) range. */
export function toCalendarQuery(state: AppState, range: DateRange): CalendarQuery {
  const query: CalendarQuery = { sport: state.sport, from: range.from, to: range.to };
  if (state.origin) {
    query.lat = state.origin.lat;
    query.lng = state.origin.lng;
    if (state.maxDistanceKm !== null) query.maxDistanceKm = state.maxDistanceKm;
  }
  return query;
}
