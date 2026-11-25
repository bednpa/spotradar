import * as cheerio from 'cheerio';
import type { FreeSlot } from '@spotradar/shared';
import { daysBetween, isValidDate } from '@spotradar/shared';
import { freeSlotsFromHalfSlots, HALF_SLOT_MINUTES } from '../halfSlots.ts';

/** The page (or A4J fragment) does not look like the Bizzy schedule we recorded. */
export class BizzyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BizzyParseError';
  }
}

/** View key of "today + 7 days": 8 grids (days) in one page. */
export const VIEW_EIGHT_DAYS = 'horizontal_service_dayandweek';

/**
 * One day of one venue: the free courts per table column.
 * `start` is minutes since midnight; every column lasts `stepMinutes` (30 or 60).
 */
export interface BizzyDay {
  stepMinutes: number;
  cells: { start: number; courts: string[] }[];
}

export interface BizzyParseOptions {
  /**
   * "YYYY-MM-DD" near the dates on the page. Only needed when the page does not carry its own
   * calendar input (A4J date-change responses are bare fragments): the headers show `28/11`
   * without a year, so the year is inferred as the one that puts the date closest to this.
   */
  referenceDate?: string;
}

// --- Recorded structure (2026-11-25 fixtures) --------------------------------------------------
//
// `var scheduleData = {grids: [...], events: [...], pastTimeData: [...]}` plus one
// `table#schedule_<gridId>` per grid. Verified against all 12 fixtures:
//  - Orientation of `events[].start/end = [col, row]`: `col` indexes the time columns (the
//    `th.scheduleTimeHeader` labels, grid.cols of them), `row` indexes the courts
//    (`th.horizontalRowHeader`, grid.rows of them). The table cells carry ids
//    `sched_<gridId>_i_<row>_<col>` in row-major order, which is checked for every cell below.
//    Every event of every fixture stays inside cols x rows (e.g. Lisen: cols 28, rows 6, event
//    [27,5]; Jehnice: cols 15, rows 5, event [14,4]); swapping the axes would put events out of
//    range, which this parser rejects.
//  - Both ends are inclusive and the event covers the whole rectangle: Lisen 28/11 has
//    start [24,0] end [27,5] = all six courts from 20:00 to 22:00; start [4,5] end [7,5] = one
//    court for four half-hours.
//  - Column length follows from the header labels: hourly at Jehnice and X-Arena (7:00, 8:00,
//    ...), half-hourly at Líšeň (7:00, 7:30, ...). Weekend days have fewer/other columns.
//  - `pastTimeData[gridIndex][row]` = index of the last column that has already started (-1 =
//    none). Recorded at 19:42: hourly grids show 12 (19:00 column), Líšeň's half-hour grid 25
//    (19:30 column). Those cells can no longer be booked, so they are not free.

interface RawGrid {
  id: number;
  cols: number;
  rows: number;
  closed: boolean;
  tableId: string;
}

interface RawEvent {
  gridId: number;
  start: [number, number];
  end: [number, number];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Text of the JSON object assigned to `var scheduleData` (brace matching, string aware). */
export function extractScheduleJson(html: string): string {
  const marker = /var\s+scheduleData\s*=\s*/.exec(html);
  if (!marker) throw new BizzyParseError('Bizzy page has no "var scheduleData"');
  const start = marker.index + marker[0].length;
  if (html[start] !== '{') throw new BizzyParseError('Bizzy scheduleData is not an object');
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new BizzyParseError('Bizzy scheduleData is not terminated');
}

function readGrids(data: Record<string, unknown>): RawGrid[] {
  const raw = data.grids;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BizzyParseError('Bizzy scheduleData has no grids');
  }
  const grids = raw.map((g: unknown): RawGrid => {
    if (!isRecord(g) || !isInt(g.id) || !isInt(g.cols) || !isInt(g.rows)) {
      throw new BizzyParseError('Bizzy grid without id/cols/rows');
    }
    if (g.cols < 0 || g.rows < 0) throw new BizzyParseError('Bizzy grid with negative size');
    if (g.closed !== undefined && typeof g.closed !== 'boolean') {
      throw new BizzyParseError('Bizzy grid with unexpected "closed" value');
    }
    return {
      id: g.id,
      cols: g.cols,
      rows: g.rows,
      closed: g.closed === true,
      tableId: typeof g.tableId === 'string' ? g.tableId : `schedule_${g.id}`,
    };
  });
  if (new Set(grids.map((g) => g.id)).size !== grids.length) {
    throw new BizzyParseError('Bizzy grids have duplicate ids');
  }
  return grids;
}

