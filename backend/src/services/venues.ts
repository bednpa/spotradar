import { compareVenuesByName, matchesVenueQuery } from '@spotradar/shared';
import type { VenueListItem, VenueQuery } from '@spotradar/shared';
import type { AvailabilityService } from '../connectors/availabilityService.ts';
import { toPublicVenue } from '../repositories/venueRepository.ts';
import type { VenueRepository } from '../repositories/venueRepository.ts';

export interface VenueListDeps {
  venues: VenueRepository;
  availability: AvailabilityService;
}

/**
 * Venue directory: filtered by sport (venues with an offering for it) and text, sorted by
 * name, public fields only. `liveSports` lists the offerings with a connector;
 * `liveAvailability` is about the filtered sport, or any sport without a filter.
 */
export function listVenues(query: VenueQuery, deps: VenueListDeps): VenueListItem[] {
  return deps.venues
    .getAll()
    .filter(
      (record) =>
        query.sport === undefined || record.offerings.some((o) => o.sport === query.sport),
    )
    .filter((record) => query.q === undefined || matchesVenueQuery(record, query.q))
    .map((record) => {
      const liveSports = record.offerings
        .filter((offering) => deps.availability.supports(offering))
        .map((offering) => offering.sport);
      return {
        venue: toPublicVenue(record),
        liveAvailability:
          query.sport === undefined ? liveSports.length > 0 : liveSports.includes(query.sport),
        liveSports,
      };
    })
    .sort((a, b) => compareVenuesByName(a.venue, b.venue));
}
