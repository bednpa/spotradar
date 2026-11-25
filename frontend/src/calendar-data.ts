/** In-memory session cache for /api/calendar responses (with a TTL). */
import { toLocalDateTime } from '@spotradar/shared';
import type { CalendarQuery, CalendarResponse } from '@spotradar/shared';
import { fetchCalendar } from './api.ts';
import type { FetchFn } from './api.ts';

/** Matches the backend cache freshness. */
export const CACHE_TTL_MS = 5 * 60_000;

/** Same sport + location filter → same group. */
function groupKey(query: CalendarQuery): string {
  return [query.sport, query.lat ?? '', query.lng ?? '', query.maxDistanceKm ?? ''].join('|');
}

function exactKey(query: CalendarQuery): string {
  return `${groupKey(query)}|${query.from}|${query.to}`;
}

/** Restricts a response to the days between from and to (inclusive). */
export function sliceResponse(
  response: CalendarResponse,
  from: string,
  to: string,
): CalendarResponse {
  return {
    ...response,
    query: { ...response.query, from, to },
    days: response.days.filter((day) => day.date >= from && day.date <= to),
  };
}

interface Entry {
  response: CalendarResponse;
  storedAt: number;
  /** Local (Europe/Prague) date when the entry was stored. */
  day: string;
}

export interface CacheOptions {
  ttlMs?: number;
  /** Injectable clock (epoch ms) for tests. */
  clock?: () => number;
}

export class CalendarCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<CalendarResponse>>();
  /** Number of network requests made (for tests / diagnostics). */
  requests = 0;

  private readonly fetchFn: FetchFn | undefined;
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(fetchFn?: FetchFn, options: CacheOptions = {}) {
    this.fetchFn = fetchFn;
    this.ttlMs = options.ttlMs ?? CACHE_TTL_MS;
    this.clock = options.clock ?? Date.now;
  }

  private isFresh(entry: Entry): boolean {
    const now = this.clock();
    return now - entry.storedAt < this.ttlMs && toLocalDateTime(new Date(now)).date === entry.day;
  }

  /** Cached, still fresh response covering the query (exact or a larger cached range), or null. */
  peek(query: CalendarQuery): CalendarResponse | null {
    const exactK = exactKey(query);
    const exact = this.entries.get(exactK);
    if (exact) {
      if (this.isFresh(exact)) return exact.response;
      this.entries.delete(exactK);
    }
    const group = groupKey(query);
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(`${group}|`)) continue;
      if (!this.isFresh(entry)) {
        this.entries.delete(key);
        continue;
      }
      const { from, to } = entry.response.query;
      if (from <= query.from && to >= query.to) {
        return sliceResponse(entry.response, query.from, query.to);
      }
    }
    return null;
  }

  /** `fresh: true` bypasses the cache (used by "Try again"). */
  async get(query: CalendarQuery, options: { fresh?: boolean } = {}): Promise<CalendarResponse> {
    if (!options.fresh) {
      const cached = this.peek(query);
      if (cached) return cached;
    }
    const key = exactKey(query);
    const pending = this.inFlight.get(key);
    if (pending && !options.fresh) return pending;
    this.requests++;
    const request = fetchCalendar(query, this.fetchFn)
      .then((response) => {
        const now = this.clock();
        this.entries.set(key, {
          response,
          storedAt: now,
          day: toLocalDateTime(new Date(now)).date,
        });
        return response;
      })
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }
}
