import type { AvailabilitySourceConfig, Venue } from '@spotradar/shared';

/**
 * A venue as stored in the backend: the public `Venue` plus the connector
 * configuration of its booking system. `source` is backend-only and must never
 * be sent to clients (use `toPublicVenue`).
 */
export interface VenueRecord extends Venue {
  source: AvailabilitySourceConfig;
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

/** Strips backend-only fields so the result is safe to return from the API. */
export function toPublicVenue(record: VenueRecord): Venue {
  // Explicit allow-list: a field added to VenueRecord later is never leaked by accident.
  const venue: Venue = {
    id: record.id,
    name: record.name,
    district: record.district,
    address: record.address,
    location: record.location,
    sports: record.sports,
    openingHours: record.openingHours,
    bookingUrl: record.bookingUrl,
    availabilitySource: record.availabilitySource,
  };
  if (record.courts !== undefined) venue.courts = record.courts;
  if (record.phone !== undefined) venue.phone = record.phone;
  if (record.website !== undefined) venue.website = record.website;
  if (record.priceInfo !== undefined) venue.priceInfo = record.priceInfo;
  if (record.multisport !== undefined) venue.multisport = { ...record.multisport };
  if (record.otherActivities !== undefined) venue.otherActivities = [...record.otherActivities];
  return venue;
}