function readCell(value: unknown, what: string): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !isInt(value[0]) || !isInt(value[1])) {
    throw new BizzyParseError(`Bizzy event has an invalid ${what}`);
  }
  return [value[0], value[1]];
}

function readEvents(data: Record<string, unknown>): RawEvent[] {
  const raw = data.events;
  if (!Array.isArray(raw)) throw new BizzyParseError('Bizzy scheduleData has no events array');
  return raw.map((e: unknown): RawEvent => {
    if (!isRecord(e) || !isInt(e.gridId)) throw new BizzyParseError('Bizzy event without gridId');
    return { gridId: e.gridId, start: readCell(e.start, 'start'), end: readCell(e.end, 'end') };
  });
}

/** `pastTimeData[gridIndex][row]` = last already started column; undefined when absent. */
function readPast(data: Record<string, unknown>, grids: RawGrid[]): number[][] | undefined {
  const raw = data.pastTimeData;
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length !== grids.length) {
    throw new BizzyParseError('Bizzy pastTimeData does not match the grids');
  }
  return raw.map((perRow: unknown, i): number[] => {
    const grid = grids[i];
    if (!grid || !Array.isArray(perRow) || perRow.length !== grid.rows || !perRow.every(isInt)) {
      throw new BizzyParseError('Bizzy pastTimeData does not match the grid rows');
    }
    return perRow as number[];
  });
}

const CZECH_WEEKDAYS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

function utcWeekday(date: string): string {
  return CZECH_WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
}

/** The date the page is "about": calendar input, else calendar widget, else the caller's hint. */
function referenceDateOf(
  $: cheerio.CheerioAPI,
  html: string,
  options: BizzyParseOptions,
): string | undefined {
  const input = $('input[id$="schedule_calendarInputDate"]').attr('value') ?? '';
  const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(input.trim());
  if (dmy) {
    const date = `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
    if (isValidDate(date)) return date;
  }
  const widget = /'selectedDate':new Date\((\d{4}),(\d{1,2}),(\d{1,2})/.exec(html);
  if (widget) {
    const date = `${widget[1]}-${String(Number(widget[2]) + 1).padStart(2, '0')}-${String(widget[3]).padStart(2, '0')}`;
    if (isValidDate(date)) return date;
  }
  return options.referenceDate;
}

/**
 * "So 28/11" -> "2026-11-28". The year is the one (reference year -1, 0, +1) that lands closest
 * to `reference`, which handles December -> January; the Czech weekday abbreviation must match
 * the resulting date, so a wrong year or a stale page is detected instead of mislabelled.
 */
function resolveHeaderDate(label: string, reference: string): string {
  const m = /^(\S+)\s+(\d{1,2})\/(\d{1,2})$/u.exec(label.replace(/\s+/g, ' ').trim());
  if (!m) throw new BizzyParseError(`Bizzy day header "${label}" is not "<weekday> D/M"`);
  const day = Number(m[2]);
  const month = Number(m[3]);
  const refYear = Number(reference.slice(0, 4));
  let best: string | undefined;
  for (const year of [refYear - 1, refYear, refYear + 1]) {
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isValidDate(candidate)) continue;
    if (
      best === undefined ||
      Math.abs(daysBetween(reference, candidate)) < Math.abs(daysBetween(reference, best))
    ) {
      best = candidate;
    }
  }
  if (!best) throw new BizzyParseError(`Bizzy day header "${label}" is not a valid date`);
  if (utcWeekday(best) !== m[1]) {
    throw new BizzyParseError(`Bizzy day header "${label}" does not match ${best}`);
  }
  return best;
}

function parseClock(label: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(label.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new BizzyParseError(`Bizzy hour label "${label}" is not H:MM`);
  }
  return Number(m[1]) * 60 + Number(m[2]);
}

function readDay(
  $: cheerio.CheerioAPI,
  grid: RawGrid,
  events: RawEvent[],
  past: number[] | undefined,
  reference: string,
): { date: string; day: BizzyDay } {
  const table = $(`[id="${grid.tableId}"]`);
  if (table.length !== 1 || !table.is('table')) {
    throw new BizzyParseError(`Bizzy grid ${grid.id} has no table#${grid.tableId}`);
  }
  const label =
    table.find('caption .group.date').first().text() ||
    table.find('th.schedule_table_day_header_cell').first().text();
  const date = resolveHeaderDate(label, reference);
  if (grid.closed) return { date, day: { stepMinutes: 60, cells: [] } };

  const labels = table
    .find('tr.heading th.scheduleTimeHeader')
    .map((_, el) => $(el).text())
    .get();
  if (labels.length !== grid.cols || grid.cols < 2) {
    throw new BizzyParseError(
      `Bizzy grid ${grid.id}: ${labels.length} hour labels for ${grid.cols} columns`,
    );
  }
  const starts = labels.map(parseClock);
  const step = (starts[1] ?? 0) - (starts[0] ?? 0);
  if (
    (step !== HALF_SLOT_MINUTES && step !== 2 * HALF_SLOT_MINUTES) ||
    starts.some((s, i) => s !== (starts[0] ?? 0) + i * step) ||
    (starts[starts.length - 1] ?? 0) + step > 24 * 60
  ) {
    throw new BizzyParseError(`Bizzy grid ${grid.id}: irregular hour labels ${labels.join(',')}`);
  }

  if (table.find('th.horizontalRowHeader').length !== grid.rows) {
    throw new BizzyParseError(`Bizzy grid ${grid.id}: court rows do not match ${grid.rows}`);
  }
  const cells = table.find('td.scheduleCell');
  if (cells.length !== grid.rows * grid.cols) {
    throw new BizzyParseError(`Bizzy grid ${grid.id}: ${cells.length} cells in the table`);
  }
  cells.each((n, el) => {
    const expected = `sched_${grid.id}_i_${Math.floor(n / grid.cols)}_${n % grid.cols}`;
    if ($(el).attr('id') !== expected) {
      throw new BizzyParseError(`Bizzy grid ${grid.id}: cell ${n} is not ${expected}`);
    }
  });

  const taken: boolean[][] = Array.from({ length: grid.rows }, () =>
    new Array<boolean>(grid.cols).fill(false),
  );
  for (const event of events) {
    if (event.gridId !== grid.id) continue;
    const [c1, r1] = event.start;
    const [c2, r2] = event.end;
    if (c1 < 0 || r1 < 0 || c2 < c1 || r2 < r1 || c2 >= grid.cols || r2 >= grid.rows) {
      throw new BizzyParseError(
        `Bizzy event [${c1},${r1}]-[${c2},${r2}] is outside grid ${grid.id} (${grid.cols}x${grid.rows})`,
      );
    }
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) (taken[r] as boolean[])[c] = true;
    }
  }
  if (past) {
    for (let r = 0; r < grid.rows; r++) {
      const lastPast = past[r] ?? -1;
      for (let c = 0; c <= Math.min(lastPast, grid.cols - 1); c++)
        (taken[r] as boolean[])[c] = true;
    }
  }

  return {
    date,
    day: {
      stepMinutes: step,
      cells: starts.map((start, c) => ({
        start,
        courts: taken.flatMap((row, r) => (row[c] ? [] : [String(r)])),
      })),
    },
  };
}

