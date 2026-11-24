import type { GeocodeResponse } from '@spotradar/shared';
import { HttpError } from '../errors.ts';
import { withTimeout } from '../connectors/timeout.ts';
import type { FetchFn } from '../connectors/types.ts';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'SpotRadar/1.0';
/** Nominatim usage policy: at most 1 request per second. */
export const MIN_REQUEST_INTERVAL_MS = 1000;
const TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 500;
/** Soft bias towards Brno (lon_min,lat_max,lon_max,lat_min); results outside are still allowed. */
const BRNO_VIEWBOX = '16.40,49.35,16.80,49.05';

export interface Geocoder {
  /** Throws HttpError LOCATION_NOT_FOUND or GEOCODER_UNAVAILABLE. */
  geocode(q: string): Promise<GeocodeResponse>;
}

export interface GeocoderOptions {
  fetch?: FetchFn;
  now: () => Date;
  /** Waits for the given number of ms (injectable so tests need no real time). */
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  timeoutMs?: number;
}

interface NominatimItem {
  lat?: unknown;
  lon?: unknown;
  display_name?: unknown;
}

function normalizeQuery(q: string): string {
  return q.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function toResponse(body: unknown): GeocodeResponse | null {
  if (!Array.isArray(body)) throw new Error('Nominatim returned a non-array body');
  if (body.length === 0) return null;
  const item = body[0] as NominatimItem | null;
  const lat = Number(item?.lat);
  const lng = Number(item?.lon);
  const label = item?.display_name;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof label !== 'string') {
    throw new Error('Nominatim returned an unexpected item');
  }
  return { lat, lng, label };
}

/**
 * Proxy for OpenStreetMap Nominatim. Results (including "not found") are cached
 * in memory; upstream requests are serialized and spaced >= 1 s apart (callers
 * wait, they are never rejected for it). Failures are not cached.
 */
export function createGeocoder(options: GeocoderOptions): Geocoder {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minInterval = options.minIntervalMs ?? MIN_REQUEST_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const cache = new Map<string, Promise<GeocodeResponse | null>>();
  let tail: Promise<unknown> = Promise.resolve();
  let lastRequestAt: number | undefined;

  async function requestUpstream(q: string): Promise<GeocodeResponse | null> {
    if (lastRequestAt !== undefined) {
      const wait = lastRequestAt + minInterval - options.now().getTime();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = options.now().getTime();

    const url = new URL(NOMINATIM_URL);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'cz');
    url.searchParams.set('viewbox', BRNO_VIEWBOX);
    url.searchParams.set('q', q);
    return withTimeout(timeoutMs, async (signal) => {
      const res = await fetchFn(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal,
      });
      if (!res.ok) throw new Error(`Nominatim responded with HTTP ${res.status}`);
      return toResponse((await res.json()) as unknown);
    });
  }

  function enqueue(q: string): Promise<GeocodeResponse | null> {
    const run = tail.then(
      () => requestUpstream(q),
      () => requestUpstream(q),
    );
    tail = run.catch(() => undefined);
    return run;
  }

  return {
    async geocode(q) {
      const key = normalizeQuery(q);
      let lookup = cache.get(key);
      if (!lookup) {
        lookup = enqueue(q.trim());
        cache.set(key, lookup);
        if (cache.size > MAX_CACHE_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        lookup.catch(() => {
          if (cache.get(key) === lookup) cache.delete(key);
        });
      }
      let result: GeocodeResponse | null;
      try {
        result = await lookup;
      } catch (err) {
        console.warn(`Geocoding failed: ${err instanceof Error ? err.message : String(err)}`);
        throw new HttpError('GEOCODER_UNAVAILABLE', 'Geocoding service is unavailable');
      }
      if (!result) throw new HttpError('LOCATION_NOT_FOUND', `No location found for "${q}"`);
      return { ...result };
    },
  };
}
