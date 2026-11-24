/** Pure render-to-string functions. All dynamic text is escaped. */
import { DISTANCE_OPTIONS_KM, SPORTS, getSearchWindow, weekdayOf } from '@spotradar/shared';
import type { SearchResult } from '@spotradar/shared';
import {
  formatCheckedAgo,
  formatCourts,
  formatDateLabel,
  formatDistance,
  formatSlotRange,
} from './format.ts';
import { getDateChips } from './query.ts';
import type { FormValues } from './query.ts';
import { isDistanceFilterEnabled, locationStatusText } from './state.ts';
import type { LocationState, SearchState } from './state.ts';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links are rendered as hrefs. */
export function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

/** "+420 123 456 789" → "+420123456789" for tel: links. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

// ---------- search form ----------

export function renderDateChips(selectedDate: string, now: Date): string {
  return getDateChips(now)
    .map(
      (chip) =>
        `<button type="button" class="chip" data-date="${chip.date}" aria-pressed="${chip.date === selectedDate}">${escapeHtml(chip.label)}</button>`,
    )
    .join('');
}

export function renderDistanceChips(selectedKm: string, enabled: boolean): string {
  const disabled = enabled ? '' : ' disabled';
  const any = `<button type="button" class="chip" data-km="" aria-pressed="${selectedKm === ''}"${disabled}>Any</button>`;
  const options = DISTANCE_OPTIONS_KM.map(
    (km) =>
      `<button type="button" class="chip" data-km="${km}" aria-pressed="${String(km) === selectedKm}"${disabled}>${km} km</button>`,
  ).join('');
  return any + options;
}

export interface SearchFormProps {
  values: FormValues;
  location: LocationState;
  now: Date;
}

export function renderSearchForm({ values, location, now }: SearchFormProps): string {
  const window = getSearchWindow(now);
  const sportOptions = SPORTS.map(
    (sport) =>
      `<option value="${sport.id}"${sport.id === values.sport ? ' selected' : ''}>${escapeHtml(sport.name)}</option>`,
  ).join('');
  const distanceEnabled = isDistanceFilterEnabled(location);
  const status = locationStatusText(location);
  const statusClass = location.status === 'error' ? ' is-error' : '';
  return `
<form id="search-form" class="search-form" novalidate>
  <div class="field field-sport">
    <label for="sport">Sport</label>
    <select id="sport" name="sport">${sportOptions}</select>
  </div>

  <fieldset class="field field-date">
    <legend>Date</legend>
    <div id="date-chips" class="chips">${renderDateChips(values.date, now)}</div>
    <label for="date" class="subtle-label">Or pick another day</label>
    <input id="date" name="date" type="date" required value="${escapeHtml(values.date)}" min="${window.from}" max="${window.to}">
  </fieldset>

  <div class="field field-time">
    <label for="time">Time (optional)</label>
    <div class="row">
      <input id="time" name="time" type="time" value="${escapeHtml(values.time)}">
      <button type="button" id="clear-time" class="btn btn-ghost">Any time</button>
    </div>
  </div>

  <fieldset class="field field-where">
    <legend>Distance from you (optional)</legend>
    <div class="row row-wrap">
      <button type="button" id="use-location" class="btn btn-secondary"${location.status === 'locating' ? ' disabled' : ''}>Use my location</button>
    </div>
    <label for="address">Or enter an address</label>
    <div class="row">
      <input id="address" name="address" type="search" autocomplete="street-address" placeholder="e.g. Česká, Brno" value="${values.origin?.source === 'address' ? escapeHtml(values.origin.label) : ''}">
      <button type="button" id="find-address" class="btn btn-secondary"${location.status === 'resolving' ? ' disabled' : ''}>Find address</button>
    </div>
    <p id="location-status" class="location-status${statusClass}" role="status">${escapeHtml(status)}</p>
    <div class="chips-label" id="distance-label">Maximum distance</div>
    <div id="distance-chips" class="chips" role="group" aria-labelledby="distance-label">${renderDistanceChips(values.maxDistanceKm, distanceEnabled)}</div>
  </fieldset>

  <button type="submit" id="search-submit" class="btn btn-primary">Search courts</button>
</form>`;
}

// ---------- results ----------

/** "Live · checked 3 min ago" etc. */
export function renderBadge(result: SearchResult, now: Date): string {
  const { status, checkedAt } = result.availability;
  if (status === 'live') {
    return `<span class="badge badge-live">Live · checked ${escapeHtml(formatCheckedAgo(checkedAt, now))}</span>`;
  }
  if (status === 'unavailable') {
    return `<span class="badge badge-warn">Couldn't read availability right now – check on website</span>`;
  }
  return `<span class="badge badge-unknown">Availability unknown – check on website</span>`;
}

