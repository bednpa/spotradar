/** Pure date-range logic for the calendar views (week starts on Monday). */
import { WEEKDAYS, addDays, daysBetween, weekdayOf } from '@spotradar/shared';
import type { CalendarView, SearchWindow } from '@spotradar/shared';
import { formatLongDate, monthName } from './format.ts';

export interface DateRange {
  from: string;
  to: string;
}

export interface Ymd {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

export function parseYmd(date: string): Ymd {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

export function toYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, -WEEKDAYS.indexOf(weekdayOf(date)));
}

export function weekDates(date: string): string[] {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthFirst(date: string): string {
  const { year, month } = parseYmd(date);
  return toYmd(year, month, 1);
}

export function monthLast(date: string): string {
  const { year, month } = parseYmd(date);
  return addDays(toYmd(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1);
}

/** Month grid: weeks (Monday first) of dates, including leading/trailing days of neighbours. */
export function monthGrid(date: string): string[][] {
  const first = weekStart(monthFirst(date));
  const last = weekStart(monthLast(date));
  const weeks = daysBetween(first, last) / 7 + 1;
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)),
  );
}

/** Dates of the 12 months of the year of `date` (the first day of each). */
export function yearMonths(date: string): string[] {
  const { year } = parseYmd(date);
  return Array.from({ length: 12 }, (_, i) => toYmd(year, i + 1, 1));
}

export function isInRange(date: string, range: DateRange): boolean {
  return date >= range.from && date <= range.to;
}

/** Intersection of a range with the search window; null when they do not overlap. */
export function clampRange(range: DateRange, window: SearchWindow): DateRange | null {
  const from = range.from > window.from ? range.from : window.from;
  const to = range.to < window.to ? range.to : window.to;
  return from <= to ? { from, to } : null;
}

/** Dates the view displays (Month/Year: the whole month/year). */
export function visibleRange(view: CalendarView, date: string): DateRange {
  switch (view) {
    case 'day':
      return { from: date, to: date };
    case 'week': {
      const start = weekStart(date);
      return { from: start, to: addDays(start, 6) };
    }
    case 'month':
      return { from: monthFirst(date), to: monthLast(date) };
    case 'year': {
      const { year } = parseYmd(date);
      return { from: toYmd(year, 1, 1), to: toYmd(year, 12, 31) };
    }
  }
}

/**
 * Range to request from the API: day/week are clamped to the search window,
 * month/year request the whole window once. Null = nothing to request.
 */
export function requestRange(
  view: CalendarView,
  date: string,
  window: SearchWindow,
): DateRange | null {
  if (view === 'month' || view === 'year') return { from: window.from, to: window.to };
  return clampRange(visibleRange(view, date), window);
}

/** Anchor date when jumping to a month/year: today if it lies inside, else the first day. */
export function anchorFor(first: string, unit: 'month' | 'year', today: string): string {
  const range = visibleRange(unit, first);
  return isInRange(today, range) ? today : range.from;
}

/** Previous (-1) / next (+1) period. */
export function shiftDate(
  view: CalendarView,
  date: string,
  direction: -1 | 1,
  today: string,
): string {
  switch (view) {
    case 'day':
      return addDays(date, direction);
    case 'week':
      return addDays(date, 7 * direction);
    case 'month': {
      const { year, month } = parseYmd(date);
      const index = year * 12 + (month - 1) + direction;
      return anchorFor(toYmd(Math.floor(index / 12), (index % 12) + 1, 1), 'month', today);
    }
    case 'year': {
      const { year } = parseYmd(date);
      return anchorFor(toYmd(year + direction, 1, 1), 'year', today);
    }
  }
}

/** Title of the shown period, e.g. "Wednesday 25 November 2026". */
export function periodTitle(view: CalendarView, date: string): string {
  const { year, month } = parseYmd(date);
  switch (view) {
    case 'day':
      return `${formatLongDate(date)} ${year}`;
    case 'month':
      return `${monthName(month)} ${year}`;
    case 'year':
      return String(year);
    case 'week': {
      const range = visibleRange('week', date);
      const a = parseYmd(range.from);
      const b = parseYmd(range.to);
      if (a.year !== b.year) {
        return `${a.day} ${monthName(a.month).slice(0, 3)} ${a.year} – ${b.day} ${monthName(b.month).slice(0, 3)} ${b.year}`;
      }
      if (a.month !== b.month) {
        return `${a.day} ${monthName(a.month).slice(0, 3)} – ${b.day} ${monthName(b.month).slice(0, 3)} ${b.year}`;
      }
      return `${a.day}–${b.day} ${monthName(a.month)} ${a.year}`;
    }
  }
}

/** Hour rows [fromHour, toHour) shown in the Day/Week views. */
export function visibleHours(fromHour: number, toHour: number): number[] {
  const count = Math.max(0, toHour - fromHour);
  return Array.from({ length: count }, (_, i) => fromHour + i);
}

export const DEFAULT_FROM_HOUR = 6;
export const DEFAULT_TO_HOUR = 23;
