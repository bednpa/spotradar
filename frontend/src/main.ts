/** Thin DOM wiring layer; all logic lives in the pure modules. */
import { CALENDAR_MAX_DAYS, getSearchWindow, isSportId } from '@spotradar/shared';
import type { CalendarResponse } from '@spotradar/shared';
import { geocodeAddress } from './api.ts';
import { CalendarCache } from './calendar-data.ts';
import { requestRange, shiftDate } from './calendar-range.ts';
import { findNextFree } from './cells.ts';
import { formatShortDate, hourLabel } from './format.ts';
import { renderPanel } from './panel.ts';
import {
  isCalendarView,
  parseGotoDate,
  stateFromSearch,
  stateToSearch,
  toCalendarQuery,
} from './query.ts';
import type { AppState, Origin } from './query.ts';
import {
  renderCalendar,
  renderDistanceChips,
  renderFilters,
  renderLegend,
  renderSportNav,
  renderToolbar,
} from './render.ts';
import {
  calendarErrorState,
  geocodeErrorMessage,
  geolocationErrorMessage,
  isDistanceFilterEnabled,
  locationStatusText,
} from './state.ts';
import type { CalendarState, LocationState } from './state.ts';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const sportNav = byId<HTMLElement>('sport-nav');
const filtersRoot = byId<HTMLElement>('filters');
const toolbarRoot = byId<HTMLElement>('toolbar');
const calendarRoot = byId<HTMLElement>('calendar');
const legendRoot = byId<HTMLElement>('legend');
const panelRoot = byId<HTMLElement>('panel-root');

const wide = window.matchMedia('(min-width: 900px)').matches;
let state: AppState = stateFromSearch(window.location.search, new Date(), wide);
let locationState: LocationState = state.origin
  ? { status: 'set', origin: state.origin }
  : { status: 'idle' };
let calendar: CalendarState = { status: 'loading' };
let panel: { date: string; hour: number } | null = null;
let loadToken = 0;
let locationToken = 0;
const cache = new CalendarCache();

// ---------- rendering ----------

function currentData(): CalendarResponse | null {
  return calendar.status === 'success' ? calendar.data : null;
}

/** Re-renders `root`, keeping keyboard focus on the element with the same data-key. */
function replaceKeepingFocus(root: HTMLElement, html: string): void {
  const active = document.activeElement;
  const key =
    active instanceof HTMLElement && root.contains(active) ? (active.dataset.key ?? null) : null;
  root.innerHTML = html;
  if (key === null) return;
  const next = Array.from(root.querySelectorAll<HTMLElement>('[data-key]')).find(
    (element) => element.dataset.key === key,
  );
  next?.focus();
}

function renderToolbarAndSport(): void {
  replaceKeepingFocus(toolbarRoot, renderToolbar(state));
  sportNav.innerHTML = renderSportNav(state.sport);
}

function renderCalendarArea(): void {
  const now = new Date();
  calendarRoot.setAttribute('aria-busy', calendar.status === 'loading' ? 'true' : 'false');
  replaceKeepingFocus(calendarRoot, renderCalendar(state, calendar, now));
  const data = currentData();
  if (data) legendRoot.innerHTML = renderLegend(data);
  if (panel) {
    if (data?.days.some((day) => day.date === panel?.date)) {
      renderPanelContent(false);
    } else closePanel(false);
  }
}

function syncFilterControls(): void {
  byId<HTMLInputElement>('goto-date').value = state.date;
  byId<HTMLSelectElement>('from-hour').value = String(state.fromHour);
  byId<HTMLSelectElement>('to-hour').value = String(state.toHour);
  byId<HTMLInputElement>('only-free').checked = state.onlyFree;
  byId<HTMLElement>('distance-chips').innerHTML = renderDistanceChips(
    state.maxDistanceKm,
    isDistanceFilterEnabled(locationState),
  );
  const status = byId<HTMLElement>('location-status');
  status.textContent = locationStatusText(locationState);
  status.classList.toggle('is-error', locationState.status === 'error');
  const busy = locationState.status === 'locating' || locationState.status === 'resolving';
  byId<HTMLButtonElement>('use-location').disabled = busy;
  byId<HTMLButtonElement>('find-address').disabled = busy;
}

// ---------- data ----------

/** Loads the data for the current view (served from the cache when possible). */
async function load(fresh = false): Promise<void> {
  const token = ++loadToken;
  const range = requestRange(state.view, state.date, getSearchWindow(new Date()));
  if (range === null) {
    calendar = { status: 'outside' };
    renderCalendarArea();
    return;
  }
  const query = toCalendarQuery(state, range);
  const cached = fresh ? null : cache.peek(query);
  if (cached) {
    calendar = { status: 'success', data: cached };
    renderCalendarArea();
    return;
  }
  calendar = { status: 'loading' };
  renderCalendarArea();
  try {
    const data = await cache.get(query, { fresh });
    if (token === loadToken) calendar = { status: 'success', data };
  } catch (error) {
    if (token === loadToken) calendar = calendarErrorState(error);
  }
  if (token === loadToken) renderCalendarArea();
}

