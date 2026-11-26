import * as cheerio from 'cheerio';
import type { FreeSlot } from '@spotradar/shared';
import { addDays, daysBetween, isValidDate } from '@spotradar/shared';
import type { LocalDateTime } from '@spotradar/shared';
import { HALF_SLOT_MINUTES, freeSlotsFromHalfSlots } from '../halfSlots.ts';

/** Thrown when the page is not the expected Komárov timetable (markup changed, date missing, ...). */
export class KomarovParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KomarovParseError';
  }
}

/** Free courts per half-hour: start (minutes since midnight) → court labels. */
export type HalfSlotCourts = Map<number, Set<string>>;

const QUARTER_MINUTES = 15;
const QUARTERS_PER_HOUR = 4;
const DAY_DATE_RE = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;
const HOUR_RE = /^(\d{1,2}):(\d{2})$/;

type CellState = 'free' | 'booked' | 'closed';

/** `free` / `discount` are bookable, `mass` / `single` booked, `closed` is outside opening hours. */
function cellState(classes: string): CellState | undefined {
  const names = classes.split(/\s+/);
  if (names.includes('free') || names.includes('discount')) return 'free';
  if (names.includes('mass') || names.includes('single')) return 'booked';
  if (names.includes('closed')) return 'closed';
  return undefined;
}

/**
 * Parses the week timetable of tenis-komarov.cz/rozvrh/N/ (`section#rezervacni-system
 * table.timetable`) into the free courts per half-hour of every day it shows.
 *
 * The header row names the hour columns (07:00 … 22:00); every day starts with a
 * `th.timetable-day` ("Čt<br>26.11.2026", `rowspan` = number of court rows) followed by one row
 * per court (`td.center` = court label, then one `td` per hour with four 15-minute `div`s).
 * A court is free in a half hour only when both of its quarters are free. Past cells keep their
 * colour on the page, so callers drop started half-hours with `freeSlotsOf`.
 * Throws KomarovParseError for anything unexpected – never partial data.
 */
