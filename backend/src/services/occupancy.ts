/**
 * SIMULATED external occupancy.
 *
 * SpotRadar is meant to aggregate the booking systems of many venues. This demo
 * has no such systems, so "booked elsewhere" slots are simulated by a
 * deterministic hash: the same court/date/slot is always occupied or always free.
 */

/** 32-bit FNV-1a hash of a string. */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export const OFF_PEAK_OCCUPANCY_PERCENT = 35;
export const PEAK_OCCUPANCY_PERCENT = 55;
const PEAK_START_MINUTES = 17 * 60;
const PEAK_END_MINUTES = 21 * 60;

/** Probability (in percent) that a slot is occupied; higher at 17:00-20:59. */
export function occupancyThresholdPercent(slotStartMinutes: number): number {
  return slotStartMinutes >= PEAK_START_MINUTES && slotStartMinutes < PEAK_END_MINUTES
    ? PEAK_OCCUPANCY_PERCENT
    : OFF_PEAK_OCCUPANCY_PERCENT;
}

/** Is the 30-minute slot starting at slotStartMinutes booked in an external system? */
export function isSlotOccupiedExternally(
  courtId: string,
  date: string,
  slotStartMinutes: number,
): boolean {
  return mix32(fnv1a(`${courtId}|${date}|${slotStartMinutes}`)) % 100 <
    occupancyThresholdPercent(slotStartMinutes);
}

/** Avalanche step (murmur3 fmix32) so the low bits used by `% 100` are well distributed. */
function mix32(input: number): number {
  let h = input;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
