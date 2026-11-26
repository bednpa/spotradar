import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AvailabilitySourceConfig } from '@spotradar/shared';
import { recordingFetch, slot } from '../../testHelpers.ts';
import { UpstreamTimeoutError } from '../timeout.ts';
import type { AvailabilityTarget } from '../types.ts';
import {
  PADELOS_HOST,
  PADELOS_SEARCH_URL,
  buildPadelosBody,
  createPadelosConnector,
} from './connector.ts';
import { PadelosParseError } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const BY_DATE: Record<string, string> = {
  '2026-11-26': fixture('slatina-2026-11-26.json'),
  '2026-11-28': fixture('slatina-2026-11-28.json'),
};
const SOURCE: Extract<AvailabilitySourceConfig, { type: 'padelos' }> = {
  type: 'padelos',
  clubId: '216930',
};
const SLATINA: AvailabilityTarget = {
  venueId: 'padel-powers-slatina',
  sport: 'padel',
  source: SOURCE,
};

function bodyOf(init?: RequestInit): { date?: string; sport?: string } {
  return JSON.parse(String(init?.body)) as { date?: string; sport?: string };
}

/** The real API: the answer depends on the date of the POST body. */
function padelosSite(): ReturnType<typeof recordingFetch> {
  return recordingFetch((_url, init) => {
    const date = bodyOf(init).date ?? '';
    return new Response(
      BY_DATE[date] ?? '{"success":true,"data":[{"id":"216930","availability":[]}]}',
      {
        status: 200,
      },
    );
  });
}

describe('buildPadelosBody', () => {
  it('is the padel search of one date with all filters empty', () => {
    assert.deepEqual(JSON.parse(buildPadelosBody('2026-11-26')), {
      date: '2026-11-26',
      sport: 'padel',
      courtType: '',
      courtSize: '',
      courtTurf: '',
      courtFeature: '',
      searchTerm: '',
      limit: '',
      offset: '',
      type: '',
    });
    assert.equal(PADELOS_HOST, 'api.padelos.co');
  });
});

describe('PadelOS connector', () => {
  it('reads a day with one POST carrying the club header', async () => {
    const fetchFn = padelosSite();
    const connector = createPadelosConnector({ fetch: fetchFn });
    assert.equal(connector.type, 'padelos');
    assert.deepEqual(await connector.getFreeSlots(SLATINA, '2026-11-26'), [
      slot('21:00', '21:30', 2),
      slot('21:30', '22:00', 7),
      slot('22:00', '23:00', 10),
    ]);
    assert.equal(fetchFn.calls.length, 1);
    const call = fetchFn.calls[0];
    assert.equal(call?.url.href, PADELOS_SEARCH_URL);
    assert.equal(call?.init?.method, 'POST');
    assert.deepEqual(
      { ...(call?.init?.headers as Record<string, string>) },
      {
        'content-type': 'application/json',
        'x-clubos-club': '216930',
        'user-agent': 'SpotRadar/1.0',
      },
    );
    assert.equal(call?.init?.body, buildPadelosBody('2026-11-26'));
    assert.ok(call?.init?.signal instanceof AbortSignal);
  });

  it('switches the date through the request body', async () => {
    const fetchFn = padelosSite();
    const connector = createPadelosConnector({ fetch: fetchFn });
    const saturday = await connector.getFreeSlots(SLATINA, '2026-11-28');
    assert.ok(saturday.length > 0);
    assert.deepEqual(await connector.getFreeSlots(SLATINA, '2026-11-29'), []);
    assert.deepEqual(
      fetchFn.calls.map((c) => bodyOf(c.init).date),
      ['2026-11-28', '2026-11-29'],
    );
  });

  it('runs requests of the shared host through the limiter', async () => {
    const hosts: string[] = [];
    const connector = createPadelosConnector({
      fetch: padelosSite(),
      limiter: {
        run: (host, task) => {
          hosts.push(host);
          return task();
        },
      },
    });
    await connector.getFreeSlots(SLATINA, '2026-11-26');
    assert.deepEqual(hosts, ['api.padelos.co']);
  });

  it('rejects HTTP errors', async () => {
    const connector = createPadelosConnector({
      fetch: () => Promise.resolve(new Response('{"success":false}', { status: 400 })),
    });
    await assert.rejects(connector.getFreeSlots(SLATINA, '2026-11-26'), /HTTP 400/);
  });

  it('times out slow answers', async () => {
    const connector = createPadelosConnector({
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(connector.getFreeSlots(SLATINA, '2026-11-26'), UpstreamTimeoutError);
  });

  it('rejects a changed answer, another club and another date', async () => {
    const changed = createPadelosConnector({
      fetch: () => Promise.resolve(new Response('{"success":true,"data":[{"id":"216930"}]}')),
    });
    await assert.rejects(changed.getFreeSlots(SLATINA, '2026-11-26'), PadelosParseError);
    const html = createPadelosConnector({
      fetch: () => Promise.resolve(new Response('<html>Maintenance</html>')),
    });
    await assert.rejects(html.getFreeSlots(SLATINA, '2026-11-26'), PadelosParseError);

    const connector = createPadelosConnector({ fetch: padelosSite() });
    await assert.rejects(
      connector.getFreeSlots(
        { ...SLATINA, source: { type: 'padelos', clubId: '1' } },
        '2026-11-26',
      ),
      /not 1/,
    );
    const wrongDate = createPadelosConnector({
      fetch: () => Promise.resolve(new Response(BY_DATE['2026-11-28'])),
    });
    await assert.rejects(wrongDate.getFreeSlots(SLATINA, '2026-11-26'), PadelosParseError);
  });

  it('rejects other source types', async () => {
    const connector = createPadelosConnector({ fetch: padelosSite() });
    await assert.rejects(
      connector.getFreeSlots({ ...SLATINA, source: { type: 'none' } }, '2026-11-26'),
      /padel-powers-slatina\/padel is not a PadelOS source/,
    );
  });
});
