/** Thin DOM wiring layer; all logic lives in the pure modules. */
import type { SearchQuery } from '@spotradar/shared';
import { geocodeAddress, searchCourts } from './api.ts';
import {
  buildSearchQuery,
  formFromQueryString,
  getDefaultFormValues,
  queryToSearchParams,
} from './query.ts';
import type { FormValues, Origin } from './query.ts';
import { renderDateChips, renderDistanceChips, renderResults, renderSearchForm } from './render.ts';
import {
  geocodeErrorMessage,
  geolocationErrorMessage,
  isDistanceFilterEnabled,
  locationStatusText,
  searchErrorState,
  searchInvalidState,
} from './state.ts';
import type { LocationState, SearchState } from './state.ts';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const searchRoot = byId<HTMLElement>('search-root');
const resultsEl = byId<HTMLElement>('results');

const now = new Date();
const restored = formFromQueryString(window.location.search, now);
let values: FormValues = restored ?? getDefaultFormValues(now);
let location: LocationState = values.origin
  ? { status: 'set', origin: values.origin }
  : { status: 'idle' };
let searchToken = 0;
let locationToken = 0;
/** The address text that `values.origin` was resolved from. */
let resolvedAddress = '';

searchRoot.innerHTML = renderSearchForm({ values, location, now });

const form = byId<HTMLFormElement>('search-form');
const submitButton = byId<HTMLButtonElement>('search-submit');
const dateInput = byId<HTMLInputElement>('date');
const timeInput = byId<HTMLInputElement>('time');
const sportSelect = byId<HTMLSelectElement>('sport');
const addressInput = byId<HTMLInputElement>('address');
const locationButton = byId<HTMLButtonElement>('use-location');
const addressButton = byId<HTMLButtonElement>('find-address');
const locationStatus = byId<HTMLElement>('location-status');
const dateChips = byId<HTMLElement>('date-chips');
const distanceChips = byId<HTMLElement>('distance-chips');

function replaceChips(container: HTMLElement, html: string): void {
  const active = document.activeElement;
  const focusedKey =
    active instanceof HTMLElement && container.contains(active)
      ? { date: active.dataset.date, km: active.dataset.km }
      : null;
  container.innerHTML = html;
  if (!focusedKey) return;
  const selector =
    focusedKey.date !== undefined
      ? `[data-date="${focusedKey.date}"]`
      : `[data-km="${focusedKey.km}"]`;
  container.querySelector<HTMLElement>(selector)?.focus();
}

function syncChips(): void {
  replaceChips(dateChips, renderDateChips(values.date, now));
  replaceChips(
    distanceChips,
    renderDistanceChips(values.maxDistanceKm, isDistanceFilterEnabled(location)),
  );
}

function setLocation(next: LocationState): void {
  location = next;
  values = {
    ...values,
    origin: next.status === 'set' ? next.origin : null,
    maxDistanceKm: next.status === 'set' ? values.maxDistanceKm : '',
  };
  locationStatus.textContent = locationStatusText(next);
  locationStatus.classList.toggle('is-error', next.status === 'error');
  locationButton.disabled = next.status === 'locating';
  addressButton.disabled = next.status === 'resolving';
  syncChips();
}

// ---------- search ----------

function setSearch(next: SearchState): void {
  resultsEl.innerHTML = renderResults(next, new Date());
  resultsEl.setAttribute('aria-busy', next.status === 'loading' ? 'true' : 'false');
  submitButton.disabled = next.status === 'loading';
}

async function runSearch(query: SearchQuery): Promise<void> {
  const token = ++searchToken;
  window.history.replaceState(null, '', `?${queryToSearchParams(query).toString()}`);
  setSearch({ status: 'loading' });
  try {
    const response = await searchCourts(query);
    if (token === searchToken) setSearch({ status: 'success', response });
  } catch (error) {
    if (token === searchToken) setSearch(searchErrorState(error));
  }
}

function readInputs(): void {
  values = { ...values, sport: sportSelect.value, date: dateInput.value, time: timeInput.value };
}

/** Resolves the typed address; returns true when an origin was set. */
async function resolveAddress(): Promise<boolean> {
  const text = addressInput.value.trim();
  if (text === '') {
    setLocation({ status: 'error', message: 'Enter an address first.' });
    return false;
  }
  const token = ++locationToken;
  setLocation({ status: 'resolving' });
  try {
    const place = await geocodeAddress(text);
    if (token !== locationToken) return false;
    resolvedAddress = text;
    const origin: Origin = {
      lat: place.lat,
      lng: place.lng,
      label: place.label,
      source: 'address',
    };
    setLocation({ status: 'set', origin });
    return true;
  } catch (error) {
    if (token === locationToken)
      setLocation({ status: 'error', message: geocodeErrorMessage(error) });
    return false;
  }
}

async function submitSearch(): Promise<void> {
  readInputs();
  const typed = addressInput.value.trim();
  if (typed !== '' && typed !== resolvedAddress) {
    const ok = await resolveAddress();
    if (!ok) return;
  }
  const result = buildSearchQuery(values);
  if (!result.ok) {
    setSearch(searchInvalidState(result.issues));
    return;
  }
  void runSearch(result.value);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitSearch();
});

// ---------- date / time / distance ----------

form.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const dateChip = target.closest<HTMLElement>('[data-date]');
  if (dateChip?.dataset.date) {
    values = { ...values, date: dateChip.dataset.date };
    dateInput.value = values.date;
    syncChips();
    return;
  }
  const kmChip = target.closest<HTMLButtonElement>('[data-km]');
  if (kmChip && !kmChip.disabled) {
    values = { ...values, maxDistanceKm: kmChip.dataset.km ?? '' };
    syncChips();
  }
});

dateInput.addEventListener('change', () => {
  values = { ...values, date: dateInput.value };
  syncChips();
});

timeInput.addEventListener('change', () => {
  values = { ...values, time: timeInput.value };
});

byId<HTMLButtonElement>('clear-time').addEventListener('click', () => {
  timeInput.value = '';
  values = { ...values, time: '' };
  timeInput.focus();
});

// ---------- origin ----------

locationButton.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    setLocation({ status: 'error', message: geolocationErrorMessage(2) });
    return;
  }
  const token = ++locationToken;
  setLocation({ status: 'locating' });
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (token !== locationToken) return;
      addressInput.value = '';
      resolvedAddress = '';
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
});

addressButton.addEventListener('click', () => void resolveAddress());

addressInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void submitSearch();
  }
});

addressInput.addEventListener('input', () => {
  if (addressInput.value.trim() === '' && values.origin?.source === 'address') {
    resolvedAddress = '';
    setLocation({ status: 'idle' });
  }
});

// ---------- start ----------

setSearch({ status: 'idle' });
if (restored) {
  const initial = buildSearchQuery(values);
  if (initial.ok) void runSearch(initial.value);
}
