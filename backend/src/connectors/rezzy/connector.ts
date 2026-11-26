import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { toLocalDateTime } from '@spotradar/shared';
import { REZZY_API_ORIGIN } from '../apiOrigins.ts';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import { targetKey } from '../types.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import { parseRezzyArea, parseRezzyBlockers, rezzyFreeSlots } from './parser.ts';
import type { RezzyArea } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;
/** How long the sport-area detail (courts + season hours) of a date is reused. */
export const AREA_CACHE_MS = 60 * 60 * 1000;
/** Host of the Rezzy API (key of the shared per-host limiter). */
export const REZZY_HOST = new URL(REZZY_API_ORIGIN).host;

export interface RezzyConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter so several connectors respect one per-host limit. */
  limiter?: HostLimiter;
  /** Clock (tests); decides which cells of today have already started. */
  now?: () => Date;
}

type RezzySource = Extract<AvailabilitySourceConfig, { type: 'rezzy' }>;

/** `SportAreas/{id}?date=` – courts in display order and the season hours. */
export function buildRezzyAreaUrl(source: RezzySource, date: string): URL {
  const url = new URL(
    `${REZZY_API_ORIGIN}/api/sportarea/v1/Tenants/${source.tenantId}/SportAreas/${source.sportAreaId}`,
  );
  url.searchParams.set('date', date);
  return url;
}

/** `…/CustomerSchedules/ReservationBlockers?date=` – the occupied intervals of the day. */
export function buildRezzyBlockersUrl(source: RezzySource, date: string): URL {
  const url = new URL(
    `${REZZY_API_ORIGIN}/api/reservation/v1/Tenants/${source.tenantId}/SportAreas/${source.sportAreaId}/CustomerSchedules/ReservationBlockers`,
  );
  url.searchParams.set('date', date);
  return url;
}

/**
 * Rezzy (rezzy.eu, e.g. TennisLinden): anonymous access gives only the occupied intervals per
 * court ("ReservationBlockers") plus the sport-area detail with courts and season hours, so free
 * time = the weekday's hours minus the blockers. The area detail is cached for an hour per date.
 * One read (two requests) is one limiter task.
 */
export function createRezzyConnector(options: RezzyConnectorOptions = {}): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();
  const now = options.now ?? (() => new Date());
  const areaCache = new Map<string, { area: RezzyArea; at: number }>();

  function getText(url: URL): Promise<string> {
    return withTimeout(timeoutMs, async (signal) => {
      const res = await fetchFn(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal,
      });
      if (!res.ok) throw new Error(`Rezzy responded with HTTP ${res.status}`);
      return res.text();
    });
  }

  async function read(source: RezzySource, date: string): Promise<FreeSlot[]> {
    const local = toLocalDateTime(now());
    // A past day has nothing left to book (and the blockers no longer cover it).
    if (date < local.date) return [];
    const key = `${source.tenantId}/${source.sportAreaId}/${date}`;
    for (const [k, entry] of areaCache) {
      if (now().getTime() - entry.at >= AREA_CACHE_MS) areaCache.delete(k);
    }
    const cached = areaCache.get(key);
    let area = cached && now().getTime() - cached.at < AREA_CACHE_MS ? cached.area : undefined;
    if (!area) {
      area = parseRezzyArea(
        await getText(buildRezzyAreaUrl(source, date)),
        source.sportAreaId,
        date,
      );
      areaCache.set(key, { area, at: now().getTime() });
    }
    const blocks = parseRezzyBlockers(await getText(buildRezzyBlockersUrl(source, date)), area);
    return rezzyFreeSlots(area, blocks, local.date === date ? local.minutes : 0);
  }

  return {
    type: 'rezzy',
    async getFreeSlots(target, date): Promise<FreeSlot[]> {
      const source = target.source;
      if (source.type !== 'rezzy') {
        throw new Error(`${targetKey(target)} is not a Rezzy source`);
      }
      return limiter.run(REZZY_HOST, () => read(source, date));
    },
  };
}
