import { extractScheduleJson } from './parser.ts';

/** Czech weekday abbreviations as Bizzy prints them (index = `Date#getUTCDay`). */
const WEEKDAYS = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];

/** The recorded week's Thursday 26.11.2026: every stubbed day is a copy of this grid. */
const SOURCE_GRID_ID = 1;

function addDaysUtc(date: string, days: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Stub mode: Bizzy fixture has an unexpected scheduleData');
  }
  return value as Record<string, unknown>;
}

function gridsOf(data: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(data.grids)) throw new Error('Stub mode: Bizzy fixture has no grids');
  return data.grids.map(asRecord);
}

/**
 * A recorded Bizzy page (`shell`) with its schedule replaced by `days` identical days starting at
 * `start` ("YYYY-MM-DD"), where `days` is the number of grids the shell shows (1 or 8).
 *
 *  - Every day is a copy of the recorded Thursday 26.11.2026 grid taken from `source` (a recorded
 *    "today + 7 days" response): same bookings, same free hours on every date, so tests can rely
 *    on them. Weekend days therefore show the weekday hours.
 *  - Table ids, cell ids, the day headers (weekday and `D/M`), the calendar input
 *    (`d.M.yyyy`, `M/yyyy`) and the calendar widget's dates are rewritten so the real parser
 *    accepts the page for any date, including across a year boundary.
 *  - `pastTimeData` is all -1: no cell counts as already past, so today's early hours stay free
 *    whatever the clock says (the connector's `minLeadMinutes` rule still uses the real clock).
 */
export function bizzyPageStartingAt(shell: string, source: string, start: string): string {
  const shellJson = extractScheduleJson(shell);
  const shellData = asRecord(JSON.parse(shellJson));
  const days = gridsOf(shellData).length;
  const sourceData = asRecord(JSON.parse(extractScheduleJson(source)));
  const sourceGrid = gridsOf(sourceData).find((g) => g.id === SOURCE_GRID_ID);
  const sourceEvents = Array.isArray(sourceData.events)
    ? sourceData.events.map(asRecord).filter((e) => e.gridId === SOURCE_GRID_ID)
    : undefined;
  const sourceTable = new RegExp(
    `<table class="schedule" id="schedule_${SOURCE_GRID_ID}"[\\s\\S]*?</table>`,
  ).exec(source)?.[0];
  if (!sourceGrid || !sourceEvents || !sourceTable) {
    throw new Error('Stub mode: Bizzy source fixture has no usable grid');
  }
  const rows = Number(sourceGrid.rows);

  const dates = Array.from({ length: days }, (_, i) => addDaysUtc(start, i));
  const tables = dates.map((d, i) => {
    const weekday = WEEKDAYS[d.getUTCDay()] ?? '';
    const label = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
    return sourceTable
      .replace(`id="schedule_${SOURCE_GRID_ID}"`, `id="schedule_${i}"`)
      .replaceAll(`sched_${SOURCE_GRID_ID}_i_`, `sched_${i}_i_`)
      .replace(
        /(<span class="group date">)[^<]*(<\/span>)/,
        (_, open: string, close: string) => `${open}${weekday} ${label}${close}`,
      )
      .replace(
        /(<th class="schedule_table_day_header_cell">)[^<]*<span class="header_date_part">[^<]*<\/span>/,
        (_, open: string) => `${open}${weekday} <span class="header_date_part">${label}</span>`,
      );
  });

  const data = {
    ...shellData,
    grids: dates.map((_, i) => ({ ...sourceGrid, id: i, tableId: `schedule_${i}` })),
    events: dates.flatMap((_, i) => sourceEvents.map((e) => ({ ...e, gridId: i }))),
    pastTimeData: dates.map(() => new Array<number>(rows).fill(-1)),
  };

  const tablesStart = shell.indexOf('<table class="schedule"');
  const container = shell.indexOf('<div id="resContainer"');
  const tablesEnd = container < 0 ? -1 : shell.lastIndexOf('</table>', container);
  if (tablesStart < 0 || tablesEnd < tablesStart) {
    throw new Error('Stub mode: Bizzy shell fixture has no schedule tables');
  }
  const withTables =
    shell.slice(0, tablesStart) + tables.join('') + shell.slice(tablesEnd + '</table>'.length);

  const first = dates[0] ?? new Date(Date.UTC(1970, 0, 1));
  const [year, month0, day] = [first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()];
  return withTables
    .replace(shellJson, () => JSON.stringify(data))
    .replace(
      /(id="scheduleNavigForm:schedule_calendarInputDate"[^>]*?value=")[^"]*/,
      (_, prefix: string) => `${prefix}${day}.${month0 + 1}.${year}`,
    )
    .replace(
      /(id="scheduleNavigForm:schedule_calendarInputCurrentDate"[^>]*?value=")[^"]*/,
      (_, prefix: string) => `${prefix}${month0 + 1}/${year}`,
    )
    .replace(
      /'selectedDate':new Date\([^)]*\)/,
      `'selectedDate':new Date(${year},${month0},${day},0,0,0)`,
    )
    .replace(/'currentDate':new Date\([^)]*\)/, `'currentDate':new Date(${year},${month0},1)`);
}
