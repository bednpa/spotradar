import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AvailabilitySourceConfig } from '@spotradar/shared';
import { jsonResponse, recordingFetch, slot } from '../../testHelpers.ts';
import { FIRESTORE_API_ORIGIN } from '../apiOrigins.ts';
import { UpstreamTimeoutError } from '../timeout.ts';
import type { AvailabilityTarget } from '../types.ts';
import { META_CACHE_TTL_MS, createZltcConnector, firestoreUrl } from './connector.ts';
import { ZltcApiError, ZltcParseError } from './parser.ts';
import { serveZltcStub } from './stub.ts';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

const COURTS = fixture('courts.json');
const CONFIG = fixture('config-reservations.json');
const DAYS: Record<string, unknown> = {
  '2026-11-25T23:00:00Z': fixture('reservations-2026-11-26.json'),
  '2026-11-27T23:00:00Z': fixture('reservations-2026-11-28.json'),
};
const SOURCE: Extract<AvailabilitySourceConfig, { type: 'zltc' }> = {
  type: 'zltc',
  projectId: 'zltc-prod-c9e6c',
};
const ZLTC: AvailabilityTarget = { venueId: 'zltc-brno', sport: 'tennis', source: SOURCE };
/** 2026-11-26 07:00 Prague: before the first free slot of the recorded days. */
const MORNING = Date.parse('2026-11-26T06:00:00Z');
const DOCS = '/v1/projects/zltc-prod-c9e6c/databases/(default)/documents';

/** The real Firestore: courts, config and the reservations of the queried midnight. */
function firestore(): ReturnType<typeof recordingFetch> {
  return recordingFetch((url, init) => {
    if (url.pathname === `${DOCS}/courts`) return jsonResponse(COURTS);
    if (url.pathname === `${DOCS}/config/reservations`) return jsonResponse(CONFIG);
    if (url.pathname === `${DOCS}:runQuery`) {
      const body = JSON.parse(String(init?.body)) as {
        structuredQuery: { where: { fieldFilter: { value: { timestampValue: string } } } };
      };
      const day = DAYS[body.structuredQuery.where.fieldFilter.value.timestampValue];
      return day ? jsonResponse(day) : jsonResponse([{ readTime: '2026-11-26T16:00:00Z' }]);
    }
    return jsonResponse({ error: { code: 404, status: 'NOT_FOUND' } }, 404);
  });
}

describe('firestoreUrl', () => {
  it('uses the shared Firestore origin and the project id of the source', () => {
    assert.equal(
      firestoreUrl(SOURCE, '/courts').href,
      `${FIRESTORE_API_ORIGIN}/v1/projects/zltc-prod-c9e6c/databases/(default)/documents/courts`,
    );
    assert.equal(firestoreUrl(SOURCE, ':runQuery').pathname, `${DOCS}:runQuery`);
  });
});

