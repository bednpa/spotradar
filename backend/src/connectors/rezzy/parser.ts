import type { FreeSlot, Weekday } from '@spotradar/shared';
import { weekdayOf } from '@spotradar/shared';
import { HALF_SLOT_MINUTES, freeSlotsFromHalfSlots } from '../halfSlots.ts';

/** Thrown when a Rezzy answer does not have the expected structure. */
export class RezzyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RezzyParseError';
  }
}

export interface RezzyCourt {
  id: number;
  name: string;
}

/** Opening window of one weekday in minutes since midnight (end clamped to 24:00). */
export interface RezzyHours {
  open: number;
  close: number;
}

/** What the sport-area detail tells us: courts in display order and the hours of the date's weekday. */
export interface RezzyArea {
  sportAreaId: number;
  /** In display order: blocker spans refer to positions in this list. */
  courts: RezzyCourt[];
  granularity: number;
  minimumLength: number;
  /** Hours of the weekday of the requested date; undefined = closed / no season. */
  hours: RezzyHours | undefined;
}

export interface RezzyBlock {
  /** Indices into `RezzyArea.courts`, inclusive. */
  from: number;
  to: number;
  /** Minutes since midnight. */
  start: number;
  end: number;
}

const DAY_MINUTES = 1440;
const DURATION_RE = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const WEEKDAY_KEYS: Record<Weekday, string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

/** .NET TimeSpan ("08:00:00", "14:00:00", "1.00:00:00" = 24 h) → minutes. */
export function parseTimeSpan(value: unknown): number {
  const m = typeof value === 'string' ? DURATION_RE.exec(value) : null;
  if (!m) throw new RezzyParseError(`Unexpected Rezzy time value ${JSON.stringify(value)}`);
  const minutes = Number(m[1] ?? 0) * DAY_MINUTES + Number(m[2]) * 60 + Number(m[3]);
  if (Number(m[3]) > 59 || Number(m[4]) > 59) {
    throw new RezzyParseError(`Unexpected Rezzy time value ${JSON.stringify(value)}`);
  }
  return minutes;
}

function parseJson(body: string, what: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new RezzyParseError(`Rezzy ${what} is not valid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveInt(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new RezzyParseError(`Rezzy ${what} is missing or invalid`);
  }
  return value;
}

/**
 * Parses `SportAreas/{id}?date=…`: courts (`availablePlayfields`, display order), the booking
 * grid and minimum length, and the opening hours of `date`'s weekday from `selectedSeason`.
 * No season or `openForDuration` 0 means closed (`hours` undefined).
 */
export function parseRezzyArea(body: string, sportAreaId: number, date: string): RezzyArea {
  const json = parseJson(body, 'sport area');
  if (!isRecord(json)) throw new RezzyParseError('Rezzy sport area is not an object');
  if (json.id !== sportAreaId) {
    throw new RezzyParseError(`Rezzy answered sport area ${String(json.id)}, not ${sportAreaId}`);
  }
  const granularity = positiveInt(json.reservationGranularity, 'reservationGranularity');
  const minimumLength = positiveInt(json.minimumReservationLength, 'minimumReservationLength');
  if (granularity !== HALF_SLOT_MINUTES) {
    throw new RezzyParseError(`Unsupported Rezzy reservation granularity ${granularity}`);
  }
  const playfields = json.availablePlayfields;
  if (!Array.isArray(playfields) || playfields.length === 0) {
    throw new RezzyParseError('Rezzy sport area has no playfields');
  }
  const courts = playfields.map((p: unknown): RezzyCourt => {
    if (!isRecord(p) || typeof p.id !== 'number' || typeof p.name !== 'string') {
      throw new RezzyParseError('Rezzy playfield has no id or name');
    }
    return { id: p.id, name: p.name };
  });

  const season = json.selectedSeason;
  let hours: RezzyHours | undefined;
  if (season !== null && season !== undefined) {
    if (!isRecord(season)) throw new RezzyParseError('Rezzy selectedSeason is not an object');
    const day = season[WEEKDAY_KEYS[weekdayOf(date)]];
    if (!isRecord(day)) throw new RezzyParseError('Rezzy season has no hours for the weekday');
    const open = parseTimeSpan(day.opensAtTime);
    const duration = parseTimeSpan(day.openForDuration);
    if (duration > 0) hours = { open, close: Math.min(open + duration, DAY_MINUTES) };
    if (hours && hours.open >= hours.close) hours = undefined;
  }
  return { sportAreaId, courts, granularity, minimumLength, hours };
}

/** Parses `…/CustomerSchedules/ReservationBlockers?date=…` against the courts of `area`. */
export function parseRezzyBlockers(body: string, area: RezzyArea): RezzyBlock[] {
  const json = parseJson(body, 'blockers');
  if (!Array.isArray(json)) throw new RezzyParseError('Rezzy blockers answer is not an array');
  const indexOf = (id: unknown): number => {
    const index = area.courts.findIndex((c) => c.id === id);
    if (index < 0)
      throw new RezzyParseError(`Rezzy blocker refers to unknown playfield ${String(id)}`);
    return index;
  };
  return json.map((raw: unknown): RezzyBlock => {
    if (!isRecord(raw)) throw new RezzyParseError('Rezzy blocker is not an object');
    if (raw.sportAreaId !== area.sportAreaId) {
      throw new RezzyParseError(`Rezzy blocker of sport area ${String(raw.sportAreaId)}`);
    }
    const from = indexOf(raw.playfieldIdFrom);
    const to = indexOf(raw.playfieldIdTo);
    const start = parseTimeSpan(raw.from);
    const end = Math.min(parseTimeSpan(raw.to), DAY_MINUTES);
    if (from > to || start >= end) throw new RezzyParseError('Rezzy blocker has an invalid span');
    return { from, to, start, end };
  });
}

/**
 * Free slots of a day: per court the opening hours minus the blockers, on the 30-minute grid.
 * Cells that already started (`earliestStart`, minutes; only for today) are dropped first, then
 * only runs of at least `minimumLength` minutes count as bookable.
 */
export function rezzyFreeSlots(
  area: RezzyArea,
  blocks: readonly RezzyBlock[],
  earliestStart = 0,
): FreeSlot[] {
  const { hours } = area;
  if (!hours) return [];
  const cell = area.granularity;
  const freeCourtsByStart = new Map<number, Set<string>>();
  area.courts.forEach((court, index) => {
    const free: number[] = [];
    for (let t = hours.open; t + cell <= hours.close; t += cell) {
      if (t < earliestStart) continue;
      const blocked = blocks.some(
        (b) => b.from <= index && index <= b.to && t < b.end && t + cell > b.start,
      );
      if (!blocked) free.push(t);
    }
    // Split into runs of consecutive cells and keep runs that are long enough.
    let runStart = 0;
    for (let i = 1; i <= free.length; i++) {
      const prev = free[i - 1] as number;
      if (i === free.length || (free[i] as number) !== prev + cell) {
        if ((i - runStart) * cell >= area.minimumLength) {
          for (const t of free.slice(runStart, i)) {
            const courts = freeCourtsByStart.get(t) ?? new Set<string>();
            courts.add(String(court.id));
            freeCourtsByStart.set(t, courts);
          }
        }
        runStart = i;
      }
    }
  });
  return freeSlotsFromHalfSlots(freeCourtsByStart);
}
