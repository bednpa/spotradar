import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  ERROR_STATUS,
  isDateInSearchWindow,
  parseGeocodeQuery,
  parseSearchQuery,
} from '@spotradar/shared';
import type {
  ApiError,
  ErrorCode,
  GeocodeQueryParams,
  HealthResponse,
  SearchQueryParams,
  SearchResponse,
} from '@spotradar/shared';
import type { AvailabilityService } from './connectors/availabilityService.ts';
import { HttpError, validationError } from './errors.ts';
import type { VenueRepository } from './repositories/venueRepository.ts';
import type { Geocoder } from './services/geocode.ts';
import { searchVenues } from './services/search.ts';

export interface AppOptions {
  venues: VenueRepository;
  availability: AvailabilityService;
  geocoder: Geocoder;
  /** Injectable clock (tests use a fixed one). */
  now: () => Date;
  /** Directory with the built frontend (absolute path). */
  staticDir: string;
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const SEARCH_QUERY_KEYS = ['sport', 'date', 'time', 'lat', 'lng', 'maxDistanceKm'] as const;

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): void {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, {
    'content-type': JSON_CONTENT_TYPE,
    'content-length': payload.length,
    ...headers,
  });
  res.end(payload);
}

function sendError(res: ServerResponse, code: ErrorCode, message: string, details?: unknown): void {
  const body: ApiError = { error: message, code };
  if (details !== undefined) body.details = details;
  sendJson(res, ERROR_STATUS[code], body);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  const payload = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': payload.length,
  });
  res.end(payload);
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: AppOptions,
): Promise<void> {
  const method = req.method ?? 'GET';
  const segments = url.pathname.split('/').filter((s) => s !== '');
  // segments[0] === 'api'
  const resource = segments[1];

  const methodNotAllowed = (allow: string): void => {
    res.setHeader('allow', allow);
    sendError(res, 'METHOD_NOT_ALLOWED', `Method ${method} not allowed`);
  };

  if (segments.length === 2 && resource === 'health') {
    if (method !== 'GET') return methodNotAllowed('GET');
    const body: HealthResponse = { status: 'ok' };
    sendJson(res, 200, body);
    return;
  }

  if (segments.length === 2 && resource === 'search') {
    if (method !== 'GET') return methodNotAllowed('GET');
    const params: SearchQueryParams = {};
    for (const key of SEARCH_QUERY_KEYS) {
      const value = url.searchParams.get(key); // first value of repeated params
      if (value !== null) params[key] = value;
    }
    const parsed = parseSearchQuery(params);
    if (!parsed.ok) throw validationError(parsed.issues);
    const now = options.now();
    if (!isDateInSearchWindow(parsed.value.date, now)) {
      throw new HttpError('DATE_OUT_OF_RANGE', 'Date is outside the searchable window');
    }
    const body: SearchResponse = {
      query: parsed.value,
      results: await searchVenues(parsed.value, {
        venues: options.venues,
        availability: options.availability,
        now: options.now,
      }),
    };
    sendJson(res, 200, body);
    return;
  }

  if (segments.length === 2 && resource === 'geocode') {
    if (method !== 'GET') return methodNotAllowed('GET');
    const params: GeocodeQueryParams = {};
    const q = url.searchParams.get('q');
    if (q !== null) params.q = q;
    const parsed = parseGeocodeQuery(params);
    if (!parsed.ok) throw validationError(parsed.issues);
    sendJson(res, 200, await options.geocoder.geocode(parsed.value.q));
    return;
  }

  throw new HttpError('NOT_FOUND', `Route ${url.pathname} not found`);
}

async function readFileOrNull(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath);
  } catch {
    return null;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  staticDir: string,
): Promise<void> {
  const method = req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    sendError(res, 'METHOD_NOT_ALLOWED', `Method ${method} not allowed`);
    return;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, 'Bad request');
    return;
  }
  if (decoded.includes('\0')) {
    sendText(res, 400, 'Bad request');
    return;
  }

  const root = path.resolve(staticDir);
  let filePath = path.resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  if (await isDirectory(filePath)) filePath = path.join(filePath, 'index.html');
  let content = await readFileOrNull(filePath);
  if (content === null && path.extname(decoded) !== '') {
    // Missing asset (e.g. /app/missing.js): don't answer with index.html.
    sendText(res, 404, 'Not found');
    return;
  }
  if (content === null) {
    // SPA fallback for client-side routes
    filePath = path.join(root, 'index.html');
    content = await readFileOrNull(filePath);
  }
  if (content === null) {
    sendText(res, 404, 'Frontend not built');
    return;
  }

  const contentType =
    MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': contentType, 'content-length': content.length });
  res.end(method === 'HEAD' ? undefined : content);
}

/** Creates (but does not start) the HTTP server. */
export function createApp(options: AppOptions): Server {
  return createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          await handleApi(req, res, url, options);
        } else {
          await serveStatic(req, res, url.pathname, options.staticDir);
        }
      } catch (err) {
        if (res.headersSent) {
          res.end();
          return;
        }
        if (err instanceof HttpError) {
          sendError(res, err.code, err.message, err.details);
          return;
        }
        console.error('Unexpected error', err);
        sendError(res, 'INTERNAL_ERROR', 'Internal server error');
      }
    })();
  });
}
