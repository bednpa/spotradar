/**
 * Error codes used in the unified ApiError body, with the HTTP status each one maps to.
 */
export const ERROR_STATUS = {
  /** Invalid query (details: ValidationIssue[]). */
  VALIDATION_ERROR: 400,
  /** Unknown API route. */
  NOT_FOUND: 404,
  /** GET /api/geocode found no place for the query. */
  LOCATION_NOT_FOUND: 404,
  /** Route exists but the HTTP method is not supported. */
  METHOD_NOT_ALLOWED: 405,
  /** Date is before today or after today + SEARCH_WINDOW_DAYS (Europe/Prague). */
  DATE_OUT_OF_RANGE: 422,
  INTERNAL_ERROR: 500,
  /** The upstream geocoding service (Nominatim) failed or timed out. */
  GEOCODER_UNAVAILABLE: 502,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
