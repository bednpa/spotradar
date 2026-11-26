import { readFileSync } from 'node:fs';
import { addDays } from '@spotradar/shared';

/**
 * The recorded Firestore answers (project zltc-prod-c9e6c, winter season). The reservations of
 * Thursday 26.11.2026 are served for every day: free half hours in the morning, around noon and
 * in the evening (19:30-20:30), so "today" has free courts until the evening.
 */
const COURTS = 'fixtures/courts.json';
const CONFIG = 'fixtures/config-reservations.json';
const RESERVATIONS = 'fixtures/reservations-2026-11-26.json';

const COURTS_PATH_RE = /^\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents\/courts$/;
const CONFIG_PATH_RE =
  /^\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents\/config\/reservations$/;
const QUERY_PATH_RE = /^\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents:runQuery$/;

const fixtureCache = new Map<string, unknown>();

function fixture(path: string): unknown {
  if (!fixtureCache.has(path)) {
    fixtureCache.set(path, JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')));
  }
  return structuredClone(fixtureCache.get(path));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

function firestoreError(status: number, code: string, message: string): Response {
  return json({ error: { code: status, message, status: code } }, status);
}

/** The `dates` timestamp the query filters for, or undefined when the body is not such a query. */
function queriedTimestamp(body: unknown): string | undefined {
  const query = (body as { structuredQuery?: Record<string, unknown> } | null)?.structuredQuery;
  const stamp = (
    query?.where as { fieldFilter?: { value?: { timestampValue?: unknown } } } | undefined
  )?.fieldFilter?.value?.timestampValue;
  return typeof stamp === 'string' ? stamp : undefined;
}

interface RecordedRow {
  document?: { fields: { dates: { arrayValue: { values: unknown[] } } } };
}

/**
 * E2E stub of the Firestore REST API for ŽLTC Brno (`FIRESTORE_API_ORIGIN`): serves the recorded
 * courts, the recorded config (booking allowed until `today` + 365 days) and answers
 * `documents:runQuery` with the recorded 26.11. reservations, their `dates` set to the queried
 * midnight so the real parser accepts them for any day. A query without a `select` projection
 * (which would download names) is refused like a bad request, so the stub also guards the
 * connector's privacy rule. Unknown paths answer 404.
 */
export function serveZltcStub(url: URL, init: RequestInit | undefined, today: string): Response {
  const isPost = init?.method === 'POST';
  if (!isPost && COURTS_PATH_RE.test(url.pathname)) return json(fixture(COURTS));
  if (!isPost && CONFIG_PATH_RE.test(url.pathname)) {
    const config = fixture(CONFIG) as {
      fields: Record<string, { stringValue?: string }>;
    };
    config.fields.last_allowed_reservation_date = { stringValue: addDays(today, 365) };
    return json(config);
  }
  if (isPost && QUERY_PATH_RE.test(url.pathname)) {
    let body: unknown;
    try {
      body = JSON.parse(typeof init?.body === 'string' ? init.body : '');
    } catch {
      return firestoreError(400, 'INVALID_ARGUMENT', 'Invalid JSON payload');
    }
    const stamp = queriedTimestamp(body);
    const select = (body as { structuredQuery?: { select?: { fields?: unknown[] } } })
      .structuredQuery?.select?.fields;
    if (stamp === undefined || !Array.isArray(select) || select.length === 0) {
      return firestoreError(
        400,
        'INVALID_ARGUMENT',
        'Query needs a filter and a select projection',
      );
    }
    const rows = fixture(RESERVATIONS) as RecordedRow[];
    for (const row of rows) {
      if (row.document) row.document.fields.dates.arrayValue.values = [{ timestampValue: stamp }];
    }
    return json(rows);
  }
  return firestoreError(404, 'NOT_FOUND', 'Document not found');
}
