/**
 * Detail panel for one hour slot: venues with free courts (with details and
 * booking links) and, collapsed, venues that are open but have no live data.
 */
import { courtPrice, formatCardsUsed, formatCourtPrice } from '@spotradar/shared';
import type {
  CalendarResponse,
  CalendarVenue,
  CourtPrice,
  MultisportCards,
  SlotVenueStatus,
  SportOffering,
  VenueAvailability,
} from '@spotradar/shared';
import { hourStatuses, indexDays } from './cells.ts';
import {
  formatCourts,
  formatDistance,
  formatLongDate,
  hourRangeLabel,
  sportNameLower,
} from './format.ts';
import { escapeHtml, externalLink, safeHref } from './html.ts';
import { renderLiveStatus } from './live-status.ts';
import { DEFAULT_CARDS, DEFAULT_SORT, renderListControls, sortEntries } from './sorting.ts';
import type { SortMode } from './sorting.ts';
import { googleMapsLink, renderMultisportBadge } from './venue-info.ts';

export interface PanelProps {
  date: string;
  hour: number;
  data: CalendarResponse;
  /** Sort order of both lists (default: distance). */
  sort?: SortMode;
  /** MultiSport cards used for the court (default 0). */
  cards?: MultisportCards;
  /** Keep the "check on website" section open (when the user opened it). */
  checkOpen?: boolean;
  /** Injectable clock for "x min ago". */
  now?: Date;
}

function availabilityOf(
  data: CalendarResponse,
  date: string,
  venueId: string,
): VenueAvailability | undefined {
  return data.days.find((d) => d.date === date)?.venues.find((v) => v.venueId === venueId)
    ?.availability;
}

function bookLink(url: string): string {
  const href = safeHref(url);
  return href
    ? `<a class="btn btn-primary" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Book on venue's website <span aria-hidden="true">↗</span></a>`
    : '';
}

function addressLine(entry: CalendarVenue): string {
  const notes: string[] = [escapeHtml(entry.venue.address)];
  if (entry.distanceKm !== undefined)
    notes.push(`${escapeHtml(formatDistance(entry.distanceKm))} away`);
  return notes.join(' · ');
}

/** "● Live · 5 min ago" – the shared one-line status; the absolute time is in its title. */
function liveNote(availability: VenueAvailability | undefined, now: Date): string {
  return `<p class="live-note">${renderLiveStatus({
    status: availability?.status ?? 'unknown',
    checkedAt: availability?.checkedAt,
    now,
  })}</p>`;
}

/** The price of the venue's offering (selected sport) for the clicked slot (null = unknown). */
function slotPrice(offering: SportOffering, ctx: SlotContext): CourtPrice | null {
  return courtPrice({
    pricing: offering.pricing,
    multisport: offering.multisport,
    date: ctx.date,
    hour: ctx.hour,
    cards: ctx.cards,
  });
}

/** MultiSport badge (+ limits) and the price of exactly this slot: the same row for every venue. */
function renderMultisportAndPrice(offering: SportOffering, ctx: SlotContext): string {
  const price = slotPrice(offering, ctx);
  const cardsText = price ? formatCardsUsed(price.cardsUsed) : '';
  const note = offering.note
    ? `<p class="muted offering-note">${escapeHtml(offering.note)}</p>`
    : '';
  return `<div class="venue-ms">${renderMultisportBadge(offering.multisport)}</div>
  <p class="fact"><span class="fact-label">Price</span> <span data-testid="slot-price">${escapeHtml(formatCourtPrice(price))}</span>${
    cardsText
      ? ` <span class="slot-price-cards" data-testid="slot-price-cards">${escapeHtml(cardsText)}</span>`
      : ''
  }</p>${note}`;
}

interface SlotContext {
  date: string;
  hour: number;
  cards: MultisportCards;
}

