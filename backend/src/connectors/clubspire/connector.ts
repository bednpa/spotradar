import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { zonedMidnightEpochMs } from '@spotradar/shared';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import { parseClubspireTimeline } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;

export interface ClubspireConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter so several connectors respect one per-host limit. */
  limiter?: HostLimiter;
}

type ClubspireSource = Extract<AvailabilitySourceConfig, { type: 'clubspire' }>;

/** `{baseUrl}timeline/day?tabIdx={tabIdx}&criteriaTimestamp={local midnight ms}&resetFilter=true` */
export function buildClubspireUrl(source: ClubspireSource, date: string): URL {
  const url = new URL('timeline/day', source.baseUrl);
  url.searchParams.set('tabIdx', String(source.tabIdx));
  url.searchParams.set('criteriaTimestamp', String(zonedMidnightEpochMs(date)));
  url.searchParams.set('resetFilter', 'true');
  return url;
}

export function createClubspireConnector(
  options: ClubspireConnectorOptions = {},
): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();

  return {
    type: 'clubspire',
    async getFreeSlots(venue, date): Promise<FreeSlot[]> {
      if (venue.source.type !== 'clubspire') {
        throw new Error(`Venue ${venue.id} is not a ClubSpire venue`);
      }
      const url = buildClubspireUrl(venue.source, date);
      const html = await limiter.run(url.host, () =>
        withTimeout(timeoutMs, async (signal) => {
          const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT }, signal });
          if (!res.ok) throw new Error(`ClubSpire responded with HTTP ${res.status}`);
          return res.text();
        }),
      );
      return parseClubspireTimeline(html);
    },
  };
}
