/** UI state types and pure state transitions / messages. */
import type { CalendarResponse, ValidationIssue } from '@spotradar/shared';
import { ApiRequestError } from './api.ts';
import type { Origin } from './query.ts';

/**
 * - outside: the shown period lies completely outside the searchable window (nothing to fetch),
 * - success: data loaded (it may still contain zero venues → empty state).
 */
export type CalendarState =
  | { status: 'loading' }
  | { status: 'outside' }
  | { status: 'success'; data: CalendarResponse }
  | { status: 'error'; message: string; issues: ValidationIssue[] };

export type LocationState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'resolving' }
  | { status: 'set'; origin: Origin }
  | { status: 'error'; message: string };

/** GeolocationPositionError codes: 1 denied, 2 unavailable, 3 timeout. */
export function geolocationErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return 'Location access was denied. Allow it in your browser or enter an address instead.';
    case 3:
      return 'Finding your location took too long. Try again or enter an address instead.';
    default:
      return 'Your location is not available. Enter an address instead.';
  }
}

/** Message for a failed /api/geocode call. */
export function geocodeErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'LOCATION_NOT_FOUND':
        return 'Address not found. Try a street, district or landmark in Brno.';
      case 'GEOCODER_UNAVAILABLE':
        return 'The address lookup service is unavailable right now. Try again in a moment or use your location.';
      case 'VALIDATION_ERROR':
        return 'Enter at least 2 characters of an address.';
      default:
        return error.message;
    }
  }
  return 'Something went wrong while looking up the address.';
}

/** Converts a failed /api/calendar call into the error state. */
export function calendarErrorState(error: unknown): CalendarState {
  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'DATE_OUT_OF_RANGE':
        return {
          status: 'error',
          message:
            'Those dates are outside the searchable range. Pick a day within the next 14 days.',
          issues: [],
        };
      case 'VALIDATION_ERROR':
        return {
          status: 'error',
          message: 'Some options are not valid. Please check them and try again.',
          issues: error.details,
        };
      default:
        return { status: 'error', message: error.message, issues: [] };
    }
  }
  return { status: 'error', message: 'Something went wrong. Please try again.', issues: [] };
}

/** Text shown under the location controls. */
export function locationStatusText(location: LocationState): string {
  switch (location.status) {
    case 'locating':
      return 'Finding your location…';
    case 'resolving':
      return 'Looking up the address…';
    case 'set':
      return `Searching near: ${location.origin.label}`;
    case 'error':
      return location.message;
    default:
      return '';
  }
}

/** The distance filter needs a known origin. */
export function isDistanceFilterEnabled(location: LocationState): boolean {
  return location.status === 'set';
}
