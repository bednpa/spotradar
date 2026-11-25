import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { CookieJar } from '../aspnet.ts';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import { targetKey } from '../types.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import { parseStarezGrid, toStarezDate } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;
/** How long the session cookie of a page is reused for further date switches. */
export const SESSION_REUSE_MS = 5 * 60 * 1000;

export interface StarezConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter so several connectors respect one per-host limit. */
  limiter?: HostLimiter;
  /** Clock in epoch ms (tests). */
  now?: () => number;
}

type StarezSource = Extract<AvailabilitySourceConfig, { type: 'starez' }>;

interface Session {
  jar: CookieJar;
  at: number;
}

/** `{url}?date=DD.MM.YYYY&do=getDate` – the AJAX date switch of the reservation page. */
export function buildStarezDateUrl(source: StarezSource, date: string): URL {
  const url = new URL(source.url);
  url.searchParams.set('date', toStarezDate(date));
  url.searchParams.set('do', 'getDate');
  return url;
}

/**
 * STAREZ reservation pages (Brno's municipal sports venues, e.g. Beach Riviéra). A plain GET
 * returns today's grid and a session cookie; another day comes from the page's own AJAX date
 * switch (`?date=DD.MM.YYYY&do=getDate` with `X-Requested-With: XMLHttpRequest` and the session
 * cookie), answered with JSON holding the grid snippet. The parser checks the shown date, so a
 * mixed-up session never yields another day's data. Every read is one limiter task.
 */
export function createStarezConnector(options: StarezConnectorOptions = {}): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();
  const now = options.now ?? Date.now;
  /** One session per reservation page. */
  const sessions = new Map<string, Session>();

  function request(url: URL, jar: CookieJar, ajax: boolean): Promise<string> {
    return withTimeout(timeoutMs, async (signal) => {
      const headers: Record<string, string> = { 'user-agent': USER_AGENT };
      const cookie = jar.header();
      if (cookie) headers.cookie = cookie;
      if (ajax) {
        headers['x-requested-with'] = 'XMLHttpRequest';
        headers.accept = 'application/json';
      }
      const res = await fetchFn(url, { headers, redirect: 'manual', signal });
      if (!res.ok) throw new Error(`STAREZ responded with HTTP ${res.status}`);
      jar.store(res);
      return res.text();
    });
  }

  async function read(source: StarezSource, date: string): Promise<FreeSlot[]> {
    const pageUrl = new URL(source.url);
    const previous = sessions.get(pageUrl.href);
    sessions.delete(pageUrl.href);
    if (previous && now() - previous.at < SESSION_REUSE_MS) {
      try {
        const slots = parseStarezGrid(
          await request(buildStarezDateUrl(source, date), previous.jar, true),
          date,
          source.facility,
        );
        sessions.set(pageUrl.href, { jar: previous.jar, at: now() });
        return slots;
      } catch {
        // Expired session or changed answer: start over with a clean GET.
      }
    }
    const jar = new CookieJar();
    const page = await request(pageUrl, jar, false);
    let slots: FreeSlot[];
    try {
      // The plain page shows today; any other day needs the date switch.
      slots = parseStarezGrid(page, date, source.facility);
    } catch {
      slots = parseStarezGrid(
        await request(buildStarezDateUrl(source, date), jar, true),
        date,
        source.facility,
      );
    }
    sessions.set(pageUrl.href, { jar, at: now() });
    return slots;
  }

  return {
    type: 'starez',
    async getFreeSlots(target, date): Promise<FreeSlot[]> {
      const source = target.source;
      if (source.type !== 'starez') {
        throw new Error(`${targetKey(target)} is not a STAREZ source`);
      }
      return limiter.run(new URL(source.url).host, () => read(source, date));
    },
  };
}
