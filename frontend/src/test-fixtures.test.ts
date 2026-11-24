/**
 * Shared test fixtures (named *.test.ts so the build skips it; contains no tests).
 */
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  AvailabilityResult,
  Reservation,
} from '@spotradar/shared';

export const QUERY: AvailabilityQuery = {
  sport: 'tennis',
  date: '2026-11-25',
  time: '18:00',
  durationMinutes: 90,
  cityId: 'brno',
};

export function makeResult(overrides: Partial<AvailabilityResult> = {}): AvailabilityResult {
  return {
    venue: {
      id: 'v1',
      name: 'Tennis Club Brno',
      cityId: 'brno',
      address: 'Hlavní 1, Brno',
      location: { lat: 49.2, lng: 16.6 },
      openingHours: { open: '08:00', close: '22:00' },
    },
    distanceKm: 1.2,
    pricePerHourCzk: 350,
    totalPriceCzk: 525,
    availableCourts: [
      { id: 'c1', name: 'Court 1', indoor: true, surface: 'clay' },
      { id: 'c2', name: 'Court 2', indoor: false, surface: 'hard' },
    ],
    ...overrides,
  };
}

export function makeResponse(results: AvailabilityResult[] = [makeResult()]): AvailabilityResponse {
  return { query: QUERY, results };
}

export const RESERVATION: Reservation = {
  id: 'r-123',
  venueId: 'v1',
  courtId: 'c1',
  sport: 'tennis',
  date: '2026-11-25',
  time: '18:00',
  durationMinutes: 90,
  customerName: 'Jana Nováková',
  customerEmail: 'jana@example.com',
  venueName: 'Tennis Club Brno',
  courtName: 'Court 1',
  totalPriceCzk: 525,
  createdAt: '2026-11-24T10:00:00.000Z',
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
