import type { Venue } from '@spotradar/shared';

/** Read-only access to venues. */
export interface VenueRepository {
  listByCity(cityId: string): Venue[];
  getById(id: string): Venue | undefined;
}

export function createVenueRepository(venues: readonly Venue[]): VenueRepository {
  return {
    listByCity(cityId) {
      return venues.filter((v) => v.cityId === cityId);
    },
    getById(id) {
      return venues.find((v) => v.id === id);
    },
  };
}
