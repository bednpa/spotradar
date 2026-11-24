/**
 * Date/time helpers shared by backend and frontend.
 * Dates are "YYYY-MM-DD", times are "HH:MM", both local to TIME_ZONE.
 */
import { BOOKING_WINDOW_DAYS, SLOT_MINUTES, TIME_ZONE } from './catalog.ts';

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

/** True for "HH:MM" aligned to the SLOT_MINUTES grid (HH:00 or HH:30). */
export function isValidSlotTime(value: string): boolean {
  return isValidTime(value) && timeToMinutes(value) % SLOT_MINUTES === 0;
}

/** "HH:MM" → minutes since midnight. Assumes a valid time. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/** Minutes since midnight → "HH:MM" (0 ≤ minutes < 1440). */
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

export interface BookingWindow {
  /** First bookable date (today). */
  from: string;
  /** Last bookable date (inclusive). */
  to: string;
}

/** Bookable date range for the given instant. */
export function getBookingWindow(now: Date): BookingWindow {
  const today = toLocalDateTime(now).date;
  return { from: today, to: addDays(today, BOOKING_WINDOW_DAYS - 1) };
}

/** True if date lies inside the booking window (string comparison works for YYYY-MM-DD). */
export function isDateInBookingWindow(date: string, now: Date): boolean {
  const { from, to } = getBookingWindow(now);
  return date >= from && date <= to;
}
