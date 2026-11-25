import type { FreeSlot, VenueAvailability } from '@spotradar/shared';
import type { VenueRecord } from '../repositories/venueRepository.ts';
import { createClubspireConnector } from './clubspire/connector.ts';
import { createHostLimiter } from './hostLimiter.ts';
import { createMemberproConnector } from './memberpro/connector.ts';
import { createMemberzoneConnector } from './memberzone/connector.ts';
import type { AvailabilityConnector, FetchFn } from './types.ts';

export const AVAILABILITY_CACHE_TTL_MS = 15 * 60 * 1000;

/** Never rejects: failures are mapped to a status. */
export interface AvailabilityService {
  getAvailability(venue: VenueRecord, date: string): Promise<VenueAvailability>;
  /** True when a connector is registered for the venue's booking system (live data possible). */
  supports(venue: VenueRecord): boolean;
}

export interface AvailabilityServiceOptions {
  connectors: readonly AvailabilityConnector[];
  now: () => Date;
  cacheTtlMs?: number;
  logger?: { warn: (message: string) => void };
}

interface CacheEntry {
  freeSlots: FreeSlot[];
  checkedAt: string;
  storedAt: number;
}

/**
 * Default connector set. Add new booking-system connectors here (Bizzy);
 * until then those venues report status "unknown".
 */
export function createDefaultConnectors(
  options: { fetch?: FetchFn } = {},
): AvailabilityConnector[] {
  const limiter = createHostLimiter();
  // One limiter for all: MemberZone (Sprint) and MemberPro (Ivanovice) share memberzone.cz.
  return [
    createClubspireConnector({ fetch: options.fetch, limiter }),
    createMemberzoneConnector({ fetch: options.fetch, limiter }),
    createMemberproConnector({ fetch: options.fetch, limiter }),
  ];
}

/**
 * Maps `venue.source.type` to a connector and turns its outcome into a
 * VenueAvailability. Successful reads are cached per venue + date (default
 * 15 min; a cached value keeps its original `checkedAt`) and concurrent
 * requests for the same key share one in-flight read. Failures are not cached.
 */
export function createAvailabilityService(
  options: AvailabilityServiceOptions,
): AvailabilityService {
  const byType = new Map(options.connectors.map((c) => [c.type, c]));
  const ttl = options.cacheTtlMs ?? AVAILABILITY_CACHE_TTL_MS;
  const logger = options.logger ?? console;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<CacheEntry>>();

  function fetchEntry(
    connector: AvailabilityConnector,
    venue: VenueRecord,
    date: string,
  ): Promise<CacheEntry> {
    const key = `${venue.id}|${date}`;
    const cached = cache.get(key);
    if (cached && options.now().getTime() - cached.storedAt < ttl) return Promise.resolve(cached);

    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = connector
      .getFreeSlots(venue, date)
      .then((freeSlots) => {
        const at = options.now();
        const entry: CacheEntry = {
          freeSlots,
          checkedAt: at.toISOString(),
          storedAt: at.getTime(),
        };
        cache.set(key, entry);
        return entry;
      })
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  }

  return {
    supports(venue) {
      return byType.has(venue.source.type);
    },
    async getAvailability(venue, date) {
      const connector = byType.get(venue.source.type);
      if (!connector) return { status: 'unknown', freeSlots: [] };
      try {
        const entry = await fetchEntry(connector, venue, date);
        // Copy so callers (e.g. today's past-slot removal) cannot mutate the cache.
        return {
          status: 'live',
          checkedAt: entry.checkedAt,
          freeSlots: entry.freeSlots.map((s) => ({ ...s })),
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.warn(`Availability of ${venue.id} on ${date} unavailable: ${reason}`);
        return { status: 'unavailable', freeSlots: [] };
      }
    },
  };
}
