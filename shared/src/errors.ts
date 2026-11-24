/**
 * Error codes used in the unified ApiError body, with the HTTP status each one maps to.
 */
export const ERROR_STATUS = {
  /** Invalid query/body (details: ValidationIssue[]), also malformed JSON. */
  VALIDATION_ERROR: 400,
  /** Unknown API route. */
  NOT_FOUND: 404,
  VENUE_NOT_FOUND: 404,
  COURT_NOT_FOUND: 404,
  RESERVATION_NOT_FOUND: 404,
  /** Route exists but the HTTP method is not supported. */
  METHOD_NOT_ALLOWED: 405,
  /** Court is already booked for (part of) the requested interval. */
  SLOT_UNAVAILABLE: 409,
  /** Request body larger than MAX_BODY_BYTES. */
  PAYLOAD_TOO_LARGE: 413,
  /** Date is before today or after the booking window (Europe/Prague). */
  DATE_OUT_OF_RANGE: 422,
  /** Requested start time has already passed (today). */
  SLOT_IN_PAST: 422,
  /** The court/venue does not offer the requested sport. */
  SPORT_NOT_OFFERED: 422,
  /** The requested interval is not fully inside the venue's opening hours. */
  OUTSIDE_OPENING_HOURS: 422,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** Maximum accepted JSON request body size in bytes. */
export const MAX_BODY_BYTES = 10_000;
