/** Detail panel for one hour slot: every venue's status with booking links. */
import type { CalendarResponse, SlotVenueStatus, VenueAvailability } from '@spotradar/shared';
import { hourStatuses, indexDays } from './cells.ts';
import {
  formatClockTime,
  formatCourts,
  formatDistance,
  formatLongDate,
  hourRangeLabel,
  sportNameLower,
} from './format.ts';
import { escapeHtml, safeHref } from './render.ts';

export interface PanelProps {
  date: string;
  hour: number;
  data: CalendarResponse;
}

function availabilityOf(
  data: CalendarResponse,
  date: string,
  venueId: string,
): VenueAvailability | undefined {
  return data.days.find((d) => d.date === date)?.venues.find((v) => v.venueId === venueId)
    ?.availability;
}

const STATE_PILL: Record<SlotVenueStatus['state'], [string, string]> = {
  free: ['pill-free', 'Free'],
  check: ['pill-check', 'Check on website'],
  full: ['pill-full', 'Fully booked'],
  closed: ['pill-closed', 'Closed'],
};

function renderVenueItem(status: SlotVenueStatus, data: CalendarResponse, date: string): string {
  const entry = data.venues.find((v) => v.venue.id === status.venueId);
  if (!entry) return '';
  const { venue } = entry;
  const availability = availabilityOf(data, date, venue.id);
  const [pillClass, pillText] = STATE_PILL[status.state];
  const label = status.state === 'free' ? `${formatCourts(status.freeCourts ?? 0)} free` : pillText;

  const notes: string[] = [escapeHtml(venue.address)];
  if (entry.distanceKm !== undefined)
    notes.push(`${escapeHtml(formatDistance(entry.distanceKm))} away`);

  let source = '';
  if (availability?.status === 'live') {
    const time = formatClockTime(availability.checkedAt);
    source = `<p class="live-note"><span class="badge badge-live">Live${time ? ` · checked ${time}` : ''}</span></p>`;
  } else if (status.state === 'check') {
    source =
      availability?.status === 'unavailable'
        ? '<p class="muted">Couldn\'t read availability right now – check on website.</p>'
        : '<p class="muted">No live data for this venue – check on website.</p>';
  }

  const href = safeHref(venue.bookingUrl);
  const book =
    href && (status.state === 'free' || status.state === 'check')
      ? `<a class="btn btn-primary" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Book on venue's website <span aria-hidden="true">↗</span></a>`
      : '';

  return `<li class="venue-item" data-state="${status.state}" data-venue-id="${escapeHtml(venue.id)}">
  <div class="venue-item-head"><h3>${escapeHtml(venue.name)}</h3><span class="pill ${pillClass}">${escapeHtml(label)}</span></div>
  <p class="muted">${notes.join(' · ')}</p>
  ${source}
  ${book}
</li>`;
}

/** Contents of the panel (backdrop + dialog). */
export function renderPanel({ date, hour, data }: PanelProps): string {
  const range = hourRangeLabel(hour);
  const statuses = hourStatuses(indexDays(data), data.venues, date, hour);
  const anyFree = statuses.some((s) => s.state === 'free');
  const anyCheck = statuses.some((s) => s.state === 'check');

  let intro = '';
  if (!anyFree) {
    intro = `<div class="state state-empty"><h3>No ${escapeHtml(sportNameLower(data.query.sport))} venue is free at ${range}</h3>${
      anyCheck
        ? '<p>These venues have no live data – check their websites:</p>'
        : '<p>Try another hour or day.</p>'
    }</div>`;
  }
  const items = statuses.map((s) => renderVenueItem(s, data, date)).join('');
  return `<div class="backdrop" data-action="close-panel"></div>
<aside class="detail" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
  <header class="detail-head">
    <div>
      <p class="eyebrow">${escapeHtml(formatLongDate(date))}</p>
      <h2 id="detail-title">${range}</h2>
    </div>
    <button type="button" class="icon-btn" data-action="close-panel" aria-label="Close details"><span aria-hidden="true">×</span></button>
  </header>
  <div class="detail-body">
    ${intro}
    <ul class="venue-items">${items}</ul>
  </div>
</aside>`;
}
