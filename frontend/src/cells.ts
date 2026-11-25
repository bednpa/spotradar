/**
 * Pure cell logic of the calendar: one cell = one hour of one day.
 * Only live (free) availability is shown in cells; venues without live data
 * never make a cell "free" and are listed separately in the slot panel.
 */
import { getSearchWindow, slotStatuses, summarizeSlot, toLocalDateTime } from '@spotradar/shared';
import type {
  CalendarDay,
  CalendarResponse,
  CalendarVenue,
  SlotSummary,
  SlotVenueStatus,
} from '@spotradar/shared';
import { DEFAULT_FROM_HOUR, DEFAULT_TO_HOUR } from './calendar-range.ts';
import { formatLongDate, formatVenues, hourLabel, hourRangeLabel } from './format.ts';

export type CellKind = 'free' | 'none' | 'past' | 'outside';

export interface HourCell {
  kind: CellKind;
  date: string;
  hour: number;
  summary: SlotSummary;
  /** Heat intensity 0-4 (free cells only). */
  level: 0 | 1 | 2 | 3 | 4;
}

export type DayIndex = ReadonlyMap<string, CalendarDay>;

const EMPTY_SUMMARY: SlotSummary = { freeVenues: 0, checkVenues: 0, freeCourts: 0 };

export function indexDays(data: CalendarResponse | null): DayIndex {
  return new Map((data?.days ?? []).map((day) => [day.date, day]));
}

/** Statuses of every venue for one hour ([HH:00, HH+1:00)). */
export function hourStatuses(
  days: DayIndex,
  venues: readonly CalendarVenue[],
  date: string,
  hour: number,
): SlotVenueStatus[] {
  const day = days.get(date);
  if (!day) return [];
  return slotStatuses(day, venues, hourLabel(hour), hourLabel(hour + 1));
}

export interface CellOptions {
  now: Date;
}

export function computeCell(
  days: DayIndex,
  venues: readonly CalendarVenue[],
  date: string,
  hour: number,
  options: CellOptions,
): HourCell {
  const window = getSearchWindow(options.now);
  const local = toLocalDateTime(options.now);
  const base = { date, hour, summary: EMPTY_SUMMARY, level: 0 as const };
  if (date < window.from || (date === local.date && (hour + 1) * 60 <= local.minutes)) {
    return { ...base, kind: 'past' };
  }
  if (date > window.to || !days.has(date)) return { ...base, kind: 'outside' };

  const summary = summarizeSlot(hourStatuses(days, venues, date, hour));
  if (summary.freeVenues > 0) {
    const level = Math.min(4, summary.freeVenues) as 1 | 2 | 3 | 4;
    return { date, hour, summary, kind: 'free', level };
  }
  return { ...base, summary, kind: 'none' };
}

/** e.g. "Wednesday 25 November, 18:00–19:00: 2 venues free" */
export function cellAriaLabel(cell: HourCell): string {
  const prefix = `${formatLongDate(cell.date)}, ${hourRangeLabel(cell.hour)}`;
  switch (cell.kind) {
    case 'free':
      return `${prefix}: ${formatVenues(cell.summary.freeVenues)} free`;
    case 'none':
      return `${prefix}: nothing free`;
    case 'past':
      return `${prefix}: in the past`;
    case 'outside':
      return `${prefix}: not available yet`;
  }
}

export function isCellSelectable(cell: HourCell): boolean {
  return cell.kind !== 'past' && cell.kind !== 'outside';
}

export interface DaySummary {
  /** Hours (06–23) with a free court at a venue with live data. */
  freeHours: number;
  /** Hour with the most free courts, null when nothing is free. */
  bestHour: number | null;
}

export function summarizeDay(
  days: DayIndex,
  venues: readonly CalendarVenue[],
  date: string,
  options: CellOptions,
): DaySummary {
  let freeHours = 0;
  let bestHour: number | null = null;
  let bestCourts = 0;
  for (let hour = DEFAULT_FROM_HOUR; hour < DEFAULT_TO_HOUR; hour++) {
    const cell = computeCell(days, venues, date, hour, options);
    if (cell.kind === 'free') {
      freeHours++;
      if (cell.summary.freeCourts > bestCourts) {
        bestCourts = cell.summary.freeCourts;
        bestHour = hour;
      }
    }
  }
  return { freeHours, bestHour };
}

export type Coverage = 'live' | 'unavailable' | 'unknown';

export interface VenueCoverage {
  venue: CalendarVenue;
  coverage: Coverage;
}

/** live: at least one day has live data; unavailable: connector failed; unknown: no connector. */
export function venueCoverage(data: CalendarResponse): VenueCoverage[] {
  return data.venues.map((venue) => {
    let coverage: Coverage = 'unknown';
    for (const day of data.days) {
      const status = day.venues.find((v) => v.venueId === venue.venue.id)?.availability.status;
      if (status === 'live') {
        coverage = 'live';
        break;
      }
      if (status === 'unavailable') coverage = 'unavailable';
    }
    return { venue, coverage };
  });
}
