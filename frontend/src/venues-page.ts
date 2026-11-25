/** Venue directory page: URL state, view state and render-to-string functions. */
import { SPORTS, VENUE_QUERY_MAX, courtPriceFrom, distanceKm, isSportId } from '@spotradar/shared';
import type {
  GeoPoint,
  MultisportCards,
  SportId,
  VenueListItem,
  VenueQuery,
  VenuesResponse,
} from '@spotradar/shared';
import { ApiRequestError } from './api.ts';
import { formatCourts, formatDistance, sportName } from './format.ts';
import {
  DEFAULT_CARDS,
  DEFAULT_SORT,
  parseCards,
  parseSort,
  renderListControls,
  sortEntries,
} from './sorting.ts';
import type { SortMode } from './sorting.ts';
import { escapeHtml, externalLink, safeHref, telHref } from './html.ts';
import { renderLiveStatus } from './live-status.ts';
import {
  googleMapsLink,
  groupOpeningHours,
  renderMultisportBadge,
  renderPriceSummary,
} from './venue-info.ts';

/** `sport: null` = all sports. */
export interface VenuesFilter {
  q: string;
  sport: SportId | null;
  /** Client-side order of the list; shared with the calendar page. */
  sort: SortMode;
  /** MultiSport cards used for the "from" price; shared with the calendar page. */
  cards: MultisportCards;
}

export type VenuesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: VenuesResponse };

export function venuesFilterFromSearch(search: string): VenuesFilter {
  const params = new URLSearchParams(search);
  const sport = params.get('sport');
  return {
    q: (params.get('q') ?? '').trim().slice(0, VENUE_QUERY_MAX),
    sport: isSportId(sport) ? sport : null,
    sort: parseSort(params.get('sort')),
    cards: parseCards(params.get('cards')),
  };
}

export function venuesFilterToSearch(filter: VenuesFilter): string {
  const params = new URLSearchParams();
  if (filter.q.trim() !== '') params.set('q', filter.q.trim());
  if (filter.sport !== null) params.set('sport', filter.sport);
  if (filter.sort !== DEFAULT_SORT) params.set('sort', filter.sort);
  if (filter.cards !== DEFAULT_CARDS) params.set('cards', String(filter.cards));
  return params.toString();
}

/** Distance of a venue from the calendar page's location; undefined without a location. */
function venueDistance(
  item: VenueListItem,
  origin: GeoPoint | null | undefined,
): number | undefined {
  return origin ? distanceKm(origin, item.venue.location) : undefined;
}

/**
 * The list in the selected order. Distance without a location keeps the API order (by name);
 * price uses the "from" price with the selected cards.
 */
export function sortVenueItems(
  items: readonly VenueListItem[],
  filter: Pick<VenuesFilter, 'sort' | 'cards'>,
  origin: GeoPoint | null | undefined,
): VenueListItem[] {
  return sortEntries(items, filter.sort, (item) => ({
    name: item.venue.name,
    distanceKm: venueDistance(item, origin),
    price: courtPriceFrom(item.venue.pricing, item.venue.multisport, filter.cards),
  }));
}

export function toVenueQuery(filter: VenuesFilter): VenueQuery {
  const query: VenueQuery = {};
  const q = filter.q.trim();
  if (q !== '') query.q = q.slice(0, VENUE_QUERY_MAX);
  if (filter.sport !== null) query.sport = filter.sport;
  return query;
}

export function venuesErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.code === 'VALIDATION_ERROR')
      return 'That search is not valid. Try a shorter search text.';
    return error.message;
  }
  return 'Something went wrong while loading the venues. Please try again.';
}

/** "3 venues" / "1 venue" / "No venues". */
export function venueCountText(count: number): string {
  if (count === 0) return 'No venues';
  return `${count} ${count === 1 ? 'venue' : 'venues'}`;
}

// ---------- rendering ----------

export function renderVenuesControls(filter: VenuesFilter): string {
  const chips = [
    `<button type="button" class="chip" data-venue-sport="" aria-pressed="${filter.sport === null}">All sports</button>`,
    ...SPORTS.map(
      (sport) =>
        `<button type="button" class="chip" data-venue-sport="${sport.id}" aria-pressed="${filter.sport === sport.id}">${escapeHtml(sport.name)}</button>`,
    ),
  ].join('');
  return `
<div class="filter-group filter-search">
  <label for="venue-search">Search venues</label>
  <input id="venue-search" type="search" maxlength="${VENUE_QUERY_MAX}" autocomplete="off" placeholder="Name, district or address" value="${escapeHtml(filter.q)}" />
</div>
<div class="filter-group">
  <span id="venue-sport-label" class="label">Sport</span>
  <div class="chips" role="group" aria-labelledby="venue-sport-label">${chips}</div>
</div>
${renderListControls(filter.sort, filter.cards, 'venues')}`;
}

