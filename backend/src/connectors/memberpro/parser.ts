import * as cheerio from 'cheerio';
import type { FreeSlot } from '@spotradar/shared';
import { freeSlotsFromHalfSlots, HALF_SLOT_MINUTES } from '../halfSlots.ts';

/** Thrown when the page is not the expected MemberPro day grid (markup changed, wrong date, ...). */
export class MemberproParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberproParseError';
  }
}

/** "YYYY-MM-DD" -> "DD.MM.YYYY", the date format of the MemberPro pages. */
export function toMemberproDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/** A free cell is titled with its start: "7:00 25.11.2026 středa ". */
const FREE_TITLE_RE = /^(\d{1,2}):(\d{2})\s+(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s|$)/;

/**
 * Parses a MemberPro (memberzone.cz/<club>/) badminton day grid for `date`.
 *
 * One row per court, one `<input type="submit">` per 30-minute cell. Only an enabled
 * `btnrez` cell with a "time date" title is free; blocked ("Blokováno"), closed ("Zavřeno") and
 * any unknown variant count as not free. Courts are aggregated per half-hour and equal
 * neighbours merged. A grid where every cell is blocked (closed day) gives [].
 *
 * Throws MemberproParseError when the grid is missing, when the page is not for `date`
 * (`#DATUM_HF`) or when a free cell belongs to another date.
 */
export function parseMemberproGrid(html: string, date: string): FreeSlot[] {
  const $ = cheerio.load(html);
  const expectedDate = toMemberproDate(date);

  const shown = $('#DATUM_HF').attr('value')?.trim();
  if (shown === undefined) throw new MemberproParseError('No #DATUM_HF found in MemberPro page');
  if (shown !== expectedDate) {
    throw new MemberproParseError(`MemberPro page shows ${shown}, expected ${expectedDate}`);
  }

  // Court rows have inputs; spacer rows (e.g. RADEK_DAY_99) do not.
  const rows = $('tr[id*="RADEK_DAY_"]')
    .toArray()
    .filter((row) => $(row).find('input[type="submit"]').length > 0);
  if (rows.length === 0) throw new MemberproParseError('No court rows found in MemberPro page');

  const freeByStart = new Map<number, Set<string>>();
  rows.forEach((row, courtIndex) => {
    $(row)
      .find('input[type="submit"]')
      .each((_, input) => {
        const cell = $(input);
        // With a duplicated class attribute the HTML parser keeps the first one ("btnrezclose").
        const classes = (cell.attr('class') ?? '').split(/\s+/);
        if (cell.is('[disabled]') || !classes.includes('btnrez')) return;
        const title = FREE_TITLE_RE.exec((cell.attr('title') ?? '').trim());
        if (!title) return;
        const titleDate = `${title[3]?.padStart(2, '0')}.${title[4]?.padStart(2, '0')}.${title[5]}`;
        if (titleDate !== expectedDate) {
          throw new MemberproParseError(
            `Free cell for ${titleDate} on the page of ${expectedDate}`,
          );
        }
        const start = Number(title[1]) * 60 + Number(title[2]);
        if (start % HALF_SLOT_MINUTES !== 0) {
          throw new MemberproParseError(
            `Free cell with unsupported start time ${title[1]}:${title[2]}`,
          );
        }
        // A cell spans colspan/2 half-hours (the grid has 4 columns per hour; normally colspan="2").
        const columns = Number(cell.closest('td').attr('colspan') ?? 2);
        if (!Number.isInteger(columns) || columns < 2 || columns % 2 !== 0) {
          throw new MemberproParseError(`Free cell with unsupported colspan ${columns}`);
        }
        for (let i = 0; i < columns / 2; i++) {
          const at = start + i * HALF_SLOT_MINUTES;
          let courts = freeByStart.get(at);
          if (!courts) {
            courts = new Set();
            freeByStart.set(at, courts);
          }
          courts.add(String(courtIndex));
        }
      });
  });
  return freeSlotsFromHalfSlots(freeByStart);
}
