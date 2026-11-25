/** Venue directory page: URL state, view state and render-to-string functions. */
import {
  VENUE_QUERY_MAX,
  courtPriceFrom,
  distanceKm,
  isSportId,
  offeringFor,
  toLocalDateTime,
} from '@spotradar/shared';
import type {
  CourtPrice,
  GeoPoint,
  MultisportCards,
  OpeningHours,
  SportId,
  SportOffering,
  VenueListItem,
  VenueQuery,
  VenuesResponse,
} from '@spotradar/shared';
import { ApiRequestError } from './api.ts';
import { formatCourts, formatDistance, sportName, sportNameLower } from './format.ts';
import {
  bookingSystemLabel,
  formatSeason,
  isOutOfSeason,
  renderSportChipButtons,
  renderSportLabel,
} from './sports.ts';
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
  filter: Pick<VenuesFilter, 'sort' | 'cards'> & { sport?: SportId | null },
  origin: GeoPoint | null | undefined,
): VenueListItem[] {
  return sortEntries(items, filter.sort, (item) => ({
    name: item.venue.name,
    distanceKm: venueDistance(item, origin),
    price: cheapestPrice(shownOfferings(item, filter.sport ?? null), filter.cards),
  }));
}

/** The cheapest "from" price over the shown offerings (null when none is known). */
function cheapestPrice(
  offerings: readonly SportOffering[],
  cards: MultisportCards,
): CourtPrice | null {
  let best: CourtPrice | null = null;
  for (const o of offerings) {
    const price = courtPriceFrom(o.pricing, o.multisport, cards);
    if (price && (best === null || price.payable < best.payable)) best = price;
  }
  return best;
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
    renderSportChipButtons(filter.sport, 'venue-sport'),
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
  if (q === '' && filter.sport !== null) {
    const name = escapeHtml(sportNameLower(filter.sport));
    return `<div class="state state-empty"><h3>No ${name} venues in SpotRadar yet</h3><p>Pick another sport or show all sports.</p><button type="button" class="btn btn-primary" data-action="clear-venue-filters">Show all sports</button></div>`;
  }
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

/** The offerings a card shows: the filtered sport's, or all of them. */
export function shownOfferings(item: VenueListItem, sport: SportId | null): SportOffering[] {
  if (sport === null) return item.venue.offerings;
  const offering = offeringFor(item.venue, sport);
  return offering ? [offering] : [];
}

function renderHours(hours: OpeningHours | undefined, today: string): string {
  if (!hours) return fact('Opening hours', '<span class="muted">Opening hours unknown</span>');
  const list = groupOpeningHours(hours)
    .map(
      (group) =>
        `<li><span class="hours-days">${escapeHtml(group.days)}</span> ${escapeHtml(group.text)}</li>`,
    )
    .join('');
  const approximate = hours.approximate
    ? ' <span class="badge badge-neutral">approximate</span>'
    : '';
  const season = hours.season
    ? `<p class="season">${escapeHtml(formatSeason(hours.season))}${
        isOutOfSeason(hours, today)
          ? ' · <span class="badge badge-neutral">Closed out of season</span>'
          : ''
      }</p>`
    : '';
  return fact(`Opening hours${approximate}`, `${season}<ul class="hours">${list}</ul>`);
}

/** Details of one sport at the venue: courts, price, MultiSport, hours, booking system + link. */
export function renderOffering(
  offering: SportOffering,
  live: boolean,
  cards: MultisportCards,
  today: string,
  venueName = '',
): string {
  const bookHref = safeHref(offering.bookingUrl);
  const facts = [
    offering.courts !== undefined ? fact('Courts', formatCourts(offering.courts)) : '',
    fact('Price', renderPriceSummary(offering.pricing, offering.multisport, cards)),
    fact('MultiSport', renderMultisportBadge(offering.multisport)),
    renderHours(offering.openingHours, today),
    fact('Booking', escapeHtml(bookingSystemLabel(offering.bookingSystem))),
  ].join('');
  // A group, not a <section>: named sections would add one landmark per sport and venue.
  const at = venueName ? `<span class="visually-hidden"> at ${escapeHtml(venueName)}</span>` : '';
  return `<div class="offering" role="group" data-sport="${offering.sport}" aria-label="${escapeHtml(sportName(offering.sport))}">
  <div class="offering-head">
    <h4>${renderSportLabel(offering.sport)}</h4>
    ${renderLiveStatus({ status: live ? 'live' : 'unknown' })}
  </div>
  ${offering.note ? `<p class="muted offering-note">${escapeHtml(offering.note)}</p>` : ''}
  <dl class="facts">${facts}</dl>
  ${
    bookHref
      ? `<a class="btn btn-primary btn-sm" href="${escapeHtml(bookHref)}" target="_blank" rel="noopener noreferrer">Book ${escapeHtml(sportNameLower(offering.sport))}${at} on venue's website <span aria-hidden="true">↗</span></a>`
      : ''
  }
</div>`;
}

export function renderVenueCard(
  item: VenueListItem,
  cards: MultisportCards = DEFAULT_CARDS,
  distance?: number,
  sport: SportId | null = null,
  today: string = toLocalDateTime(new Date()).date,
): string {
  const { venue } = item;
  const sports = venue.sports.map((id) => {
    const live = item.liveSports.includes(id);
    return `<li class="tag tag-sport${live ? ' tag-live' : ''}" data-sport="${id}">${renderSportLabel(id)}${
      live ? ' <span class="visually-hidden">(live)</span><span aria-hidden="true">●</span>' : ''
    }</li>`;
  });
  const others = (venue.otherActivities ?? []).map(
    (name) => `<li class="tag">${escapeHtml(name)}</li>`,
  );
  const offerings = shownOfferings(item, sport)
    .map((o) => renderOffering(o, item.liveSports.includes(o.sport), cards, today, venue.name))
    .join('');

  const phoneHref = venue.phone ? telHref(venue.phone) : null;
  const links = [
    externalLink(venue.website, 'Website'),
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
  <div class="offerings">${offerings}</div>
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
        .map((item) =>
          renderVenueCard(item, filter.cards, venueDistance(item, origin), filter.sport),
        )
        .join('');
      return `<p class="result-count" role="status">${venueCountText(state.data.venues.length)}</p><ul class="venue-grid">${cards}</ul>`;
    }
  }
}
