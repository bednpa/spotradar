import { BRNO_CENTER, GEOCODE_SUGGEST_LIMIT } from '@spotradar/shared';
import type { GeocodeResponse } from '@spotradar/shared';
import { HttpError } from '../errors.ts';
import { withTimeout } from '../connectors/timeout.ts';
import type { FetchFn } from '../connectors/types.ts';

export const PHOTON_URL = 'https://photon.komoot.io/api/';
const USER_AGENT = 'SpotRadar/1.0';
/** Photon allows search-as-you-type; we still space upstream calls to stay polite. */
export const SUGGEST_MIN_INTERVAL_MS = 300;
const TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 500;
/** Czechia (lon_min,lat_min,lon_max,lat_max). */
const CZ_BBOX = '12.09,48.55,18.86,51.06';

export interface Suggester {
  /** Throws HttpError GEOCODER_UNAVAILABLE. An empty array means "nothing found". */
  suggest(q: string): Promise<GeocodeResponse[]>;
}

export interface SuggesterOptions {
  fetch?: FetchFn;
  now: () => Date;
  /** Waits for the given number of ms (injectable so tests need no real time). */
  sleep?: (ms: number) => Promise<void>;
  minIntervalMs?: number;
  timeoutMs?: number;
}

function normalizeQuery(q: string): string {
  return q.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** "Kuklenská, Židenice, Brno" / "Václavské náměstí 12, Praha"; parts are de-duplicated. */
export function buildLabel(props: Record<string, unknown>): string {
  const name = str(props.name);
  const street = str(props.street);
  const housenumber = str(props.housenumber);
  const district = str(props.district);
  const city = str(props.city) ?? str(props.locality) ?? str(props.county);

  const parts: string[] = [];
  if (name) parts.push(name);
  if (street) {
    const streetPart = housenumber ? `${street} ${housenumber}` : street;
    // A street result is named like its street; a POI named "X Kuklenská" keeps both.
    if (!name || name.toLowerCase() !== street.toLowerCase()) parts.push(streetPart);
  } else if (name && housenumber) {
    parts[0] = `${name} ${housenumber}`;
  }
  if (district) parts.push(district);
  if (city) parts.push(city);

  const seen = new Set<string>();
  return parts
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(', ');
}

function parseSuggestions(body: unknown): GeocodeResponse[] {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error('Photon returned an unexpected body');
  const result: GeocodeResponse[] = [];
  const labels = new Set<string>();
  for (const feature of features as unknown[]) {
    const f = feature as {
      properties?: Record<string, unknown>;
      geometry?: { coordinates?: unknown };
    } | null;
    const props = f?.properties;
    const coords = f?.geometry?.coordinates;
    if (!props || !Array.isArray(coords)) continue;
    if (str(props.countrycode)?.toUpperCase() !== 'CZ') continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label = buildLabel(props);
    if (label === '' || labels.has(label.toLowerCase())) continue;
    labels.add(label.toLowerCase());
    result.push({ lat, lng, label });
    if (result.length >= GEOCODE_SUGGEST_LIMIT) break;
  }
  return result;
}

/**
 * Address autocomplete backed by Photon (OSM data, allows search-as-you-type).
 * Results (including empty ones) are cached in memory; upstream calls are
 * serialized and spaced >= minInterval apart. Failures are not cached.
 */
export function createSuggester(options: SuggesterOptions): Suggester {
  const fetchFn: FetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const minInterval = options.minIntervalMs ?? SUGGEST_MIN_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const cache = new Map<string, Promise<GeocodeResponse[]>>();
  let tail: Promise<unknown> = Promise.resolve();
  let lastRequestAt: number | undefined;

  async function requestUpstream(q: string): Promise<GeocodeResponse[]> {
    if (lastRequestAt !== undefined) {
      const wait = lastRequestAt + minInterval - options.now().getTime();
      if (wait > 0) await sleep(wait);
    }
    lastRequestAt = options.now().getTime();

    const url = new URL(PHOTON_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', String(GEOCODE_SUGGEST_LIMIT));
    url.searchParams.set('lat', String(BRNO_CENTER.lat));
    url.searchParams.set('lon', String(BRNO_CENTER.lng));
    url.searchParams.set('bbox', CZ_BBOX);
    return withTimeout(timeoutMs, async (signal) => {
      const res = await fetchFn(url, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal,
      });
      if (!res.ok) throw new Error(`Photon responded with HTTP ${res.status}`);
      return parseSuggestions((await res.json()) as unknown);
    });
  }

  function enqueue(q: string): Promise<GeocodeResponse[]> {
    const run = tail.then(
      () => requestUpstream(q),
      () => requestUpstream(q),
    );
    tail = run.catch(() => undefined);
    return run;
  }

  return {
    async suggest(q) {
      const key = normalizeQuery(q);
      let lookup = cache.get(key);
      if (!lookup) {
        lookup = enqueue(q.trim());
        cache.set(key, lookup);
        if (cache.size > MAX_CACHE_ENTRIES) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) cache.delete(oldest);
        }
        const created = lookup;
        created.catch(() => {
          if (cache.get(key) === created) cache.delete(key);
        });
      }
      try {
        return (await lookup).map((s) => ({ ...s }));
      } catch (err) {
        console.warn(`Suggest failed: ${err instanceof Error ? err.message : String(err)}`);
        throw new HttpError('GEOCODER_UNAVAILABLE', 'Geocoding service is unavailable');
      }
    },
  };
}
