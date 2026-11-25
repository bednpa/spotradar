/**
 * Pure calendar helpers shared by backend and frontend: what is free in a
 * given time range across venues (used by the day/week/month views).
 */
import { timeToMinutes, weekdayOf } from './dates.ts';
import type { CalendarDay, CalendarVenue, FreeSlot, OpeningHours } from './types.ts';

/**
 * Courts free for the WHOLE interval [start, end) ("HH:MM", end may be "24:00"):
 * the minimum `freeCourts` over the slots covering it, 0 when any part is not covered.
 */
export function freeCourtsBetween(slots: readonly FreeSlot[], start: string, end: string): number {
  let cursor = timeToMinutes(start);
  const stop = timeToMinutes(end);
  if (stop <= cursor) return 0;
  let min = Number.POSITIVE_INFINITY;
  const sorted = [...slots].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  for (const slot of sorted) {
    const s = timeToMinutes(slot.start);
    const e = timeToMinutes(slot.end);
    if (e <= cursor) continue;
    if (s > cursor) return 0; // gap
    min = Math.min(min, slot.freeCourts);
    cursor = e;
    if (cursor >= stop) return min;
  }
  return 0;
}

/**
 * True when the venue is open for the whole interval [start, end) on `date`
 * according to its (possibly approximate) opening hours.
 */
export function isOpenDuring(
  hours: OpeningHours,
  date: string,
  start: string,
  end: string,
): boolean {
  const day = hours.days[weekdayOf(date)];
  if (!day) return false;
  return (
    timeToMinutes(day.open) <= timeToMinutes(start) &&
    timeToMinutes(end) <= timeToMinutes(day.close)
  );
}

/**
 * State of one venue in a time range:
 * - free: live data, ≥ 1 court free for the whole range,
 * - full: live data, nothing free for the whole range,
 * - check: open (per opening hours) but no live data (status unknown/unavailable) – check on the venue's website,
 * - closed: closed for (part of) the range per opening hours and no free court in live data.
 */
export type SlotVenueState = 'free' | 'full' | 'check' | 'closed';

export interface SlotVenueStatus {
  venueId: string;
  state: SlotVenueState;
  /** Courts free for the whole range; present only for state "free". */
  freeCourts?: number;
}

const STATE_ORDER: Record<SlotVenueState, number> = { free: 0, check: 1, full: 2, closed: 3 };

/**
 * Status of every venue of `day` in [start, end). Sorted free → check → full →
 * closed; within a state the order of `venues` is kept (distance or name order).
 */
export function slotStatuses(
  day: CalendarDay,
  venues: readonly CalendarVenue[],
  start: string,
  end: string,
): SlotVenueStatus[] {
  const order = new Map(venues.map((v, i) => [v.venue.id, i]));
  const byId = new Map(venues.map((v) => [v.venue.id, v.venue]));
  const statuses: SlotVenueStatus[] = [];
  for (const entry of day.venues) {
    const venue = byId.get(entry.venueId);
    if (!venue) continue;
    const open = isOpenDuring(venue.openingHours, day.date, start, end);
    if (entry.availability.status === 'live') {
      const free = freeCourtsBetween(entry.availability.freeSlots, start, end);
      if (free > 0) statuses.push({ venueId: venue.id, state: 'free', freeCourts: free });
      else statuses.push({ venueId: venue.id, state: open ? 'full' : 'closed' });
    } else {
      statuses.push({ venueId: venue.id, state: open ? 'check' : 'closed' });
    }
  }
  return statuses.sort(
    (a, b) =>
      STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
      (order.get(a.venueId) ?? 0) - (order.get(b.venueId) ?? 0),
  );
}

export interface SlotSummary {
  /** Venues with state "free". */
  freeVenues: number;
  /** Venues with state "check". */
  checkVenues: number;
  /** Sum of freeCourts over free venues. */
  freeCourts: number;
}

/** Counts for a calendar cell (one hour of one day). */
export function summarizeSlot(statuses: readonly SlotVenueStatus[]): SlotSummary {
  let freeVenues = 0;
  let checkVenues = 0;
  let freeCourts = 0;
  for (const s of statuses) {
    if (s.state === 'free') {
      freeVenues++;
      freeCourts += s.freeCourts ?? 0;
    } else if (s.state === 'check') checkVenues++;
  }
  return { freeVenues, checkVenues, freeCourts };
}
