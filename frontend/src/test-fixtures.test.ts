/**
 * Shared test fixtures (named *.test.ts so the build skips it; contains no tests).
 */
import type { SearchQuery, SearchResponse, SearchResult } from '@spotradar/shared';

export const QUERY: SearchQuery = { sport: 'badminton', date: '2026-11-25' };

export function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    venue: {
      id: 'kuklenska',
      name: 'Sportcentrum Kuklenská',
      district: 'Brno-Židenice',
      address: 'Kuklenská 1, Brno',
      location: { lat: 49.2, lng: 16.6 },
      sports: ['badminton'],
      courts: 4,
      openingHours: {
        approximate: false,
        days: {
          mon: { open: '07:00', close: '22:00' },
          tue: { open: '07:00', close: '22:00' },
          wed: { open: '07:00', close: '22:00' },
          thu: { open: '07:00', close: '22:00' },
          fri: { open: '07:00', close: '22:00' },
          sat: null,
          sun: null,
        },
      },
      bookingUrl: 'https://example.com/book',
      availabilitySource: 'clubspire',
    },
    availability: {
      status: 'live',
      checkedAt: '2026-11-25T11:57:00Z',
      freeSlots: [
        { start: '08:00', end: '10:00', freeCourts: 3 },
        { start: '18:00', end: '19:00', freeCourts: 1 },
      ],
    },
    ...overrides,
  };
}

export function makeResponse(
  results: SearchResult[] = [makeResult()],
  query: SearchQuery = QUERY,
): SearchResponse {
  return { query, results };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
