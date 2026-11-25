import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { CookieJar, readHiddenFields } from '../aspnet.ts';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import { parseMemberproGrid, toMemberproDate } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;
/** How long the session + form state of the last answer is reused for the next date. */
export const SESSION_REUSE_MS = 5 * 60 * 1000;
/** The submit button of the badminton sport. */
export const SPORT_BUTTON = { name: 'BTN5', value: 'Badminton' };

export interface MemberproConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter: MemberZone and MemberPro both run on memberzone.cz and must be serialized. */
  limiter?: HostLimiter;
  /** Clock in epoch ms (tests). */
  now?: () => number;
}

type MemberproSource = Extract<AvailabilitySourceConfig, { type: 'memberpro' }>;

/** Session cookie and hidden fields (ViewState, EventValidation, ...) of the last good answer. */
interface Session {
  href: string;
  jar: CookieJar;
  fields: URLSearchParams;
  at: number;
}

/** Form body that asks for the badminton grid of `date`, on top of the page's hidden fields. */
export function buildMemberproBody(hidden: URLSearchParams, date: string): URLSearchParams {
  const [y, m, d] = date.split('-').map(Number);
  const raw = String(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  const czDate = toMemberproDate(date);
  const body = new URLSearchParams(hidden);
  body.set('ASPxFormLayout2$Datepicker2', czDate);
  body.set(
    'ASPxFormLayout2$Datepicker2$State',
    JSON.stringify({ rawValue: raw, useMinDateInsteadOfNull: false }),
  );
  body.set('ASPxFormLayout2_Datepicker2_Raw', raw);
  body.set('DATUM_HF', czDate);
  body.set(SPORT_BUTTON.name, SPORT_BUTTON.value);
  return body;
}

/**
 * MemberPro (Sportcentrum Ivanovice). A plain GET only shows the sport buttons; the grid
 * for one date comes from a single POST of the page's form: its hidden fields (ViewState,
 * EventValidation, ...) plus the date fields and the badminton button.
 *
 * The answer carries fresh hidden fields, so the session and fields of the last answer are
 * reused for the next date (one POST instead of GET + POST); any failure of that shortcut
 * falls back to a clean GET + POST. The whole sequence of one read is a single limiter task.
 */
export function createMemberproConnector(
  options: MemberproConnectorOptions = {},
): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();
  const now = options.now ?? Date.now;
  let session: Session | undefined;

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
      if (!res.ok) throw new Error(`MemberPro responded with HTTP ${res.status}`);
      jar.store(res);
      return res.text();
    });
  }

  /** POSTs the date form; remembers the session only when the answer parsed. */
  async function postDate(
    url: URL,
    jar: CookieJar,
    hidden: URLSearchParams,
    date: string,
  ): Promise<FreeSlot[]> {
    const html = await request(url, jar, buildMemberproBody(hidden, date));
    const slots = parseMemberproGrid(html, date);
    session = { href: url.href, jar, fields: readHiddenFields(html), at: now() };
    return slots;
  }

  async function read(source: MemberproSource, date: string): Promise<FreeSlot[]> {
    const url = new URL(source.url);
    const previous = session;
    session = undefined;
    if (previous && previous.href === url.href && now() - previous.at < SESSION_REUSE_MS) {
      try {
        return await postDate(url, previous.jar, previous.fields, date);
      } catch {
        session = undefined; // stale session or changed form: start over with a clean GET
      }
    }
    const jar = new CookieJar();
    const hidden = readHiddenFields(await request(url, jar));
    return postDate(url, jar, hidden, date);
  }

  return {
    type: 'memberpro',
    async getFreeSlots(venue, date): Promise<FreeSlot[]> {
      const source = venue.source;
      if (source.type !== 'memberpro') {
        throw new Error(`Venue ${venue.id} is not a MemberPro venue`);
      }
      return limiter.run(new URL(source.url).host, () => read(source, date));
    },
  };
}