export function renderVenuesSkeleton(): string {
  const cards = Array.from({ length: 4 }, () => '<div class="skeleton skeleton-card"></div>').join(
    '',
  );
  return `<div class="venue-grid" aria-busy="true"><p class="visually-hidden">Loading venues…</p>${cards}</div>`;
}

export function renderVenuesError(message: string): string {
  return `<div class="state state-error" role="alert"><p>${escapeHtml(message)}</p><button type="button" class="btn btn-primary" data-action="retry-venues">Try again</button></div>`;
}

export function renderVenuesEmpty(filter: VenuesFilter): string {
  const q = filter.q.trim();
  const what = q !== '' ? `“${escapeHtml(q)}”` : 'your filters';
  return `<div class="state state-empty"><h3>No venues match ${what}</h3><p>Try a different name, district or address.</p>${
    q !== '' || filter.sport !== null
      ? '<button type="button" class="btn btn-primary" data-action="clear-venue-filters">Clear search</button>'
      : ''
  }</div>`;
}

function fact(label: string, valueHtml: string): string {
  return `<div class="fact-row"><dt>${label}</dt><dd>${valueHtml}</dd></div>`;
}

export function renderVenueCard(
  item: VenueListItem,
  cards: MultisportCards = DEFAULT_CARDS,
  distance?: number,
): string {
  const { venue } = item;
  const sports = venue.sports.map(
    (id) => `<li class="tag tag-sport">${escapeHtml(sportName(id))}</li>`,
  );
  const others = (venue.otherActivities ?? []).map(
    (name) => `<li class="tag">${escapeHtml(name)}</li>`,
  );

  const hours = groupOpeningHours(venue.openingHours)
    .map(
      (group) =>
        `<li><span class="hours-days">${escapeHtml(group.days)}</span> ${escapeHtml(group.text)}</li>`,
    )
    .join('');
  const approximate = venue.openingHours.approximate
    ? ' <span class="badge badge-neutral">approximate</span>'
    : '';

  const price = renderPriceSummary(venue.pricing, venue.multisport, cards);
  const multisport = renderMultisportBadge(venue.multisport);
  const phoneHref = venue.phone ? telHref(venue.phone) : null;
  const bookHref = safeHref(venue.bookingUrl);

  const facts = [
    venue.courts !== undefined ? fact('Courts', formatCourts(venue.courts)) : '',
    fact('Price', price),
    fact('MultiSport', multisport),
    fact(`Opening hours${approximate}`, `<ul class="hours">${hours}</ul>`),
  ].join('');

  const links = [
    externalLink(venue.website, 'Website'),
    bookHref
      ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(bookHref)}" target="_blank" rel="noopener noreferrer">Book on venue's website <span aria-hidden="true">↗</span></a>`
      : '',
    googleMapsLink(venue),
    phoneHref && venue.phone
      ? `<a class="link" href="${escapeHtml(phoneHref)}">${escapeHtml(venue.phone)}</a>`
      : '',
  ]
    .filter((link) => link !== '')
    .join('');

  return `<li class="vcard" data-venue-id="${escapeHtml(venue.id)}" data-live="${item.liveAvailability}">
  <div class="vcard-head">
    <h3>${escapeHtml(venue.name)}</h3>
    ${renderLiveStatus({ status: item.liveAvailability ? 'live' : 'unknown' })}
  </div>
  <p class="muted">${escapeHtml(venue.district)} · ${escapeHtml(venue.address)}${
    distance !== undefined ? ` · ${escapeHtml(formatDistance(distance))} away` : ''
  }</p>
  <ul class="tags" aria-label="Sports and activities">${sports.join('')}${others.join('')}</ul>
  <dl class="facts">${facts}</dl>
  <div class="link-row">${links}</div>
</li>`;
}

/** Page body for the current state (loading / error / empty / list with count). */
export function renderVenuesBody(
  state: VenuesState,
  filter: VenuesFilter,
  origin?: GeoPoint | null,
): string {
  switch (state.status) {
    case 'loading':
      return renderVenuesSkeleton();
    case 'error':
      return renderVenuesError(state.message);
    case 'success': {
      if (state.data.venues.length === 0) return renderVenuesEmpty(filter);
      const cards = sortVenueItems(state.data.venues, filter, origin)
        .map((item) => renderVenueCard(item, filter.cards, venueDistance(item, origin)))
        .join('');
      return `<p class="result-count" role="status">${venueCountText(state.data.venues.length)}</p><ul class="venue-grid">${cards}</ul>`;
    }
  }
}
