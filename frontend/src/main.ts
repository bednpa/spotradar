/** Thin DOM wiring layer; all logic lives in the pure modules. */
import { getSearchWindow, isSportId } from '@spotradar/shared';
import type { CalendarResponse, GeocodeResponse } from '@spotradar/shared';
import {
  Debouncer,
  LISTBOX_ID,
  LatestOnly,
  canSuggest,
  isListboxOpen,
  moveActive,
  optionId,
  renderSuggestionOptions,
  suggestErrorState,
  suggestStateFromResult,
  suggestStatusText,
} from './address-suggest.ts';
import type { SuggestState } from './address-suggest.ts';
import { fetchVenues, geocodeAddress, suggestAddresses } from './api.ts';
import { CalendarCache } from './calendar-data.ts';
import { requestRange, shiftDate } from './calendar-range.ts';
import { renderDateStrip, stripKeyTarget, viewAfterDateSelect } from './date-strip.ts';
import { renderPanel } from './panel.ts';
import { isCalendarView, stateFromSearch, stateToSearch, toCalendarQuery } from './query.ts';
import type { AppState, Origin } from './query.ts';
import {
  renderCalendar,
  renderDistanceChips,
  renderFilters,
  renderLegend,
  renderMainNav,
  renderToolbar,
} from './render.ts';
import { ROUTE_TITLES, isPlainLeftClick, isRoute, routeFromPath, routeUrl } from './router.ts';
import type { Route } from './router.ts';
import {
  calendarErrorState,
  geocodeErrorMessage,
  geolocationErrorMessage,
  isDistanceFilterEnabled,
  locationStatusText,
} from './state.ts';
import type { CalendarState, LocationState } from './state.ts';
import {
  renderVenuesBody,
  renderVenuesControls,
  toVenueQuery,
  venuesErrorMessage,
  venuesFilterFromSearch,
  venuesFilterToSearch,
} from './venues-page.ts';
import type { VenuesFilter, VenuesState } from './venues-page.ts';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const mainNav = byId<HTMLElement>('main-nav');
const mainContent = byId<HTMLElement>('main-content');
const pageCalendar = byId<HTMLElement>('page-calendar');
const pageVenues = byId<HTMLElement>('page-venues');
const filtersRoot = byId<HTMLElement>('filters');
const dateStripRoot = byId<HTMLElement>('date-strip');
const toolbarRoot = byId<HTMLElement>('toolbar');
const calendarRoot = byId<HTMLElement>('calendar');
const legendRoot = byId<HTMLElement>('legend');
const panelRoot = byId<HTMLElement>('panel-root');
const venuesFiltersRoot = byId<HTMLElement>('venues-filters');
const venuesBodyRoot = byId<HTMLElement>('venues-body');

const isWide = (): boolean => window.matchMedia('(min-width: 900px)').matches;

let route: Route = routeFromPath(window.location.pathname);
let state: AppState = stateFromSearch(
  route === 'calendar' ? window.location.search : '',
  new Date(),
  isWide(),
);
let locationState: LocationState = state.origin
  ? { status: 'set', origin: state.origin }
  : { status: 'idle' };
let calendar: CalendarState = { status: 'loading' };
let panel: { date: string; hour: number } | null = null;
let loadToken = 0;
let locationToken = 0;
const cache = new CalendarCache();

// address combobox
let suggest: SuggestState = { status: 'idle' };
let suggestItems: GeocodeResponse[] = [];
let activeOption = -1;
let listOpen = false;
const suggestLatest = new LatestOnly();
const suggestDebounce = new Debouncer();

// venues page
let venuesFilter: VenuesFilter = venuesFilterFromSearch(
  route === 'venues' ? window.location.search : '',
);
let venues: VenuesState = { status: 'loading' };
let venuesToken = 0;
const venuesDebounce = new Debouncer(250);

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

