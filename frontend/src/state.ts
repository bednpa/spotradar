/** UI state types and pure state transitions / messages. */
import type { CalendarResponse, CalendarView, ValidationIssue } from '@spotradar/shared';
import { ApiRequestError } from './api.ts';
import type { Origin } from './query.ts';

/**
 * - outside: the shown period lies completely outside the searchable window (nothing to fetch),
 * - success: data loaded (it may still contain zero venues → empty state),
 * - partial: the focused day is loaded, the rest of pendingFrom..pendingTo is still loading
 *   (or failed: `error` holds the message and the loaded day stays visible).
 */
export type CalendarState =
  | { status: 'loading' }
  | { status: 'outside' }
  | { status: 'success'; data: CalendarResponse }
  | {
      status: 'partial';
      data: CalendarResponse;
      pendingFrom: string;
      pendingTo: string;
      error: string | null;
    }
  | { status: 'error'; message: string; issues: ValidationIssue[] };

/** Data usable for the panel and legend (also while only part of the range is loaded). */
export function calendarData(calendar: CalendarState): CalendarResponse | null {
  return calendar.status === 'success' || calendar.status === 'partial' ? calendar.data : null;
}

/** True while something is still being fetched (drives aria-busy). */
export function isCalendarBusy(calendar: CalendarState): boolean {
  return (
    calendar.status === 'loading' || (calendar.status === 'partial' && calendar.error === null)
  );
}

/** Text of the single persistent live region next to the calendar ("" = nothing loading). */
export function calendarStatusText(calendar: CalendarState, view: CalendarView): string {
  if (calendar.status === 'loading') return 'Loading availability…';
  if (calendar.status === 'partial' && calendar.error === null) {
    return `Loading the rest of the ${view}…`;
  }
  return '';
}

/**
 * State to show while retrying a range. When the same range is shown partially, the visible
 * day stays on screen (error cleared); everything else starts from the skeleton.
 */
export function loadingStateFor(
  previous: CalendarState,
  range: { from: string; to: string },
): CalendarState {
  if (
    previous.status === 'partial' &&
    previous.pendingFrom === range.from &&
    previous.pendingTo === range.to
  ) {
    return { ...previous, error: null };
  }
  return { status: 'loading' };
}

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
