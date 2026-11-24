/** Thin DOM wiring layer; all logic lives in the pure modules. */
import { getBookingWindow } from '@spotradar/shared';
import type { AvailabilityQuery } from '@spotradar/shared';
import { createReservation, searchAvailability } from './api.ts';
import { buildSearchQuery, getDefaultFormValues } from './query.ts';
import type { SearchFormValues } from './query.ts';
import { renderReservationDialog, renderResults, renderSearchForm } from './render.ts';
import {
  CLOSED_RESERVATION,
  buildReservationTarget,
  geolocationErrorMessage,
  isDistanceFilterEnabled,
  locationStatusText,
  locationToFormValues,
  openReservation,
  reservationFailed,
  reservationInvalid,
  reservationSubmitting,
  reservationSucceeded,
  searchErrorState,
  searchInvalidState,
  validateReservationForm,
} from './state.ts';
import type { LocationState, ReservationState, SearchState } from './state.ts';

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const searchRoot = byId<HTMLElement>('search-root');
const resultsEl = byId<HTMLElement>('results');
const dialog = byId<HTMLDialogElement>('reservation-dialog');

let userLocation: LocationState = { status: 'idle' };
let search: SearchState = { status: 'idle' };
let reservation: ReservationState = CLOSED_RESERVATION;
let lastQuery: AvailabilityQuery | null = null;
let searchToken = 0;

const now = new Date();
const bookingWindow = getBookingWindow(now);
searchRoot.innerHTML = renderSearchForm({
  values: getDefaultFormValues(now),
  location: userLocation,
  minDate: bookingWindow.from,
  maxDate: bookingWindow.to,
});

const form = byId<HTMLFormElement>('search-form');
const submitButton = byId<HTMLButtonElement>('search-submit');
const locationButton = byId<HTMLButtonElement>('use-location');
const locationStatus = byId<HTMLElement>('location-status');
const maxDistance = byId<HTMLSelectElement>('max-distance');

// ---------- search ----------

function setSearch(next: SearchState): void {
  search = next;
  resultsEl.innerHTML = renderResults(next);
  resultsEl.setAttribute('aria-busy', next.status === 'loading' ? 'true' : 'false');
  submitButton.disabled = next.status === 'loading';
}

async function runSearch(query: AvailabilityQuery): Promise<void> {
  lastQuery = query;
  const token = ++searchToken;
  setSearch({ status: 'loading' });
  try {
    const response = await searchAvailability(query);
    if (token === searchToken) setSearch({ status: 'success', response });
  } catch (error) {
    if (token === searchToken) setSearch(searchErrorState(error));
  }
}

function readFormValues(): SearchFormValues {
  const data = new FormData(form);
  const text = (name: string): string => {
    const value = data.get(name);
    return typeof value === 'string' ? value : '';
  };
  const coords = locationToFormValues(userLocation);
  return {
    sport: text('sport'),
    date: text('date'),
    time: text('time'),
    durationMinutes: text('durationMinutes'),
    lat: coords.lat,
    lng: coords.lng,
    maxDistanceKm: isDistanceFilterEnabled(userLocation) ? text('maxDistanceKm') : '',
  };
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = buildSearchQuery(readFormValues());
  if (!result.ok) {
    setSearch(searchInvalidState(result.issues));
    return;
  }
  void runSearch(result.value);
});

// ---------- location ----------

function setLocation(next: LocationState): void {
  userLocation = next;
  locationStatus.textContent = locationStatusText(next);
  locationButton.disabled = next.status === 'locating';
  maxDistance.disabled = !isDistanceFilterEnabled(next);
  if (maxDistance.disabled) maxDistance.value = '';
}

locationButton.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    setLocation({ status: 'error', message: geolocationErrorMessage(2) });
    return;
  }
  setLocation({ status: 'locating' });
  navigator.geolocation.getCurrentPosition(
    (position) =>
      setLocation({
        status: 'set',
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }),
    (error) => setLocation({ status: 'error', message: geolocationErrorMessage(error.code) }),
    { timeout: 10_000, maximumAge: 60_000 },
  );
});

// ---------- reservation ----------

function setReservation(next: ReservationState): void {
  reservation = next;
  dialog.innerHTML = renderReservationDialog(next);
  if (next.status === 'closed') {
    if (dialog.open) dialog.close();
    return;
  }
  if (!dialog.open) dialog.showModal();
  if (next.status === 'editing') {
    dialog.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }
}

resultsEl.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLElement>('[data-action="reserve"]');
  if (!button || search.status !== 'success') return;
  const { venueId, courtId } = button.dataset;
  const { response } = search;
  const result = response.results.find((r) => r.venue.id === venueId);
  const court = result?.availableCourts.find((c) => c.id === courtId);
  if (!result || !court) return;
  setReservation(openReservation(buildReservationTarget(response.query, result, court)));
});

async function submitReservation(): Promise<void> {
  if (reservation.status !== 'editing') return;
  const data = new FormData(byId<HTMLFormElement>('reservation-form'));
  const values = {
    customerName: String(data.get('customerName') ?? ''),
    customerEmail: String(data.get('customerEmail') ?? ''),
  };
  const validation = validateReservationForm(reservation.target, values);
  if (!validation.ok) {
    setReservation(reservationInvalid(reservation, values, validation.fieldErrors));
    return;
  }
  setReservation(reservationSubmitting(reservation, values));
  try {
    const created = await createReservation(validation.request);
    setReservation(reservationSucceeded(reservation, created));
    // Refresh results so the booked court disappears.
    if (lastQuery) void runSearch(lastQuery);
  } catch (error) {
    setReservation(reservationFailed(reservation, error));
  }
}

dialog.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitReservation();
});

dialog.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'cancel' || action === 'close') {
    setReservation(CLOSED_RESERVATION);
  } else if (action === 'refresh') {
    setReservation(CLOSED_RESERVATION);
    if (lastQuery) void runSearch(lastQuery);
  }
});

// Don't let Escape close the dialog while the reservation request is in flight.
dialog.addEventListener('cancel', (event) => {
  if (reservation.status === 'submitting') event.preventDefault();
});

// Escape key closes the native dialog; keep our state in sync.
dialog.addEventListener('close', () => {
  if (reservation.status !== 'closed' && reservation.status !== 'submitting') {
    reservation = CLOSED_RESERVATION;
    dialog.innerHTML = '';
  }
});

setSearch({ status: 'idle' });
