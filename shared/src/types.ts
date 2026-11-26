/**
 * API DTOs – the single source of truth for request/response shapes.
 * Dates are "YYYY-MM-DD", times are "HH:MM" (local time in Europe/Prague).
 */
import type { AvailabilitySource, BookingSystem, GeoPoint, SportId } from './catalog.ts';
import type { ErrorCode } from './errors.ts';
import type { MultisportInfo } from './multisport.ts';
import type { Pricing } from './pricing.ts';

/** GET /api/health → 200 */
export interface HealthResponse {
  status: 'ok';
}

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DayOpeningHours {
  /** "HH:MM" */
  open: string;
  /** "HH:MM" */
  close: string;
}

/**
 * Yearly season of a seasonal (usually outdoor) offering, inclusive, as "MM-DD".
 * `from` > `to` wraps the year end (e.g. an indoor winter season "10-01".."04-30").
 */
export interface Season {
  from: string;
  to: string;
}

export interface OpeningHours {
  /** True when the hours are an estimate (not confirmed by the venue); data only, not shown. */
  approximate: boolean;
  /** null = closed that day. */
  days: Record<Weekday, DayOpeningHours | null>;
  /** Only open within this season (closed on every other date); absent = all year. */
  season?: Season;
}

/**
 * One sport at one venue: its own courts, hours, booking page, booking system,
 * prices and MultiSport terms (a venue can offer several sports).
 */
export interface SportOffering {
  sport: SportId;
  /** Number of courts/tables for this sport; absent when not known. */
  courts?: number;
  /**
   * Opening hours for this sport; absent when not known (the calendar then treats the hours
   * of UNKNOWN_HOURS_WINDOW as possibly open → "check on website" unless live data shows free).
   */
  openingHours?: OpeningHours;
  /** The venue's own booking page for this sport – SpotRadar never books anything itself. */
  bookingUrl: string;
  /** Booking system the venue uses for this sport (display + research status). */
  bookingSystem: BookingSystem;
  /** Connector that reads live data for this sport ("none" = no connector → "check on website"). */
  availabilitySource: AvailabilitySource;
  /** Structured court price list (see `priceFor`); absent when unknown. */
  pricing?: Pricing;
  /** MultiSport terms; `{ category: 'unknown' }` when not known. */
  multisport: MultisportInfo;
  /** Short factual remark, e.g. "Outdoor sand courts" or "Indoor courts in winter only". */
  note?: string;
}

/** Public venue information (what the API returns). */
export interface Venue {
  id: string;
  name: string;
  /** City district, e.g. "Brno-Židenice". */
  district: string;
  address: string;
  location: GeoPoint;
  /** Sports of `offerings`, in the same order (convenience for filtering and tags). */
  sports: SportId[];
  /** Non-empty; at most one offering per sport. */
  offerings: SportOffering[];
  phone?: string;
  /** The venue's own website (not the booking page); absent when unknown. */
  website?: string;
}

/**
 * Backend-only connector configuration for a venue's booking system
 * (stored in the venue data file, never sent to clients).
 */
export type AvailabilitySourceConfig =
  | {
      type: 'clubspire';
      baseUrl: string;
      /** Timeline tab of the sport (e.g. Centrum Viktoria: 0 squash, 1 badminton, 2 beach, 3 padel). */
      tabIdx: number;
      /**
       * Only court rows whose name starts with one of these prefixes (case-insensitive) count,
       * for tabs that mix sports (Viktoria tab 3: "Padel 1-3" + an outdoor tennis court).
       * Absent = every row of the tab.
       */
      courtNamePrefixes?: string[];
    }
  | {
      type: 'bizzy';
      scheduleUrl: string;
      /**
       * Bookings must start at least this many minutes from now (X-Arena: 120);
       * hour cells starting sooner are never reported as free. Absent = no limit.
       */
      minLeadMinutes?: number;
    }
  | { type: 'memberzone'; url: string }
  | {
      type: 'memberpro';
      url: string;
      /**
       * The sport button posted to load the grid, e.g. `{ name: 'BTN5', value: 'Badminton' }`
       * (Ivanovice: BTN4=Squash, BTN3=Ping-pong).
       */
      sportButton: { name: string; value: string };
    }
  | {
      type: 'starez';
      /** The public reservation page, e.g. "https://beach.starez.cz/vstupenky-rezervace". */
      url: string;
      /** Title of the facility group to read, e.g. "Beachvolejbal" (one page lists several). */
      facility: string;
    }
  | { type: 'none' };

/**
 * Backend-only: a sport offering plus the connector configuration of its booking
 * system (stored in the venue data file, never sent to clients).
 * Invariant: `availabilitySource === source.type`.
 */
export interface SportOfferingConfig extends SportOffering {
  source: AvailabilitySourceConfig;
}

/** Parsed query of GET /api/search. */
export interface SearchQuery {
  sport: SportId;
  date: string;
  /** Optional "HH:MM". */
  time?: string;
  /** lat and lng are either both present or both absent. */
  lat?: number;
  lng?: number;
  /** Only allowed together with lat/lng. */
  maxDistanceKm?: number;
}

/** Raw query string parameters of GET /api/search (all strings). */
export type SearchQueryParams = Partial<Record<keyof SearchQuery, string>>;

