import type {
  AvailabilitySource,
  AvailabilitySourceConfig,
  FreeSlot,
  SportId,
} from '@spotradar/shared';

/** Subset of the global `fetch` that connectors need (injectable in tests). */
export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

/**
 * What a connector reads: one sport of one venue. Connectors only use `source` (plus the ids
 * for messages), so a venue in another city only needs new config, never new connector code.
 */
export interface AvailabilityTarget {
  venueId: string;
  sport: SportId;
  source: AvailabilitySourceConfig;
}

/** "centrum-viktoria/squash": identifies a target in connector caches and messages. */
export function targetKey(target: Pick<AvailabilityTarget, 'venueId' | 'sport'>): string {
  return `${target.venueId}/${target.sport}`;
}

/**
 * Reads free courts from one kind of booking system.
 *
 * To support a new system: implement this interface and add the instance to
 * `createDefaultConnectors`. Offerings whose `source.type` has no registered connector are
 * reported as status "unknown".
 */
export interface AvailabilityConnector {
  /** The `source.type` this connector handles. */
  readonly type: AvailabilitySource;
  /**
   * Free slots of the target on `date` ("YYYY-MM-DD"), sorted by start.
   * Must throw (reject) when the data cannot be read; never return partial garbage.
   */
  getFreeSlots(target: AvailabilityTarget, date: string): Promise<FreeSlot[]>;
}
