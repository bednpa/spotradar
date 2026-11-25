import type { AvailabilitySourceConfig, FreeSlot, VenueAvailability } from '@spotradar/shared';
import type { Logger } from '../logger.ts';
import type { VenueRecord } from '../repositories/venueRepository.ts';
import { createBizzyConnector } from './bizzy/connector.ts';
import { createClubspireConnector } from './clubspire/connector.ts';
import { createHostLimiter } from './hostLimiter.ts';
import { createMemberproConnector } from './memberpro/connector.ts';
import { createMemberzoneConnector } from './memberzone/connector.ts';
import { UpstreamTimeoutError } from './timeout.ts';
import type { AvailabilityConnector, FetchFn } from './types.ts';

export const AVAILABILITY_CACHE_TTL_MS = 15 * 60 * 1000;
/** Entries older than the TTL but younger than this are served stale while refreshing. */
export const AVAILABILITY_STALE_MAX_AGE_MS = 60 * 60 * 1000;
/** At most one failure warning per host per this interval. */
export const HOST_WARNING_INTERVAL_MS = 60 * 60 * 1000;
export const BACKOFF_INITIAL_MS = 5 * 60 * 1000;
export const BACKOFF_MAX_MS = 60 * 60 * 1000;

export type WarmResult = 'skipped' | 'ok' | 'failed';

/** Never rejects: failures are mapped to a status. */
export interface AvailabilityService {
  getAvailability(venue: VenueRecord, date: string): Promise<VenueAvailability>;
  /** True when a connector is registered for the venue's booking system (live data possible). */
  supports(venue: VenueRecord): boolean;
  /** True while connection failures keep the host in backoff (reads are not attempted). */
  isHostBackedOff(host: string): boolean;
  /**
   * Refreshes the cache entry for the warmer. Reads only when the entry is missing or older
   * than `refreshIfOlderThanMs` (default 0 = always read); skips backed-off hosts. Never rejects.
   */
  warm(
    venue: VenueRecord,
    date: string,
    options?: { refreshIfOlderThanMs?: number },
  ): Promise<WarmResult>;
}

export interface AvailabilityServiceOptions {
  connectors: readonly AvailabilityConnector[];
  now: () => Date;
  cacheTtlMs?: number;
  /** Max age of an entry that may still be served (stale) while it refreshes in background. */
  staleMaxAgeMs?: number;
  /** Minimum gap between two failure warnings of the same host. */
  warningIntervalMs?: number;
  logger?: Logger;
}