function renderFreeItem(
  status: SlotVenueStatus,
  entry: CalendarVenue,
  availability: VenueAvailability | undefined,
  now: Date,
  ctx: SlotContext,
): string {
  const { venue, offering } = entry;
  const facts = renderMultisportAndPrice(offering, ctx);
  const links = [externalLink(venue.website, 'Website'), googleMapsLink(venue)]
    .filter((link) => link !== '')
    .join('');
  return `<li class="venue-item" data-state="free" data-venue-id="${escapeHtml(venue.id)}">
  <div class="venue-item-head"><h3>${escapeHtml(venue.name)}</h3><span class="pill pill-free">${formatCourts(status.freeCourts ?? 0)} free</span></div>
  <p class="muted">${addressLine(entry)}</p>
  ${liveNote(availability, now)}
  ${facts}
  ${links ? `<p class="link-row">${links}</p>` : ''}
  ${bookLink(offering.bookingUrl)}
</li>`;
}

function renderCheckItem(
  entry: CalendarVenue,
  availability: VenueAvailability | undefined,
  now: Date,
  ctx: SlotContext,
): string {
  const { venue, offering } = entry;
  const note = liveNote(
    availability?.status === 'unavailable' ? availability : { status: 'unknown', freeSlots: [] },
    now,
  );
  return `<li class="venue-item" data-state="check" data-venue-id="${escapeHtml(venue.id)}">
  <div class="venue-item-head"><h3>${escapeHtml(venue.name)}</h3><span class="pill pill-check">Check on website</span></div>
  <p class="muted">${addressLine(entry)}</p>
  ${note}
  ${renderMultisportAndPrice(offering, ctx)}
  ${bookLink(offering.bookingUrl)}
</li>`;
}

/** Contents of the panel (backdrop + dialog). Full and closed venues are not listed. */
export function renderPanel({
  date,
  hour,
  data,
  now = new Date(),
  sort = DEFAULT_SORT,
  cards = DEFAULT_CARDS,
  checkOpen = false,
}: PanelProps): string {
  const range = hourRangeLabel(hour);
  const ctx: SlotContext = { date, hour, cards };
  const statuses = hourStatuses(indexDays(data), data.venues, date, hour);
  const byId = new Map(data.venues.map((entry) => [entry.venue.id, entry]));

  // Sections stay separate; each is sorted by the same rule. Statuses of unknown venues drop out.
  const sorted = (state: 'free' | 'check'): { status: SlotVenueStatus; entry: CalendarVenue }[] => {
    const rows = statuses
      .filter((s) => s.state === state)
      .flatMap((status) => {
        const entry = byId.get(status.venueId);
        return entry ? [{ status, entry }] : [];
      });
    return sortEntries(rows, sort, ({ entry }) => ({
      name: entry.venue.name,
      distanceKm: entry.distanceKm,
      price: slotPrice(entry.offering, ctx),
    }));
  };
  const free = sorted('free');
  const check = sorted('check');

  const freeItems = free
    .map(({ status, entry }) =>
      renderFreeItem(status, entry, availabilityOf(data, date, status.venueId), now, ctx),
    )
    .join('');
  const checkItems = check
    .map(({ status, entry }) =>
      renderCheckItem(entry, availabilityOf(data, date, status.venueId), now, ctx),
    )
    .join('');

  const intro =
    free.length === 0
      ? `<div class="state state-empty"><h3>No ${escapeHtml(sportNameLower(data.query.sport))} venue is free at ${range}</h3><p>${
          check.length > 0
            ? 'Venues without live data may still have space – check their websites below.'
            : 'Try another hour or day.'
        }</p></div>`
      : '';

  const checkSection =
    check.length > 0
      ? `<details class="check-venues"${free.length === 0 || checkOpen ? ' open' : ''}>
  <summary>${check.length} ${check.length === 1 ? 'venue' : 'venues'} without live data – check on website</summary>
  <ul class="venue-items">${checkItems}</ul>
</details>`
      : '';

  return `<div class="backdrop" data-action="close-panel"></div>
<div class="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
  <header class="detail-head">
    <div>
      <p class="eyebrow">${escapeHtml(formatLongDate(date))}</p>
      <h2 id="detail-title">${range}</h2>
    </div>
    <button type="button" class="icon-btn" data-action="close-panel" aria-label="Close details"><span aria-hidden="true">×</span></button>
  </header>
  <div class="detail-body">
    ${free.length + check.length > 0 ? renderListControls(sort, cards, 'panel') : ''}
    ${intro}
    ${free.length > 0 ? `<ul class="venue-items">${freeItems}</ul>` : ''}
    ${checkSection}
  </div>
</div>`;
}
