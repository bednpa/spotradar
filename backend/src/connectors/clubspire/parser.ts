import * as cheerio from 'cheerio';
import type { FreeSlot } from '@spotradar/shared';
import { minutesToTime } from '@spotradar/shared';

/** Thrown when the page is not a ClubSpire timeline at all (markup changed, error page, ...). */
export class ClubspireParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClubspireParseError';
  }
}

interface Column {
  /** Minutes since midnight. */
  start: number;
  length: number;
}

interface Interval {
  start: number;
  end: number;
  free: boolean;
}

const DEFAULT_COLUMN_MINUTES = 60;
const HEADER_TIME_RE = /^(\d{1,2}):(\d{2})$/;

/** Booked / closed markers win over "can book" markers (see ClubSpire "substitute" cells). */
const NOT_FREE_CLASSES = ['full', 'full_substitute', 'disabled'];
const FREE_CLASSES = ['can_book', 'can_book_substitute'];

function isFree(classAttr: string | undefined): boolean {
  const classes = (classAttr ?? '').split(/\s+/).filter((c) => c !== '');
  if (classes.some((c) => NOT_FREE_CLASSES.includes(c))) return false;
  return classes.some((c) => FREE_CLASSES.includes(c));
}

function parseColspan(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** Column start times come from the header (never hard-coded); length = distance to the next column. */
function readColumns($: cheerio.CheerioAPI): Column[] {
  const starts: number[] = [];
  $('#hours_head table.schedule tr td[id^="time_col_"]').each((_, el) => {
    const match = HEADER_TIME_RE.exec($(el).text().trim());
    if (match) starts.push(Number(match[1]) * 60 + Number(match[2]));
  });
  const columns: Column[] = [];
  let previousLength = DEFAULT_COLUMN_MINUTES;
  starts.forEach((start, i) => {
    const next = starts[i + 1];
    const diff = next === undefined ? previousLength : next - start;
    const length = diff > 0 ? diff : DEFAULT_COLUMN_MINUTES;
    columns.push({ start, length });
    previousLength = length;
  });
  return columns;
}

/** Splits a cell into time intervals: "zoom" cells hold equally sized sub-cells. */
function cellIntervals(
  $: cheerio.CheerioAPI,
  cell: ReturnType<cheerio.CheerioAPI>,
  start: number,
  end: number,
): Interval[] {
  if (cell.hasClass('zoom')) {
    const subCells = cell.find('tr.zoom_items > td').toArray();
    if (subCells.length > 0) {
      const step = (end - start) / subCells.length;
      return subCells.map((sub, i) => ({
        start: start + i * step,
        end: start + (i + 1) * step,
        free: isFree($(sub).attr('class')),
      }));
    }
  }
  return [{ start, end, free: isFree(cell.attr('class')) }];
}

/**
 * Parses a ClubSpire "timeline/day" page into the free slots of the whole venue
 * (courts aggregated per time interval, finest granularity present, not merged).
 *
 * Returns [] when the page has a schedule but no usable header/rows; throws
 * ClubspireParseError when the page contains no schedule table at all.
 */
export interface ClubspireParseOptions {
  /**
   * Only rows whose court name (`#activities_halls li.hall` with the row's id) starts with
   * one of these prefixes, case-insensitive. Absent = every row.
   */
  courtNamePrefixes?: readonly string[];
}

/** Court name per row id, from the left-hand list (`li.hall#<row id>`). */
function readCourtNames($: cheerio.CheerioAPI): Map<string, string> {
  const names = new Map<string, string>();
  $('#activities_halls li.hall[id]').each((_, el) => {
    const id = $(el).attr('id');
    if (id) names.set(id, $(el).text().trim());
  });
  return names;
}

export function parseClubspireTimeline(
  html: string,
  options: ClubspireParseOptions = {},
): FreeSlot[] {
  const $ = cheerio.load(html);
  if ($('table.schedule').length === 0) {
    throw new ClubspireParseError('No schedule table found in ClubSpire page');
  }

  const columns = readColumns($);
  if (columns.length === 0) return [];

  const prefixes = options.courtNamePrefixes?.map((p) => p.toLocaleLowerCase('cs'));
  const courtNames = prefixes ? readCourtNames($) : new Map<string, string>();
  if (prefixes && courtNames.size === 0) {
    // A filter without names would silently count nothing (or everything): markup changed.
    throw new ClubspireParseError('No court names found for the court filter');
  }

  const courts: Interval[][] = [];
  $('#hours_body table.schedule tr[data-row-id]').each((_, rowEl) => {
    if (prefixes) {
      const name = courtNames.get($(rowEl).attr('data-row-id') ?? '')?.toLocaleLowerCase('cs');
      if (name === undefined || !prefixes.some((p) => name.startsWith(p))) return;
    }
    const intervals: Interval[] = [];
    let position = 0;
    // Only direct cells: nested zoom tables are handled per cell. Disabled cells carry
    // no data-time-id, so cells are mapped to header columns by position + colspan.
    for (const cellEl of $(rowEl).children('td').toArray()) {
      const cell = $(cellEl);
      const span = parseColspan(cell.attr('colspan'));
      const first = columns[position];
      const last = columns[Math.min(position + span, columns.length) - 1];
      position += span;
      if (!first || !last) continue;
      intervals.push(...cellIntervals($, cell, first.start, last.start + last.length));
    }
    courts.push(intervals);
  });

  const boundaries = new Set<number>();
  for (const court of courts) {
    for (const interval of court) {
      boundaries.add(interval.start);
      boundaries.add(interval.end);
    }
  }
  const points = [...boundaries].sort((a, b) => a - b);

  const slots: FreeSlot[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const start = points[i] as number;
    const end = points[i + 1] as number;
    const freeCourts = courts.filter((court) =>
      court.some((iv) => iv.free && iv.start <= start && end <= iv.end),
    ).length;
    if (freeCourts >= 1) {
      slots.push({
        start: minutesToTime(Math.round(start)),
        end: minutesToTime(Math.round(end)),
        freeCourts,
      });
    }
  }
  return slots;
}