/**
 * Parses a full Bizzy schedule page or an A4J fragment into one `BizzyDay` per date shown
 * (1 day in the one-day view, 8 in "today + 7 days"). Throws `BizzyParseError` on anything
 * unexpected; never returns partial data.
 */
export function parseBizzyDays(
  html: string,
  options: BizzyParseOptions = {},
): Map<string, BizzyDay> {
  let data: unknown;
  try {
    data = JSON.parse(extractScheduleJson(html));
  } catch (err) {
    if (err instanceof BizzyParseError) throw err;
    throw new BizzyParseError('Bizzy scheduleData is not valid JSON');
  }
  if (!isRecord(data)) throw new BizzyParseError('Bizzy scheduleData is not an object');
  const grids = readGrids(data);
  const events = readEvents(data);
  const past = readPast(data, grids);
  const known = new Set(grids.map((g) => g.id));
  if (events.some((e) => !known.has(e.gridId))) {
    throw new BizzyParseError('Bizzy event refers to an unknown grid');
  }

  const $ = cheerio.load(html);
  const reference = referenceDateOf($, html, options);
  if (!reference) throw new BizzyParseError('Bizzy page has no calendar date to infer the year');

  const days = new Map<string, BizzyDay>();
  grids.forEach((grid, i) => {
    const { date, day } = readDay($, grid, events, past?.[i], reference);
    if (days.has(date)) throw new BizzyParseError(`Bizzy page shows ${date} twice`);
    days.set(date, day);
  });
  return days;
}

/**
 * Free slots of one day, sorted by start. Columns that start before `notBeforeMinutes` (minutes
 * since midnight of that day, may be negative) are not free, e.g. for a minimum booking lead.
 */
export function bizzyDaySlots(day: BizzyDay, notBeforeMinutes?: number): FreeSlot[] {
  const halfSlots = new Map<number, ReadonlySet<string>>();
  for (const cell of day.cells) {
    if (notBeforeMinutes !== undefined && cell.start < notBeforeMinutes) continue;
    const courts = new Set(cell.courts);
    for (let offset = 0; offset < day.stepMinutes; offset += HALF_SLOT_MINUTES) {
      halfSlots.set(cell.start + offset, courts);
    }
  }
  return freeSlotsFromHalfSlots(halfSlots);
}