function syncUrl(): void {
  window.history.replaceState(null, '', `?${stateToSearch(state)}`);
}

function refresh(): Promise<void> {
  syncUrl();
  renderToolbarAndSport();
  syncFilterControls();
  return load();
}

function setState(patch: Partial<AppState>, closePanelFirst = true): Promise<void> {
  if (closePanelFirst) closePanel(false);
  state = { ...state, ...patch };
  return refresh();
}

// ---------- detail panel ----------

/** Everything behind the modal panel (header, main, footer, skip link). */
function setBackgroundInert(inert: boolean): void {
  for (const element of document.querySelectorAll<HTMLElement>('body > *')) {
    if (element !== panelRoot && element.tagName !== 'SCRIPT') element.inert = inert;
  }
}

function renderPanelContent(focus: boolean): void {
  const data = currentData();
  if (!panel || !data) return;
  panelRoot.innerHTML = renderPanel({ date: panel.date, hour: panel.hour, data });
  panelRoot.hidden = false;
  setBackgroundInert(true);
  if (focus) panelRoot.querySelector<HTMLElement>('.detail')?.focus();
}

function openPanel(date: string, hour: number): void {
  panel = { date, hour };
  renderPanelContent(true);
}

function closePanel(restoreFocus: boolean): void {
  if (!panel) return;
  const key = `cell-${panel.date}-${panel.hour}`;
  panel = null;
  panelRoot.innerHTML = '';
  panelRoot.hidden = true;
  setBackgroundInert(false);
  if (!restoreFocus) return;
  Array.from(document.querySelectorAll<HTMLElement>('[data-key]'))
    .find((element) => element.dataset.key === key)
    ?.focus();
}

// ---------- location ----------

function setLocation(next: LocationState): void {
  locationState = next;
  const origin = next.status === 'set' ? next.origin : null;
  const changed = origin?.lat !== state.origin?.lat || origin?.lng !== state.origin?.lng;
  if (next.status === 'locating' || next.status === 'resolving' || next.status === 'error') {
    // keep the current origin while resolving / after a failure; only update the status text
    syncFilterControls();
    return;
  }
  state = { ...state, origin, maxDistanceKm: origin ? state.maxDistanceKm : null };
  closePanel(false);
  if (changed) void refresh();
  else syncFilterControls();
}

async function resolveAddress(): Promise<void> {
  const input = byId<HTMLInputElement>('address');
  const text = input.value.trim();
  if (text === '') {
    setLocation({ status: 'error', message: 'Enter an address first.' });
    return;
  }
  const token = ++locationToken;
  setLocation({ status: 'resolving' });
  try {
    const place = await geocodeAddress(text);
    if (token !== locationToken) return;
    const origin: Origin = {
      lat: place.lat,
      lng: place.lng,
      label: place.label,
      source: 'address',
    };
    setLocation({ status: 'set', origin });
  } catch (error) {
    if (token === locationToken)
      setLocation({ status: 'error', message: geocodeErrorMessage(error) });
  }
}

function useMyLocation(): void {
  if (!('geolocation' in navigator)) {
    setLocation({ status: 'error', message: geolocationErrorMessage(2) });
    return;
  }
  const token = ++locationToken;
  setLocation({ status: 'locating' });
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (token !== locationToken) return;
      byId<HTMLInputElement>('address').value = '';
      setLocation({
        status: 'set',
        origin: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          label: 'Your location',
          source: 'geolocation',
        },
      });
    },
    (error) => {
      if (token === locationToken)
        setLocation({ status: 'error', message: geolocationErrorMessage(error.code) });
    },
    { timeout: 10_000, maximumAge: 60_000 },
  );
}

// ---------- next free court ----------

async function goToNextFree(): Promise<void> {
  const status = byId<HTMLElement>('next-free-status');
  const button = byId<HTMLButtonElement>('next-free');
  const window = getSearchWindow(new Date());
  // Snapshot: every state change creates a new object, so identity detects "user changed something".
  const snapshot = state;
  status.textContent = 'Looking for the next free court…';
  button.disabled = true;
  try {
    const data = await cache.get(toCalendarQuery(snapshot, window));
    if (state !== snapshot) {
      status.textContent = '';
      return;
    }
    const found = findNextFree(data, new Date(), snapshot.fromHour, snapshot.toHour);
    if (!found) {
      status.textContent = `No free court found in the next ${CALENDAR_MAX_DAYS} days.`;
      return;
    }
    const loading = setState({ view: 'day', date: found.date });
    const jumped = state;
    await loading;
    if (state !== jumped) {
      status.textContent = '';
      return;
    }
    const loaded = currentData();
    if (!loaded?.days.some((day) => day.date === found.date)) {
      status.textContent = "Couldn't load that day. Please try again.";
      return;
    }
    openPanel(found.date, found.hour);
    status.textContent = `Next free court: ${formatShortDate(found.date)}, ${hourLabel(found.hour)}`;
  } catch (error) {
    const failed = calendarErrorState(error);
    status.textContent = failed.status === 'error' ? failed.message : 'Something went wrong.';
  } finally {
    button.disabled = false;
  }
}

