/** Venue detail helpers shared by the venues page and the slot panel. */
import {
  PRICE_UNKNOWN_LABEL,
  WEEKDAYS,
  formatMultisport,
  formatPriceFrom,
  formatPriceRule,
  googleMapsUrl,
} from '@spotradar/shared';
import type { MultisportInfo, OpeningHours, Pricing, Venue, Weekday } from '@spotradar/shared';
import { escapeHtml, externalLink } from './html.ts';

export const GOOGLE_MAPS_LINK_TEXT = 'Rating & reviews on Google Maps';

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

export interface HoursGroup {
  /** "Mon–Fri", "Sat" … */
  days: string;
  /** "07:00–22:00" or "Closed" */
  text: string;
}

function dayText(hours: OpeningHours, day: Weekday): string {
  const entry = hours.days[day];
  return entry ? `${entry.open}–${entry.close}` : 'Closed';
}

/** Compact opening hours: consecutive days with identical hours are merged ("Mon–Fri 07:00–22:00"). */
export function groupOpeningHours(hours: OpeningHours): HoursGroup[] {
  const groups: HoursGroup[] = [];
  let start = 0;
  while (start < WEEKDAYS.length) {
    const first = WEEKDAYS[start] as Weekday;
    const text = dayText(hours, first);
    let end = start;
    while (end + 1 < WEEKDAYS.length && dayText(hours, WEEKDAYS[end + 1] as Weekday) === text) {
      end++;
    }
    const last = WEEKDAYS[end] as Weekday;
    const days =
      start === end
        ? WEEKDAY_LABEL[first]
        : `${WEEKDAY_LABEL[first]}${end === start + 1 ? ', ' : '–'}${WEEKDAY_LABEL[last]}`;
    groups.push({ days, text });
    start = end + 1;
  }
  return groups;
}

/**
 * The one MultiSport badge (slot panel, venue list, venue detail), text from
 * `formatMultisport`; an unknown state reads "MultiSport: unknown". The note is the tooltip
 * and short extra text.
 */
export function renderMultisportBadge(multisport: MultisportInfo | undefined): string {
  const cls = multisport?.accepted ? 'badge-multisport' : 'badge-neutral';
  const note = multisport?.note ? multisport.note : '';
  const title = note ? ` title="${escapeHtml(note)}"` : '';
  return `<span class="badge ${cls}" data-testid="multisport"${title}>${escapeHtml(formatMultisport(multisport))}</span>${note ? `<span class="muted fact-terms">${escapeHtml(note)}</span>` : ''}`;
}

/**
 * Short price ("from 280 Kč / h") that expands to the full price table and note.
 * Unknown price: plain "Price on website".
 */
export function renderPriceSummary(pricing: Pricing | undefined): string {
  if (!pricing || pricing.rules.length === 0) {
    return `<span class="muted" data-testid="price-unknown">${escapeHtml(PRICE_UNKNOWN_LABEL)}</span>`;
  }
  const rows = pricing.rules
    .map((rule) => `<li>${escapeHtml(formatPriceRule(rule))}</li>`)
    .join('');
  const note = pricing.note ? `<p class="muted price-note">${escapeHtml(pricing.note)}</p>` : '';
  return `<details class="price-details" data-testid="price-details"><summary>${escapeHtml(formatPriceFrom(pricing))}</summary><ul class="price-rules">${rows}</ul>${note}</details>`;
}

export function googleMapsLink(venue: Pick<Venue, 'name' | 'address'>): string {
  return externalLink(googleMapsUrl(venue), GOOGLE_MAPS_LINK_TEXT);
}
