/** Pure formatting helpers for distances, dates, times and slots. */
import { SEARCH_WINDOW_DAYS, SPORTS } from '@spotradar/shared';
import type { FreeSlot, SportId } from '@spotradar/shared';

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

/** "2026-11-25" → "Wed". Unparseable input is returned unchanged. */
export function formatShortWeekday(date: string): string {
  const short = formatShortDate(date);
  return short === date ? date : (short.split(' ')[0] ?? date);
}

/** 1 → "1 court", 3 → "3 courts" */
export function formatCourts(count: number): string {
  return `${count} ${count === 1 ? 'court' : 'courts'}`;
}

/** { start: "18:00", end: "20:00" } → "18:00–20:00" */
export function formatSlotRange(slot: FreeSlot): string {
  return `${slot.start}–${slot.end}`;
}

const WEEKDAY_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTH_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** 1-based month number → "November". */
export function monthName(month: number): string {
  return MONTH_LONG[month - 1] ?? String(month);
}

/** "2026-11-25" → "Wednesday 25 November". Unparseable input is returned unchanged. */
export function formatLongDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const weekday = WEEKDAY_LONG[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const monthLong = MONTH_LONG[month - 1];
  if (weekday === undefined || monthLong === undefined) return date;
  return `${weekday} ${day} ${monthLong}`;
}

/** 18 → "18:00" */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** 18 → "18:00–19:00" */
export function hourRangeLabel(hour: number): string {
  return `${hourLabel(hour)}–${hourLabel(hour + 1)}`;
}

/** ISO timestamp → "HH:MM" wall-clock time in Europe/Prague; "" when unparseable. */
export function formatClockTime(iso: string | undefined): string {
  if (iso === undefined || Number.isNaN(Date.parse(iso))) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** Display name of a sport, e.g. "Badminton" (falls back to the id). */
export function sportName(id: SportId): string {
  return SPORTS.find((sport) => sport.id === id)?.name ?? id;
}

/** "No badminton venues…" style: the sport name in lower case. */
export function sportNameLower(id: SportId): string {
  return sportName(id).toLowerCase();
}

/** "today and the next 14 days" (derived from SEARCH_WINDOW_DAYS). */
export function windowDescription(): string {
  return `today and the next ${SEARCH_WINDOW_DAYS} days`;
}

/** 1 → "1 venue", 3 → "3 venues" */
export function formatVenues(count: number): string {
  return `${count} ${count === 1 ? 'venue' : 'venues'}`;
}
