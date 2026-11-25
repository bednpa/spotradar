import { dateRange } from '@spotradar/shared';
import type {
  CalendarDay,
  CalendarQuery,
  CalendarResponse,
  CalendarVenue,
} from '@spotradar/shared';
import { toPublicOffering, toPublicVenue } from '../repositories/venueRepository.ts';
import { getDayAvailability, selectVenues } from './search.ts';
import type { SearchDeps } from './search.ts';

export type CalendarDeps = SearchDeps;

export async function getCalendar(
  query: CalendarQuery,
  deps: CalendarDeps,
): Promise<CalendarResponse> {
  const now = deps.now();
  const candidates = selectVenues(deps.venues, query).toSorted((a, b) =>
    a.distance !== undefined && b.distance !== undefined
      ? a.distance - b.distance || a.venue.name.localeCompare(b.venue.name, 'cs')
      : a.venue.name.localeCompare(b.venue.name, 'cs'),
  );

  const venues: CalendarVenue[] = candidates.map(({ venue, offering, distance }) => {
    const entry: CalendarVenue = {
      venue: toPublicVenue(venue),
      offering: toPublicOffering(offering),
    };
    if (distance !== undefined) entry.distanceKm = distance;
    return entry;
  });

  // The availability service caches and limits concurrency per host.
  const days = await Promise.all(
    dateRange(query.from, query.to).map(async (date): Promise<CalendarDay> => {
      const dayVenues = await Promise.all(
        candidates.map(async ({ venue, offering }) => ({
          venueId: venue.id,
          availability: await getDayAvailability(deps.availability, venue, offering, date, now),
        })),
      );
      return { date, venues: dayVenues };
    }),
  );

  return { query, venues, days };
}
