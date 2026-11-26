import * as cheerio from 'cheerio';
import type { FreeSlot } from '@spotradar/shared';
import { timeToMinutes } from '@spotradar/shared';
import { HALF_SLOT_MINUTES, freeSlotsFromHalfSlots } from '../halfSlots.ts';

/** Thrown when the answer is not the expected iSportSystem schema (markup changed, day missing, ...). */
export class IsportsystemParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsportsystemParseError';
  }
}

/** Czech weekday names as iSportSystem writes them in the day heading, Sunday first. */
export const CZECH_WEEKDAY_NAMES = [
  'Neděle',
  'Pondělí',
  'Úterý',
  'Středa',
  'Čtvrtek',
  'Pátek',
  'Sobota',
] as const;

/** Czech weekday name of "YYYY-MM-DD". */
export function czechWeekdayName(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return CZECH_WEEKDAY_NAMES[day] ?? '';
}

const HEADING_RE = /^(\S+)\s+(\d{1,2})\.\s*(\d{1,2})\.$/;
const TIME_RE = /^(\d{1,2}:\d{2})$/;
const TITLE_RANGE_RE = /^(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})/;

/** Cell classes that are free to book: "Volno" and "Rezervace pouze telefonicky" (by phone). */
const FREE_CLASSES = ['empty', 'tdNoBooking'];

function fail(message: string): never {
  throw new IsportsystemParseError(`iSportSystem: ${message}`);
}

/**
 * Parses one day of the answer of `POST /ajax/ajax.schema.php` into free slots. The answer holds
 * several days, one `div.schemaFullContainer` per day with an `h3` such as "Čtvrtek 26.11."; the
 * heading has no year, so the container whose day, month and Czech weekday match `date` is the
 * one (this also covers the turn of the year).
 *
 * Each lane (`tr.trSchemaLane_N`, one court) lists 30-minute cells from the first hour of
 * `tr.times`; a cell may span several columns (`colspan`). A cell is free when its class is
 * `empty` ("Volno") or `tdNoBooking` ("Rezervace pouze telefonicky": not taken, the club only
 * books it by phone). `booked`, `old` (already past), technical breaks and any unknown class are
 * not free. The time of a cell comes from its column; the time in its `title` must agree.
 *
 * Throws IsportsystemParseError when the day or its table is missing or the structure changed.
 */
export function parseIsportsystemDay(html: string, date: string): FreeSlot[] {
  const $ = cheerio.load(html);
  const containers = $('div.schemaFullContainer').toArray();
  if (containers.length === 0) fail('no day schema found');
  const [, month, day] = date.split('-').map(Number);
  const weekday = czechWeekdayName(date).toLowerCase();
  const container = containers.find((el) => {
    const match = HEADING_RE.exec($(el).find('h3').first().text().trim());
    return (
      match !== null &&
      Number(match[2]) === day &&
      Number(match[3]) === month &&
      (match[1] ?? '').toLowerCase() === weekday
    );
  });
  if (!container) fail(`day ${date} is not in the answer`);

  const table = $(container).find('table.schema').first();
  if (table.length === 0) fail(`day ${date} has no schema table`);
  const firstHour = TIME_RE.exec(table.find('tr.times td').first().text().trim());
  if (!firstHour) fail('schema has no time header');
  const base = timeToMinutes(firstHour[1] as string);
  if (base % HALF_SLOT_MINUTES !== 0) fail('schema starts at an unexpected time');

  const lanes = table
    .find('tr')
    .toArray()
    .filter((tr) => /(^|\s)trSchemaLane_\d+(\s|$)/.test($(tr).attr('class') ?? ''));
  if (lanes.length === 0) fail('schema has no courts');

  const freeCourtsByStart = new Map<number, Set<string>>();
  lanes.forEach((laneEl, laneIndex) => {
    const lane = $(laneEl);
    const court = lane.children('th').first().text().trim() || `#${laneIndex}`;
    const cells = lane.children('td').toArray();
    if (cells.length === 0) fail(`court ${court} has no cells`);
    let column = 0;
    for (const cellEl of cells) {
      const cell = $(cellEl);
      const span = Number(cell.attr('colspan') ?? '1');
      if (!Number.isInteger(span) || span < 1) fail(`court ${court} has an invalid colspan`);
      const start = base + column * HALF_SLOT_MINUTES;
      const end = start + span * HALF_SLOT_MINUTES;
      column += span;

      const range = TITLE_RANGE_RE.exec((cell.attr('title') ?? '').trim());
      if (
        !range ||
        timeToMinutes(range[1] as string) !== start ||
        timeToMinutes(range[2] as string) !== end
      ) {
        fail(`a cell of ${court} does not match its column (${start})`);
      }
      const classes = (cell.attr('class') ?? '').split(/\s+/);
      if (!FREE_CLASSES.some((c) => classes.includes(c))) continue;
      for (let t = start; t < end; t += HALF_SLOT_MINUTES) {
        const courts = freeCourtsByStart.get(t) ?? new Set<string>();
        courts.add(court);
        freeCourtsByStart.set(t, courts);
      }
    }
  });
  return freeSlotsFromHalfSlots(freeCourtsByStart);
}
