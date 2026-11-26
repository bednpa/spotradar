import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { PADELOS_API_ORIGIN } from '../apiOrigins.ts';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import { targetKey } from '../types.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import { parsePadelosAvailability } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;
/** Host of the PadelOS API (key of the shared per-host limiter). */
export const PADELOS_HOST = new URL(PADELOS_API_ORIGIN).host;
export const PADELOS_SEARCH_URL = `${PADELOS_API_ORIGIN}/customers/searchByDate`;

export interface PadelosConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter so several connectors respect one per-host limit. */
  limiter?: HostLimiter;
  /** Accepted for symmetry with the other connectors; PadelOS needs no clock (the server hides past slots). */
  now?: () => number;
}

type PadelosSource = Extract<AvailabilitySourceConfig, { type: 'padelos' }>;

/** JSON body of `POST /customers/searchByDate` for padel on `date` ("YYYY-MM-DD", club-local). */
export function buildPadelosBody(date: string): string {
  return JSON.stringify({
    date,
    sport: 'padel',
    courtType: '',
    courtSize: '',
    courtTurf: '',
    courtFeature: '',
    searchTerm: '',
    limit: '',
    offset: '',
    type: '',
  });
}

/**
 * PadelOS (api.padelos.co, e.g. Padel Powers Brno): one stateless, anonymous POST per club and
 * date returns the bookable court windows per duration; the parser merges them into free
 * intervals. The club is selected by the `x-clubos-club` header. Every read is one limiter task.
 */
export function createPadelosConnector(
  options: PadelosConnectorOptions = {},
): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();

  function read(source: PadelosSource, date: string): Promise<FreeSlot[]> {
    return withTimeout(timeoutMs, async (signal) => {
      const res = await fetchFn(PADELOS_SEARCH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-clubos-club': source.clubId,
          'user-agent': USER_AGENT,
        },
        body: buildPadelosBody(date),
        signal,
      });
      if (!res.ok) throw new Error(`PadelOS responded with HTTP ${res.status}`);
      return parsePadelosAvailability(await res.text(), source.clubId, date);
    });
  }

  return {
    type: 'padelos',
    async getFreeSlots(target, date): Promise<FreeSlot[]> {
      const source = target.source;
      if (source.type !== 'padelos') {
        throw new Error(`${targetKey(target)} is not a PadelOS source`);
      }
      return limiter.run(PADELOS_HOST, () => read(source, date));
    },
  };
}