function renderChrome(): void {
  replaceKeepingFocus(toolbarRoot, renderToolbar(state));
  replaceKeepingFocus(dateStripRoot, renderDateStrip(getSearchWindow(new Date()), state.date));
  const strip = dateStripRoot.querySelector<HTMLElement>('[data-strip]');
  const selected = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (strip && selected) {
    strip.scrollLeft = selected.offsetLeft - (strip.clientWidth - selected.offsetWidth) / 2;
  }
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
  for (const chip of byId<HTMLElement>('sport-chips').querySelectorAll<HTMLElement>(
    '[data-sport]',
  )) {
    chip.setAttribute('aria-pressed', String(chip.dataset.sport === state.sport));
  }
  byId<HTMLElement>('distance-chips').innerHTML = renderDistanceChips(
    state.maxDistanceKm,
    isDistanceFilterEnabled(locationState),
  );
  const status = byId<HTMLElement>('location-status');
  status.textContent = locationStatusText(locationState);
  status.classList.toggle('is-error', locationState.status === 'error');
  const busy = locationState.status === 'locating' || locationState.status === 'resolving';
  byId<HTMLButtonElement>('use-location').disabled = busy;
  byId<HTMLButtonElement>('clear-location').hidden = locationState.status !== 'set';
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
  if (route === 'calendar') {
    window.history.replaceState(null, '', routeUrl('calendar', stateToSearch(state)));
  }
}

