import type { AvailabilitySourceConfig, FreeSlot } from '@spotradar/shared';
import { toLocalDateTime } from '@spotradar/shared';
import { FIRESTORE_API_ORIGIN } from '../apiOrigins.ts';
import { createHostLimiter } from '../hostLimiter.ts';
import type { HostLimiter } from '../hostLimiter.ts';
import { withTimeout } from '../timeout.ts';
import { targetKey } from '../types.ts';
import type { AvailabilityConnector, FetchFn } from '../types.ts';
import {
  ZltcParseError,
  buildZltcQuery,
  isBookableDate,
  parseZltcBookings,
  parseZltcConfig,
  parseZltcCourts,
  zltcFreeSlots,
} from './parser.ts';
import type { ZltcConfig, ZltcCourt } from './parser.ts';

export const USER_AGENT = 'SpotRadar/1.0';
export const DEFAULT_TIMEOUT_MS = 8000;
/** Courts and booking settings change a few times a year; they are reused for this long. */
export const META_CACHE_TTL_MS = 60 * 60 * 1000;

export interface ZltcConnectorOptions {
  fetch?: FetchFn;
  timeoutMs?: number;
  /** Shared limiter so several connectors respect one per-host limit. */
  limiter?: HostLimiter;
  /** Lifetime of the cached courts + config (default 1 hour). */
  metaCacheTtlMs?: number;
  /** Clock in epoch ms (tests). */
  now?: () => number;
}

type ZltcSource = Extract<AvailabilitySourceConfig, { type: 'zltc' }>;

interface Meta {
  courts: ZltcCourt[];
  config: ZltcConfig;
  storedAt: number;
}

const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,}$/;

/** `https://firestore.googleapis.com/v1/projects/<id>/databases/(default)/documents<path>` */
export function firestoreUrl(source: ZltcSource, path: string): URL {
  return new URL(
    `${FIRESTORE_API_ORIGIN}/v1/projects/${source.projectId}/databases/(default)/documents${path}`,
  );
}

/**
 * ŽLTC Brno's own booking app (zltc.cz/reservations) keeps its data in Firebase Firestore with
 * public read rules, so the connector reads the same REST endpoints the web app uses:
 *
 *  1. `courts` and `config/reservations` (cached for an hour): the courts of the current season
 *     and the bookable segments (30-minute slots, `idx * 30` min after midnight, both ends
 *     inclusive).
 *  2. `documents:runQuery` for the reservations containing the day's local midnight, always with
 *     a `select` of `dates` + `reservations` so customer names and user ids are never downloaded.
 *
 * Free = season courts × bookable segments minus the booked segments. A day the club takes no
 * reservations for (disabled, or after `last_allowed_reservation_date`) has no free slots (`[]`,
 * without the reservations query). Any HTTP or Firestore error (e.g. PERMISSION_DENIED after the
 * club locks the rules) and any unexpected structure rejects, so the venue shows "check on
 * website". All requests of a read run as one task of the Firestore host's limiter.
 */
export function createZltcConnector(options: ZltcConnectorOptions = {}): AvailabilityConnector {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = options.limiter ?? createHostLimiter();
  const metaTtlMs = options.metaCacheTtlMs ?? META_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  const metaCache = new Map<string, Meta>();

  function request(url: URL, body?: unknown): Promise<unknown> {
    return withTimeout(timeoutMs, async (signal) => {
      const headers: Record<string, string> = {
        'user-agent': USER_AGENT,
        accept: 'application/json',
      };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetchFn(
        url,
        body === undefined
          ? { headers, signal }
          : { method: 'POST', headers, body: JSON.stringify(body), signal },
      );
      if (!res.ok) throw new Error(`ŽLTC Firestore responded with HTTP ${res.status}`);
      try {
        return (await res.json()) as unknown;
      } catch {
        throw new ZltcParseError('ŽLTC Firestore answer is not JSON');
      }
    });
  }

  async function loadMeta(source: ZltcSource): Promise<Meta> {
    const hit = metaCache.get(source.projectId);
    if (hit && now() - hit.storedAt < metaTtlMs) return hit;
    const courts = parseZltcCourts(await request(firestoreUrl(source, '/courts?pageSize=100')));
    const config = parseZltcConfig(await request(firestoreUrl(source, '/config/reservations')));
    const meta: Meta = { courts, config, storedAt: now() };
    metaCache.set(source.projectId, meta);
    return meta;
  }

  return {
    type: 'zltc',
    async getFreeSlots(target, date): Promise<FreeSlot[]> {
      const source = target.source;
      if (source.type !== 'zltc') {
        throw new Error(`${targetKey(target)} is not a ŽLTC source`);
      }
      if (!PROJECT_ID_RE.test(source.projectId)) {
        throw new Error(`${targetKey(target)} has an invalid Firestore project id`);
      }
      return limiter.run(new URL(FIRESTORE_API_ORIGIN).host, async () => {
        const { courts, config } = await loadMeta(source);
        const local = toLocalDateTime(new Date(now()));
        if (!isBookableDate(config, date) || date < local.date) return [];
        const bookings = parseZltcBookings(
          await request(firestoreUrl(source, ':runQuery'), buildZltcQuery(date)),
          date,
        );
        return zltcFreeSlots(courts, config, bookings, date, local);
      });
    },
  };
}