describe('ŽLTC connector', () => {
  it('reads courts, config and the day of reservations (3 requests)', async () => {
    const fetchFn = firestore();
    const connector = createZltcConnector({ fetch: fetchFn, now: () => MORNING });
    assert.deepEqual(await connector.getFreeSlots(ZLTC, '2026-11-26'), [
      slot('08:00', '08:30', 2),
      slot('08:30', '09:00', 3),
      slot('11:00', '12:30', 1),
      slot('12:30', '13:00', 2),
      slot('19:30', '20:00', 1),
      slot('20:00', '20:30', 2),
    ]);
    assert.deepEqual(
      fetchFn.calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url.pathname}`),
      [`GET ${DOCS}/courts`, `GET ${DOCS}/config/reservations`, `POST ${DOCS}:runQuery`],
    );
    for (const call of fetchFn.calls) {
      assert.equal(call.url.host, 'firestore.googleapis.com');
      assert.equal(new Headers(call.init?.headers).get('user-agent'), 'SpotRadar/1.0');
      assert.ok(call.init?.signal instanceof AbortSignal);
    }
  });

  it('never asks for names: the query body has the dates + reservations projection only', async () => {
    const fetchFn = firestore();
    const connector = createZltcConnector({ fetch: fetchFn, now: () => MORNING });
    await connector.getFreeSlots(ZLTC, '2026-11-26');
    const post = fetchFn.calls.find((c) => c.init?.method === 'POST');
    assert.equal(new Headers(post?.init?.headers).get('content-type'), 'application/json');
    const raw = String(post?.init?.body);
    const body = JSON.parse(raw) as {
      structuredQuery: { select: { fields: { fieldPath: string }[] }; from: unknown };
    };
    assert.deepEqual(body.structuredQuery.select.fields, [
      { fieldPath: 'dates' },
      { fieldPath: 'reservations' },
    ]);
    assert.deepEqual(body.structuredQuery.from, [{ collectionId: 'reservations' }]);
    assert.doesNotMatch(raw, /customer|creator|name|color|description/);
  });

  it('switches the day with the Prague local midnight timestamp', async () => {
    const fetchFn = firestore();
    const connector = createZltcConnector({ fetch: fetchFn, now: () => MORNING });
    const saturday = await connector.getFreeSlots(ZLTC, '2026-11-28');
    assert.equal(saturday[0]?.start, '08:00');
    assert.equal(saturday.length, 8);
    const bodies = fetchFn.calls
      .filter((c) => c.init?.method === 'POST')
      .map((c) => String(c.init?.body));
    assert.match(bodies[0] ?? '', /"timestampValue":"2026-11-27T23:00:00Z"/);
    // A summer day: midnight is 22:00Z of the day before.
    await connector.getFreeSlots(ZLTC, '2027-04-10');
    const last = fetchFn.calls.at(-1);
    assert.match(String(last?.init?.body), /"timestampValue":"2027-04-09T22:00:00Z"/);
  });

  it('reuses courts and config for an hour, then loads them again', async () => {
    const fetchFn = firestore();
    let t = MORNING;
    const connector = createZltcConnector({ fetch: fetchFn, now: () => t });
    await connector.getFreeSlots(ZLTC, '2026-11-26');
    await connector.getFreeSlots(ZLTC, '2026-11-28');
    assert.equal(fetchFn.calls.length, 4); // courts + config + 2 queries
    t += META_CACHE_TTL_MS + 1;
    await connector.getFreeSlots(ZLTC, '2026-11-28');
    assert.equal(fetchFn.calls.length, 7);
  });

  it('drops half hours that already started today', async () => {
    const connector = createZltcConnector({
      fetch: firestore(),
      now: () => Date.parse('2026-11-26T10:40:00Z'), // 11:40 Prague
    });
    assert.deepEqual(await connector.getFreeSlots(ZLTC, '2026-11-26'), [
      slot('12:00', '12:30', 1),
      slot('12:30', '13:00', 2),
      slot('19:30', '20:00', 1),
      slot('20:00', '20:30', 2),
    ]);
  });

  it('has no free slots, and asks no reservations, after the last allowed date or when disabled', async () => {
    const fetchFn = firestore();
    const connector = createZltcConnector({ fetch: fetchFn, now: () => MORNING });
    assert.deepEqual(await connector.getFreeSlots(ZLTC, '2027-04-12'), []);
    assert.equal(fetchFn.calls.filter((c) => c.init?.method === 'POST').length, 0);

    const off = structuredClone(CONFIG) as { fields: Record<string, unknown> };
    off.fields.reservations_enabled = { booleanValue: false };
    const disabled = createZltcConnector({
      fetch: recordingFetch((url) => jsonResponse(url.pathname.endsWith('/courts') ? COURTS : off)),
      now: () => MORNING,
    });
    assert.deepEqual(await disabled.getFreeSlots(ZLTC, '2026-11-27'), []);
  });

  it('rejects HTTP errors, also a locked-down Firestore (403)', async () => {
    const down = createZltcConnector({
      fetch: () => Promise.resolve(new Response('busy', { status: 503 })),
      now: () => MORNING,
    });
    await assert.rejects(down.getFreeSlots(ZLTC, '2026-11-26'), /HTTP 503/);
    const locked = createZltcConnector({
      fetch: () =>
        Promise.resolve(jsonResponse({ error: { code: 403, status: 'PERMISSION_DENIED' } }, 403)),
      now: () => MORNING,
    });
    await assert.rejects(locked.getFreeSlots(ZLTC, '2026-11-26'), /HTTP 403/);
  });

  it('rejects a Firestore error object that comes with HTTP 200', async () => {
    const connector = createZltcConnector({
      fetch: () =>
        Promise.resolve(jsonResponse([{ error: { code: 7, status: 'PERMISSION_DENIED' } }])),
      now: () => MORNING,
    });
    // Courts and config are not valid either, so the first parser rejects.
    await assert.rejects(connector.getFreeSlots(ZLTC, '2026-11-26'), ZltcParseError);
    const queryDenied = createZltcConnector({
      fetch: recordingFetch((url) =>
        url.pathname.endsWith('/courts')
          ? jsonResponse(COURTS)
          : url.pathname.endsWith('/reservations')
            ? jsonResponse(CONFIG)
            : jsonResponse([{ error: { code: 7, status: 'PERMISSION_DENIED' } }]),
      ),
      now: () => MORNING,
    });
    await assert.rejects(queryDenied.getFreeSlots(ZLTC, '2026-11-26'), ZltcApiError);
  });

  it('times out slow answers', async () => {
    const connector = createZltcConnector({
      timeoutMs: 10,
      now: () => MORNING,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(connector.getFreeSlots(ZLTC, '2026-11-26'), UpstreamTimeoutError);
  });

  it('rejects a changed structure and non-JSON answers', async () => {
    const changed = createZltcConnector({
      fetch: () =>
        Promise.resolve(jsonResponse({ documents: [{ name: 'x/courts/a', fields: {} }] })),
      now: () => MORNING,
    });
    await assert.rejects(changed.getFreeSlots(ZLTC, '2026-11-26'), ZltcParseError);
    const html = createZltcConnector({
      fetch: () => Promise.resolve(new Response('<html></html>', { status: 200 })),
      now: () => MORNING,
    });
    await assert.rejects(html.getFreeSlots(ZLTC, '2026-11-26'), ZltcParseError);
  });

  it('rejects other source types and unsafe project ids', async () => {
    const fetchFn = firestore();
    const connector = createZltcConnector({ fetch: fetchFn, now: () => MORNING });
    await assert.rejects(
      connector.getFreeSlots({ ...ZLTC, source: { type: 'none' } }, '2026-11-26'),
      /zltc-brno\/tennis is not a ŽLTC source/,
    );
    await assert.rejects(
      connector.getFreeSlots(
        { ...ZLTC, source: { type: 'zltc', projectId: '../evil?x=' } },
        '2026-11-26',
      ),
      /invalid Firestore project id/,
    );
    assert.equal(fetchFn.calls.length, 0);
  });
});

describe('ŽLTC stub', () => {
  const TODAY = '2026-12-02';
  const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

  it('answers the courts, the config (booking open for a year) and 404 otherwise', async () => {
    const courts = serveZltcStub(firestoreUrl(SOURCE, '/courts?pageSize=100'), undefined, TODAY);
    assert.equal(((await courts.json()) as { documents: unknown[] }).documents.length, 12);
    const config = serveZltcStub(firestoreUrl(SOURCE, '/config/reservations'), undefined, TODAY);
    const fields = ((await config.json()) as { fields: Record<string, { stringValue?: string }> })
      .fields;
    assert.equal(fields.last_allowed_reservation_date?.stringValue, '2027-12-02');
    assert.equal(serveZltcStub(firestoreUrl(SOURCE, '/other'), undefined, TODAY).status, 404);
  });

  it('refuses a query without a select projection', () => {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'reservations' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'dates' },
            op: 'ARRAY_CONTAINS',
            value: { timestampValue: '2026-12-01T23:00:00Z' },
          },
        },
      },
    };
    assert.equal(serveZltcStub(firestoreUrl(SOURCE, ':runQuery'), post(body), TODAY).status, 400);
    assert.equal(serveZltcStub(firestoreUrl(SOURCE, ':runQuery'), post('x'), TODAY).status, 400);
  });

  it('gives the real connector free courts on today and tomorrow', async () => {
    const connector = createZltcConnector({
      fetch: (input, init) => Promise.resolve(serveZltcStub(new URL(input), init, TODAY)),
      now: () => Date.parse('2026-12-02T08:00:00Z'), // 09:00 Prague
    });
    for (const date of ['2026-12-02', '2026-12-03', '2026-12-09']) {
      const slots = await connector.getFreeSlots(ZLTC, date);
      assert.ok(slots.length > 0, `${date} has free slots`);
    }
    // 09:00 today: the 08:00 slots are past, the noon and evening ones remain.
    assert.equal((await connector.getFreeSlots(ZLTC, '2026-12-02'))[0]?.start, '11:00');
    assert.equal((await connector.getFreeSlots(ZLTC, '2026-12-03'))[0]?.start, '08:00');
  });
});
