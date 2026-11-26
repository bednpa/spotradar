import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { zonedMidnightEpochMs } from '@spotradar/shared';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import { targetKey } from '../types.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import { parseClubspireTimeline } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
/** Timeline pages are large (~0.4–0.7 MB of tooltip markup), so allow more than the usual 8 s. */
export const DEFAULT_TIMEOUT_MS = 15_000;

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
    async getFreeSlots(target, date): Promise<FreeSlot[]> {
      const source = target.source;
      if (source.type !== 'clubspire') {
        throw new Error(`${targetKey(target)} is not a ClubSpire source`);
      }
      const url = buildClubspireUrl(source, date);
      const html = await limiter.run(url.host, () =>
        withTimeout(timeoutMs, async (signal) => {
          const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT }, signal });
          if (!res.ok) throw new Error(`ClubSpire responded with HTTP ${res.status}`);
          return res.text();
        }),
      );
      return parseClubspireTimeline(
        html,
        source.courtNamePrefixes ? { courtNamePrefixes: source.courtNamePrefixes } : {},
      );
    },
  };
}