/** Pure HTML -> `Map<"YYYY-MM-DD", FreeSlot[]>` for every day on the page. */
export function parseBizzySchedule(
  html: string,
  options: BizzyParseOptions = {},
): Map<string, FreeSlot[]> {
  const result = new Map<string, FreeSlot[]>();
  for (const [date, day] of parseBizzyDays(html, options)) result.set(date, bizzyDaySlots(day));
  return result;
}

// --- Navigation (A4J postbacks) ----------------------------------------------------------------

export interface BizzyNav {
  /** Form action (relative or absolute); POST target of the A4J requests. */
  actionUrl: string;
  viewState: string;
  /** The hidden `scheduleNavigForm:j_idNNN` input and its value (differ per venue). */
  hiddenName: string;
  hiddenValue: string;
  /** Component id sent as `<id>=<id>` to change the date (date picker `onchanged`). */
  dateChangeId: string;
  /** Component id sent as `<id>=<id>` to change the view (`view_filter_menu` `onchange`). */
  viewChangeId: string;
  /** Current value of `schedule_calendarInputDate` ("25.11.2026"). */
  inputDate: string;
  /** Current value of `schedule_calendarInputCurrentDate` ("11/2026"). */
  inputCurrentDate: string;
}

const COMPONENT_ID = /^scheduleNavigForm:[A-Za-z0-9_-]+$/;

/** `javax.faces.ViewState` of a page or A4J response, if there is one. */
export function readViewState(html: string): string | undefined {
  const $ = cheerio.load(html);
  return $('input[name="javax.faces.ViewState"]').first().attr('value') || undefined;
}

/** Value of the selected `view_filter_menu` option (undefined when not shown). */
export function readSelectedView(html: string): string | undefined {
  const $ = cheerio.load(html);
  return (
    $('select[id="scheduleNavigForm:view_filter_menu"] option[selected]').first().attr('value') ||
    undefined
  );
}

/**
 * Reads what the A4J postbacks need from the GET page. The `j_idNNN` ids differ per venue, so
 * nothing is hard-coded; anything missing throws `BizzyParseError`.
 */
export function parseBizzyNav(html: string): BizzyNav {
  const $ = cheerio.load(html);
  const form = $('form[id="scheduleNavigForm"]');
  const actionUrl = form.attr('action');
  if (!actionUrl) throw new BizzyParseError('Bizzy page has no scheduleNavigForm action');

  const viewState = form.find('input[name="javax.faces.ViewState"]').first().attr('value');
  if (!viewState) throw new BizzyParseError('Bizzy page has no javax.faces.ViewState');

  const hidden = form
    .find('input[type="hidden"]')
    .filter((_, el) => /^scheduleNavigForm:j_id\d+$/.test($(el).attr('name') ?? ''))
    .first();
  const hiddenName = hidden.attr('name');
  if (!hiddenName)
    throw new BizzyParseError('Bizzy page has no scheduleNavigForm:j_id hidden input');

  const dateMatch =
    /new Calendar\('scheduleNavigForm:schedule_calendar'[\s\S]*?'onchanged'\s*:\s*function[\s\S]*?'parameters'\s*:\s*\{\s*'([^']+)'/.exec(
      html,
    );
  const dateChangeId = dateMatch?.[1];
  if (!dateChangeId || !COMPONENT_ID.test(dateChangeId)) {
    throw new BizzyParseError('Bizzy page has no date picker action id');
  }

  const onchange = form.find('select[id="scheduleNavigForm:view_filter_menu"]').attr('onchange');
  const viewChangeId = /'parameters'\s*:\s*\{\s*'([^']+)'/.exec(onchange ?? '')?.[1];
  if (!viewChangeId || !COMPONENT_ID.test(viewChangeId)) {
    throw new BizzyParseError('Bizzy page has no view menu action id');
  }

  const inputDate = form
    .find('input[id="scheduleNavigForm:schedule_calendarInputDate"]')
    .attr('value');
  const inputCurrentDate = form
    .find('input[id="scheduleNavigForm:schedule_calendarInputCurrentDate"]')
    .attr('value');
  if (!inputDate || !inputCurrentDate) {
    throw new BizzyParseError('Bizzy page has no calendar input values');
  }

  return {
    actionUrl,
    viewState,
    hiddenName,
    hiddenValue: hidden.attr('value') ?? '',
    dateChangeId,
    viewChangeId,
    inputDate,
    inputCurrentDate,
  };
}
