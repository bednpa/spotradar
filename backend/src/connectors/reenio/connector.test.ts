import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AvailabilitySourceConfig } from '@spotradar/shared';
import { jsonResponse, recordingFetch, slot } from '../../testHelpers.ts';
import { UpstreamTimeoutError } from '../timeout.ts';
import type { AvailabilityTarget } from '../types.ts';
import { buildReenioUrl, createReenioConnector } from './connector.ts';
import { ReenioParseError } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const SOURCE: Extract<AvailabilitySourceConfig, { type: 'reenio' }> = {
  type: 'reenio',
  baseUrl: 'https://tjteslabrno.reenio.cz/cs',
  resourceId: 51584,
};
const HALL: AvailabilityTarget = { venueId: 'tj-tesla-brno', sport: 'volleyball', source: SOURCE };
const NOW = () => Date.parse('2026-11-20T00:00:00Z');

const DAYS: Record<string, string> = {
  '2026-11-26': fixture('hala-51584-2026-11-26.json'),
  '2026-11-27': fixture('hala-51584-2026-11-27.json'),
  '2026-11-28': fixture('hala-51584-2026-11-28.json'),
};

function site(): ReturnType<typeof recordingFetch> {
  return recordingFetch((_url, init) => {
    const date = (init?.body as FormData).get('date');
    const body = typeof date === 'string' ? DAYS[date] : undefined;
    return new Response(body ?? '{"status":"OK","data":{"events":[]}}', { status: 200 });
  });
}

describe('buildReenioUrl', () => {
  it('appends /api/Term/List to the base URL', () => {
    assert.equal(buildReenioUrl(SOURCE).href, 'https://tjteslabrno.reenio.cz/cs/api/Term/List');
    assert.equal(
      buildReenioUrl({ ...SOURCE, baseUrl: `${SOURCE.baseUrl}/` }).href,
      'https://tjteslabrno.reenio.cz/cs/api/Term/List',
    );
  });
});

describe('Reenio connector', () => {
  it('posts date and resource id as multipart form data and parses the day', async () => {
    const fetchFn = site();
    const connector = createReenioConnector({ fetch: fetchFn, now: NOW });
    assert.equal(connector.type, 'reenio');
    assert.deepEqual(await connector.getFreeSlots(HALL, '2026-11-27'), [
      slot('06:00', '07:45', 1),
      slot('09:30', '11:00', 1),
      slot('21:30', '22:30', 1),
    ]);
    assert.equal(fetchFn.calls.length, 1);
    const call = fetchFn.calls[0];
    assert.equal(call?.url.href, 'https://tjteslabrno.reenio.cz/cs/api/Term/List');
    assert.equal(call?.init?.method, 'POST');
    assert.deepEqual(call?.init?.headers, {
      'user-agent': 'SpotRadar/1.0',
      accept: 'application/json',
    });
    assert.ok(call?.init?.signal instanceof AbortSignal);
    const form = call?.init?.body as FormData;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('date'), '2026-11-27');
    assert.equal(form.get('filter.pseudoTerm.resourceIds[0]'), '51584');
  });

  it('sends the new date on a date switch', async () => {
    const fetchFn = site();
    const connector = createReenioConnector({ fetch: fetchFn, now: NOW });
    await connector.getFreeSlots(HALL, '2026-11-27');
    assert.deepEqual(await connector.getFreeSlots(HALL, '2026-11-28'), [
      slot('07:00', '08:00', 1),
      slot('12:00', '17:00', 1),
      slot('18:00', '21:00', 1),
    ]);
    assert.equal((fetchFn.calls[1]?.init?.body as FormData).get('date'), '2026-11-28');
  });

  it('applies the booking lead time relative to now', async () => {
    const connector = createReenioConnector({
      fetch: site(),
      now: () => Date.parse('2026-11-26T08:30:00Z'),
    });
    assert.deepEqual(await connector.getFreeSlots(HALL, '2026-11-26'), []);
  });

  it('rejects HTTP errors, a wrong source type and a timeout', async () => {
    const down = createReenioConnector({
      fetch: () => Promise.resolve(new Response('busy', { status: 503 })),
    });
    await assert.rejects(down.getFreeSlots(HALL, '2026-11-27'), /HTTP 503/);

    const connector = createReenioConnector({ fetch: site(), now: NOW });
    await assert.rejects(
      connector.getFreeSlots({ ...HALL, source: { type: 'none' } }, '2026-11-27'),
      /tj-tesla-brno\/volleyball is not a Reenio source/,
    );

    const slow = createReenioConnector({
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(slow.getFreeSlots(HALL, '2026-11-27'), UpstreamTimeoutError);
  });

  it('rejects changed structure and an ignored resource filter', async () => {
    const changed = createReenioConnector({
      fetch: () => Promise.resolve(jsonResponse({ status: 'OK', data: { events: 'none' } })),
      now: NOW,
    });
    await assert.rejects(changed.getFreeSlots(HALL, '2026-11-27'), ReenioParseError);

    const otherResource = createReenioConnector({ fetch: site(), now: NOW });
    await assert.rejects(
      otherResource.getFreeSlots({ ...HALL, source: { ...SOURCE, resourceId: 1 } }, '2026-11-27'),
      ReenioParseError,
    );
  });
});
