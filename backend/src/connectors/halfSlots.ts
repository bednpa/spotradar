import type { FreeSlot } from '@spotradar/shared';
import { minutesToTime } from '@spotradar/shared';

export const HALF_SLOT_MINUTES = 30;

/**
 * Turns "which courts are free in which 30-minute half-slot" into FreeSlot[]:
 * freeCourts = number of distinct free courts, consecutive half-slots with the same
 * count are merged, half-slots without any free court are skipped. Sorted by start.
 *
 * `freeCourtsByStart` maps the start (minutes since midnight) of a half-slot to the
 * set of court identifiers that are free during it.
 */
export function freeSlotsFromHalfSlots(
  freeCourtsByStart: ReadonlyMap<number, ReadonlySet<string>>,
): FreeSlot[] {
  const starts = [...freeCourtsByStart.keys()].sort((a, b) => a - b);
  const slots: FreeSlot[] = [];
  let current: { start: number; end: number; freeCourts: number } | undefined;
  const flush = (): void => {
    if (current) {
      slots.push({
        start: minutesToTime(current.start),
        end: minutesToTime(current.end),
        freeCourts: current.freeCourts,
      });
      current = undefined;
    }
  };
  for (const start of starts) {
    const freeCourts = freeCourtsByStart.get(start)?.size ?? 0;
    if (freeCourts === 0) {
      flush();
      continue;
    }
    if (current && current.end === start && current.freeCourts === freeCourts) {
      current.end = start + HALF_SLOT_MINUTES;
    } else {
      flush();
      current = { start, end: start + HALF_SLOT_MINUTES, freeCourts };
    }
  }
  flush();
  return slots;
}
