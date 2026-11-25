/**
 * Shared test fixtures (named *.test.ts so the build skips it; contains no tests).
 */
import { dateRange } from '@spotradar/shared';
import type {
  CalendarDay,
  CalendarQuery,
  CalendarResponse,
  CalendarVenue,
  FreeSlot,
  OpeningHours,
  Venue,
  VenueAvailability,
  Weekday,
} from '@spotradar/shared';

/** Wednesday 25 Nov 2026, 12:00 Europe/Prague. */
export const NOW = new Date('2026-11-25T11:00:00Z');
export const TODAY = '2026-11-25';

export const QUERY: CalendarQuery = { sport: 'badminton', from: TODAY, to: '2026-11-27' };

const WEEK: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function hours(open: string | null, close = '22:00'): OpeningHours {
  const days = Object.fromEntries(
    WEEK.map((d) => [d, open === null ? null : { open, close }]),
  ) as OpeningHours['days'];
  return { approximate: false, days };
}

export function makeVenue(id: string, name: string, overrides: Partial<Venue> = {}): Venue {
  return {
    id,
    name,
    district: 'Brno-Židenice',
    address: `${name} street 1, Brno`,
    location: { lat: 49.2, lng: 16.6 },
    sports: ['badminton'],
    courts: 4,
    openingHours: hours('07:00'),
    bookingUrl: `https://example.com/${id}`,
    availabilitySource: 'clubspire',
    ...overrides,
  };
}

export const LIVE_SLOTS: FreeSlot[] = [
  { start: '08:00', end: '10:00', freeCourts: 3 },
  { start: '18:00', end: '19:00', freeCourts: 1 },
];

export function live(freeSlots: FreeSlot[] = LIVE_SLOTS): VenueAvailability {
  return { status: 'live', checkedAt: '2026-11-25T11:57:00Z', freeSlots };
}

export const UNKNOWN: VenueAvailability = { status: 'unknown', freeSlots: [] };
export const UNAVAILABLE: VenueAvailability = { status: 'unavailable', freeSlots: [] };

/** live (kuklenska, with distance 1.5), unavailable, unknown, a full live venue and a closed one. */
export function makeVenues(): CalendarVenue[] {
  return [
    {
      venue: makeVenue('kuklenska', 'Sportcentrum Kuklenská', {
        website: 'https://www.example.com/kuklenska',
        priceInfo: '280–380 Kč / hour',
        multisport: { accepted: true, terms: '50 % off the court price' },
      }),
      distanceKm: 1.5,
    },
    { venue: makeVenue('viktoria', 'Centrum Viktoria'), distanceKm: 2.5 },
    { venue: makeVenue('unknown', 'Unknown Hall', { availabilitySource: 'none' }) },
    { venue: makeVenue('full', 'Full Hall') },
    { venue: makeVenue('closed', 'Closed Hall', { openingHours: hours(null) }) },
  ];
}

export function makeDay(date: string): CalendarDay {
  return {
    date,
    venues: [
      { venueId: 'kuklenska', availability: live() },
      { venueId: 'viktoria', availability: UNAVAILABLE },
      { venueId: 'unknown', availability: UNKNOWN },
      { venueId: 'full', availability: live([]) },
      { venueId: 'closed', availability: UNKNOWN },
    ],
  };
}

export function makeCalendar(
  from = TODAY,
  to = '2026-11-27',
  venues: CalendarVenue[] = makeVenues(),
): CalendarResponse {
  return {
    query: { sport: 'badminton', from, to },
    venues,
    days: dateRange(from, to).map(makeDay),
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
