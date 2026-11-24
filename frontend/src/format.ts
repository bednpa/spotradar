/** Pure formatting helpers for distances, dates, times and slots. */
import type { FreeSlot } from '@spotradar/shared';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_NAMES = [
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

/** 1.234 → "1.2 km" */
export function formatDistance(distanceKm: number): string {
  return `${distanceKm.toFixed(1)} km`;
}

/** "2026-11-25" → "Wed 25 Nov". Unparseable input is returned unchanged. */
export function formatShortDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const monthName = MONTH_NAMES[month - 1];
  if (weekday === undefined || monthName === undefined) return date;
  return `${weekday} ${day} ${monthName}`;
}

/** "2026-11-25" → "Wed 25 Nov 2026". */
export function formatDateLabel(date: string): string {
  const short = formatShortDate(date);
  return short === date ? date : `${short} ${date.slice(0, 4)}`;
}

/** "Live · checked 3 min ago" helper: "just now", "3 min ago", "2 h ago". */
export function formatCheckedAgo(checkedAt: string | undefined, now: Date): string {
  if (checkedAt === undefined) return 'recently';
  const checked = Date.parse(checkedAt);
  if (Number.isNaN(checked)) return 'recently';
  const minutes = Math.floor((now.getTime() - checked) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return 'over a day ago';
}

/** 1 → "1 court", 3 → "3 courts" */
export function formatCourts(count: number): string {
  return `${count} ${count === 1 ? 'court' : 'courts'}`;
}

/** { start: "18:00", end: "20:00" } → "18:00–20:00" */
export function formatSlotRange(slot: FreeSlot): string {
  return `${slot.start}–${slot.end}`;
}