/** The big "3 courts free at 18:00" line (live venues only). */
export function renderHeadline(result: SearchResult, time: string | undefined): string {
  const { status, freeSlots } = result.availability;
  if (status !== 'live') return '';
  if (time !== undefined && result.freeCourtsAtTime !== undefined) {
    return result.freeCourtsAtTime > 0
      ? `<p class="headline is-free">${escapeHtml(formatCourts(result.freeCourtsAtTime))} free at ${escapeHtml(time)}</p>`
      : `<p class="headline is-full">Fully booked at ${escapeHtml(time)}</p>`;
  }
  if (freeSlots.length === 0) return `<p class="headline is-full">Fully booked this day</p>`;
  const max = Math.max(...freeSlots.map((s) => s.freeCourts));
  return `<p class="headline is-free">Up to ${escapeHtml(formatCourts(max))} free</p>`;
}

function renderSlots(result: SearchResult): string {
  const { status, freeSlots } = result.availability;
  if (status !== 'live' || freeSlots.length === 0) return '';
  const items = freeSlots
    .map(
      (slot) =>
        `<li class="slot"><span class="slot-time">${escapeHtml(formatSlotRange(slot))}</span> <span class="slot-courts">${escapeHtml(formatCourts(slot.freeCourts))}</span></li>`,
    )
    .join('');
  return `<ul class="slots" aria-label="Free time slots">${items}</ul>`;
}

function renderHours(result: SearchResult, date: string): string {
  const hours = result.venue.openingHours.days[weekdayOf(date)];
  const approx = result.venue.openingHours.approximate ? ' (approx.)' : '';
  const text = hours ? `Open ${hours.open}–${hours.close}${approx}` : `Closed${approx}`;
  return `<span class="meta-item">${escapeHtml(text)}</span>`;
}

export function renderResultCard(
  result: SearchResult,
  query: { date: string; time?: string },
  now: Date,
): string {
  const { venue, availability } = result;
  const href = safeHref(venue.bookingUrl);
  const book = href
    ? `<a class="btn btn-primary" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Book on venue's website<span class="visually-hidden"> (opens in a new tab)</span></a>`
    : '';
  const phone = venue.phone
    ? `<a class="btn btn-secondary" href="${escapeHtml(telHref(venue.phone))}">Call ${escapeHtml(venue.phone)}</a>`
    : '';
  const distance =
    result.distanceKm !== undefined
      ? `<span class="meta-item meta-distance">${escapeHtml(formatDistance(result.distanceKm))} away</span>`
      : '';
  const courts =
    venue.courts !== undefined
      ? `<span class="meta-item">${escapeHtml(formatCourts(venue.courts))} in total</span>`
      : '';
  const note =
    availability.status === 'live'
      ? ''
      : `<p class="note">Free courts can't be shown here – open the venue's booking page to see them.</p>`;
  return `
<li class="card" data-venue-id="${escapeHtml(venue.id)}" data-status="${availability.status}">
  <article aria-labelledby="venue-${escapeHtml(venue.id)}">
    <header class="card-head">
      <h3 id="venue-${escapeHtml(venue.id)}">${escapeHtml(venue.name)}</h3>
      <p class="district">${escapeHtml(venue.district)}</p>
    </header>
    <p class="meta">${distance}${courts}${renderHours(result, query.date)}</p>
    ${renderHeadline(result, query.time)}
    ${renderSlots(result)}
    ${note}
    <p class="badge-row">${renderBadge(result, now)}</p>
    <div class="actions">${book}${phone}</div>
  </article>
</li>`;
}

export function renderSkeletons(count = 3): string {
  const card = `<li class="card skeleton" aria-hidden="true"><div class="sk sk-title"></div><div class="sk sk-line"></div><div class="sk sk-big"></div><div class="sk sk-line"></div><div class="sk sk-button"></div></li>`;
  return `<p class="visually-hidden">Loading results…</p><ul class="cards" aria-hidden="true">${card.repeat(count)}</ul>`;
}

export function renderEmpty(): string {
  return `
<div class="state state-empty">
  <p class="state-title">No courts found</p>
  <p>No venues match your search. Try another time or day, or a larger distance.</p>
</div>`;
}

export function renderError(message: string, issues: { field: string; message: string }[]): string {
  const list = issues.length
    ? `<ul>${issues.map((i) => `<li>${escapeHtml(i.field)}: ${escapeHtml(i.message)}</li>`).join('')}</ul>`
    : '';
  return `
<div class="state state-error" role="alert">
  <p class="state-title">Search failed</p>
  <p>${escapeHtml(message)}</p>${list}
</div>`;
}

export function renderResults(state: SearchState, now: Date): string {
  switch (state.status) {
    case 'idle':
      return `<div class="state state-idle"><p>Pick a day and press <strong>Search courts</strong> to see free badminton courts in Brno.</p></div>`;
    case 'loading':
      return renderSkeletons();
    case 'error':
      return renderError(state.message, state.issues);
    case 'success': {
      const { query, results } = state.response;
      if (results.length === 0) return renderEmpty();
      const when = `${formatDateLabel(query.date)}${query.time ? ` at ${query.time}` : ''}`;
      const count = `${results.length} ${results.length === 1 ? 'venue' : 'venues'}`;
      return `<p class="summary">${escapeHtml(count)} · ${escapeHtml(when)}</p><ul class="cards">${results
        .map((r) => renderResultCard(r, query, now))
        .join('')}</ul>`;
    }
  }
}