/** A time interval on the requested date with at least one free court. */
export interface FreeSlot {
  /** "HH:MM", inclusive */
  start: string;
  /** "HH:MM", exclusive */
  end: string;
  /** Number of courts free for the whole interval (always ≥ 1). */
  freeCourts: number;
}

/**
 * - live: read from the venue's booking page,
 * - unavailable: a connector exists but reading the page failed,
 * - unknown: no connector for this booking system yet.
 */
export type AvailabilityStatus = 'live' | 'unavailable' | 'unknown';

export interface VenueAvailability {
  status: AvailabilityStatus;
  /** ISO 8601 timestamp of when the data was read (status "live" only). */
  checkedAt?: string;
  /** Free slots for the day sorted by start; empty unless status is "live". */
  freeSlots: FreeSlot[];
}

export interface SearchResult {
  venue: Venue;
  /** The venue's offering for `query.sport` (hours, prices, booking page of that sport). */
  offering: SportOffering;
  /** Distance from the origin in km (1 decimal); present only when lat/lng were given. */
  distanceKm?: number;
  availability: VenueAvailability;
  /**
   * Free courts in the slot containing the requested time; present only when
   * `time` was given and availability status is "live" (0 = nothing free then).
   */
  freeCourtsAtTime?: number;
}

/** GET /api/search → 200 */
export interface SearchResponse {
  query: SearchQuery;
  /**
   * Sorted: venues with a free court first (at `time` when given, otherwise
   * anywhere during the day), then by distanceKm when an origin was given,
   * otherwise by venue name.
   */
  results: SearchResult[];
}

/** Parsed query of GET /api/calendar (availability for a range of days). */
export interface CalendarQuery {
  sport: SportId;
  /** First day "YYYY-MM-DD" (inclusive). */
  from: string;
  /** Last day "YYYY-MM-DD" (inclusive), from ≤ to, at most CALENDAR_MAX_DAYS days. */
  to: string;
  /** lat and lng are either both present or both absent. */
  lat?: number;
  lng?: number;
  /** Only allowed together with lat/lng. */
  maxDistanceKm?: number;
}

/** Raw query string parameters of GET /api/calendar (all strings). */
export type CalendarQueryParams = Partial<Record<keyof CalendarQuery, string>>;

/** A venue matching the calendar filters. */
export interface CalendarVenue {
  venue: Venue;
  /** The venue's offering for `query.sport` (hours, prices, booking page of that sport). */
  offering: SportOffering;
  /** Distance from the origin in km (1 decimal); present only when lat/lng were given. */
  distanceKm?: number;
}

/** Availability of one venue on one day. */
export interface CalendarDayVenue {
  venueId: string;
  /** Same semantics as in /api/search: slots that already ended today are removed. */
  availability: VenueAvailability;
}

export interface CalendarDay {
  /** "YYYY-MM-DD" */
  date: string;
  /** One entry per item of CalendarResponse.venues, in the same order. */
  venues: CalendarDayVenue[];
}

/** GET /api/calendar → 200 */
export interface CalendarResponse {
  query: CalendarQuery;
  /** Matching venues sorted by distanceKm when an origin was given, otherwise by name (Czech collation). */
  venues: CalendarVenue[];
  /** Every date from `from` to `to`, ascending. */
  days: CalendarDay[];
}

/** Parsed query of GET /api/venues (venue directory). */
export interface VenueQuery {
  /** Only venues offering this sport; all venues when absent. */
  sport?: SportId;
  /** Trimmed free-text search (1–VENUE_QUERY_MAX chars) over name, district and address. */
  q?: string;
}

/** Raw query string parameters of GET /api/venues (all strings). */
export type VenueQueryParams = Partial<Record<keyof VenueQuery, string>>;

export interface VenueListItem {
  venue: Venue;
  /**
   * True when SpotRadar can read live court availability (a connector exists) for
   * `query.sport`, or for at least one sport when no sport filter is given.
   */
  liveAvailability: boolean;
  /** Sports of the venue with live availability (a connector exists), in offering order. */
  liveSports: SportId[];
}

/** GET /api/venues → 200 */
export interface VenuesResponse {
  query: VenueQuery;
  /** Matching venues sorted by name (Czech collation); empty when nothing matches. */
  venues: VenueListItem[];
}

/** Parsed query of GET /api/geocode and GET /api/geocode/suggest. */
export interface GeocodeQuery {
  /** Trimmed free-text address. */
  q: string;
}

export type GeocodeQueryParams = Partial<Record<keyof GeocodeQuery, string>>;

/** GET /api/geocode → 200 */
export interface GeocodeResponse {
  lat: number;
  lng: number;
  /** Human-readable place name. */
  label: string;
}

/**
 * GET /api/geocode/suggest → 200: address suggestions while the user types
 * (at most GEOCODE_SUGGEST_LIMIT, biased to Brno; empty when nothing matches –
 * never 404).
 */
export interface GeocodeSuggestResponse {
  suggestions: GeocodeResponse[];
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Unified error body for every non-2xx API response. */
export interface ApiError {
  error: string;
  code: ErrorCode;
  /** For VALIDATION_ERROR: ValidationIssue[] */
  details?: unknown;
}
