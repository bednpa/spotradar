import type {
  AvailabilitySourceConfig,
  FreeSlot,
  SportId,
  SportOfferingConfig,
} from '@spotradar/shared';
import type { AvailabilityConnector, AvailabilityTarget, FetchFn } from './connectors/types.ts';
import type { VenueRecord } from './repositories/venueRepository.ts';

/** 2026-11-24 09:00 in Europe/Prague. */
export const FIXED_NOW = new Date('2026-11-24T08:00:00Z');
export const TODAY = '2026-11-24';
export const TOMORROW = '2026-11-25';

export const silentLogger = { info: (): void => undefined, warn: (): void => undefined };

export function slot(start: string, end: string, freeCourts: number): FreeSlot {
  return { start, end, freeCourts };
}

export type ConnectorImpl = (target: AvailabilityTarget, date: string) => Promise<FreeSlot[]>;

/** Connector with a replaceable implementation that records its calls. */
export function fakeConnector(
  type: AvailabilityConnector['type'],
  impl: ConnectorImpl,
): AvailabilityConnector & { calls: { venueId: string; sport: SportId; date: string }[] } {
  const calls: { venueId: string; sport: SportId; date: string }[] = [];
  return {
    type,
    calls,
    getFreeSlots(target, date) {
      calls.push({ venueId: target.venueId, sport: target.sport, date });
      return impl(target, date);
    },
  };
}

/** The availability target of a venue's offering (first offering when no sport is given). */
export function targetOf(venue: VenueRecord, sport?: SportId): AvailabilityTarget {
  const offering =
    sport === undefined ? venue.offerings[0] : venue.offerings.find((o) => o.sport === sport);
  if (!offering) throw new Error(`${venue.id} has no ${sport ?? ''} offering`);
  return { venueId: venue.id, sport: offering.sport, source: offering.source };
}

/** A minimal venue record with one badminton offering read from `source` (tests). */
export function testVenue(
  id: string,
  source: AvailabilitySourceConfig,
  extra: Partial<SportOfferingConfig> = {},
): VenueRecord {
  return {
    id,
    name: id,
    district: 'Brno',
    address: 'Test 1, Brno',
    location: { lat: 49.2, lng: 16.6 },
    offerings: [
      {
        sport: 'badminton',
        bookingUrl: 'https://example.com',
        bookingSystem: 'unknown',
        multisport: { category: 'unknown' },
        availabilitySource: source.type,
        source,
        ...extra,
      },
    ],
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
