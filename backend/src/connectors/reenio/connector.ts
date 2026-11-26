import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import { targetKey } from '../types.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import { parseReenioTerms } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;

export interface ReenioConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter so several connectors respect one per-host limit. */
  limiter?: HostLimiter;
  /** Clock in epoch ms (tests); decides which free time is still bookable. */
  now?: () => number;
}

type ReenioSource = Extract<AvailabilitySourceConfig, { type: 'reenio' }>;

/** `{baseUrl}/api/Term/List` (baseUrl e.g. "https://tjteslabrno.reenio.cz/cs"). */
export function buildReenioUrl(source: ReenioSource): URL {
  return new URL(`${source.baseUrl.replace(/\/+$/, '')}/api/Term/List`);
}

/**
 * The form of the day read. Reenio's own app sends multipart/form-data; a JSON body is answered
 * with HTTP 200 but the resource filter is silently ignored.
 */
export function buildReenioForm(source: ReenioSource, date: string): FormData {
  const form = new FormData();
  form.set('date', date);
  form.set('filter.pseudoTerm.resourceIds[0]', String(source.resourceId));
  return form;
}

/**
 * Reenio booking pages (e.g. TJ Tesla Brno): one anonymous POST per day returns the bookable
 * windows with their reservations. No cookie or token is needed. Every read is one limiter task.
 */
export function createReenioConnector(options: ReenioConnectorOptions = {}): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();
  const now = options.now ?? Date.now;

  async function read(source: ReenioSource, date: string): Promise<FreeSlot[]> {
    const url = buildReenioUrl(source);
    const body = await withTimeout(timeoutMs, async (signal) => {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        body: buildReenioForm(source, date),
        signal,
      });
      if (!res.ok) throw new Error(`Reenio responded with HTTP ${res.status}`);
      return res.text();
    });
    return parseReenioTerms(body, date, source.resourceId, new Date(now()));
  }

  return {
    type: 'reenio',
    async getFreeSlots(target, date): Promise<FreeSlot[]> {
      const source = target.source;
      if (source.type !== 'reenio') {
        throw new Error(`${targetKey(target)} is not a Reenio source`);
      }
      return limiter.run(buildReenioUrl(source).host, () => read(source, date));
    },
  };
}
