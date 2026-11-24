import { ERROR_STATUS } from '@spotradar/shared';
import type { ErrorCode, ValidationIssue } from '@spotradar/shared';

/** Error that maps directly to an ApiError response. */
export class HttpError extends Error {
  code: ErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}

export function validationError(issues: ValidationIssue[]): HttpError {
  return new HttpError('VALIDATION_ERROR', 'Invalid request', issues);
}
