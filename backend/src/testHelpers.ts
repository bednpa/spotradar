import type { FreeSlot } from '@spotradar/shared';
import type { AvailabilityConnector, FetchFn } from './connectors/types.ts';
import type { VenueRecord } from './repositories/venueRepository.ts';

/** 2026-11-24 09:00 in Europe/Prague. */
export const FIXED_NOW = new Date('2026-11-24T08:00:00Z');
export const TODAY = '2026-11-24';
export const TOMORROW = '2026-11-25';

export const silentLogger = { warn: (): void => undefined };

export function slot(start: string, end: string, freeCourts: number): FreeSlot {
  return { start, end, freeCourts };
}

export type ConnectorImpl = (venue: VenueRecord, date: string) => Promise<FreeSlot[]>;

/** Connector with a replaceable implementation that records its calls. */
export function fakeConnector(
  type: AvailabilityConnector['type'],
  impl: ConnectorImpl,
): AvailabilityConnector & { calls: { venueId: string; date: string }[] } {
  const calls: { venueId: string; date: string }[] = [];
  return {
    type,
    calls,
    getFreeSlots(venue, date) {
      calls.push({ venueId: venue.id, date });
      return impl(venue, date);
    },
  };
}

/** Mutable clock for cache / rate-limit tests. */
export function fakeClock(start: Date = FIXED_NOW): {
  now: () => Date;
  advance: (ms: number) => void;
} {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    advance: (ms) => {
      t += ms;
    },
  };
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html' } });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export type RecordedFetch = FetchFn & { calls: { url: URL; init?: RequestInit }[] };

/** Fetch stub that records calls and answers with `respond`. */
export function recordingFetch(
  respond: (url: URL, init?: RequestInit) => Promise<Response> | Response,
): RecordedFetch {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fn: FetchFn = (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    return Promise.resolve(respond(url, init));
  };
  return Object.assign(fn, { calls });
}
