/** Pure HTML-string renderers. Every dynamic string is escaped. */
import { DISTANCE_OPTIONS_KM, DURATIONS_MINUTES, SPORTS } from '@spotradar/shared';
import type { AvailabilityResult, ValidationIssue } from '@spotradar/shared';
import {
  formatCzk,
  formatDateLabel,
  formatDistance,
  formatDuration,
  formatOpeningHours,
  formatPrice,
  formatTimeRange,
} from './format.ts';
import { TIME_OPTIONS } from './query.ts';
import type { SearchFormValues } from './query.ts';
import { isDistanceFilterEnabled, locationStatusText } from './state.ts';
import type { LocationState, ReservationState, ReservationTarget, SearchState } from './state.ts';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function option(value: string, label: string, selected: boolean): string {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

// ---------- search form ----------

export interface SearchFormOptions {
  values: SearchFormValues;
  location: LocationState;
  /** Booking window (min/max of the date input). */
  minDate: string;
  maxDate: string;
}

export function renderSearchForm(options: SearchFormOptions): string {
  const { values, location, minDate, maxDate } = options;
  const sports = SPORTS.map((s) => option(s.id, s.name, s.id === values.sport)).join('');
  const times = TIME_OPTIONS.map((t) => option(t, t, t === values.time)).join('');
  const durations = DURATIONS_MINUTES.map((d) =>
    option(String(d), formatDuration(d), String(d) === values.durationMinutes),
  ).join('');
  const distances = [
    option('', 'Any distance', values.maxDistanceKm === ''),
    ...DISTANCE_OPTIONS_KM.map((km) =>
      option(String(km), `Within ${km} km`, String(km) === values.maxDistanceKm),
    ),
  ].join('');
  const distanceDisabled = isDistanceFilterEnabled(location) ? '' : ' disabled';

  return `<form id="search-form" class="search-form" aria-label="Search courts" novalidate>
  <div class="field">
    <label for="sport">Sport</label>
    <select id="sport" name="sport">${sports}</select>
  </div>
  <div class="field">
    <label for="date">Date</label>
    <input id="date" name="date" type="date" required min="${escapeHtml(minDate)}" max="${escapeHtml(maxDate)}" value="${escapeHtml(values.date)}">
  </div>
  <div class="field">
    <label for="time">Start time</label>
    <select id="time" name="time">${times}</select>
  </div>
  <div class="field">
    <label for="duration">Duration</label>
    <select id="duration" name="durationMinutes">${durations}</select>
  </div>
  <div class="field field-location">
    <button type="button" id="use-location" class="button-secondary">Use my location</button>
    <p id="location-status" class="hint">${escapeHtml(locationStatusText(location))}</p>
  </div>
  <div class="field">
    <label for="max-distance">Max distance</label>
    <select id="max-distance" name="maxDistanceKm"${distanceDisabled}>${distances}</select>
  </div>
  <div class="field field-submit">
    <button type="submit" id="search-submit" class="button-primary">Search</button>
  </div>
</form>`;
}

// ---------- results ----------

function renderIssues(issues: ValidationIssue[]): string {
  if (issues.length === 0) return '';
  const items = issues
    .map((i) => `<li><strong>${escapeHtml(i.field)}</strong>: ${escapeHtml(i.message)}</li>`)
    .join('');
  return `<ul class="issues">${items}</ul>`;
}

function renderCourt(result: AvailabilityResult, court: AvailabilityResult['availableCourts'][number]): string {
  const label = `Reserve ${court.name} at ${result.venue.name}`;
  const meta = `${court.indoor ? 'Indoor' : 'Outdoor'} · ${court.surface}`;
  return `<li class="court">
        <span class="court-info"><span class="court-name">${escapeHtml(court.name)}</span> <span class="court-meta">${escapeHtml(meta)}</span></span>
        <button type="button" class="button-primary" data-action="reserve" data-venue-id="${escapeHtml(result.venue.id)}" data-court-id="${escapeHtml(court.id)}" aria-label="${escapeHtml(label)}">Reserve</button>
      </li>`;
}

export function renderVenueCard(result: AvailabilityResult, index: number): string {
  const headingId = `venue-heading-${index}`;
  const distance =
    result.distanceKm === null
      ? ''
      : `\n      <p class="venue-distance">${escapeHtml(formatDistance(result.distanceKm))} away</p>`;
  const courts = result.availableCourts.map((c) => renderCourt(result, c)).join('');
  return `<li><article class="venue-card" aria-labelledby="${headingId}">
      <h3 id="${headingId}">${escapeHtml(result.venue.name)}</h3>
      <p class="venue-address">${escapeHtml(result.venue.address)}</p>${distance}
      <p class="venue-price">${escapeHtml(formatPrice(result.pricePerHourCzk, result.totalPriceCzk))}</p>
      <p class="venue-hours">Open ${escapeHtml(formatOpeningHours(result.venue.openingHours))}</p>
      <ul class="court-list" aria-label="Free courts at ${escapeHtml(result.venue.name)}">${courts}</ul>
    </article></li>`;
}

/** Content of the results region for the given search state. */
export function renderResults(state: SearchState): string {
  switch (state.status) {
    case 'idle':
      return '<p class="hint">Choose a sport, date and time, then press Search.</p>';
    case 'loading':
      return '<p role="status" class="loading">Searching for free courts…</p>';
    case 'error':
      return `<div role="alert" class="error"><p>${escapeHtml(state.message)}</p>${renderIssues(state.issues)}</div>`;
    case 'success': {
      const { results } = state.response;
      if (results.length === 0) {
        return '<div class="empty"><p><strong>No free courts found for this slot.</strong></p><p>Try a different time, another date or a larger max distance.</p></div>';
      }
      const count = `${results.length} ${results.length === 1 ? 'venue' : 'venues'} with free courts`;
      return `<p class="result-count">${escapeHtml(count)}</p>
<ul class="venue-list">${results.map((r, i) => renderVenueCard(r, i)).join('')}</ul>`;
    }
  }
}

// ---------- reservation dialog ----------

function renderSummary(target: ReservationTarget): string {
  const rows: Array<[string, string]> = [
    ['Venue', target.venueName],
    ['Court', target.courtName],
    ['Date', formatDateLabel(target.date)],
    ['Time', `${formatTimeRange(target.time, target.durationMinutes)} (${formatDuration(target.durationMinutes)})`],
    ['Total price', formatCzk(target.totalPriceCzk)],
  ];
  const items = rows
    .map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('');
  return `<dl class="summary">${items}</dl>`;
}

function renderTextField(opts: {
  id: string;
  name: string;
  label: string;
  type: string;
  value: string;
  error: string | undefined;
  disabled: boolean;
  autocomplete: string;
  autofocus?: boolean;
}): string {
  const errorId = `${opts.id}-error`;
  const invalid = opts.error !== undefined;
  const error = invalid ? `<p class="field-error" id="${errorId}">${escapeHtml(opts.error ?? '')}</p>` : '';
  return `<div class="field">
      <label for="${opts.id}">${escapeHtml(opts.label)}</label>
      <input id="${opts.id}" name="${opts.name}" type="${opts.type}" value="${escapeHtml(opts.value)}" autocomplete="${opts.autocomplete}" required${invalid ? ` aria-invalid="true" aria-describedby="${errorId}"` : ''}${opts.disabled ? ' disabled' : ''}${opts.autofocus ? ' autofocus' : ''}>
      ${error}
    </div>`;
}

/** Inner HTML of the reservation <dialog>; empty string when closed. */
export function renderReservationDialog(state: ReservationState): string {
  if (state.status === 'closed') return '';

  if (state.status === 'success') {
    const r = state.reservation;
    return `<h2 id="reservation-title">Reservation confirmed</h2>
<div role="status" class="success">
  <p>Thank you, ${escapeHtml(r.customerName)}! Your court is booked.</p>
  <dl class="summary">
    <div><dt>Reservation ID</dt><dd>${escapeHtml(r.id)}</dd></div>
    <div><dt>Venue</dt><dd>${escapeHtml(r.venueName)}</dd></div>
    <div><dt>Court</dt><dd>${escapeHtml(r.courtName)}</dd></div>
    <div><dt>Date</dt><dd>${escapeHtml(formatDateLabel(r.date))}</dd></div>
    <div><dt>Time</dt><dd>${escapeHtml(formatTimeRange(r.time, r.durationMinutes))}</dd></div>
    <div><dt>Total price</dt><dd>${escapeHtml(formatCzk(r.totalPriceCzk))}</dd></div>
  </dl>
</div>
<div class="dialog-actions"><button type="button" class="button-primary" data-action="close">Close</button></div>`;
  }

  const submitting = state.status === 'submitting';
  const fieldErrors = state.status === 'editing' ? state.fieldErrors : {};
  const failure = state.status === 'editing' ? state.failure : null;
  const { target, values } = state;

  const failureHtml = failure
    ? `<div role="alert" class="error"><p>${escapeHtml(failure.message)}</p>${
        failure.canRefresh
          ? '<p><button type="button" class="button-secondary" data-action="refresh">Refresh results</button></p>'
          : ''
      }</div>`
    : '';
  const submittingHtml = submitting
    ? '<p role="status" class="loading">Reserving your court…</p>'
    : '';

  return `<h2 id="reservation-title">Reserve a court</h2>
${renderSummary(target)}
<form id="reservation-form" aria-label="Reservation" novalidate${submitting ? ' aria-busy="true"' : ''}>
    ${renderTextField({ id: 'res-name', name: 'customerName', label: 'Name', type: 'text', value: values.customerName, error: fieldErrors.customerName, disabled: submitting, autocomplete: 'name', autofocus: true })}
    ${renderTextField({ id: 'res-email', name: 'customerEmail', label: 'E-mail', type: 'email', value: values.customerEmail, error: fieldErrors.customerEmail, disabled: submitting, autocomplete: 'email' })}
    ${failureHtml}
    ${submittingHtml}
    <div class="dialog-actions">
      <button type="submit" class="button-primary"${submitting ? ' disabled' : ''}>Confirm</button>
      <button type="button" class="button-secondary" data-action="cancel"${submitting ? ' disabled' : ''}>Cancel</button>
    </div>
  </form>`;
}
