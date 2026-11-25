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
  SportId,
  SportOffering,
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

/** Venue fields plus the fields of its (single) offering. */
export type VenueOverrides = Partial<Omit<Venue, 'offerings' | 'sports'>> &
  Partial<SportOffering> & { offerings?: SportOffering[] };

const OFFERING_KEYS = [
  'sport',
  'courts',
  'openingHours',
  'bookingUrl',
  'bookingSystem',
  'availabilitySource',
  'pricing',
  'multisport',
  'note',
] as const;

export function makeOffering(id: string, overrides: Partial<SportOffering> = {}): SportOffering {
  return {
    sport: 'badminton',
    courts: 4,
    openingHours: hours('07:00'),
    bookingUrl: `https://example.com/${id}`,
    bookingSystem: 'clubspire',
    availabilitySource: 'clubspire',
    multisport: { category: 'unknown' },
    ...overrides,
  };
}

/**
 * A venue with one badminton offering. Offering fields in `overrides` (pricing, courts, …)
 * go into that offering; `offerings` replaces it (several sports).
 */
export function makeVenue(id: string, name: string, overrides: VenueOverrides = {}): Venue {
  const venueFields: Record<string, unknown> = {};
  const offeringFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'offerings') continue;
    if ((OFFERING_KEYS as readonly string[]).includes(key)) offeringFields[key] = value;
    else venueFields[key] = value;
  }
  const offerings = overrides.offerings ?? [
    makeOffering(id, offeringFields as Partial<SportOffering>),
  ];
  return {
    id,
    name,
    district: 'Brno-Židenice',
    address: `${name} street 1, Brno`,
    location: { lat: 49.2, lng: 16.6 },
    ...(venueFields as Partial<Venue>),
    sports: offerings.map((o) => o.sport),
    offerings,
  };
}

/** A calendar entry: the venue plus its offering of `sport` (default: the first). */
export function calendarVenue(
  venue: Venue,
  distanceKm?: number,
  sport: SportId = venue.offerings[0]?.sport ?? 'badminton',
): CalendarVenue {
  const offering = venue.offerings.find((o) => o.sport === sport);
  if (!offering) throw new Error(`${venue.id} has no ${sport}`);
  const entry: CalendarVenue = { venue, offering };
  if (distanceKm !== undefined) entry.distanceKm = distanceKm;
  return entry;
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
    calendarVenue(
      makeVenue('kuklenska', 'Sportcentrum Kuklenská', {
        website: 'https://www.example.com/kuklenska',
        pricing: {
          currency: 'CZK',
          unit: 'hour',
          rules: [
            { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '07:00', to: '15:00', price: 280 },
            { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '15:00', to: '22:00', price: 380 },
          ],
          note: 'Students <20 % off',
        },
        multisport: { category: 'half-per-card' },
      }),
      1.5,
    ),
    calendarVenue(makeVenue('viktoria', 'Centrum Viktoria'), 2.5),
    calendarVenue(makeVenue('unknown', 'Unknown Hall', { availabilitySource: 'none' })),
    calendarVenue(makeVenue('full', 'Full Hall')),
    calendarVenue(makeVenue('closed', 'Closed Hall', { openingHours: hours(null) })),
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

/** A calendar entry, the offering may be left out (then the venue's first offering is used). */
export type CalendarVenueInput = { venue: Venue; distanceKm?: number; offering?: SportOffering };

export function makeCalendar(
  from = TODAY,
  to = '2026-11-27',
  venues: readonly CalendarVenueInput[] = makeVenues(),
): CalendarResponse {
  return {
    query: { sport: 'badminton', from, to },
    venues: venues.map((v) =>
      v.offering ? { ...v, offering: v.offering } : calendarVenue(v.venue, v.distanceKm),
    ),
    days: dateRange(from, to).map(makeDay),
  };
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