export function parseKomarovWeek(html: string): Map<string, HalfSlotCourts> {
  const $ = cheerio.load(html);
  const table = $('section#rezervacni-system table.timetable').first();
  if (table.length === 0) throw new KomarovParseError('No Komárov timetable found');

  let hourStarts: number[] | undefined;
  const days = new Map<string, HalfSlotCourts>();
  let current: { date: string; rowsLeft: number; free: HalfSlotCourts } | undefined;

  for (const rowEl of table.find('tr').toArray()) {
    const row = $(rowEl);
    const dayHeader = row.children('th.timetable-day').first();
    const cells = row.children('td').toArray();

    if (dayHeader.length === 0 && cells.length === 0) {
      // The header row; the hour columns are read once.
      if (hourStarts) continue;
      hourStarts = row
        .children('th')
        .toArray()
        .map((th) => HOUR_RE.exec($(th).text().trim()))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => Number(m[1]) * 60 + Number(m[2]));
      if (
        hourStarts.length === 0 ||
        hourStarts.some((h, i) => i > 0 && h <= (hourStarts?.[i - 1] ?? 0))
      ) {
        throw new KomarovParseError('Komárov timetable has no usable hour header');
      }
      continue;
    }
    if (!hourStarts) throw new KomarovParseError('Komárov timetable row before the hour header');

    if (dayHeader.length > 0) {
      if (current && current.rowsLeft !== 0) {
        throw new KomarovParseError(`Komárov day ${current.date} has too few court rows`);
      }
      const match = DAY_DATE_RE.exec(dayHeader.text());
      const date = match
        ? `${match[3]}-${(match[2] as string).padStart(2, '0')}-${(match[1] as string).padStart(2, '0')}`
        : '';
      if (!isValidDate(date)) throw new KomarovParseError('Komárov day heading has no valid date');
      if (days.has(date)) throw new KomarovParseError(`Komárov shows ${date} twice`);
      const rowspan = Number(dayHeader.attr('rowspan') ?? '1');
      if (!Number.isInteger(rowspan) || rowspan < 1) {
        throw new KomarovParseError(`Komárov day ${date} has an invalid rowspan`);
      }
      current = { date, rowsLeft: rowspan, free: new Map() };
      days.set(date, current.free);
    }
    if (!current || current.rowsLeft === 0) {
      throw new KomarovParseError('Komárov timetable row outside of a day');
    }
    current.rowsLeft -= 1;

    const [label, ...hourCells] = cells;
    if (!label || !$(label).hasClass('center')) {
      throw new KomarovParseError(`Komárov day ${current.date} has a row without court label`);
    }
    const court = $(label).text().trim() || `#${current.free.size}`;
    if (hourCells.length !== hourStarts.length) {
      throw new KomarovParseError(`Komárov court ${court} has ${hourCells.length} hour cells`);
    }

    const freeQuarters = new Set<number>();
    hourCells.forEach((cellEl, hourIndex) => {
      const cell = $(cellEl);
      const colspan = cell.attr('colspan');
      if (colspan !== undefined && colspan !== '1') {
        throw new KomarovParseError(`Komárov court ${court} has a spanning cell`);
      }
      const quarters = cell.children('div').toArray();
      if (quarters.length !== QUARTERS_PER_HOUR) {
        throw new KomarovParseError(`Komárov court ${court} has an hour without 4 quarters`);
      }
      quarters.forEach((quarterEl, q) => {
        const state = cellState($(quarterEl).attr('class') ?? '');
        if (state === undefined) {
          throw new KomarovParseError(`Komárov court ${court} has an unknown cell class`);
        }
        if (state === 'free') {
          freeQuarters.add((hourStarts?.[hourIndex] ?? 0) + q * QUARTER_MINUTES);
        }
      });
    });
    for (const start of freeQuarters) {
      if (start % HALF_SLOT_MINUTES !== 0) continue;
      if (!freeQuarters.has(start + QUARTER_MINUTES)) continue;
      const courts = current.free.get(start) ?? new Set<string>();
      courts.add(court);
      current.free.set(start, courts);
    }
  }
  if (current && current.rowsLeft !== 0) {
    throw new KomarovParseError(`Komárov day ${current.date} has too few court rows`);
  }
  if (days.size === 0) throw new KomarovParseError('Komárov timetable shows no day');
  return days;
}

/**
 * The free slots of one parsed day. Half-hours that already started on `now.date` (the page
 * keeps the colour of past cells) are dropped; earlier days have nothing left.
 */
export function freeSlotsOf(
  halfSlots: HalfSlotCourts,
  date: string,
  now?: LocalDateTime,
): FreeSlot[] {
  if (!now || date > now.date) return freeSlotsFromHalfSlots(halfSlots);
  if (date < now.date) return [];
  return freeSlotsFromHalfSlots(new Map([...halfSlots].filter(([start]) => start > now.minutes)));
}

/** Free slots of `date` ("YYYY-MM-DD") in the week page; KomarovParseError when it is not shown. */
export function parseKomarovDay(html: string, date: string, now?: LocalDateTime): FreeSlot[] {
  const halfSlots = parseKomarovWeek(html).get(date);
  if (!halfSlots) throw new KomarovParseError(`Komárov timetable does not show ${date}`);
  return freeSlotsOf(halfSlots, date, now);
}

/** Monday of the week of `date` ("YYYY-MM-DD"). */
export function mondayOf(date: string): string {
  const jsDay = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((jsDay + 6) % 7));
}

/**
 * Week offset of `/rozvrh/<N>/`: whole weeks from the Monday of `today` to the Monday of `date`
 * (0 = this week). Negative when `date` lies before the current week (the site has no history).
 */
export function komarovWeekOffset(date: string, today: string): number {
  return Math.round(daysBetween(mondayOf(today), mondayOf(date)) / 7);
}
