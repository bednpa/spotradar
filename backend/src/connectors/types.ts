import type { AvailabilitySource, FreeSlot } from '@spotradar/shared';
import type { VenueRecord } from '../repositories/venueRepository.ts';

/** Subset of the global `fetch` that connectors need (injectable in tests). */
export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * Reads free courts from one kind of booking system.
 *
 * To support a new system (Bizzy, MemberZone, MemberPro, ...): implement this
 * interface and add the instance to `createDefaultConnectors`. Venues whose
 * `source.type` has no registered connector are reported as status "unknown".
 */
export interface AvailabilityConnector {
  /** The `source.type` this connector handles. */
  readonly type: AvailabilitySource;
  /**
   * Free slots of `venue` on `date` ("YYYY-MM-DD"), sorted by start.
   * Must throw (reject) when the data cannot be read; never return partial garbage.
   */
  getFreeSlots(venue: VenueRecord, date: string): Promise<FreeSlot[]>;
}
