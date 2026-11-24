import type { DayOpeningHours, OpeningHours, Weekday } from '@spotradar/shared';
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
    // Hours unknown: the live timeline shows columns 7:00-21:00, so 07:00-22:00 is an estimate.
    openingHours: daily(true, ['07:00', '22:00']),
    bookingUrl: clubspireBookingUrl(KUKLENSKA_BASE_URL, 0),
    phone: '775 738 188',
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
    availabilitySource: 'clubspire',
    source: { type: 'clubspire', baseUrl: VIKTORIA_BASE_URL, tabIdx: 1 },
  },
  {
    id: 'badminton-jehnice',
    name: 'Badminton Jehnice',
    district: 'Brno-Jehnice',
    address: 'Blanenská 350, Brno',
    // Approximate location (village centre), not the exact building.
    location: { lat: 49.26955, lng: 16.59594 },
    sports: ['badminton'],
    courts: 5,
    openingHours: weekdaysAndWeekend(false, ['14:00', '22:00'], ['07:00', '22:00']),
    bookingUrl: 'https://badminton-jehnice.e-rezervace.cz/Branch/pages/Schedule.faces',
    phone: '724 337 542',
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
    openingHours: daily(true, ['07:00', '22:00']),
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
    openingHours: daily(true, ['07:00', '22:00']),
    bookingUrl: 'http://xarena.e-rezervace.cz/Branch/pages/Schedule.faces',
    availabilitySource: 'bizzy',
    source: {
      type: 'bizzy',
      scheduleUrl: 'http://xarena.e-rezervace.cz/Branch/pages/Schedule.faces',
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
    // Number of courts unknown.
    openingHours: daily(true, ['07:00', '22:00']),
    bookingUrl: 'https://memberzone.cz/ivanovice/',
    phone: '730 899 399',
    availabilitySource: 'memberpro',
    source: { type: 'memberpro', url: 'https://memberzone.cz/ivanovice/' },
  },
];
