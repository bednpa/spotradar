/** Venue detail helpers shared by the venues page and the slot panel. */
import {
  PRICE_UNKNOWN_LABEL,
  WEEKDAYS,
  acceptsMultisport,
  courtPriceFrom,
  formatCzk,
  formatMultisport,
  formatMultisportLimits,
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

/** One row of the 7-day tables (opening hours, prices): always Mon … Sun, never merged. */
export interface DayRow {
  /** "Mon" … "Sun" */
  day: string;
  /** "07:00–22:00", "Closed", "07:00–15:00 280 Kč · 15:00–22:00 380 Kč" or "–" */
  text: string;
}

/** Opening hours as 7 rows, one per weekday ("Mon 07:00–22:00", "Sun Closed"). */
export function openingHoursByDay(hours: OpeningHours): DayRow[] {
  return WEEKDAYS.map((day) => {
    const entry = hours.days[day];
    return { day: WEEKDAY_LABEL[day], text: entry ? `${entry.open}–${entry.close}` : 'Closed' };
  });
}

/**
 * Court prices as 7 rows in the same format as the opening hours: each day lists its time
 * ranges with the hourly price ("07:00–15:00 280 Kč · 15:00–22:00 380 Kč"); "–" when the
 * price list has no rule for that day.
 */
export function pricesByDay(pricing: Pricing): DayRow[] {
  return WEEKDAYS.map((day) => {
    const parts = pricing.rules
      .filter((rule) => rule.days.includes(day))
      .toSorted((a, b) => a.from.localeCompare(b.from))
      .map((rule) => `${rule.from}–${rule.to} ${formatCzk(rule.price)}`);
    return { day: WEEKDAY_LABEL[day], text: parts.length > 0 ? parts.join(' · ') : '–' };
  });
}

/** `<ul class="hours">` with one `<li>` per weekday. */
export function renderDayRows(rows: readonly DayRow[]): string {
  const items = rows
    .map(
      (row) =>
        `<li><span class="hours-days">${escapeHtml(row.day)}</span> ${escapeHtml(row.text)}</li>`,
    )
    .join('');
  return `<ul class="hours">${items}</ul>`;
}

/**
 * The one MultiSport badge (slot panel, venue list, venue detail), text from
 * `formatMultisport`; unknown terms read "MultiSport: not available". The note is the tooltip
 * and short extra text.
 */
export function renderMultisportBadge(multisport: MultisportInfo | undefined): string {
  const cls = acceptsMultisport(multisport) ? 'badge-multisport' : 'badge-neutral';
  const limits = formatMultisportLimits(multisport).join(' · ');
  const title = limits ? ` title="${escapeHtml(limits)}"` : '';
  return `<span class="badge ${cls}" data-testid="multisport"${title}>${escapeHtml(formatMultisport(multisport))}</span>${limits ? `<span class="muted venue-ms-limits" data-testid="multisport-limits">${escapeHtml(limits)}</span>` : ''}`;
}

/** "from 280 Kč / h" or, when cards reduce it, "from 280 Kč → 140 Kč / h". */
export function formatPriceFromWithCards(
  pricing: Pricing | undefined,
  multisport: MultisportInfo | undefined,
  cards: number,
): string {
  const price = courtPriceFrom(pricing, multisport, cards);
  if (price === null) return PRICE_UNKNOWN_LABEL;
  if (price.cardsUsed === 0) return `from ${formatCzk(price.basePrice)} / h`;
  return `from ${formatCzk(price.basePrice)} → ${formatCzk(price.payable)} / h`;
}

/**
 * Short price ("from 280 Kč / h", computed with the selected cards) that expands to the
 * per-day price table (Mon … Sun, same format as the opening hours) and note.
 * Unknown price: plain "Price on website".
 */
export function renderPriceSummary(
  pricing: Pricing | undefined,
  multisport?: MultisportInfo,
  cards = 0,
): string {
  if (!pricing || pricing.rules.length === 0) {
    return `<span class="muted" data-testid="price-unknown">${escapeHtml(PRICE_UNKNOWN_LABEL)}</span>`;
  }
  const note = pricing.note ? `<p class="muted price-note">${escapeHtml(pricing.note)}</p>` : '';
  return `<details class="price-details" data-testid="price-details"><summary data-testid="price-from">${escapeHtml(formatPriceFromWithCards(pricing, multisport, cards))}</summary><div class="price-rules">${renderDayRows(pricesByDay(pricing))}</div>${note}</details>`;
}

export function googleMapsLink(venue: Pick<Venue, 'name' | 'address'>): string {
  return externalLink(googleMapsUrl(venue), GOOGLE_MAPS_LINK_TEXT);
}
