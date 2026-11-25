import type { DayOpeningHours, OpeningHours, PriceRule, Pricing, Weekday } from '@spotradar/shared';
import type { VenueRecord } from '../repositories/venueRepository.ts';

type Range = readonly [open: string, close: string];

function range([open, close]: Range): DayOpeningHours {
  return { open, close };
}

/** Same hours every day. */
function daily(approximate: boolean, hours: Range): OpeningHours {
  return weekdaysAndWeekend(approximate, hours, hours);
}

function weekdaysAndWeekend(approximate: boolean, weekdays: Range, weekend: Range): OpeningHours {
  const days: Record<Weekday, DayOpeningHours | null> = {
    mon: range(weekdays),
    tue: range(weekdays),
    wed: range(weekdays),
    thu: range(weekdays),
    fri: range(weekdays),
    sat: range(weekend),
    sun: range(weekend),
  };
  return { approximate, days };
}

/** Different closing time on Friday (Mon–Thu and Sat–Sun share their own ranges). */
function withFriday(approximate: boolean, monThu: Range, fri: Range, weekend: Range): OpeningHours {
  const base = weekdaysAndWeekend(approximate, monThu, weekend);
  return { approximate, days: { ...base.days, fri: range(fri) } };
}

const MON_FRI: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const MON_THU: Weekday[] = ['mon', 'tue', 'wed', 'thu'];
const FRI: Weekday[] = ['fri'];
const SAT_SUN: Weekday[] = ['sat', 'sun'];

/** One price rule: `price` CZK per hour on `days` for start times in [from, to). */
function rule(days: Weekday[], from: string, to: string, price: number): PriceRule {
  return { days: [...days], from, to, price };
}

function czkPerHour(rules: PriceRule[], note?: string): Pricing {
  const pricing: Pricing = { currency: 'CZK', unit: 'hour', rules };
  if (note !== undefined) pricing.note = note;
  return pricing;
}

function clubspireBookingUrl(baseUrl: string, tabIdx: number): string {
  return `${baseUrl}timeline/day?tabIdx=${tabIdx}`;
}

const KUKLENSKA_BASE_URL = 'https://kuklenska.clubspire.cz/';
const VIKTORIA_BASE_URL = 'https://rezervace.centrumviktoria.cz:18443/';

/**
 * Real badminton venues in Brno. `source` configures the availability connector
 * and is backend-only (see `toPublicVenue`); `availabilitySource` must equal `source.type`.
 */
