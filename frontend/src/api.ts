/** API client for the SpotRadar REST API (relative URLs, injectable fetch). */
import { ERROR_STATUS } from '@spotradar/shared';
import type {
  CalendarQuery,
  CalendarResponse,
  ErrorCode,
  GeocodeResponse,
  ValidationIssue,
} from '@spotradar/shared';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Error codes produced by the client itself (not by the server). */
export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiRequestError extends Error {
  /** HTTP status, 0 when no response was received. */
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: ValidationIssue[];

  constructor(
    status: number,
    code: ClientErrorCode,
    message: string,
    details: ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const defaultFetch: FetchFn = (input, init) => fetch(input, init);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_STATUS, value);
}

/** Keeps only well-formed ValidationIssue items. */
export function toValidationIssues(details: unknown): ValidationIssue[] {
  if (!Array.isArray(details)) return [];
  const issues: ValidationIssue[] = [];
  for (const item of details) {
    if (isRecord(item) && typeof item.field === 'string' && typeof item.message === 'string') {
      issues.push({ field: item.field, message: item.message });
    }
  }
  return issues;
}

function errorFromResponse(status: number, body: unknown): ApiRequestError {
  if (isRecord(body) && typeof body.error === 'string' && isErrorCode(body.code)) {
    return new ApiRequestError(status, body.code, body.error, toValidationIssues(body.details));
  }
  return new ApiRequestError(
    status,
    'INVALID_RESPONSE',
    `The server returned an unexpected response (HTTP ${status}). Please try again later.`,
  );
}

async function requestJson<T>(
  url: string,
  isValid: (body: unknown) => body is T,
  fetchFn: FetchFn,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiRequestError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the server. Check your connection and try again.',
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    body = undefined;
  }

  if (!response.ok) throw errorFromResponse(response.status, body);
  if (!isValid(body)) {
    throw new ApiRequestError(
      response.status,
      'INVALID_RESPONSE',
      'The server returned an unreadable response. Please try again later.',
    );
  }
  return body;
}

function isCalendarResponse(body: unknown): body is CalendarResponse {
  return (
    isRecord(body) && isRecord(body.query) && Array.isArray(body.venues) && Array.isArray(body.days)
  );
}

/** CalendarQuery → URLSearchParams (optional location params only when set). */
export function calendarQueryToParams(query: CalendarQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set('sport', query.sport);
  params.set('from', query.from);
  params.set('to', query.to);
  if (query.lat !== undefined && query.lng !== undefined) {
    params.set('lat', String(query.lat));
    params.set('lng', String(query.lng));
  }
  if (query.maxDistanceKm !== undefined) params.set('maxDistanceKm', String(query.maxDistanceKm));
  return params;
}

function isGeocodeResponse(body: unknown): body is GeocodeResponse {
  return (
    isRecord(body) &&
    typeof body.lat === 'number' &&
    typeof body.lng === 'number' &&
    typeof body.label === 'string'
  );
}

/** GET /api/calendar */
export function fetchCalendar(
  query: CalendarQuery,
  fetchFn: FetchFn = defaultFetch,
): Promise<CalendarResponse> {
  return requestJson(
    `/api/calendar?${calendarQueryToParams(query).toString()}`,
    isCalendarResponse,
    fetchFn,
  );
}

/** GET /api/geocode */
export function geocodeAddress(
  q: string,
  fetchFn: FetchFn = defaultFetch,
): Promise<GeocodeResponse> {
  return requestJson(
    `/api/geocode?${new URLSearchParams({ q }).toString()}`,
    isGeocodeResponse,
    fetchFn,
  );
}
