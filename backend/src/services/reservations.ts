import { isDateInBookingWindow, timeToMinutes } from '@spotradar/shared';
import type { CreateReservationRequest, Reservation } from '@spotradar/shared';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../errors.ts';
import type { ReservationRepository } from '../repositories/reservationRepository.ts';
import type { VenueRepository } from '../repositories/venueRepository.ts';
import { isCourtFree, isStartInPast, isWithinOpeningHours } from './availability.ts';

export interface ReservationDeps {
  venues: VenueRepository;
  reservations: ReservationRepository;
  now: Date;
}

/**
 * Creates a reservation for an already validated request.
 * Throws HttpError for every business-rule violation. Synchronous on purpose, so
 * the availability check and the insert cannot interleave with another request.
 */
export function createReservation(
  input: CreateReservationRequest,
  deps: ReservationDeps,
): Reservation {
  const venue = deps.venues.getById(input.venueId);
  if (!venue) throw new HttpError('VENUE_NOT_FOUND', `Venue ${input.venueId} not found`);

  const court = venue.courts.find((c) => c.id === input.courtId);
  if (!court) {
    throw new HttpError('COURT_NOT_FOUND', `Court ${input.courtId} not found in this venue`);
  }

  const pricePerHourCzk = venue.pricePerHourCzk[input.sport];
  if (pricePerHourCzk === undefined || !court.sports.includes(input.sport)) {
    throw new HttpError('SPORT_NOT_OFFERED', `This court does not offer ${input.sport}`);
  }

  if (!isDateInBookingWindow(input.date, deps.now)) {
    throw new HttpError('DATE_OUT_OF_RANGE', 'Date is outside the booking window');
  }

  const startMin = timeToMinutes(input.time);
  const endMin = startMin + input.durationMinutes;

  if (isStartInPast(input.date, startMin, deps.now)) {
    throw new HttpError('SLOT_IN_PAST', 'The requested start time has already passed');
  }
  if (!isWithinOpeningHours(venue, startMin, endMin)) {
    throw new HttpError('OUTSIDE_OPENING_HOURS', 'The interval is outside the opening hours');
  }
  if (!isCourtFree(court.id, input.date, startMin, endMin, deps.reservations)) {
    throw new HttpError('SLOT_UNAVAILABLE', 'The court is not available for the requested slot');
  }

  const reservation: Reservation = {
    ...input,
    id: randomUUID(),
    venueName: venue.name,
    courtName: court.name,
    totalPriceCzk: Math.round((pricePerHourCzk * input.durationMinutes) / 60),
    createdAt: deps.now.toISOString(),
  };
  return deps.reservations.create(reservation);
}