export const VENUE_RECORDS: readonly VenueRecord[] = [
  {
    id: 'kuklenska',
    name: 'Sportcentrum Kuklenská',
    district: 'Brno-Židenice',
    address: 'Kuklenská 4396/46, Brno',
    location: { lat: 49.19522, lng: 16.63242 },
    sports: ['badminton'],
    courts: 4,
    // Details from https://www.sportkuklenska.cz/ (researched 2026-11-25).
    openingHours: weekdaysAndWeekend(false, ['07:00', '22:00'], ['08:00', '21:00']),
    bookingUrl: clubspireBookingUrl(KUKLENSKA_BASE_URL, 0),
    phone: '775 738 188',
    website: 'https://www.sportkuklenska.cz/',
    pricing: czkPerHour([
      rule(MON_FRI, '07:00', '15:00', 280),
      rule(MON_FRI, '15:00', '22:00', 380),
      rule(SAT_SUN, '08:00', '21:00', 380),
    ]),
    multisport: { accepted: true, coverage: { kind: 'percentOff', percent: 50 } },
    availabilitySource: 'clubspire',
    source: { type: 'clubspire', baseUrl: KUKLENSKA_BASE_URL, tabIdx: 0 },
  },
  {
    id: 'centrum-viktoria',
    name: 'Centrum Viktoria',
    district: 'Brno-Komárov',
    address: 'Vodařská 2, Brno',
    location: { lat: 49.17627, lng: 16.61661 },
    sports: ['badminton'],
    courts: 3,
    openingHours: weekdaysAndWeekend(false, ['07:00', '22:00'], ['08:00', '22:00']),
    bookingUrl: clubspireBookingUrl(VIKTORIA_BASE_URL, 1),
    phone: '776 282 575',
    // Details from https://www.centrumviktoria.cz/ (researched 2026-11-25).
    website: 'https://www.centrumviktoria.cz/',
    pricing: czkPerHour([
      rule(MON_FRI, '07:00', '15:00', 300),
      rule(MON_FRI, '15:00', '22:00', 400),
      rule(SAT_SUN, '08:00', '22:00', 400),
    ]),
    multisport: { accepted: true, coverage: { kind: 'minutesPerCard', minutes: 30 } },
    otherActivities: ['Padel', 'Squash', 'Beach volleyball', 'Bowling', 'Tennis'],
    availabilitySource: 'clubspire',
    source: { type: 'clubspire', baseUrl: VIKTORIA_BASE_URL, tabIdx: 1 },
  },
  {
    id: 'badminton-jehnice',
    name: 'Badminton Jehnice',
    district: 'Brno-Jehnice',
    address: 'Blanenská 3a, Brno',
    // Approximate location (village centre), not the exact building.
    location: { lat: 49.26955, lng: 16.59594 },
    sports: ['badminton'],
    courts: 5,
    openingHours: weekdaysAndWeekend(false, ['14:00', '22:00'], ['07:00', '22:00']),
    bookingUrl: 'https://badminton-jehnice.e-rezervace.cz/Branch/pages/Schedule.faces',
    phone: '724 337 542',
    // Details from http://www.badmintonjehnice.cz/ (researched 2026-11-25); Multisport unknown.
    website: 'http://www.badmintonjehnice.cz/',
    pricing: czkPerHour([
      rule(MON_FRI, '14:00', '17:00', 240),
      rule(MON_FRI, '17:00', '22:00', 290),
      rule(SAT_SUN, '07:00', '22:00', 290),
    ]),
    availabilitySource: 'bizzy',
    source: {
      type: 'bizzy',
      scheduleUrl: 'https://badminton-jehnice.e-rezervace.cz/Branch/pages/Schedule.faces',
    },
  },
  {
    id: 'badminton-lisen',
    name: 'Badminton Líšeň',
    district: 'Brno-Líšeň',
    address: 'Úlehlova 3050/16, Brno',
    location: { lat: 49.19469, lng: 16.67056 },
    sports: ['badminton'],
    courts: 6,
    // Details from https://www.badmintonlisen.cz/ (researched 2026-11-25); hours derived from the price list.
    openingHours: weekdaysAndWeekend(true, ['07:00', '22:00'], ['08:00', '22:00']),
    website: 'https://www.badmintonlisen.cz/',
    pricing: czkPerHour([
      rule(MON_FRI, '07:00', '14:00', 280),
      rule(MON_FRI, '14:00', '22:00', 400),
      rule(SAT_SUN, '08:00', '22:00', 400),
    ]),
    multisport: { accepted: true, coverage: { kind: 'percentOff', percent: 50 } },
    bookingUrl: 'http://badmintonlisen.e-rezervace.cz/Branch/pages/Schedule.faces',
    availabilitySource: 'bizzy',
    source: {
      type: 'bizzy',
      scheduleUrl: 'http://badmintonlisen.e-rezervace.cz/Branch/pages/Schedule.faces',
    },
  },
  {
    id: 'x-arena-slatina',
    name: 'X-Arena Slatina',
    district: 'Brno-Slatina',
    address: 'Tuřanka 1512/55, Brno',
    location: { lat: 49.1734, lng: 16.68352 },
    sports: ['badminton'],
    courts: 6,
    // Details from https://www.xarena.cz/ (researched 2026-11-25).
    openingHours: weekdaysAndWeekend(false, ['07:00', '22:00'], ['08:00', '22:00']),
    website: 'https://www.xarena.cz/',
    pricing: czkPerHour([
      rule(MON_FRI, '07:00', '14:00', 280),
      rule(MON_FRI, '14:00', '22:00', 400),
      rule(SAT_SUN, '08:00', '22:00', 400),
    ]),
    multisport: {
      accepted: true,
      coverage: { kind: 'percentOff', percent: 50 },
      note: 'max 4 players per court',
    },
    otherActivities: ['Table tennis'],
    bookingUrl: 'http://xarena.e-rezervace.cz/Branch/pages/Schedule.faces',
    availabilitySource: 'bizzy',
    source: {
      type: 'bizzy',
      scheduleUrl: 'http://xarena.e-rezervace.cz/Branch/pages/Schedule.faces',
      // X-Arena only accepts bookings at least 2 h ahead.
      minLeadMinutes: 120,
    },
  },
  {
    id: 'hala-sprint',
    name: 'Hala Sprint',
    district: 'Brno-Královo Pole',
    address: 'Sportovní 2A, Brno',
    location: { lat: 49.21229, lng: 16.60806 },
    sports: ['badminton'],
    courts: 6,
    openingHours: daily(false, ['07:00', '22:00']),
    // Details from https://www.sprinttenis.cz/ (researched 2026-11-25); Multisport unknown.
    website: 'https://www.sprinttenis.cz/',
    pricing: czkPerHour([
      rule(MON_FRI, '07:00', '15:00', 280),
      rule(MON_FRI, '15:00', '22:00', 380),
      rule(SAT_SUN, '07:00', '22:00', 380),
    ]),
    otherActivities: ['Tennis'],
    bookingUrl:
      'https://memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3&NAZEV=Badminton%20hala',
    availabilitySource: 'memberzone',
    source: {
      type: 'memberzone',
      url: 'https://memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3&NAZEV=Badminton%20hala',
    },
  },
  {
    id: 'sportcentrum-ivanovice',
    name: 'Sportcentrum Ivanovice',
    district: 'Brno-Ivanovice',
    address: 'Černohorská 245/22, Brno',
    location: { lat: 49.25891, lng: 16.57203 },
    sports: ['badminton'],
    courts: 3, // Badminton 1-3 in the booking grid
    // Details from http://www.sportcentrum-ivanovice.cz/ (researched 2026-11-25).
    openingHours: withFriday(false, ['07:00', '22:00'], ['07:00', '21:00'], ['08:00', '21:00']),
    website: 'http://www.sportcentrum-ivanovice.cz/',
    pricing: czkPerHour([
      rule(MON_FRI, '07:00', '15:00', 330),
      rule(MON_THU, '15:00', '22:00', 440),
      rule(FRI, '15:00', '21:00', 440), // Friday closes at 21:00
      rule(SAT_SUN, '08:00', '21:00', 440),
    ]),
    multisport: {
      accepted: true,
      coverage: { kind: 'percentOff', percent: 50 },
      note: '2 cards = 100 %; 60-min bookings only, tell staff in advance',
    },
    otherActivities: ['Squash', 'Table tennis', 'Fitness classes', 'Indoor cycling'],
    bookingUrl: 'https://memberzone.cz/ivanovice/',
    phone: '730 899 399',
    availabilitySource: 'memberpro',
    source: { type: 'memberpro', url: 'https://memberzone.cz/ivanovice/' },
  },
];
