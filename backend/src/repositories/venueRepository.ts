import type { SportOffering, SportOfferingConfig, Venue } from '@spotradar/shared';

/**
 * A venue as stored in the backend: the public `Venue` fields plus, per sport, the
 * connector configuration of its booking system. `offerings[].source` is backend-only and
 * must never be sent to clients (use `toPublicVenue` / `toPublicOffering`). `sports` is
 * derived from the offerings.
 */
export interface VenueRecord extends Omit<Venue, 'offerings' | 'sports'> {
  offerings: SportOfferingConfig[];
}

/** Read-only access to venues. */
export interface VenueRepository {
  getAll(): VenueRecord[];
  getById(id: string): VenueRecord | undefined;
}

export function createVenueRepository(records: readonly VenueRecord[]): VenueRepository {
  return {
    getAll() {
      return [...records];
    },
    getById(id) {
      return records.find((v) => v.id === id);
    },
  };
}

/** Strips the backend-only `source` (explicit allow-list, deep copies). */
export function toPublicOffering(offering: SportOfferingConfig): SportOffering {
  const result: SportOffering = {
    sport: offering.sport,
    bookingUrl: offering.bookingUrl,
    bookingSystem: offering.bookingSystem,
    availabilitySource: offering.availabilitySource,
    multisport: structuredClone(offering.multisport), // deep copy incl. limits
  };
  if (offering.courts !== undefined) result.courts = offering.courts;
  if (offering.openingHours !== undefined) {
    result.openingHours = structuredClone(offering.openingHours);
  }
  if (offering.pricing !== undefined) {
    result.pricing = {
      ...offering.pricing,
      rules: offering.pricing.rules.map((r) => ({ ...r, days: [...r.days] })),
    };
  }
  if (offering.note !== undefined) result.note = offering.note;
  return result;
}

/** Strips backend-only fields so the result is safe to return from the API. */
export function toPublicVenue(record: VenueRecord): Venue {
  // Explicit allow-list: a field added to VenueRecord later is never leaked by accident.
  const venue: Venue = {
    id: record.id,
    name: record.name,
    district: record.district,
    address: record.address,
    location: { ...record.location },
    sports: record.offerings.map((o) => o.sport),
    offerings: record.offerings.map(toPublicOffering),
  };
  if (record.phone !== undefined) venue.phone = record.phone;
  if (record.website !== undefined) venue.website = record.website;
  return venue;
}
