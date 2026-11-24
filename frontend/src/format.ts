/** Pure formatting helpers for prices, distances, dates and times. */
import { timeToMinutes, minutesToTime } from '@spotradar/shared';
import type { OpeningHours } from '@spotradar/shared';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** 350 → "350 CZK" */
export function formatCzk(amount: number): string {
  return `${amount} CZK`;
}

/** "350 CZK / hour · 525 CZK total" */
export function formatPrice(pricePerHourCzk: number, totalPriceCzk: number): string {
  return `${formatCzk(pricePerHourCzk)} / hour · ${formatCzk(totalPriceCzk)} total`;
}

/** 1.234 → "1.2 km" */
export function formatDistance(distanceKm: number): string {
  return `${distanceKm.toFixed(1)} km`;
}

/** 90 → "90 min" */
export function formatDuration(minutes: number): string {
  return `${minutes} min`;
}

/** { open: "08:00", close: "22:00" } → "08:00–22:00" */
export function formatOpeningHours(hours: OpeningHours): string {
  return `${hours.open}–${hours.close}`;
}

/** ("18:00", 90) → "18:00–19:30" */
export function formatTimeRange(time: string, durationMinutes: number): string {
  const end = (timeToMinutes(time) + durationMinutes) % 1440;
  return `${time}–${minutesToTime(end)}`;
}

/** "2026-11-25" → "Wed 25 Nov 2026". Unparseable input is returned unchanged. */
export function formatDateLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const monthName = MONTHS[month - 1];
  if (weekday === undefined || monthName === undefined) return date;
  return `${weekday} ${day} ${monthName} ${year}`;
}