function refresh(): Promise<void> {
  syncUrl();
  renderChrome();
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
  panelRoot.innerHTML = renderPanel({ date: panel.date, hour: panel.hour, data, now: new Date() });
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

function addressInput(): HTMLInputElement {
  return byId<HTMLInputElement>('address');
}

/** Enter without a selected suggestion: resolve the free text with /api/geocode. */
async function resolveAddress(): Promise<void> {
  const text = addressInput().value.trim();
  if (text === '') {
    setLocation({ status: 'error', message: 'Enter an address first.' });
    return;
  }
  resetSuggestions();
  const token = ++locationToken;
  setLocation({ status: 'resolving' });
  try {
    const place = await geocodeAddress(text);
    if (token !== locationToken) return;
    setLocation({
      status: 'set',
      origin: { lat: place.lat, lng: place.lng, label: place.label, source: 'address' },
    });
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
  resetSuggestions();
  const token = ++locationToken;
  setLocation({ status: 'locating' });
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (token !== locationToken) return;
      addressInput().value = '';
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

function clearLocation(): void {
  ++locationToken;
  addressInput().value = '';
  resetSuggestions();
  setLocation({ status: 'idle' });
  addressInput().focus();
}

// ---------- address suggestions (combobox) ----------

function renderSuggestions(): void {
  const input = addressInput();
  const listbox = byId<HTMLElement>(LISTBOX_ID);
  const open = listOpen && isListboxOpen(suggest);
  listbox.hidden = !open;
  listbox.innerHTML = open ? renderSuggestionOptions(suggestItems, activeOption) : '';
  input.setAttribute('aria-expanded', String(open));
  if (open && activeOption >= 0)
    input.setAttribute('aria-activedescendant', optionId(activeOption));
  else input.removeAttribute('aria-activedescendant');
  const status = byId<HTMLElement>('suggest-status');
  status.textContent = suggestStatusText(suggest);
  status.classList.toggle('is-error', suggest.status === 'error');
}

function setSuggest(next: SuggestState): void {
  suggest = next;
  suggestItems = next.status === 'ready' ? next.items : [];
  activeOption = -1;
  listOpen = next.status === 'ready';
  renderSuggestions();
}

function resetSuggestions(): void {
  suggestDebounce.cancel();
  suggestLatest.cancel();
  setSuggest({ status: 'idle' });
}

async function fetchSuggestions(text: string): Promise<void> {
  const token = suggestLatest.start();
  setSuggest({ status: 'loading' });
  try {
    const items = await suggestAddresses(text);
    if (suggestLatest.isCurrent(token)) setSuggest(suggestStateFromResult(items));
  } catch (error) {
    if (suggestLatest.isCurrent(token)) setSuggest(suggestErrorState(error));
  }
}

function onAddressInput(): void {
  const text = addressInput().value;
  if (text.trim() === '' && state.origin?.source === 'address') {
    ++locationToken;
    setLocation({ status: 'idle' });
  }
  if (!canSuggest(text)) {
    resetSuggestions();
    return;
  }
  suggestDebounce.schedule(() => void fetchSuggestions(addressInput().value.trim()));
}

function selectSuggestion(index: number): void {
  const item = suggestItems[index];
  if (!item) return;
  addressInput().value = item.label;
  resetSuggestions();
  ++locationToken;
  const origin: Origin = { lat: item.lat, lng: item.lng, label: item.label, source: 'address' };
  setLocation({ status: 'set', origin });
}

function onAddressKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      if (suggest.status === 'ready') {
        event.preventDefault();
        listOpen = true;
        activeOption = moveActive(activeOption, event.key, suggestItems.length);
        renderSuggestions();
      }
      break;
    case 'Enter':
      event.preventDefault();
      if (listOpen && activeOption >= 0) selectSuggestion(activeOption);
      else void resolveAddress();
      break;
    case 'Escape':
      if (listOpen) {
        event.preventDefault();
        listOpen = false;
        activeOption = -1;
        renderSuggestions();
      }
      break;
  }
}

// ---------- venues page ----------

function renderVenuesArea(): void {
  venuesBodyRoot.setAttribute('aria-busy', venues.status === 'loading' ? 'true' : 'false');
  venuesBodyRoot.innerHTML = renderVenuesBody(venues, venuesFilter);
}

function syncVenueControls(): void {
  byId<HTMLInputElement>('venue-search').value = venuesFilter.q;
  for (const chip of venuesFiltersRoot.querySelectorAll<HTMLButtonElement>('[data-venue-sport]')) {
    const sport = chip.dataset.venueSport ?? '';
    chip.setAttribute('aria-pressed', String(sport === (venuesFilter.sport ?? '')));
  }
}

async function loadVenues(): Promise<void> {
  const token = ++venuesToken;
  // keep showing the previous list while a refined search loads (no flicker while typing)
  if (venues.status !== 'success') {
    venues = { status: 'loading' };
    renderVenuesArea();
  }
  try {
    const data = await fetchVenues(toVenueQuery(venuesFilter));
    if (token === venuesToken) venues = { status: 'success', data };
  } catch (error) {
    if (token === venuesToken) venues = { status: 'error', message: venuesErrorMessage(error) };
  }
  if (token === venuesToken) renderVenuesArea();
}

function setVenuesFilter(patch: Partial<VenuesFilter>, immediate: boolean): void {
  venuesFilter = { ...venuesFilter, ...patch };
  if (route === 'venues') {
    window.history.replaceState(null, '', routeUrl('venues', venuesFilterToSearch(venuesFilter)));
  }
  if (immediate) {
    venuesDebounce.cancel();
    void loadVenues();
  } else venuesDebounce.schedule(() => void loadVenues());
}

// ---------- routing ----------

function currentSearch(target: Route): string {
  return target === 'calendar' ? stateToSearch(state) : venuesFilterToSearch(venuesFilter);
}

function applyRoute(moveFocus: boolean): void {
  closePanel(false);
  mainNav.innerHTML = renderMainNav(route);
  pageCalendar.hidden = route !== 'calendar';
  pageVenues.hidden = route !== 'venues';
  document.title = ROUTE_TITLES[route];
  if (route === 'calendar') {
    void refresh();
  } else {
    syncVenueControls();
    window.history.replaceState(null, '', routeUrl('venues', venuesFilterToSearch(venuesFilter)));
    void loadVenues();
  }
  if (moveFocus) mainContent.focus({ preventScroll: true });
}

function navigate(target: Route): void {
  if (target === route) return;
  window.history.pushState(null, '', routeUrl(target, currentSearch(target)));
  route = target;
  applyRoute(true);
}

window.addEventListener('popstate', () => {
  route = routeFromPath(window.location.pathname);
  if (route === 'calendar') {
    state = stateFromSearch(window.location.search, new Date(), isWide());
    locationState = state.origin ? { status: 'set', origin: state.origin } : { status: 'idle' };
    ++locationToken;
    if (!state.origin) addressInput().value = '';
  } else {
    venuesFilter = venuesFilterFromSearch(window.location.search);
  }
  applyRoute(false);
});

// ---------- events ----------

// The static filter controls are rendered once, before any listener looks them up.
filtersRoot.innerHTML = renderFilters(state, locationState);
venuesFiltersRoot.innerHTML = renderVenuesControls(venuesFilter);

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
    case 'retry-venues':
      void loadVenues();
      break;
    case 'clear-venue-filters':
      setVenuesFilter({ q: '', sport: null }, true);
      syncVenueControls();
      break;
    case 'clear-distance':
      void setState({ maxDistanceKm: null });
      break;
    case 'pick-date':
      if (target.dataset.date)
        void setState({
          date: target.dataset.date,
          view: viewAfterDateSelect(state.view, isWide()),
        });
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

  // close the suggestions when clicking elsewhere
  if (listOpen && !target.closest('.combo')) {
    listOpen = false;
    activeOption = -1;
    renderSuggestions();
  }

  const link = target.closest<HTMLAnchorElement>('a[data-route]');
  if (link && isRoute(link.dataset.route) && isPlainLeftClick(event)) {
    event.preventDefault();
    navigate(link.dataset.route);
    return;
  }

  const option = target.closest<HTMLElement>('[role="option"][data-index]');
  if (option) {
    selectSuggestion(Number(option.dataset.index));
    return;
  }
  const sportId = target.closest<HTMLElement>('[data-sport]')?.dataset.sport;
  if (isSportId(sportId)) {
    void setState({ sport: sportId });
    return;
  }
  const venueSport = target.closest<HTMLElement>('[data-venue-sport]');
  if (venueSport) {
    const value = venueSport.dataset.venueSport;
    setVenuesFilter({ sport: isSportId(value) ? value : null }, true);
    syncVenueControls();
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
  const button = target.closest('button');
  if (button?.id === 'use-location') {
    useMyLocation();
    return;
  }
  if (button?.id === 'clear-location') {
    clearLocation();
    return;
  }
  const actionEl = target.closest<HTMLElement>('[data-action]');
  if (actionEl?.dataset.action) onAction(actionEl.dataset.action, actionEl);
});

