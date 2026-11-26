import type { FreeSlot } from '@spotradar/shared';
import { addDays, minutesToTime, toLocalDateTime, zonedMidnightEpochMs } from '@spotradar/shared';

/** Thrown when the answer is not the expected Reenio `Term/List` JSON (structure changed, other day, ...). */
export class ReenioParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReenioParseError';
  }
}

const MINUTE_MS = 60_000;
const DUE_RE = /^(\d+):([0-5]\d):([0-5]\d)$/;

interface Interval {
  start: number;
  end: number;
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ReenioParseError(`Reenio: ${message}`);
}

function timeOf(value: unknown, what: string): number {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) fail(`${what} is not a timestamp`);
  return ms;
}

function intervalOf(value: unknown, what: string): Interval {
  if (!isObj(value)) fail(`${what} is not an object`);
  const start = timeOf(value.start, `${what}.start`);
  const end = timeOf(value.end, `${what}.end`);
  if (!(start < end)) fail(`${what} has an empty range`);
  return { start, end };
}

function intervalList(value: unknown, what: string): Interval[] {
  if (!Array.isArray(value)) fail(`${what} is not a list`);
  return value.map((item, i) => intervalOf(item, `${what}[${i}]`));
}

/** "2:00:00" (h:mm:ss, hours may exceed 24) → milliseconds. */
export function parseDueDate(value: unknown): number {
  const match = typeof value === 'string' ? DUE_RE.exec(value) : null;
  if (!match) fail('reservationDueDate is not h:mm:ss');
  return (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000;
}

/** `[a, b]` minus all `busy` intervals (any order, may overlap). */
function subtract(window: Interval, busy: Interval[]): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;
  for (const b of [...busy].sort((x, y) => x.start - y.start)) {
    if (b.end <= cursor) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

/**
 * Parses the answer of `POST {baseUrl}/api/Term/List` (one resource, one Prague-local day) into
 * free slots.
 *
 * `data.events[]` are the bookable windows (outside them the venue is closed). Free time of a
 * window = window minus its own `reservations` minus every interval of `collisions` (any key:
 * bookings on other resources of the same service block the resource), snapped inwards to the
 * window's `reservationIntervalSize` grid, at least `def.minLength` long. Booking closes
 * `reservationDueDate` before the start, so free time starting sooner than that after `now` is
 * dropped. The resource is exclusive (`maxCapacity` 1), so every slot has freeCourts 1.
 *
 * Throws ReenioParseError when the answer is not `status: "OK"`, shows another day, belongs to
 * another resource (a ignored filter answers every resource) or has an unexpected structure.
 */
export function parseReenioTerms(
  body: string,
  date: string,
  resourceId: number,
  now: Date,
): FreeSlot[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return fail('answer is not JSON');
  }
  if (!isObj(json) || json.status !== 'OK' || !isObj(json.data)) fail('answer has no data');
  const data = json.data;
  const dayStart = zonedMidnightEpochMs(date);
  const dayEnd = zonedMidnightEpochMs(addDays(date, 1));
  if (timeOf(data.startDate, 'startDate') !== dayStart) {
    fail(`answer shows another day than ${date}`);
  }
  if (!Array.isArray(data.events)) fail('events is not a list');

  const nowMs = now.getTime();
  const free: Interval[] = [];
  data.events.forEach((raw: unknown, i: number) => {
    const what = `events[${i}]`;
    if (!isObj(raw)) fail(`${what} is not an object`);
    if (
      !Array.isArray(raw.eventResources) ||
      !raw.eventResources.some((r: unknown) => isObj(r) && r.id === resourceId)
    ) {
      fail(`${what} does not belong to resource ${resourceId}`);
    }
    const window = intervalOf(raw, what);
    // Only the requested local day (a window may also start the evening before).
    if (window.end <= dayStart || window.start >= dayEnd) return;
    if (raw.isEnabled === false || raw.isEnabledForCustomer === false) return;

    const grid = raw.reservationIntervalSize;
    if (typeof grid !== 'number' || !Number.isInteger(grid) || grid <= 0) {
      fail(`${what}.reservationIntervalSize is invalid`);
    }
    const minLength = isObj(raw.def) ? raw.def.minLength : undefined;
    if (typeof minLength !== 'number' || !(minLength >= 0))
      fail(`${what}.def.minLength is invalid`);
    if (!isObj(raw.collisions)) fail(`${what}.collisions is not an object`);

    const busy = intervalList(raw.reservations, `${what}.reservations`);
    for (const [key, list] of Object.entries(raw.collisions)) {
      busy.push(...intervalList(list, `${what}.collisions.${key}`));
    }
    const earliest = nowMs + parseDueDate(raw.reservationDueDate);
    const gridMs = grid * MINUTE_MS;
    for (const gap of subtract(window, busy)) {
      const from = Math.max(gap.start, earliest, dayStart);
      const to = Math.min(gap.end, dayEnd);
      const start = window.start + Math.ceil((from - window.start) / gridMs) * gridMs;
      const end = window.start + Math.floor((to - window.start) / gridMs) * gridMs;
      if (end > start && end - start >= minLength * MINUTE_MS) free.push({ start, end });
    }
  });

  free.sort((a, b) => a.start - b.start);
  const slots: FreeSlot[] = [];
  let current: Interval | undefined;
  const flush = (): void => {
    if (current) {
      slots.push({
        start: minutesToTime(localMinutes(current.start, date, dayStart)),
        end: minutesToTime(localMinutes(current.end, date, dayStart)),
        freeCourts: 1,
      });
    }
  };
  for (const interval of free) {
    if (current && interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
    } else {
      flush();
      current = { ...interval };
    }
  }
  flush();
  return slots;
}

/** Wall-clock minutes of an instant of `date` (the end of the day counts as 24:00). */
function localMinutes(ms: number, date: string, dayStart: number): number {
  const local = toLocalDateTime(new Date(ms));
  if (local.date === date) return local.minutes;
  if (ms > dayStart) return 24 * 60;
  return fail('slot outside the requested day');
}
