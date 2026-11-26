import type { FreeSlot } from '@spotradar/shared';
import { timeToMinutes } from '@spotradar/shared';
import { HALF_SLOT_MINUTES, freeSlotsFromHalfSlots } from '../halfSlots.ts';

/** Thrown when a PadelOS answer does not have the expected structure. */
export class PadelosParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PadelosParseError';
  }
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** "HH:MM" on the 30-minute grid → minutes; "00:00" as an end time means midnight (1440). */
function gridMinutes(value: unknown, what: string, isEnd: boolean): number {
  if (typeof value !== 'string' || !TIME_RE.test(value)) {
    throw new PadelosParseError(`PadelOS slot has an invalid ${what}`);
  }
  const minutes = timeToMinutes(value);
  if (minutes % HALF_SLOT_MINUTES !== 0) {
    throw new PadelosParseError(`PadelOS slot ${what} ${value} is off the 30-minute grid`);
  }
  return isEnd && minutes === 0 ? 1440 : minutes;
}

/**
 * Parses the answer of `POST /customers/searchByDate` for club `clubId` and `date`
 * ("YYYY-MM-DD") into free slots.
 *
 * `data[0].availability` has one group per booking duration (60 / 90 / 120 min); each slot
 * lists the courts bookable for exactly that window. Booked or closed time is simply absent.
 * Because the server hides offers that would leave a gap shorter than an hour, one group is
 * not the whole free time, so every offered window is added to its court and the union over all
 * groups is aggregated on 30-minute half-slots (the only minutes seen in the data are :00 and :30).
 * An empty `availability` is a valid empty day (out of season, beyond the booking horizon).
 * Throws PadelosParseError when the structure is missing, the club is another one or a slot is
 * for another date – never partial data.
 */
export function parsePadelosAvailability(body: string, clubId: string, date: string): FreeSlot[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new PadelosParseError('PadelOS answer is not valid JSON');
  }
  const club = isRecord(json) && Array.isArray(json.data) ? json.data[0] : undefined;
  if (!isRecord(club)) throw new PadelosParseError('PadelOS answer has no data[0]');
  if (String(club.id) !== clubId) {
    throw new PadelosParseError(`PadelOS answered club ${String(club.id)}, not ${clubId}`);
  }
  if (!Array.isArray(club.availability)) {
    throw new PadelosParseError('PadelOS answer has no availability array');
  }

  const freeCourtsByStart = new Map<number, Set<string>>();
  for (const group of club.availability as unknown[]) {
    if (!isRecord(group) || !Array.isArray(group.slots)) {
      throw new PadelosParseError('PadelOS availability group has no slots');
    }
    for (const slot of group.slots as unknown[]) {
      if (!isRecord(slot) || !Array.isArray(slot.courts)) {
        throw new PadelosParseError('PadelOS slot has no courts');
      }
      if (slot.date !== date) {
        throw new PadelosParseError(`PadelOS slot is for ${String(slot.date)}, not ${date}`);
      }
      const start = gridMinutes(slot.startTime, 'startTime', false);
      const end = gridMinutes(slot.endTime, 'endTime', true);
      if (start >= end) throw new PadelosParseError('PadelOS slot ends before it starts');
      for (const court of slot.courts as unknown[]) {
        if (!isRecord(court) || (typeof court.id !== 'string' && typeof court.id !== 'number')) {
          throw new PadelosParseError('PadelOS court has no id');
        }
        const id = String(court.id);
        for (let t = start; t < end; t += HALF_SLOT_MINUTES) {
          const courts = freeCourtsByStart.get(t) ?? new Set<string>();
          courts.add(id);
          freeCourtsByStart.set(t, courts);
        }
      }
    }
  }
  return freeSlotsFromHalfSlots(freeCourtsByStart);
}
