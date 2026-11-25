/** App state ↔ URL query string ↔ CalendarQuery. Pure functions. */
import {
  CALENDAR_VIEWS,
  DEFAULT_SPORT_ID,
  MAX_DISTANCE_KM,
  getSearchWindow,
  isSportId,
  isValidDate,
} from '@spotradar/shared';
import type { CalendarQuery, CalendarView, MultisportCards, SportId } from '@spotradar/shared';
import type { DateRange } from './calendar-range.ts';
import { DEFAULT_CARDS, DEFAULT_SORT, parseCards, parseSort } from './sorting.ts';
import type { SortMode } from './sorting.ts';

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
  origin: Origin | null;
  /** Only with an origin. */
  maxDistanceKm: number | null;
  /** Order of the venue lists (slot panel); shared with the venues page. */
  sort: SortMode;
  /** MultiSport cards used for one court (0–4); shared with the venues page. */
  cards: MultisportCards;
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
    origin: null,
    maxDistanceKm: null,
    sort: DEFAULT_SORT,
    cards: DEFAULT_CARDS,
  };
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
    origin,
    maxDistanceKm: origin && km !== null && km > 0 && km <= MAX_DISTANCE_KM ? km : null,
    sort: parseSort(params.get('sort')),
    cards: parseCards(params.get('cards')),
  };
}

/** State → query string without the leading "?". View, date and sport are always present. */
export function stateToSearch(state: AppState): string {
  const params = new URLSearchParams();
  params.set('view', state.view);
  params.set('date', state.date);
  params.set('sport', state.sport);
  if (state.origin) {
    params.set('lat', String(state.origin.lat));
    params.set('lng', String(state.origin.lng));
    if (state.maxDistanceKm !== null) params.set('maxDistanceKm', String(state.maxDistanceKm));
  }
  if (state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
  if (state.cards !== DEFAULT_CARDS) params.set('cards', String(state.cards));
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
