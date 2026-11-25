/** Sport labels, chips and season texts shared by the calendar and the venue list. */
import { BOOKING_SYSTEM_LABELS, SPORTS, isInSeason, sportInfo } from '@spotradar/shared';
import type { BookingSystem, OpeningHours, Season, SportId } from '@spotradar/shared';
import { escapeHtml } from './html.ts';

/**
 * "🏸 Badminton" as HTML: the icon is decorative (aria-hidden), so the accessible name is
 * the English name; the Czech name is the tooltip.
 */
export function renderSportLabel(id: SportId): string {
  const sport = sportInfo(id);
  return `<span class="sport-icon" aria-hidden="true">${escapeHtml(sport.icon)}</span> <span title="${escapeHtml(sport.nameCs)}">${escapeHtml(sport.name)}</span>`;
}

/**
 * One chip per sport (`SPORTS` order). `dataAttr` names the data attribute carrying the id
 * ("sport" on the calendar, "venue-sport" on the venue list).
 */
export function renderSportChipButtons(
  selected: SportId | null,
  dataAttr: 'sport' | 'venue-sport',
): string {
  return SPORTS.map(
    (sport) =>
      `<button type="button" class="chip chip-sport" data-${dataAttr}="${sport.id}" aria-pressed="${sport.id === selected}" lang="en">${renderSportLabel(sport.id)}</button>`,
  ).join('');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "05-01" → "1 May". */
function monthDay(value: string): string {
  const [month, day] = value.split('-').map(Number);
  return `${day ?? ''} ${MONTHS[(month ?? 1) - 1] ?? ''}`.trim();
}

/** "Season 1 May – 30 Sep". */
export function formatSeason(season: Season): string {
  return `Season ${monthDay(season.from)} – ${monthDay(season.to)}`;
}

/** True when the hours have a season and `date` lies outside it. */
export function isOutOfSeason(hours: OpeningHours | undefined, date: string): boolean {
  return hours?.season !== undefined && !isInSeason(hours.season, date);
}

export function bookingSystemLabel(system: BookingSystem): string {
  return BOOKING_SYSTEM_LABELS[system];
}
