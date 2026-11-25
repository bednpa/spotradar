import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { CookieJar } from '../aspnet.ts';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import {
  MemberzoneDateNotShownError,
  MemberzoneParseError,
  parseMemberzoneForm,
  parseMemberzoneWeek,
} from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;
/** A page shows 7 days; the other 6 are kept this long so a calendar request needs few round trips. */
export const WEEK_CACHE_TTL_MS = 5 * 60 * 1000;

export interface MemberzoneConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter: MemberZone and MemberPro both run on memberzone.cz and must be serialized. */
  limiter?: HostLimiter;
  /** Lifetime of the per-day cache (default 5 minutes). */
  cacheTtlMs?: number;
  /** Clock in epoch ms (tests). */
  now?: () => number;
}

type MemberzoneSource = Extract<AvailabilitySourceConfig, { type: 'memberzone' }>;

interface CachedDay {
  slots: FreeSlot[];
  storedAt: number;
}

/**
 * MemberZone (Hala Sprint). One page = a 7-day week starting at the selected date.
 *
 *  1. GET the booking page (week starting today; keeps the ASP.NET session cookie).
 *  2. If the wanted date is not among those 7 days: POST the page's own form back with
 *     `__EVENTTARGET=btnHidePom` and `myDate=YYYY-MM-DD`; the answer is the week starting there.
 *
 * All 7 parsed days are cached briefly, and the cache is checked again after waiting in the
 * host queue, so a calendar asking for D..D+14 costs one GET and at most two POSTs.
 */
export function createMemberzoneConnector(
  options: MemberzoneConnectorOptions = {},
): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();
  const cacheTtlMs = options.cacheTtlMs ?? WEEK_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CachedDay>();

  function cached(key: string): FreeSlot[] | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (now() - entry.storedAt >= cacheTtlMs) {
      cache.delete(key);
      return undefined;
    }
    return entry.slots.map((s) => ({ ...s }));
  }

  function store(venueId: string, week: Map<string, FreeSlot[]>): void {
    const storedAt = now();
    for (const [key, entry] of cache) {
      if (storedAt - entry.storedAt >= cacheTtlMs) cache.delete(key);
    }
    for (const [date, slots] of week) cache.set(`${venueId}|${date}`, { slots, storedAt });
  }

  function request(url: URL, jar: CookieJar, post?: URLSearchParams): Promise<string> {
    return withTimeout(timeoutMs, async (signal) => {
      const headers: Record<string, string> = { 'user-agent': USER_AGENT };
      const cookie = jar.header();
      if (cookie) headers.cookie = cookie;
      if (post) headers['content-type'] = 'application/x-www-form-urlencoded';
      const res = await fetchFn(
        url,
        post
          ? { method: 'POST', headers, body: post.toString(), redirect: 'manual', signal }
          : { headers, signal },
      );
      if (!res.ok) throw new Error(`MemberZone responded with HTTP ${res.status}`);
      jar.store(res);
      return res.text();
    });
  }

  async function readWeek(
    source: MemberzoneSource,
    date: string,
  ): Promise<Map<string, FreeSlot[]>> {
    const pageUrl = new URL(source.url);
    const jar = new CookieJar();
    const html = await request(pageUrl, jar);
    try {
      return parseMemberzoneWeek(html, date);
    } catch (err) {
      if (!(err instanceof MemberzoneDateNotShownError)) throw err;
    }

    const form = parseMemberzoneForm(html);
    const action = new URL(form.action, pageUrl);
    if (action.host !== pageUrl.host) {
      throw new MemberzoneParseError(`MemberZone form posts to an unexpected host ${action.host}`);
    }
    form.fields.set('__EVENTTARGET', 'btnHidePom');
    form.fields.set('__EVENTARGUMENT', '');
    form.fields.set('myDate', date);
    // A week that still lacks the date means the postback did not work: never use another day's data.
    return parseMemberzoneWeek(await request(action, jar, form.fields), date);
  }

  return {
    type: 'memberzone',
    async getFreeSlots(venue, date): Promise<FreeSlot[]> {
      const source = venue.source;
      if (source.type !== 'memberzone') {
        throw new Error(`Venue ${venue.id} is not a MemberZone venue`);
      }
      const key = `${venue.id}|${date}`;
      const hit = cached(key);
      if (hit) return hit;

      return limiter.run(new URL(source.url).host, async () => {
        // An earlier task in the queue may have loaded this week meanwhile.
        const afterWait = cached(key);
        if (afterWait) return afterWait;
        const week = await readWeek(source, date);
        store(venue.id, week);
        return (week.get(date) ?? []).map((s) => ({ ...s }));
      });
    },
  };
}