// keep the focus in the input when an option is pressed
byId<HTMLElement>(LISTBOX_ID).addEventListener('mousedown', (event) => event.preventDefault());

addressInput().addEventListener('input', onAddressInput);
addressInput().addEventListener('keydown', onAddressKeydown);
addressInput().addEventListener('focus', () => {
  if (suggest.status === 'ready' && !listOpen) {
    listOpen = true;
    renderSuggestions();
  }
});

byId<HTMLInputElement>('venue-search').addEventListener('input', (event) => {
  const input = event.target;
  if (input instanceof HTMLInputElement) setVenuesFilter({ q: input.value }, false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && panel) {
    event.preventDefault();
    closePanel(true);
    return;
  }
  if (event.key === 'Tab' && panel) {
    // Content of a collapsed <details> cannot take focus (only its summary can).
    const focusable = Array.from(
      panelRoot.querySelectorAll<HTMLElement>(
        '.detail a[href], .detail button:not(:disabled), .detail summary',
      ),
    ).filter((el) => el.tagName === 'SUMMARY' || !el.closest('details:not([open])'));
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
  if (!(target instanceof HTMLElement)) return;

  if (target.matches('.day-pill')) {
    const pills = Array.from(dateStripRoot.querySelectorAll<HTMLElement>('.day-pill'));
    const next = stripKeyTarget(event.key, pills.indexOf(target), pills.length);
    if (next !== null) {
      event.preventDefault();
      pills[next]?.focus();
    }
    return;
  }

  if (!target.matches('.cell')) return;
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

applyRoute(false);
