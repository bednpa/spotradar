import type {
  DayOpeningHours,
  MultisportInfo,
  OpeningHours,
  PriceRule,
  Pricing,
  Season,
  SportOfferingConfig,
  Weekday,
} from '@spotradar/shared';
import type { VenueRecord } from '../repositories/venueRepository.ts';

/*
 * Real Brno venues, researched 2026-11-25 (see docs/live-data-connectors.md for the venue /
 * booking-system table). Unknown values stay unknown: no `openingHours` = hours unknown, no
 * `pricing` = "Price on website", `multisport: { category: 'unknown' }`. Offerings whose
 * `source.type` has a connector show live data; the others show "check on website".
 */

type Range = readonly [open: string, close: string];

function range([open, close]: Range): DayOpeningHours {
  return { open, close };
}

/** Same hours every day. */
function daily(approximate: boolean, hours: Range, season?: Season): OpeningHours {
  return weekdaysAndWeekend(approximate, hours, hours, season);
}

function weekdaysAndWeekend(
  approximate: boolean,
  weekdays: Range,
  weekend: Range,
  season?: Season,
): OpeningHours {
  const days: Record<Weekday, DayOpeningHours | null> = {
    mon: range(weekdays),
    tue: range(weekdays),
    wed: range(weekdays),
    thu: range(weekdays),
    fri: range(weekdays),
    sat: range(weekend),
    sun: range(weekend),
  };
  const hours: OpeningHours = { approximate, days };
  if (season) hours.season = season;
  return hours;
}

/** Different hours on Friday (Mon–Thu and Sat–Sun share their own ranges). */
function withFriday(approximate: boolean, monThu: Range, fri: Range, weekend: Range): OpeningHours {
  const base = weekdaysAndWeekend(approximate, monThu, weekend);
  return { approximate, days: { ...base.days, fri: range(fri) } };
}

const MON_FRI: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const MON_THU: Weekday[] = ['mon', 'tue', 'wed', 'thu'];
const FRI: Weekday[] = ['fri'];
const SAT_SUN: Weekday[] = ['sat', 'sun'];
const EVERY_DAY: Weekday[] = [...MON_FRI, ...SAT_SUN];

/** One price rule: `price` CZK per hour on `days` for start times in [from, to). */
function rule(days: Weekday[], from: string, to: string, price: number): PriceRule {
  return { days: [...days], from, to, price };
}

function czkPerHour(rules: PriceRule[], note?: string): Pricing {
  const pricing: Pricing = { currency: 'CZK', unit: 'hour', rules };
  if (note !== undefined) pricing.note = note;
  return pricing;
}

const MULTISPORT_UNKNOWN: MultisportInfo = { category: 'unknown' };

/** MultiSport terms that exist but do not fit the structured categories (kept as text). */
function multisportNote(note: string): MultisportInfo {
  return { category: 'unknown', note };
}

function clubspireBookingUrl(baseUrl: string, tabIdx: number): string {
  return `${baseUrl}timeline/day?tabIdx=${tabIdx}`;
}

/** An offering without a connector: shown as "check on website" during its opening hours. */
function noConnector(
  offering: Omit<SportOfferingConfig, 'availabilitySource' | 'source'>,
): SportOfferingConfig {
  return { ...offering, availabilitySource: 'none', source: { type: 'none' } };
}

const KUKLENSKA_BASE_URL = 'https://kuklenska.clubspire.cz/';
const VIKTORIA_BASE_URL = 'https://rezervace.centrumviktoria.cz:18443/';
const FITNESS_BOBY_BASE_URL = 'https://rezervace.fitnessboby.cz:28080/';
const IVANOVICE_URL = 'https://memberzone.cz/ivanovice/';
const SPRINT_BADMINTON_URL =
  'https://memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3&NAZEV=Badminton%20hala';
const SPRINT_TENNIS_URL =
  'https://memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=1&NAZEV=Tenis%20hala';
const BEACH_RIVIERA_URL = 'https://beach.starez.cz/vstupenky-rezervace';

// Centrum Viktoria: all sports Mon–Fri 7–22, Sat–Sun 8–22 (https://www.centrumviktoria.cz/, 2026-11-25).
const VIKTORIA_HOURS = weekdaysAndWeekend(false, ['07:00', '22:00'], ['08:00', '22:00']);
// Sportcentrum Ivanovice: http://www.sportcentrum-ivanovice.cz/ (2026-11-25).
const IVANOVICE_HOURS = withFriday(
  false,
  ['07:00', '22:00'],
  ['07:00', '21:00'],
  ['08:00', '21:00'],
);
// Source: http://www.sportcentrum-ivanovice.cz/cenik/ (2026-11-25) – "Karta hradí 50% z ceny kurtu
// u raketových sportů. Pokud uplatníte 2 karty, je kartami hrazeno 100% ceny", "Rezervace u raketových
// sportů je možná pouze na 60 min.", "Využití karty je povinen držitel karty hlásit obsluze předem",
// "Kartu lze využít každý den pouze na 1 sportovní aktivitu."
const IVANOVICE_RACKET_MULTISPORT: MultisportInfo = {
  category: 'full-two-cards',
  limits: { maxCardsPerCourt: 2, onlyBookingMinutes: 60, requiresNotice: true },
  note: 'One sports activity per card per day',
};

/**
 * `source` (per offering) configures the availability connector and is backend-only (see
 * `toPublicVenue`); each offering's `availabilitySource` must equal its `source.type`.
 */
