import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import { targetKey } from '../types.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import { parseIsportsystemDay } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;
/** How long an answer (it holds several days) is reused for the other days it contains. */
export const ANSWER_REUSE_MS = 60 * 1000;

export interface IsportsystemConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter so several connectors respect one per-host limit. */
  limiter?: HostLimiter;
  /** Clock in epoch ms (tests). */
  now?: () => number;
}

type IsportsystemSource = Extract<AvailabilitySourceConfig, { type: 'isportsystem' }>;

/** `{baseUrl}/ajax/ajax.schema.php` */
export function buildIsportsystemUrl(source: IsportsystemSource): URL {
  return new URL(`${source.baseUrl.replace(/\/+$/, '')}/ajax/ajax.schema.php`);
}

/** The form the page's own "pageLoad" sends: the answer starts at `date` and spans several days. */
export function buildIsportsystemBody(source: IsportsystemSource, date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new URLSearchParams({
    id_sport: String(source.sportId),
    day: String(day),
    month: String(month),
    year: String(year),
    event: 'pageLoad',
    timetableWidth: '970',
  }).toString();
}

interface Answer {
  html: string;
  at: number;
}

/**
 * iSportSystem venues (e.g. Squash Slovan): one anonymous POST returns the schema of the
 * requested day and the following ones as HTML. The last answer of a sport is reused for a
 * minute for the other days it contains; a day it does not contain triggers a new request.
 * Every request is one limiter task.
 */
export function createIsportsystemConnector(
  options: IsportsystemConnectorOptions = {},
): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();
  const now = options.now ?? Date.now;
  const answers = new Map<string, Answer>();

  async function read(source: IsportsystemSource, date: string): Promise<FreeSlot[]> {
    const url = buildIsportsystemUrl(source);
    const key = `${url.href}#${source.sportId}`;
    const cached = answers.get(key);
    if (cached && now() - cached.at < ANSWER_REUSE_MS) {
      try {
        return parseIsportsystemDay(cached.html, date);
      } catch {
        // The day is not in the cached answer: ask again.
      }
    }
    answers.delete(key);
    const html = await withTimeout(timeoutMs, async (signal) => {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          'user-agent': USER_AGENT,
          'content-type': 'application/x-www-form-urlencoded',
          'x-requested-with': 'XMLHttpRequest',
        },
        body: buildIsportsystemBody(source, date),
        signal,
      });
      if (!res.ok) throw new Error(`iSportSystem responded with HTTP ${res.status}`);
      return res.text();
    });
    const slots = parseIsportsystemDay(html, date);
    answers.set(key, { html, at: now() });
    return slots;
  }

  return {
    type: 'isportsystem',
    async getFreeSlots(target, date): Promise<FreeSlot[]> {
      const source = target.source;
      if (source.type !== 'isportsystem') {
        throw new Error(`${targetKey(target)} is not an iSportSystem source`);
      }
      return limiter.run(buildIsportsystemUrl(source).host, () => read(source, date));
    },
  };
}
