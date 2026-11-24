/** Pure UI state types and transitions (no DOM). */
import { parseCreateReservationRequest } from '@spotradar/shared';
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  AvailabilityResult,
  AvailableCourt,
  CreateReservationRequest,
  DurationMinutes,
  Reservation,
  SportId,
  ValidationIssue,
} from '@spotradar/shared';
import { ApiRequestError } from './api.ts';

// ---------- location ----------

export type LocationState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'set'; lat: number; lng: number }
  | { status: 'error'; message: string };

export function locationStatusText(location: LocationState): string {
  switch (location.status) {
    case 'idle':
      return 'Location not set.';
    case 'locating':
      return 'Locating…';
    case 'set':
      return 'Location set. Results are sorted by distance.';
    case 'error':
      return location.message;
  }
}

/** GeolocationPositionError codes: 1 denied, 2 unavailable, 3 timeout. */
export function geolocationErrorMessage(code: number | undefined): string {
  switch (code) {
    case 1:
      return 'Location access was denied. You can still search without it.';
    case 3:
      return 'Locating took too long. Please try again.';
    default:
      return 'Your location is unavailable. You can still search without it.';
  }
}

/** The max-distance select is only usable once a location is known. */
export function isDistanceFilterEnabled(location: LocationState): boolean {
  return location.status === 'set';
}

/** Coordinates as form strings (rounded to 5 decimals), empty when no location. */
export function locationToFormValues(location: LocationState): { lat: string; lng: string } {
  if (location.status !== 'set') return { lat: '', lng: '' };
  return { lat: location.lat.toFixed(5), lng: location.lng.toFixed(5) };
}

// ---------- errors ----------

export interface ErrorInfo {
  message: string;
  code: string;
  issues: ValidationIssue[];
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof ApiRequestError) {
    return { message: error.message, code: error.code, issues: error.details };
  }
  return { message: 'Something went wrong. Please try again.', code: 'UNKNOWN', issues: [] };
}

// ---------- search ----------

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; issues: ValidationIssue[] }
  | { status: 'success'; response: AvailabilityResponse };

export function searchErrorState(error: unknown): SearchState {
  const info = toErrorInfo(error);
  return { status: 'error', message: info.message, issues: info.issues };
}

export function searchInvalidState(issues: ValidationIssue[]): SearchState {
  return { status: 'error', message: 'Please fix the search form and try again.', issues };
}

// ---------- reservation ----------

export interface ReservationTarget {
  venueId: string;
  venueName: string;
  courtId: string;
  courtName: string;
  sport: SportId;
  date: string;
  time: string;
  durationMinutes: DurationMinutes;
  totalPriceCzk: number;
}

export interface ReservationFormValues {
  customerName: string;
  customerEmail: string;
}

export interface ReservationFailure {
  message: string;
  /** True when re-running the search makes sense (slot was taken). */
  canRefresh: boolean;
}

export type ReservationState =
  | { status: 'closed' }
  | {
      status: 'editing';
      target: ReservationTarget;
      values: ReservationFormValues;
      fieldErrors: Record<string, string>;
      failure: ReservationFailure | null;
    }
  | { status: 'submitting'; target: ReservationTarget; values: ReservationFormValues }
  | { status: 'success'; reservation: Reservation };

export const EMPTY_RESERVATION_VALUES: ReservationFormValues = {
  customerName: '',
  customerEmail: '',
};

export function buildReservationTarget(
  query: AvailabilityQuery,
  result: AvailabilityResult,
  court: AvailableCourt,
): ReservationTarget {
  return {
    venueId: result.venue.id,
    venueName: result.venue.name,
    courtId: court.id,
    courtName: court.name,
    sport: query.sport,
    date: query.date,
    time: query.time,
    durationMinutes: query.durationMinutes,
    totalPriceCzk: result.totalPriceCzk,
  };
}

export function openReservation(target: ReservationTarget): ReservationState {
  return {
    status: 'editing',
    target,
    values: EMPTY_RESERVATION_VALUES,
    fieldErrors: {},
    failure: null,
  };
}

export const CLOSED_RESERVATION: ReservationState = { status: 'closed' };

export type ReservationValidation =
  | { ok: true; request: CreateReservationRequest }
  | { ok: false; fieldErrors: Record<string, string> };

/** Validates the reservation form with the shared contract validator. */
export function validateReservationForm(
  target: ReservationTarget,
  values: ReservationFormValues,
): ReservationValidation {
  const result = parseCreateReservationRequest({
    venueId: target.venueId,
    courtId: target.courtId,
    sport: target.sport,
    date: target.date,
    time: target.time,
    durationMinutes: target.durationMinutes,
    customerName: values.customerName,
    customerEmail: values.customerEmail,
  });
  if (result.ok) return { ok: true, request: result.value };
  return { ok: false, fieldErrors: issuesToFieldErrors(result.issues) };
}

/** First message per field. */
export function issuesToFieldErrors(issues: ValidationIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    if (errors[issue.field] === undefined) errors[issue.field] = issue.message;
  }
  return errors;
}

export function reservationInvalid(
  state: ReservationState,
  values: ReservationFormValues,
  fieldErrors: Record<string, string>,
): ReservationState {
  if (state.status !== 'editing') return state;
  return { ...state, values, fieldErrors, failure: null };
}

export function reservationSubmitting(
  state: ReservationState,
  values: ReservationFormValues,
): ReservationState {
  if (state.status !== 'editing') return state;
  return { status: 'submitting', target: state.target, values };
}

export function reservationFailed(state: ReservationState, error: unknown): ReservationState {
  if (state.status !== 'submitting') return state;
  const info = toErrorInfo(error);
  const canRefresh = info.code === 'SLOT_UNAVAILABLE';
  const message =
    info.code === 'SLOT_UNAVAILABLE'
      ? `${info.message} Someone may have just booked this court. Refresh the results to see what is still free.`
      : info.message;
  return {
    status: 'editing',
    target: state.target,
    values: state.values,
    fieldErrors: issuesToFieldErrors(info.issues),
    failure: { message, canRefresh },
  };
}

export function reservationSucceeded(
  state: ReservationState,
  reservation: Reservation,
): ReservationState {
  if (state.status !== 'submitting') return state;
  return { status: 'success', reservation };
}
