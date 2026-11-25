import { compareVenuesByName, matchesVenueQuery } from '@spotradar/shared';
import type { VenueListItem, VenueQuery } from '@spotradar/shared';
import type { AvailabilityService } from '../connectors/availabilityService.ts';
import { toPublicVenue } from '../repositories/venueRepository.ts';
import type { VenueRepository } from '../repositories/venueRepository.ts';

export interface VenueListDeps {
  venues: VenueRepository;
  availability: AvailabilityService;
}

/** Venue directory: filtered by sport and text, sorted by name, public fields only. */
export function listVenues(query: VenueQuery, deps: VenueListDeps): VenueListItem[] {
  return deps.venues
    .getAll()
    .filter((record) => query.sport === undefined || record.sports.includes(query.sport))
    .filter((record) => query.q === undefined || matchesVenueQuery(record, query.q))
    .map((record) => ({
      venue: toPublicVenue(record),
      liveAvailability: deps.availability.supports(record),
    }))
    .sort((a, b) => compareVenuesByName(a.venue, b.venue));
}