// ---------- events ----------

function onAction(action: string, target: HTMLElement): void {
  const today = getSearchWindow(new Date()).from;
  switch (action) {
    case 'today':
      void setState({ date: today });
      break;
    case 'prev':
    case 'next':
      void setState({ date: shiftDate(state.view, state.date, action === 'prev' ? -1 : 1, today) });
      break;
    case 'retry':
      void load(true);
      break;
    case 'clear-distance':
      void setState({ maxDistanceKm: null });
      break;
    case 'open-slot': {
      const { date, hour } = target.dataset;
      if (date !== undefined && hour !== undefined) openPanel(date, Number(hour));
      break;
    }
    case 'open-day':
      if (target.dataset.date) void setState({ view: 'day', date: target.dataset.date });
      break;
    case 'open-month':
      if (target.dataset.date) void setState({ view: 'month', date: target.dataset.date });
      break;
    case 'close-panel':
      closePanel(true);
      break;
  }
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const sportId = target.closest<HTMLElement>('[data-sport]')?.dataset.sport;
  if (isSportId(sportId)) {
    void setState({ sport: sportId });
    return;
  }
  const viewId = target.closest<HTMLElement>('[data-view]')?.dataset.view;
  if (isCalendarView(viewId)) {
    void setState({ view: viewId });
    return;
  }
  const km = target.closest<HTMLButtonElement>('[data-km]');
  if (km && !km.disabled) {
    void setState({ maxDistanceKm: km.dataset.km ? Number(km.dataset.km) : null }, false);
    return;
  }
  const actionEl = target.closest<HTMLElement>('[data-action]');
  if (actionEl?.dataset.action) onAction(actionEl.dataset.action, actionEl);
});

filtersRoot.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('button');
  if (button?.id === 'find-address') void resolveAddress();
  else if (button?.id === 'use-location') useMyLocation();
  else if (button?.id === 'next-free') void goToNextFree();
});

filtersRoot.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  switch (target.id) {
    case 'goto-date': {
      const date = parseGotoDate(target.value, new Date());
      if (date !== null) void setState({ date });
      else target.value = state.date; // ignore invalid / out-of-window input
      break;
    }
    case 'from-hour': {
      const fromHour = Number(target.value);
      void setState({ fromHour, toHour: Math.max(state.toHour, fromHour + 1) }, false);
      break;
    }
    case 'to-hour': {
      const toHour = Number(target.value);
      void setState({ toHour, fromHour: Math.min(state.fromHour, toHour - 1) }, false);
      break;
    }
    case 'only-free':
      if (target instanceof HTMLInputElement) void setState({ onlyFree: target.checked }, false);
      break;
  }
});

filtersRoot.addEventListener('keydown', (event) => {
  if (
    event.key === 'Enter' &&
    event.target instanceof HTMLInputElement &&
    event.target.id === 'address'
  ) {
    event.preventDefault();
    void resolveAddress();
  }
});

filtersRoot.addEventListener('input', (event) => {
  const target = event.target;
  if (
    target instanceof HTMLInputElement &&
    target.id === 'address' &&
    target.value.trim() === '' &&
    state.origin?.source === 'address'
  ) {
    ++locationToken;
    setLocation({ status: 'idle' });
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && panel) {
    event.preventDefault();
    closePanel(true);
    return;
  }
  if (event.key === 'Tab' && panel) {
    const focusable = Array.from(
      panelRoot.querySelectorAll<HTMLElement>('.detail a[href], .detail button:not(:disabled)'),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const dialog = panelRoot.querySelector<HTMLElement>('.detail');
    if (first && last) {
      if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches('.cell')) return;
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const delta = deltas[event.key];
  if (!delta) return;
  let col = Number(target.dataset.col) + delta[0];
  let row = Number(target.dataset.row) + delta[1];
  const cells = Array.from(calendarRoot.querySelectorAll<HTMLButtonElement>('.cell'));
  for (let step = 0; step < 30; step++, col += delta[0], row += delta[1]) {
    const next = cells.find((c) => Number(c.dataset.col) === col && Number(c.dataset.row) === row);
    if (!next) return;
    if (!next.disabled) {
      event.preventDefault();
      next.focus();
      return;
    }
  }
});

// ---------- start ----------

filtersRoot.innerHTML = renderFilters(state, locationState);
renderToolbarAndSport();
syncUrl();
void load();
