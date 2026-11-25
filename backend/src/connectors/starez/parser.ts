import * as cheerio from 'cheerio';
import type { FreeSlot } from '@spotradar/shared';
import { timeToMinutes } from '@spotradar/shared';
import { HALF_SLOT_MINUTES, freeSlotsFromHalfSlots } from '../halfSlots.ts';

/** Thrown when the page is not the expected STAREZ reservation grid (markup changed, other day, ...). */
export class StarezParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StarezParseError';
  }
}

/** Reservation name STAREZ gives a free, bookable cell ("free to book", with a deposit). */
export const FREE_RESERVATION_NAME = 'volno k rezervaci';

const BLOCK_TIME_RE = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/;

/**
 * The HTML of the reservation grid in a STAREZ answer: the full page (plain GET) or the
 * `snippet--reservation` of the JSON answer to the AJAX date switch (`?date=…&do=getDate`).
 */
export function starezReservationHtml(body: string): string {
  const trimmed = body.trimStart();
  if (!trimmed.startsWith('{')) return body;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new StarezParseError('STAREZ answer is neither HTML nor valid JSON');
  }
  const snippet = (json as { snippets?: Record<string, unknown> } | null)?.snippets?.[
    'snippet--reservation'
  ];
  if (typeof snippet !== 'string') {
    throw new StarezParseError('STAREZ JSON answer has no snippet--reservation');
  }
  return snippet;
}

/**
 * Parses the STAREZ reservation grid (e.g. beach.starez.cz/vstupenky-rezervace) of the
 * facility group titled `facility` on `date` ("YYYY-MM-DD") into free slots.
 *
 * A row (`.facility-group__unit-row`) is one court; each `div.block` cell carries its time
 * range in `.block-time` ("15:00-16:00"). A cell is free only when its reservation name is
 * "volno k rezervaci"; booked cells carry the customer's name, grey cells without a
 * reservation are not available. Throws StarezParseError when the page shows another day,
 * the facility is missing or the cells cannot be read – never partial data.
 */
export function parseStarezGrid(body: string, date: string, facility: string): FreeSlot[] {
  const $ = cheerio.load(starezReservationHtml(body));
  const reservation = $('.reservation[data-active-date]').first();
  if (reservation.length === 0) throw new StarezParseError('No STAREZ reservation grid found');
  const shown = reservation.attr('data-active-date');
  if (shown !== date) throw new StarezParseError(`STAREZ page shows ${shown}, not ${date}`);

  const group = $('.facility--grouped')
    .filter((_, el) => $(el).find('.facility-group__title').first().text().trim() === facility)
    .first();
  if (group.length === 0) throw new StarezParseError(`STAREZ facility "${facility}" not found`);

  const rows = group.find('.facility-group__unit-row').toArray();
  if (rows.length === 0) throw new StarezParseError(`STAREZ facility "${facility}" has no courts`);

  const freeCourtsByStart = new Map<number, Set<string>>();
  rows.forEach((rowEl, rowIndex) => {
    const court =
      $(rowEl).find('.facility-group__unit-label').first().text().trim() || `#${rowIndex}`;
    const blocks = $(rowEl).find('div.block').toArray();
    if (blocks.length === 0) throw new StarezParseError(`STAREZ court ${court} has no cells`);
    for (const blockEl of blocks) {
      const block = $(blockEl);
      const match = BLOCK_TIME_RE.exec(block.find('.block-time').first().text().trim());
      if (!match) throw new StarezParseError(`STAREZ cell of ${court} has no time range`);
      const start = timeToMinutes(match[1] as string);
      const end = timeToMinutes(match[2] as string);
      if (!(start < end) || start % HALF_SLOT_MINUTES !== 0 || end % HALF_SLOT_MINUTES !== 0) {
        throw new StarezParseError(`STAREZ cell of ${court} has an unexpected time range`);
      }
      if (block.attr('data-reservation-name')?.trim() !== FREE_RESERVATION_NAME) continue;
      for (let t = start; t < end; t += HALF_SLOT_MINUTES) {
        const courts = freeCourtsByStart.get(t) ?? new Set<string>();
        courts.add(court);
        freeCourtsByStart.set(t, courts);
      }
    }
  });
  return freeSlotsFromHalfSlots(freeCourtsByStart);
}

/** "2026-11-26" → "26.11.2026" (the `date` parameter of the STAREZ date switch). */
export function toStarezDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}