export const VENUE_RECORDS: readonly VenueRecord[] = [
  {
    id: 'kuklenska',
    name: 'Sportcentrum Kuklenská',
    district: 'Brno-Židenice',
    address: 'Kuklenská 4396/46, Brno',
    location: { lat: 49.19522, lng: 16.63242 },
    phone: '775 738 188',
    website: 'https://www.sportkuklenska.cz/',
    offerings: [
      {
        sport: 'badminton',
        courts: 4,
        // Details from https://www.sportkuklenska.cz/ (researched 2026-11-25).
        openingHours: weekdaysAndWeekend(false, ['07:00', '22:00'], ['08:00', '21:00']),
        bookingUrl: clubspireBookingUrl(KUKLENSKA_BASE_URL, 0),
        bookingSystem: 'clubspire',
        pricing: czkPerHour([
          rule(MON_FRI, '07:00', '15:00', 280),
          rule(MON_FRI, '15:00', '22:00', 380),
          rule(SAT_SUN, '08:00', '15:00', 330), // weekend / holidays before 15:00
          rule(SAT_SUN, '15:00', '21:00', 380),
        ]),
        // Source: https://www.sportkuklenska.cz/cenik/ – "Multisport karta 50 % slevy / hodina" (2026-11-25).
        multisport: { category: 'half-per-card' },
        availabilitySource: 'clubspire',
        source: { type: 'clubspire', baseUrl: KUKLENSKA_BASE_URL, tabIdx: 0 },
      },
    ],
  },
  {
    id: 'centrum-viktoria',
    name: 'Centrum Viktoria',
    district: 'Brno-Komárov',
    address: 'Vodařská 2, Brno',
    location: { lat: 49.17627, lng: 16.61661 },
    phone: '776 282 575',
    website: 'https://www.centrumviktoria.cz/',
    otherActivities: ['Bowling'],
    offerings: [
      {
        sport: 'badminton',
        courts: 3,
        openingHours: VIKTORIA_HOURS,
        bookingUrl: clubspireBookingUrl(VIKTORIA_BASE_URL, 1),
        bookingSystem: 'clubspire',
        pricing: czkPerHour([
          rule(MON_FRI, '07:00', '15:00', 300),
          rule(MON_FRI, '15:00', '22:00', 400),
          rule(SAT_SUN, '08:00', '22:00', 400),
        ]),
        // Source: https://www.centrumviktoria.cz/badminton – "MULTISPORT HRADÍ 1 KARTA PŮL HODINY HRACÍHO ČASU" (2026-11-25).
        multisport: { category: 'minutes-per-card', minutesPerCard: 30 },
        availabilitySource: 'clubspire',
        source: { type: 'clubspire', baseUrl: VIKTORIA_BASE_URL, tabIdx: 1 },
      },
      {
        sport: 'squash',
        courts: 6, // "Kurt 1–6" in timeline tab 0
        openingHours: VIKTORIA_HOURS,
        bookingUrl: clubspireBookingUrl(VIKTORIA_BASE_URL, 0),
        bookingSystem: 'clubspire',
        // Source: https://www.centrumviktoria.cz/squash (2026-11-25); the booking tooltips match.
        pricing: czkPerHour(
          [
            rule(MON_FRI, '07:00', '15:00', 270),
            rule(MON_FRI, '15:00', '22:00', 370),
            rule(SAT_SUN, '08:00', '22:00', 320),
          ],
          'Students 220/370/270 CZK',
        ),
        // Source: https://www.centrumviktoria.cz/squash – 1 card = 30 min (2026-11-25).
        multisport: { category: 'minutes-per-card', minutesPerCard: 30 },
        availabilitySource: 'clubspire',
        source: { type: 'clubspire', baseUrl: VIKTORIA_BASE_URL, tabIdx: 0 },
      },
      {
        sport: 'padel',
        courts: 3, // "Padel 1–3" in timeline tab 3 (the tab also lists an outdoor tennis court)
        openingHours: VIKTORIA_HOURS,
        bookingUrl: clubspireBookingUrl(VIKTORIA_BASE_URL, 3),
        bookingSystem: 'clubspire',
        // Source: https://www.centrumviktoria.cz/padel (2026-11-25); booking page shows 175/200 CZK per 15 min.
        pricing: czkPerHour(
          [
            rule(MON_FRI, '07:00', '15:00', 700),
            rule(MON_FRI, '15:00', '22:00', 800),
            rule(SAT_SUN, '08:00', '22:00', 800),
          ],
          'Winter prices (1 Nov – 30 Mar); summer 500/600 CZK',
        ),
        // Source: https://www.centrumviktoria.cz/padel – 1 card = 15 min (2026-11-25).
        multisport: { category: 'minutes-per-card', minutesPerCard: 15 },
        note: '3 roofed courts',
        availabilitySource: 'clubspire',
        source: {
          type: 'clubspire',
          baseUrl: VIKTORIA_BASE_URL,
          tabIdx: 3,
          courtNamePrefixes: ['Padel'],
        },
      },
      {
        sport: 'beach-volleyball',
        courts: 5, // "Beach 1–5" in timeline tab 2
        openingHours: weekdaysAndWeekend(false, ['07:00', '22:00'], ['08:00', '22:00'], {
          from: '05-01',
          to: '09-30',
        }),
        bookingUrl: clubspireBookingUrl(VIKTORIA_BASE_URL, 2),
        bookingSystem: 'clubspire',
        // Source: https://www.centrumviktoria.cz/beachvolejbal (2026-11-25), summer prices.
        pricing: czkPerHour(
          [
            rule(MON_FRI, '07:00', '15:00', 250),
            rule(MON_FRI, '15:00', '22:00', 400),
            rule(SAT_SUN, '08:00', '22:00', 300),
          ],
          '+50 CZK/h with lights',
        ),
        // Source: https://www.centrumviktoria.cz/beachvolejbal – "2 cards = 30 min" (2026-11-25).
        multisport: {
          category: 'minutes-per-card',
          minutesPerCard: 15,
          note: '2 cards cover 30 min',
        },
        note: 'Outdoor sand courts, 1 May – 30 Sep',
        availabilitySource: 'clubspire',
        source: { type: 'clubspire', baseUrl: VIKTORIA_BASE_URL, tabIdx: 2 },
      },
      // The tennis court is a row of timeline tab 3, but it shows as bookable in November with no
      // price or sport id, so its cells are not trusted as live data: "check on website".
      noConnector({
        sport: 'tennis',
        courts: 1,
        openingHours: VIKTORIA_HOURS,
        bookingUrl: clubspireBookingUrl(VIKTORIA_BASE_URL, 3),
        bookingSystem: 'clubspire',
        // Source: https://www.centrumviktoria.cz/tenis-hriste (2026-11-25).
        pricing: czkPerHour(
          [
            rule(MON_FRI, '07:00', '15:00', 180),
            rule(MON_FRI, '15:00', '22:00', 230),
            rule(SAT_SUN, '08:00', '22:00', 230),
          ],
          '+50 CZK/h with lights',
        ),
        multisport: { category: 'minutes-per-card', minutesPerCard: 30 },
        note: '1 outdoor court',
      }),
    ],
  },
  {
    id: 'badminton-jehnice',
    name: 'Badminton Jehnice',
    district: 'Brno-Jehnice',
    address: 'Blanenská 3a, Brno',
    // Approximate location (village centre), not the exact building.
    location: { lat: 49.26955, lng: 16.59594 },
    phone: '724 337 542',
    // Details from http://www.badmintonjehnice.cz/ (researched 2026-11-25).
    website: 'http://www.badmintonjehnice.cz/',
    offerings: [
      {
        sport: 'badminton',
        courts: 5,
        openingHours: weekdaysAndWeekend(false, ['14:00', '22:00'], ['07:00', '22:00']),
        bookingUrl: 'https://badminton-jehnice.e-rezervace.cz/Branch/pages/Schedule.faces',
        bookingSystem: 'bizzy',
        pricing: czkPerHour([
          rule(MON_FRI, '14:00', '17:00', 240),
          rule(MON_FRI, '17:00', '22:00', 290),
          rule(SAT_SUN, '07:00', '22:00', 290),
        ]),
        // Source: http://www.badmintonjehnice.cz/ does not mention MultiSport (checked 2026-11-25).
        multisport: MULTISPORT_UNKNOWN,
        availabilitySource: 'bizzy',
        source: {
          type: 'bizzy',
          scheduleUrl: 'https://badminton-jehnice.e-rezervace.cz/Branch/pages/Schedule.faces',
        },
      },
    ],
  },
  {
    id: 'badminton-lisen',
    name: 'Badminton Líšeň',
    district: 'Brno-Líšeň',
    address: 'Úlehlova 3050/16, Brno',
    location: { lat: 49.19469, lng: 16.67056 },
    website: 'https://www.badmintonlisen.cz/',
    offerings: [
      {
        sport: 'badminton',
        courts: 6,
        // Details from https://www.badmintonlisen.cz/ (researched 2026-11-25); hours derived from the price list.
        openingHours: weekdaysAndWeekend(true, ['07:00', '22:00'], ['08:00', '22:00']),
        bookingUrl: 'http://badmintonlisen.e-rezervace.cz/Branch/pages/Schedule.faces',
        bookingSystem: 'bizzy',
        pricing: czkPerHour([
          rule(MON_FRI, '07:00', '14:00', 280),
          rule(MON_FRI, '14:00', '22:00', 400),
          rule(SAT_SUN, '08:00', '22:00', 400),
        ]),
        // Source: https://www.badmintonlisen.cz/cenik – "MultiSport karta hradí 50% ceny jednoho kurtu za hodinu." (2026-11-25).
        multisport: { category: 'half-per-card' },
        availabilitySource: 'bizzy',
        source: {
          type: 'bizzy',
          scheduleUrl: 'http://badmintonlisen.e-rezervace.cz/Branch/pages/Schedule.faces',
        },
      },
    ],
  },
  {
    id: 'x-arena-slatina',
    name: 'X-Arena Slatina',
    district: 'Brno-Slatina',
    address: 'Tuřanka 1512/55, Brno',
    location: { lat: 49.1734, lng: 16.68352 },
    website: 'https://www.xarena.cz/',
    // Table tennis is offered, but its booking and prices were not found (2026-11-25).
    otherActivities: ['Table tennis'],
    offerings: [
      {
        sport: 'badminton',
        courts: 6,
        // Details from https://www.xarena.cz/ (researched 2026-11-25).
        openingHours: weekdaysAndWeekend(false, ['07:00', '22:00'], ['08:00', '22:00']),
        bookingUrl: 'http://xarena.e-rezervace.cz/Branch/pages/Schedule.faces',
        bookingSystem: 'bizzy',
        pricing: czkPerHour([
          rule(MON_FRI, '07:00', '14:00', 280),
          rule(MON_FRI, '14:00', '22:00', 400),
          rule(SAT_SUN, '08:00', '22:00', 400),
        ]),
        // Source: https://www.xarena.cz/cenik/ – "Multisport karta hradí 50 % ceny jednoho kurtu za hodinu."
        // and "Na jeden kurt max. 4 hráči, případně jinak po individuální domluvě" (2026-11-25).
        multisport: { category: 'half-per-card', limits: { maxPlayersPerCourt: 4 } },
        availabilitySource: 'bizzy',
        source: {
          type: 'bizzy',
          scheduleUrl: 'http://xarena.e-rezervace.cz/Branch/pages/Schedule.faces',
          // X-Arena only accepts bookings at least 2 h ahead.
          minLeadMinutes: 120,
        },
      },
    ],
  },
  {
    id: 'hala-sprint',
    name: 'Hala Sprint',
    district: 'Brno-Královo Pole',
    address: 'Sportovní 2A, Brno',
    location: { lat: 49.21229, lng: 16.60806 },
    // Details from https://www.sprinttenis.cz/ (researched 2026-11-25).
    website: 'https://www.sprinttenis.cz/',
    offerings: [
      {
        sport: 'badminton',
        courts: 6,
        openingHours: daily(false, ['07:00', '22:00']),
        bookingUrl: SPRINT_BADMINTON_URL,
        bookingSystem: 'memberzone',
        pricing: czkPerHour([
          rule(MON_FRI, '07:00', '15:00', 280),
          rule(MON_FRI, '15:00', '22:00', 380),
          rule(SAT_SUN, '07:00', '22:00', 380),
        ]),
        // Source: https://www.sprinttenis.cz/ and its provozní řád do not mention MultiSport (checked 2026-11-25).
        multisport: MULTISPORT_UNKNOWN,
        availabilitySource: 'memberzone',
        source: { type: 'memberzone', url: SPRINT_BADMINTON_URL },
      },
      {
        sport: 'tennis',
        courts: 6, // court ids 1–6 in the booking system (3 concrete + 3 carpet)
        openingHours: daily(false, ['07:00', '22:00']),
        bookingUrl: SPRINT_TENNIS_URL,
        bookingSystem: 'memberzone',
        // Source: https://www.sprinttenis.cz/#cenik (2026-11-25), indoor winter season 12.10.2026–30.4.2027.
        pricing: czkPerHour(
          [
            rule(MON_FRI, '07:00', '15:00', 550),
            rule(MON_FRI, '15:00', '21:00', 750),
            rule(MON_FRI, '21:00', '22:00', 550),
            rule(SAT_SUN, '07:00', '22:00', 550),
          ],
          'Winter season; students −20 % except Mon–Fri 15–21; summer 380 CZK',
        ),
        multisport: MULTISPORT_UNKNOWN,
        note: '6 indoor courts; 3 outdoor courts in summer',
        availabilitySource: 'memberzone',
        source: { type: 'memberzone', url: SPRINT_TENNIS_URL },
      },
    ],
  },
  {
    id: 'sportcentrum-ivanovice',
    name: 'Sportcentrum Ivanovice',
    district: 'Brno-Ivanovice',
    address: 'Černohorská 245/22, Brno',
    location: { lat: 49.25891, lng: 16.57203 },
    website: 'http://www.sportcentrum-ivanovice.cz/',
    phone: '730 899 399',
    otherActivities: ['Fitness classes', 'Indoor cycling'],
    offerings: [
      {
        sport: 'badminton',
        courts: 3, // Badminton 1-3 in the booking grid
        openingHours: IVANOVICE_HOURS,
        bookingUrl: IVANOVICE_URL,
        bookingSystem: 'memberpro',
        pricing: czkPerHour([
          rule(MON_FRI, '07:00', '15:00', 330),
          rule(MON_THU, '15:00', '22:00', 440),
          rule(FRI, '15:00', '21:00', 440), // Friday closes at 21:00
          rule(SAT_SUN, '08:00', '21:00', 440),
        ]),
        multisport: IVANOVICE_RACKET_MULTISPORT,
        availabilitySource: 'memberpro',
        source: {
          type: 'memberpro',
          url: IVANOVICE_URL,
          sportButton: { name: 'BTN5', value: 'Badminton' },
        },
      },
      {
        sport: 'squash',
        courts: 4, // "Squash 1–4" in the booking grid
        openingHours: IVANOVICE_HOURS,
        bookingUrl: IVANOVICE_URL,
        bookingSystem: 'memberpro',
        // Squash and table tennis prices are only an image on /cenik: unknown.
        multisport: IVANOVICE_RACKET_MULTISPORT,
        availabilitySource: 'memberpro',
        source: {
          type: 'memberpro',
          url: IVANOVICE_URL,
          sportButton: { name: 'BTN4', value: 'Squash' },
        },
      },
      {
        sport: 'table-tennis',
        courts: 2, // "Stůl 1–2" in the booking grid
        openingHours: IVANOVICE_HOURS,
        bookingUrl: IVANOVICE_URL,
        bookingSystem: 'memberpro',
        // Not stated whether table tennis counts as a "racket sport" for MultiSport: unknown.
        multisport: MULTISPORT_UNKNOWN,
        availabilitySource: 'memberpro',
        source: {
          type: 'memberpro',
          url: IVANOVICE_URL,
          sportButton: { name: 'BTN3', value: 'Ping-pong' },
        },
      },
    ],
  },
  {
    id: 'fitness-boby',
    name: 'Fitness Boby',
    district: 'Brno-Královo Pole',
    address: 'Sportovní 559/2a, Brno',
    // OSM node 5405413527 "Squash" (leisure=pitch).
    location: { lat: 49.212727, lng: 16.6082265 },
    phone: '607 853 386',
    website: 'https://www.fitnessboby.cz/',
    otherActivities: ['Fitness'],
    offerings: [
      {
        sport: 'squash',
        courts: 5,
        // Source: https://www.fitnessboby.cz/ (2026-11-25).
        openingHours: weekdaysAndWeekend(false, ['06:00', '22:00'], ['07:00', '21:00']),
        bookingUrl: clubspireBookingUrl(FITNESS_BOBY_BASE_URL, 4),
        bookingSystem: 'clubspire',
        // Prices per 30 min shown in the booking grid cells (26.11.2026), doubled to an hour;
        // only Mon–Thu was visible, other days unknown.
        pricing: czkPerHour(
          [
            rule(MON_THU, '08:00', '15:00', 220),
            rule(MON_THU, '15:00', '17:00', 300),
            rule(MON_THU, '17:00', '20:00', 320),
            rule(MON_THU, '20:00', '21:30', 200),
          ],
          'Booked per 30 min; Fri–Sun prices on website',
        ),
        // Source: https://www.fitnessboby.cz/ – "Akceptujeme Multisport kartu na vstup do fitness bez
        // omezení a 30 minut na squash" (2026-11-25).
        multisport: { category: 'minutes-per-card', minutesPerCard: 30 },
        availabilitySource: 'clubspire',
        source: { type: 'clubspire', baseUrl: FITNESS_BOBY_BASE_URL, tabIdx: 4 },
      },
    ],
  },
  {
    id: 'beach-riviera',
    name: 'Beach Riviéra',
    district: 'Brno-Pisárky',
    address: 'Bauerova 322/7, Brno',
    // Nominatim address geocode (building).
    location: { lat: 49.1881826, lng: 16.5693097 },
    phone: '533 033 800',
    website: 'https://beach.starez.cz/',
    offerings: [
      {
        sport: 'beach-volleyball',
        courts: 6,
        // Hours differ by season and weekends are "by arrangement": too irregular for the model.
        bookingUrl: BEACH_RIVIERA_URL,
        bookingSystem: 'starez',
        // Source: https://beach.starez.cz/oteviraci-doba-cenik (2026-11-25).
        pricing: czkPerHour(
          [rule(EVERY_DAY, '16:00', '20:00', 850)],
          'Winter (Oct–Apr) single booking; summer 125–315 CZK',
        ),
        // The price list does not mention MultiSport (2026-11-25).
        multisport: MULTISPORT_UNKNOWN,
        note: 'Heated hall in winter. Winter: Mon–Fri 15–21, weekends by arrangement; summer: daily 9–20',
        availabilitySource: 'starez',
        source: { type: 'starez', url: BEACH_RIVIERA_URL, facility: 'Beachvolejbal' },
      },
    ],
  },

  // ---- Venues without a connector ("check on website") ----

  {
    id: 'padel-powers-slatina',
    name: 'Padel Powers Brno Slatina',
    district: 'Brno-Černovice',
    address: 'Vlastimila Pecha, Brno',
    // OSM node 13984990936 via Nominatim.
    location: { lat: 49.1791078, lng: 16.6643947 },
    phone: '601 280 568',
    website: 'https://www.padelpowers.com/brno-slatina/',
    offerings: [
      noConnector({
        sport: 'padel',
        courts: 10,
        // Source: https://www.padelpowers.com/brno-slatina/ (2026-11-25).
        openingHours: weekdaysAndWeekend(false, ['07:00', '23:00'], ['08:00', '23:00']),
        bookingUrl: 'https://player.padelos.co/company/217?clubIds=216930&locale=cs',
        bookingSystem: 'padelos',
        // Source: https://www.padelpowers.com/turnaje-a-akce/multisport/ (2026-11-25).
        pricing: czkPerHour([
          rule(MON_FRI, '07:00', '16:00', 700),
          rule(MON_FRI, '16:00', '23:00', 850),
          rule(SAT_SUN, '08:00', '23:00', 850),
        ]),
        multisport: multisportNote(
          'Card covers the 1st hour of each booking (amount not stated); +55 CZK per card on weekday evenings and weekends',
        ),
        note: '10 indoor courts',
      }),
    ],
  },
  {
    id: 'padel-powers-kravi-hora',
    name: 'Padel Powers Brno Kraví hora',
    district: 'Brno-střed',
    address: 'Rybkova 948/23, Brno',
    // Nominatim address geocode (building).
    location: { lat: 49.2044235, lng: 16.5855549 },
    phone: '602 168 616',
    website: 'https://www.padelpowers.com/brno-kravi-hora/',
    offerings: [
      noConnector({
        sport: 'padel',
        courts: 4,
        // Source: https://www.padelpowers.com/brno-kravi-hora/ (2026-11-25).
        openingHours: daily(false, ['08:00', '22:00']),
        bookingUrl: 'https://player.padelos.co/company/217?clubIds=216928&locale=cs',
        bookingSystem: 'padelos',
        // Prices differ between the venue page and the MultiSport page: unknown.
        multisport: multisportNote('Card covers the 1st hour of each booking (amount not stated)'),
        note: '4 outdoor courts',
      }),
    ],
  },
  {
    id: 'padel-club-brno',
    name: 'Padel Club Brno',
    district: 'Brno-Královo Pole',
    address: 'Dobrovského 96/29, Brno',
    // OSM way 1433829558.
    location: { lat: 49.2174366, lng: 16.5886884 },
    phone: '703 631 621',
    website: 'https://www.padelclub.cz/',
    offerings: [
      noConnector({
        sport: 'padel',
        courts: 4,
        bookingUrl: 'https://www.padelclub.cz/rezervace',
        bookingSystem: 'own',
        // Source: https://www.padelclub.cz/ – "S kartou Multisport máš nárok na 1/4 slevy z kurtovného
        // na jednu hodinu hry." (2026-11-25).
        multisport: multisportNote('1 card = 1/4 off the court price for one hour'),
        note: 'Outdoor courts, closed in winter (reopening date not published)',
      }),
    ],
  },
  {
    id: 'kravi-hora-beach',
    name: 'Kraví hora – beach volleyball',
    district: 'Brno-střed',
    address: 'Údolní 532/76, Brno',
    // Nominatim address geocode.
    location: { lat: 49.2011865, lng: 16.583982 },
    website: 'https://www.kravihora-brno.cz/plazovy-volejbal',
    offerings: [
      noConnector({
        sport: 'beach-volleyball',
        courts: 2,
        // Source: https://www.kravihora-brno.cz/plazovy-volejbal (2026-11-25) – May to end of October, 9–20.
        openingHours: daily(false, ['09:00', '20:00'], { from: '05-01', to: '10-31' }),
        bookingUrl: 'https://zakaznik.kravihora-brno.cz/kzona',
        bookingSystem: 'own',
        pricing: czkPerHour([rule(EVERY_DAY, '09:00', '20:00', 150)], 'Summer 2026 price'),
        multisport: MULTISPORT_UNKNOWN,
        note: 'Outdoor sand courts, May – October',
      }),
    ],
  },
  {
    id: 'club-classic',
    name: 'Club Classic',
    district: 'Brno-Žabovřesky',
    address: 'Žabovřeská 581/3, Brno',
    // OSM node 5007537698.
    location: { lat: 49.2039443, lng: 16.5649048 },
    phone: '725 712 834',
    website: 'https://www.clubclassic.cz/',
    // Also badminton and "paddle tenis" (not padel); no details found (2026-11-25).
    otherActivities: ['Badminton', 'Paddle tennis'],
    offerings: [
      noConnector({
        sport: 'tennis',
        courts: 10,
        // Winter hours from the October 2026 notice on https://www.clubclassic.cz/.
        openingHours: weekdaysAndWeekend(true, ['07:00', '22:00'], ['07:00', '18:00']),
        bookingUrl: 'https://rezervace.clubclassic.cz',
        bookingSystem: 'unknown',
        // Source: https://www.clubclassic.cz/ (2026-11-25), winter inflatable hall prices.
        pricing: czkPerHour(
          [
            rule(MON_FRI, '07:00', '13:00', 490),
            rule(MON_FRI, '13:00', '22:00', 650),
            rule(SAT_SUN, '07:00', '18:00', 490),
          ],
          'Winter hall (15 Oct – 15 Apr); summer outdoor courts 230–300 CZK',
        ),
        // Source: https://www.clubclassic.cz/ – "1 karta hradí 1/4 hodinové ceny … 4 karty hradí celou hodinu".
        multisport: multisportNote('1 card = 1/4 of the hourly price, 4 cards = whole hour'),
        note: '8 clay + 2 synthetic courts; the 2 synthetic ones under an inflatable hall in winter',
      }),
      noConnector({
        sport: 'beach-volleyball',
        courts: 4,
        bookingUrl: 'https://rezervace.clubclassic.cz',
        bookingSystem: 'unknown',
        // Source: https://www.clubclassic.cz/cenik (2026-11-25).
        pricing: czkPerHour([
          rule(MON_FRI, '07:00', '15:00', 150),
          rule(MON_FRI, '15:00', '21:00', 300),
          rule(SAT_SUN, '07:00', '21:00', 200),
        ]),
        // Source: https://www.clubclassic.cz/o-klubu/cenik/ – "Přijímáme multisport a platbu pouze v hotovosti."
        multisport: multisportNote('MultiSport accepted; terms not published'),
        note: 'Sand courts; season not published',
      }),
      noConnector({
        sport: 'table-tennis',
        bookingUrl: 'https://rezervace.clubclassic.cz',
        bookingSystem: 'unknown',
        // Source: https://www.clubclassic.cz/cenik (2026-11-25).
        pricing: czkPerHour([
          rule(MON_FRI, '07:00', '15:00', 220),
          rule(MON_FRI, '15:00', '21:00', 290),
          rule(SAT_SUN, '07:00', '21:00', 290),
        ]),
        multisport: multisportNote('MultiSport accepted; terms not published'),
      }),
    ],
  },
  {
    id: 'tenis-paradise',
    name: 'Tenis Paradise',
    district: 'Brno-Královo Pole',
    address: 'Sportovní 586/2c, Brno',
    // Nominatim address geocode (building, not the courts).
    location: { lat: 49.2140155, lng: 16.6115629 },
    phone: '777 333 773',
    website: 'https://www.tenisparadise.cz/',
    offerings: [
      noConnector({
        sport: 'tennis',
        bookingUrl: 'https://jdemenato.cz/reservation/tenis-paradise/reservationcalendaroverview',
        bookingSystem: 'jdemenato',
        // Source: https://www.tenisparadise.cz/ (2026-11-25), winter 2026/27.
        pricing: czkPerHour(
          [
            rule(MON_FRI, '08:00', '13:00', 560),
            rule(MON_FRI, '13:00', '15:00', 580),
            rule(MON_FRI, '15:00', '21:00', 730),
            rule(SAT_SUN, '08:00', '21:00', 560),
          ],
          'Winter 2026/27; summer 200/230 CZK',
        ),
        multisport: multisportNote(
          '1–4 cards cover 25/50/75/100 % of the hourly price; +33 CZK per card Mon–Fri 15–21',
        ),
        note: '3 outdoor courts; winter pressure hall',
      }),
    ],
  },
  {
    id: 'zltc-brno',
    name: 'ŽLTC Brno',
    district: 'Brno-Židenice',
    address: 'Bubeníčkova 4248/52, Brno',
    // OSM way 86748655.
    location: { lat: 49.1995696, lng: 16.6418093 },
    phone: '776 886 068',
    website: 'https://www.zltc.cz/',
    offerings: [
      noConnector({
        sport: 'tennis',
        // Source: https://www.zltc.cz/ (2026-11-25).
        openingHours: weekdaysAndWeekend(false, ['07:00', '21:00'], ['07:00', '20:00']),
        bookingUrl: 'https://www.zltc.cz/reservations',
        bookingSystem: 'own',
        multisport: MULTISPORT_UNKNOWN,
        note: '10 outdoor clay courts in summer, 3 indoor courts in winter',
      }),
    ],
  },
  {
    id: 'tenis-komarov',
    name: 'Tenisový areál Komárov',
    district: 'Brno-jih',
    address: 'Kšírova 16, Brno',
    // OSM way 976069011.
    location: { lat: 49.1753355, lng: 16.6195022 },
    phone: '777 363 664',
    website: 'https://www.tenis-komarov.cz/',
    offerings: [
      noConnector({
        sport: 'tennis',
        bookingUrl: 'https://www.tenis-komarov.cz/rozvrh/0',
        bookingSystem: 'own',
        // Source: https://www.tenis-komarov.cz/ (2026-11-25), hall prices for singles.
        pricing: czkPerHour(
          [
            rule(MON_FRI, '07:00', '12:00', 480),
            rule(MON_FRI, '12:00', '14:00', 450),
            rule(MON_FRI, '14:00', '20:00', 700),
            rule(MON_FRI, '20:00', '22:00', 520),
            rule(SAT_SUN, '07:00', '21:00', 520),
          ],
          'Winter hall, singles (doubles up to 580); summer outdoor 220–280 CZK',
        ),
        multisport: MULTISPORT_UNKNOWN,
        note: '5 outdoor clay courts in summer, 3 in inflatable halls in winter',
      }),
    ],
  },
  {
    id: 'tenisova-hala-kohoutovice',
    name: 'Tenisová hala Kohoutovice',
    district: 'Brno-Kohoutovice',
    address: 'Voříškova 864/59, Brno',
    // Nominatim address geocode (building).
    location: { lat: 49.1991046, lng: 16.5374565 },
    phone: '721 254 008',
    website: 'https://www.tenisovahalakohoutovice.cz',
    otherActivities: ['Table tennis'],
    offerings: [
      noConnector({
        sport: 'tennis',
        courts: 4,
        // firmy.cz listing (2026-11-25).
        openingHours: daily(true, ['08:00', '22:00']),
        bookingUrl: 'https://rezzy.eu/tennislinden/schedules',
        bookingSystem: 'unknown', // Rezzy (rezzy.eu)
        // Source: https://www.tenisovahalakohoutovice.cz (2026-11-25), winter 2026/27.
        pricing: czkPerHour(
          [
            rule(MON_FRI, '08:00', '12:00', 490),
            rule(MON_FRI, '12:00', '14:00', 400),
            rule(MON_FRI, '14:00', '15:00', 490),
            rule(MON_FRI, '15:00', '20:00', 680),
            rule(MON_FRI, '20:00', '22:00', 490),
            rule(SAT_SUN, '08:00', '22:00', 500),
          ],
          'Winter 2026/27',
        ),
        multisport: MULTISPORT_UNKNOWN,
        note: 'Clay courts in a hall; booking via Rezzy',
      }),
    ],
  },
  {
    id: 'tk-tesla-brno',
    name: 'TK Tesla Brno',
    district: 'Brno-Královo Pole',
    address: 'Střední 611/22, Brno',
    // OSM way 194829845.
    location: { lat: 49.2120641, lng: 16.6062036 },
    phone: '775 215 406',
    website: 'https://www.teslabrno.cz/',
    offerings: [
      noConnector({
        sport: 'tennis',
        courts: 8,
        // Source: https://www.teslabrno.cz/ (2026-11-25).
        openingHours: daily(false, ['08:00', '19:00']),
        bookingUrl: 'https://www.teslabrno.cz/rezervace/',
        bookingSystem: 'own',
        pricing: czkPerHour([rule(EVERY_DAY, '08:00', '19:00', 260)], 'Non-members'),
        multisport: MULTISPORT_UNKNOWN,
        note: 'Outdoor courts; non-members book by phone',
      }),
    ],
  },
  {
    id: 'tenis-park-luzanky',
    name: 'Tenis Park Lužánky',
    district: 'Brno-střed',
    address: 'Lužánecká 2016/7, Brno',
    // Nominatim address geocode (building).
    location: { lat: 49.2053718, lng: 16.6111839 },
    phone: '778 791 014',
    website: 'http://www.tenisparkluzanky.cz',
    offerings: [
      noConnector({
        sport: 'tennis',
        courts: 8,
        // firmy.cz listing, marked as not recently updated (2026-11-25).
        openingHours: daily(true, ['07:00', '21:00']),
        bookingUrl: 'http://www.tenisparkluzanky.cz',
        bookingSystem: 'phone',
        multisport: MULTISPORT_UNKNOWN,
        note: 'Outdoor clay courts; booking by e-mail or phone',
      }),
    ],
  },
  {
    id: 'tj-start-brno',
    name: 'TJ Start Brno',
    district: 'Brno-sever',
    address: 'Loosova 800/1b, Brno',
    // Nominatim address geocode (building).
    location: { lat: 49.2305464, lng: 16.6232172 },
    phone: '605 726 412',
    website: 'https://www.tjstartbrno.cz/',
    offerings: [
      noConnector({
        sport: 'tennis',
        bookingUrl: 'https://www.tjstartbrno.cz/online-rezervace/',
        bookingSystem: 'own',
        multisport: MULTISPORT_UNKNOWN,
        note: 'Outdoor courts and a tennis hall',
      }),
    ],
  },
  {
    id: 'zone4you',
    name: 'ZONE4YOU',
    district: 'Brno-sever',
    address: 'třída Generála Píky 2026/11, Brno',
    // Nominatim (leisure=sports_centre "Zone4You").
    location: { lat: 49.2188999, lng: 16.6162053 },
    phone: '548 221 010',
    website: 'https://zone4you.cz/squash',
    offerings: [
      noConnector({
        sport: 'squash',
        courts: 4,
        // Source: https://zone4you.cz/squash (2026-11-25).
        openingHours: withFriday(false, ['06:00', '22:00'], ['06:00', '21:00'], ['08:00', '21:00']),
        bookingUrl: 'https://zone4you.cz/squash',
        bookingSystem: 'memberzone',
        // Non-member prices per 30 min, doubled to an hour.
        pricing: czkPerHour(
          [
            rule(MON_THU, '06:00', '17:00', 320),
            rule(MON_THU, '17:00', '20:00', 420),
            rule(MON_THU, '20:00', '21:30', 320),
            rule(FRI, '06:00', '17:00', 320),
            rule(FRI, '17:00', '19:00', 420),
            rule(FRI, '19:00', '20:30', 320),
            rule(SAT_SUN, '08:00', '21:00', 320),
          ],
          'Booked per 30 min; members cheaper',
        ),
        multisport: MULTISPORT_UNKNOWN,
        note: 'MemberZone booking page (memberzone.cz/zone4you) refused our requests',
      }),
    ],
  },
  {
    id: 'squash-slovan',
    name: 'Squash Slovan',
    district: 'Brno-Černovice',
    address: 'Štolcova 693/6, Brno',
    // Nominatim address geocode (building).
    location: { lat: 49.1893635, lng: 16.6355037 },
    phone: '602 458 011',
    website: 'https://www.squashslovan.cz/',
    offerings: [
      noConnector({
        sport: 'squash',
        // Source: https://www.squashslovan.cz/ (2026-11-25), by advance reservation only.
        openingHours: {
          approximate: false,
          days: {
            mon: { open: '06:00', close: '21:00' },
            tue: { open: '06:00', close: '21:00' },
            wed: { open: '06:00', close: '21:00' },
            thu: { open: '06:00', close: '21:00' },
            fri: { open: '06:00', close: '21:00' },
            sat: { open: '08:00', close: '10:00' },
            sun: { open: '17:00', close: '20:00' },
          },
        },
        bookingUrl: 'https://www.squashslovan.cz/',
        bookingSystem: 'phone',
        // Source: https://www.squashslovan.cz/cenik (from 1.9.2026), incl. 30 CZK changing-room fee.
        pricing: czkPerHour([
          rule(MON_FRI, '06:00', '15:00', 330),
          rule(MON_FRI, '15:00', '21:00', 440),
          rule(['sat'], '08:00', '10:00', 330),
          rule(['sun'], '17:00', '20:00', 330),
        ]),
        // Source: https://www.squashslovan.cz/cenik – "Platby na recepci přijímáme v hotovosti nebo Multisport kartou."
        multisport: multisportNote('MultiSport accepted as payment; terms not published'),
        note: 'Booking by phone/SMS',
      }),
    ],
  },
  {
    id: 'tj-tesla-hala-lesna',
    name: 'TJ Tesla Brno – Sportovní hala Lesná',
    district: 'Brno-sever',
    address: 'Halasovo nám. 826/7, Brno',
    // Nominatim address geocode (building).
    location: { lat: 49.2233723, lng: 16.6248062 },
    phone: '545 222 600',
    website: 'https://www.tjteslabrno.cz/sportovni-zarizeni/sportovni-hala',
    offerings: [
      noConnector({
        sport: 'volleyball',
        courts: 1,
        // Rental price list hours (https://www.tjteslabrno.cz/cenik, 2026-11-25).
        openingHours: daily(true, ['06:00', '22:00']),
        bookingUrl: 'https://tjteslabrno.reenio.cz/cs/#/view/lesna-f1/sportovni-hala-r51584',
        bookingSystem: 'reenio',
        pricing: czkPerHour(
          [rule(MON_FRI, '06:00', '22:00', 1300)],
          'Whole hall, one-off rental; weekends from 1,400 CZK',
        ),
        multisport: MULTISPORT_UNKNOWN,
        // "vhodná především pro zápasy míčových sportů (futsal, florbal, basketbal, volejbal)".
        note: 'Whole sports hall (18.5 × 36 m) rented as one',
      }),
    ],
  },
];
