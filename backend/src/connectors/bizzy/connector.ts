import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { daysBetween, toLocalDateTime } from '@spotradar/shared';
import { CookieJar } from '../aspnet.ts';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import {
  BizzyParseError,
  VIEW_EIGHT_DAYS,
  bizzyDaySlots,
  parseBizzyDays,
  parseBizzyNav,
  readSelectedView,
  readViewState,
} from './parser.ts';
import type { BizzyDay, BizzyNav } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;
/**
 * One page holds 8 days; they are kept this long so the reads of one calendar request or one
 * warming pass (all within seconds) share a page. Kept short on purpose: the availability service
 * stamps `checkedAt` when the connector answers, so a longer connector cache would make old data
 * look freshly checked.
 */
export const DAY_CACHE_TTL_MS = 2 * 60 * 1000;

export interface BizzyConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  limiter?: HostLimiter;
  /** Clock in epoch ms (tests). */
  now?: () => number;
  /** Lifetime of the per-day cache (default 15 minutes). */
  cacheTtlMs?: number;
}

type BizzySource = Extract<AvailabilitySourceConfig, { type: 'bizzy' }>;

interface CachedDay {
  day: BizzyDay;
  storedAt: number;
}

interface Page {
  html: string;
  url: URL;
}

/** "2026-12-01" -> "1.12.2026" (the date picker's `d.M.yyyy`). */
function pickerDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d}.${m}.${y}`;
}

/** "2026-12-01" -> "12/2026" (`schedule_calendarInputCurrentDate`). */
function pickerMonth(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return `${m}/${y}`;
}

/**
 * Bizzy (RichFaces 3 / A4J) booking pages: Badminton Jehnice, Badminton Líšeň, X-Arena Slatina.
 *
 *  1. GET the schedule page (JSESSIONID cookie, default view).
 *  2. Unless it already shows "today + 7 days": A4J POST switching `view_filter_menu` to
 *     `horizontal_service_dayandweek` (8 days from the session's date).
 *  3. If the wanted date is still not shown: A4J POST of the date picker, which moves the
 *     8-day window to start at that date.
 *
 * All days of every response are cached briefly (2 min), and the cache is checked again after
 * waiting in the host queue, so a 7-day calendar costs one GET and one POST per venue.
 * `minLeadMinutes` is applied here per cell (exact for the venue's column length) and again by
 * `withoutTooSoonSlots` in services/search.ts when answering, because the availability service
 * caches this result for up to an hour; the later cutoff is always the stricter one.
 *
 * Fetch failures propagate unchanged (with their `cause`), so the caller can tell a refused
 * connection from a timeout or a changed page (`BizzyParseError`).
 */
export function createBizzyConnector(options: BizzyConnectorOptions = {}): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? DAY_CACHE_TTL_MS;
  const cache = new Map<string, CachedDay>();

  /** Minutes (since midnight of `date`) before which hour cells are not free; undefined = no rule. */
  function notBefore(source: BizzySource, date: string): number | undefined {
    if (!source.minLeadMinutes) return undefined;
    const local = toLocalDateTime(new Date(now()));
    return local.minutes + source.minLeadMinutes - 24 * 60 * daysBetween(local.date, date);
  }

  function cachedSlots(source: BizzySource, venueId: string, date: string): FreeSlot[] | undefined {
    const key = `${venueId}|${date}`;
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (now() - entry.storedAt >= cacheTtlMs) {
      cache.delete(key);
      return undefined;
    }
    return bizzyDaySlots(entry.day, notBefore(source, date));
  }

  function store(venueId: string, days: Map<string, BizzyDay>): void {
    const storedAt = now();
    for (const [key, entry] of cache) {
      if (storedAt - entry.storedAt >= cacheTtlMs) cache.delete(key);
    }
    for (const [date, day] of days) cache.set(`${venueId}|${date}`, { day, storedAt });
  }

  function request(url: URL, jar: CookieJar, post?: URLSearchParams): Promise<Page> {
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
      if (!res.ok) throw new Error(`Bizzy responded with HTTP ${res.status}`);
      jar.store(res);
      return { html: await res.text(), url: res.url ? new URL(res.url) : url };
    });
  }

  function postbackBody(
    nav: BizzyNav,
    viewState: string,
    actionId: string,
    inputDate: string,
    inputCurrentDate: string,
  ): URLSearchParams {
    const body = new URLSearchParams();
    body.set('AJAXREQUEST', 'scheduleNavigForm:schedule-navig-region');
    body.set('AJAX:EVENTS_COUNT', '1');
    body.set('scheduleNavigForm', 'scheduleNavigForm');
    body.set('javax.faces.ViewState', viewState);
    body.set(nav.hiddenName, nav.hiddenValue);
    body.set('scheduleNavigForm:view_filter_menu', VIEW_EIGHT_DAYS);
    body.set('scheduleNavigForm:schedule_calendarInputDate', inputDate);
    body.set('scheduleNavigForm:schedule_calendarInputCurrentDate', inputCurrentDate);
    body.set(actionId, actionId);
    return body;
  }

  /** Loads the venue's pages until `date` is shown, caching every day seen on the way. */
  async function loadWindow(venueId: string, source: BizzySource, date: string): Promise<void> {
    const jar = new CookieJar();
    const pageUrl = new URL(source.scheduleUrl);
    const page = await request(pageUrl, jar);
    let days = parseBizzyDays(page.html, { referenceDate: date });
    store(venueId, days);
    const eightDays = readSelectedView(page.html) === VIEW_EIGHT_DAYS;
    if (eightDays && days.has(date)) return;

    const nav = parseBizzyNav(page.html);
    const action = new URL(nav.actionUrl, page.url);
    if (action.host !== pageUrl.host) {
      throw new BizzyParseError(`Bizzy form posts to an unexpected host ${action.host}`);
    }
    let viewState = nav.viewState;
    const post = async (actionId: string, inputDate: string, inputMonth: string): Promise<void> => {
      const res = await request(
        action,
        jar,
        postbackBody(nav, viewState, actionId, inputDate, inputMonth),
      );
      viewState = readViewState(res.html) ?? viewState;
      days = parseBizzyDays(res.html, { referenceDate: date });
      store(venueId, days);
    };

    if (!eightDays) {
      await post(nav.viewChangeId, nav.inputDate, nav.inputCurrentDate);
      if (days.has(date)) return;
    }
    await post(nav.dateChangeId, pickerDate(date), pickerMonth(date));
    // Never answer with another day's data when the postback did not move the window.
    if (!days.has(date)) throw new BizzyParseError(`Bizzy response does not show ${date}`);
  }

  return {
    type: 'bizzy',
    async getFreeSlots(venue, date): Promise<FreeSlot[]> {
      const source = venue.source;
      if (source.type !== 'bizzy') throw new Error(`Venue ${venue.id} is not a Bizzy venue`);
      const hit = cachedSlots(source, venue.id, date);
      if (hit) return hit;

      return limiter.run(new URL(source.scheduleUrl).host, async () => {
        // An earlier task in the queue may have loaded this window meanwhile.
        const afterWait = cachedSlots(source, venue.id, date);
        if (afterWait) return afterWait;
        await loadWindow(venue.id, source, date);
        const slots = cachedSlots(source, venue.id, date);
        if (!slots) throw new BizzyParseError(`Bizzy page does not show ${date}`);
        return slots;
      });
    },
  };
}
