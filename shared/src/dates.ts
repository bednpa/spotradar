/**
 * Date/time helpers shared by backend and frontend.
 * Dates are "YYYY-MM-DD", times are "HH:MM", both local to TIME_ZONE.
 */
import { SEARCH_WINDOW_DAYS, TIME_ZONE } from './catalog.ts';
import { WEEKDAYS } from './types.ts';
import type { Weekday } from './types.ts';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True for a real calendar date in "YYYY-MM-DD" format. */
export function isValidDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/** True for "HH:MM" (00:00–23:59). */
export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

/** "HH:MM" → minutes since midnight ("24:00" → 1440). Assumes a valid time. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** Minutes since midnight → "HH:MM" (0 ≤ minutes ≤ 1440; 1440 → "24:00"). */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Adds (or subtracts) whole days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const utc = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days));
  return utc.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Every date from `from` to `to` inclusive (empty when to < from). */
export function dateRange(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addDays(from, i));
}

/** Day of week of a "YYYY-MM-DD" date. */
export function weekdayOf(date: string): Weekday {
  const [y, m, d] = date.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay(); // 0 = Sunday
  return WEEKDAYS[(jsDay + 6) % 7] as Weekday;
}

export interface LocalDateTime {
  /** "YYYY-MM-DD" */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
}

/** Current wall-clock date and time in TIME_ZONE for the given instant. */
export function toLocalDateTime(now: Date, timeZone: string = TIME_ZONE): LocalDateTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Epoch milliseconds of local midnight (00:00 in TIME_ZONE) at the start of `date`. */
export function zonedMidnightEpochMs(date: string, timeZone: string = TIME_ZONE): number {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  // Try offsets from +14h to -12h; the first one that lands on local 00:00 of `date` wins.
  for (let offsetHours = 14; offsetHours >= -12; offsetHours--) {
    const candidate = utcMidnight - offsetHours * 3_600_000;
    const local = toLocalDateTime(new Date(candidate), timeZone);
    if (local.date === date && local.minutes === 0) return candidate;
  }
  return utcMidnight;
}

export interface SearchWindow {
  /** First searchable date (today). */
  from: string;
  /** Last searchable date (inclusive, today + SEARCH_WINDOW_DAYS). */
  to: string;
}

/** Searchable date range for the given instant. */
export function getSearchWindow(now: Date): SearchWindow {
  const today = toLocalDateTime(now).date;
  return { from: today, to: addDays(today, SEARCH_WINDOW_DAYS) };
}

/** True if date lies inside the search window (string comparison works for YYYY-MM-DD). */
export function isDateInSearchWindow(date: string, now: Date): boolean {
  const { from, to } = getSearchWindow(now);
  return date >= from && date <= to;
}