/** Host (with port) of the venue's booking system, `undefined` for venues without a source. */
export function sourceHost(source: AvailabilitySourceConfig): string | undefined {
  let raw: string;
  switch (source.type) {
    case 'clubspire':
      raw = source.baseUrl;
      break;
    case 'bizzy':
      raw = source.scheduleUrl;
      break;
    case 'memberzone':
    case 'memberpro':
      raw = source.url;
      break;
    default:
      return undefined;
  }
  try {
    return new URL(raw).host;
  } catch {
    return undefined;
  }
}

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Short reason when `err` (or any `cause` in its chain) is a connection-level failure. */
function connectionReason(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth++) {
    if (current instanceof UpstreamTimeoutError) return 'timeout';
    if (typeof current !== 'object') return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** True for refused/reset/unreachable/DNS/timeout failures (also nested in `cause`). */
export function isConnectionError(err: unknown): boolean {
  return connectionReason(err) !== undefined;
}

interface CacheEntry {
  freeSlots: FreeSlot[];
  checkedAt: string;
  storedAt: number;
}

/**
 * Default connector set. Add new booking-system connectors here; venues whose
 * `source.type` has no connector report status "unknown".
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
    createBizzyConnector({ fetch: options.fetch, limiter }),
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
  const staleMaxAge = Math.max(options.staleMaxAgeMs ?? AVAILABILITY_STALE_MAX_AGE_MS, ttl);
  const warningInterval = options.warningIntervalMs ?? HOST_WARNING_INTERVAL_MS;
  const logger: Logger = options.logger ?? console;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<CacheEntry>>();
  const backoff = new Map<string, { failures: number; until: number }>();
  const warnings = new Map<string, { lastAt: number; suppressed: number }>();

  function isBackedOff(host: string | undefined): boolean {
    if (host === undefined) return false;
    const state = backoff.get(host);
    return state !== undefined && options.now().getTime() < state.until;
  }

  function markConnectionFailure(host: string): void {
    const nowMs = options.now().getTime();
    const state = backoff.get(host);
    // Concurrent failures of one burst count once.
    if (state && nowMs < state.until) return;
    const failures = (state?.failures ?? 0) + 1;
    const duration = Math.min(BACKOFF_INITIAL_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
    backoff.set(host, { failures, until: nowMs + duration });
  }

  /** At most one warning per host per interval; later ones are counted and reported once. */
  function warnFailure(venue: VenueRecord, date: string, host: string, err: unknown): void {
    const nowMs = options.now().getTime();
    const connection = connectionReason(err);
    // Connection failures and other failures (changed markup, HTTP errors) are limited
    // separately, so a network blip never hides a broken parser for an hour.
    const key = `${host}|${connection !== undefined ? 'connection' : 'read'}`;
    const state = warnings.get(key);
    if (state && nowMs - state.lastAt < warningInterval) {
      state.suppressed++;
      return;
    }
    const minutes = Math.round(warningInterval / 60_000);
    const suppressed = state?.suppressed ?? 0;
    const note =
      suppressed > 0 ? ` (${suppressed} failures suppressed since the last warning)` : '';
    const reason = err instanceof Error ? err.message : String(err);
    const message =
      connection !== undefined
        ? `${host} unreachable (${connection}): its venues show "check on website"; next warning in ${minutes} min${note}`
        : `${host} read failed for ${venue.id} on ${date}: ${reason}; next warning in ${minutes} min${note}`;
    warnings.set(key, { lastAt: nowMs, suppressed: 0 });
    logger.warn(message);
  }

  function evictOld(nowMs: number): void {
    for (const [key, entry] of cache) {
      if (nowMs - entry.storedAt >= staleMaxAge) cache.delete(key);
    }
  }

  /** Reads from the connector (sharing one in-flight read per key) and updates cache + host health. */
  function read(
    connector: AvailabilityConnector,
    venue: VenueRecord,
    date: string,
  ): Promise<CacheEntry> {
    const key = `${venue.id}|${date}`;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const host = sourceHost(venue.source);
    const began = performance.now();
    const took = (): number => Math.round(performance.now() - began);
    // Promise.resolve().then: a connector that throws synchronously still yields a rejection,
    // so callers (incl. the fire-and-forget stale refresh) never see a thrown exception.
    const request = Promise.resolve()
      .then(() => connector.getFreeSlots(venue, date))
      .then(
        (freeSlots) => {
          const at = options.now();
          const entry: CacheEntry = {
            freeSlots,
            checkedAt: at.toISOString(),
            storedAt: at.getTime(),
          };
          cache.set(key, entry);
          evictOld(entry.storedAt);
          if (host !== undefined) backoff.delete(host);
          logger.info(`[availability] ${venue.id} ${date} read in ${took()} ms (ok)`);
          return entry;
        },
        (err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          logger.info(
            `[availability] ${venue.id} ${date} read in ${took()} ms (failed: ${reason})`,
          );
          const hostKey = host ?? venue.id;
          if (host !== undefined && isConnectionError(err)) markConnectionFailure(host);
          warnFailure(venue, date, hostKey, err);
          throw err;
        },
      )
      .finally(() => {
        inFlight.delete(key);
      });
    inFlight.set(key, request);
    return request;
  }

  function ageOf(entry: CacheEntry): number {
    return options.now().getTime() - entry.storedAt;
  }

  function toLive(entry: CacheEntry): VenueAvailability {
    // Copy so callers (e.g. today's past-slot removal) cannot mutate the cache.
    return {
      status: 'live',
      checkedAt: entry.checkedAt,
      freeSlots: entry.freeSlots.map((s) => ({ ...s })),
    };
  }

  return {
    supports(venue) {
      return byType.has(venue.source.type);
    },
    isHostBackedOff(host) {
      return isBackedOff(host);
    },
    async getAvailability(venue, date) {
      const connector = byType.get(venue.source.type);
      if (!connector) return { status: 'unknown', freeSlots: [] };
      const key = `${venue.id}|${date}`;
      const cached = cache.get(key);
      if (cached && ageOf(cached) >= staleMaxAge) cache.delete(key);
      else if (cached) {
        if (ageOf(cached) >= ttl && !isBackedOff(sourceHost(venue.source))) {
          // Stale-while-revalidate: answer now, refresh in the background (failures are logged
          // by `read` and the stale entry stays).
          read(connector, venue, date).catch(() => undefined);
        }
        return toLive(cached);
      }
      if (isBackedOff(sourceHost(venue.source))) return { status: 'unavailable', freeSlots: [] };
      try {
        return toLive(await read(connector, venue, date));
      } catch {
        // `read` already logged the failure.
        return { status: 'unavailable', freeSlots: [] };
      }
    },
    async warm(venue, date, warmOptions = {}) {
      const connector = byType.get(venue.source.type);
      if (!connector || isBackedOff(sourceHost(venue.source))) return 'skipped';
      const cached = cache.get(`${venue.id}|${date}`);
      if (cached && ageOf(cached) < (warmOptions.refreshIfOlderThanMs ?? 0)) return 'skipped';
      try {
        await read(connector, venue, date);
        return 'ok';
      } catch {
        return 'failed';
      }
    },
  };
}
