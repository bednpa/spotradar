/**
 * Detail panel for one hour slot: venues with free courts (with details and
 * booking links) and, collapsed, venues that are open but have no live data.
 */
import { formatTimeAgo } from '@spotradar/shared';
import type {
  CalendarResponse,
  CalendarVenue,
  SlotVenueStatus,
  VenueAvailability,
} from '@spotradar/shared';
import { hourStatuses, indexDays } from './cells.ts';
import {
  formatClockTime,
  formatCourts,
  formatDistance,
  formatLongDate,
  hourRangeLabel,
  sportNameLower,
} from './format.ts';
import { escapeHtml, externalLink, safeHref } from './html.ts';
import { googleMapsLink, renderMultisportBadge } from './venue-info.ts';

export interface PanelProps {
  date: string;
  hour: number;
  data: CalendarResponse;
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

/** "Live · Checked 5 min ago" – the absolute time stays available in the title. */
function liveNote(availability: VenueAvailability | undefined, now: Date): string {
  if (availability?.status !== 'live' || availability.checkedAt === undefined) {
    return availability?.status === 'live'
      ? '<p class="live-note"><span class="badge badge-live">Live</span></p>'
      : '';
  }
  const ago = formatTimeAgo(availability.checkedAt, now);
  const clock = formatClockTime(availability.checkedAt);
  const title = clock ? ` title="Checked at ${clock}"` : '';
  return `<p class="live-note"><span class="badge badge-live">Live</span> <span class="muted">Checked <time datetime="${escapeHtml(availability.checkedAt)}"${title}>${escapeHtml(ago)}</time></span></p>`;
}

function renderFreeItem(
  status: SlotVenueStatus,
  entry: CalendarVenue,
  availability: VenueAvailability | undefined,
  now: Date,
): string {
  const { venue } = entry;
  const multisport = renderMultisportBadge(venue.multisport);
  const facts = [
    venue.priceInfo
      ? `<p class="fact"><span class="fact-label">Price</span> ${escapeHtml(venue.priceInfo)}</p>`
      : '',
    multisport
      ? `<p class="fact"><span class="fact-label">MultiSport</span> ${multisport}</p>`
      : '',
  ].join('');
  const links = [externalLink(venue.website, 'Website'), googleMapsLink(venue)]
    .filter((link) => link !== '')
    .join('');
  return `<li class="venue-item" data-state="free" data-venue-id="${escapeHtml(venue.id)}">
  <div class="venue-item-head"><h3>${escapeHtml(venue.name)}</h3><span class="pill pill-free">${formatCourts(status.freeCourts ?? 0)} free</span></div>
  <p class="muted">${addressLine(entry)}</p>
  ${liveNote(availability, now)}
  ${facts}
  ${links ? `<p class="link-row">${links}</p>` : ''}
  ${bookLink(venue.bookingUrl)}
</li>`;
}

function renderCheckItem(
  entry: CalendarVenue,
  availability: VenueAvailability | undefined,
): string {
  const { venue } = entry;
  const note =
    availability?.status === 'unavailable'
      ? "Couldn't read availability right now – check on website."
      : 'No live data for this venue – check on website.';
  return `<li class="venue-item" data-state="check" data-venue-id="${escapeHtml(venue.id)}">
  <div class="venue-item-head"><h3>${escapeHtml(venue.name)}</h3><span class="pill pill-check">Check on website</span></div>
  <p class="muted">${addressLine(entry)}</p>
  <p class="muted">${note}</p>
  ${bookLink(venue.bookingUrl)}
</li>`;
}

/** Contents of the panel (backdrop + dialog). Full and closed venues are not listed. */
export function renderPanel({ date, hour, data, now = new Date() }: PanelProps): string {
  const range = hourRangeLabel(hour);
  const statuses = hourStatuses(indexDays(data), data.venues, date, hour);
  const byId = new Map(data.venues.map((entry) => [entry.venue.id, entry]));

  const free = statuses.filter((s) => s.state === 'free');
  const check = statuses.filter((s) => s.state === 'check');

  const freeItems = free
    .map((status) => {
      const entry = byId.get(status.venueId);
      return entry
        ? renderFreeItem(status, entry, availabilityOf(data, date, status.venueId), now)
        : '';
    })
    .join('');
  const checkItems = check
    .map((status) => {
      const entry = byId.get(status.venueId);
      return entry ? renderCheckItem(entry, availabilityOf(data, date, status.venueId)) : '';
    })
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
      ? `<details class="check-venues"${free.length === 0 ? ' open' : ''}>
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
    ${intro}
    ${free.length > 0 ? `<ul class="venue-items">${freeItems}</ul>` : ''}
    ${checkSection}
  </div>
</div>`;
}
