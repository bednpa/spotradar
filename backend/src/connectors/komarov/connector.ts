import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { toLocalDateTime } from '@spotradar/shared';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import { targetKey } from '../types.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import { KomarovParseError, freeSlotsOf, komarovWeekOffset, parseKomarovWeek } from './parser.ts';
import type { HalfSlotCourts } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;
/**
 * One page shows 7 days; the parsed week is kept this long so a calendar asking for several days
 * of a week costs one request. Short on purpose: the availability service stamps `checkedAt`
 * when the connector answers, so a longer cache would make old data look freshly checked.
 */
export const WEEK_CACHE_TTL_MS = 2 * 60 * 1000;

export interface KomarovConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter so several connectors respect one per-host limit. */
  limiter?: HostLimiter;
  /** Lifetime of the parsed-week cache (default 2 minutes). */
  cacheTtlMs?: number;
  /** Clock in epoch ms (tests). */
  now?: () => number;
}

type KomarovSource = Extract<AvailabilitySourceConfig, { type: 'komarov' }>;

interface CachedWeek {
  days: Map<string, HalfSlotCourts>;
  storedAt: number;
}

/** `{url}{offset}/` – the site redirects the form without the trailing slash. */
export function buildKomarovUrl(source: KomarovSource, weekOffset: number): URL {
  const base = source.url.endsWith('/') ? source.url : `${source.url}/`;
  return new URL(`${base}${weekOffset}/`);
}

/**
 * Tenisový areál Komárov: the club's own server-rendered week timetable. `/rozvrh/<N>/` shows
 * the Monday–Sunday week N weeks from the current one (negative offsets are clamped by the site
 * and there is no history), so a date before this week is rejected. The page's day headings
 * decide which day is read, never the offset. The parsed week is cached briefly; slots that
 * already started today are dropped at answer time (the page keeps the colour of past cells).
 */
export function createKomarovConnector(
  options: KomarovConnectorOptions = {},
): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();
  const cacheTtlMs = options.cacheTtlMs ?? WEEK_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  /** Parsed weeks per page URL. */
  const cache = new Map<string, CachedWeek>();

  function cachedWeek(key: string): CachedWeek | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (now() - entry.storedAt >= cacheTtlMs) {
      cache.delete(key);
      return undefined;
    }
    return entry;
  }

  function request(url: URL): Promise<string> {
    return withTimeout(timeoutMs, async (signal) => {
      const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT }, signal });
      if (!res.ok) throw new Error(`Komárov responded with HTTP ${res.status}`);
      return res.text();
    });
  }

  function answer(week: CachedWeek, date: string): FreeSlot[] {
    const halfSlots = week.days.get(date);
    if (!halfSlots) throw new KomarovParseError(`Komárov timetable does not show ${date}`);
    return freeSlotsOf(halfSlots, date, toLocalDateTime(new Date(now())));
  }

  return {
    type: 'komarov',
    async getFreeSlots(target, date): Promise<FreeSlot[]> {
      const source = target.source;
      if (source.type !== 'komarov') {
        throw new Error(`${targetKey(target)} is not a Komárov source`);
      }
      const today = toLocalDateTime(new Date(now())).date;
      const offset = komarovWeekOffset(date, today);
      if (offset < 0) throw new Error(`Komárov shows no weeks before the current one (${date})`);
      const url = buildKomarovUrl(source, offset);

      const hit = cachedWeek(url.href);
      if (hit) return answer(hit, date);
      return limiter.run(url.host, async () => {
        // An earlier task in the queue may have loaded this week meanwhile.
        const afterWait = cachedWeek(url.href);
        if (afterWait) return answer(afterWait, date);
        const week: CachedWeek = { days: parseKomarovWeek(await request(url)), storedAt: now() };
        for (const [key, entry] of cache) {
          if (week.storedAt - entry.storedAt >= cacheTtlMs) cache.delete(key);
        }
        cache.set(url.href, week);
        return answer(week, date);
      });
    },
  };
}
