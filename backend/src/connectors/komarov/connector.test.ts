import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AvailabilitySourceConfig } from '@spotradar/shared';
import { htmlResponse, recordingFetch, slot } from '../../testHelpers.ts';
import { UpstreamTimeoutError } from '../timeout.ts';
import type { AvailabilityTarget } from '../types.ts';
import { WEEK_CACHE_TTL_MS, buildKomarovUrl, createKomarovConnector } from './connector.ts';
import { KomarovParseError, parseKomarovWeek } from './parser.ts';
import { komarovWeekStartingAt, serveKomarovStub } from './stub.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const WEEK_0 = fixture('rozvrh-0-2026-11-26.html');
const WEEK_1 = fixture('rozvrh-1-2026-11-26.html');
const SOURCE: Extract<AvailabilitySourceConfig, { type: 'komarov' }> = {
  type: 'komarov',
  url: 'https://www.tenis-komarov.cz/rozvrh/',
};
const KOMAROV: AvailabilityTarget = { venueId: 'komarov', sport: 'tennis', source: SOURCE };
/** 2026-11-26 12:00 Prague (the recording day, before the evening gaps). */
const NOON = Date.parse('2026-11-26T11:00:00Z');

/** The real site: /rozvrh/0/ and /rozvrh/1/ recorded, a redirect without the trailing slash. */
function site(): ReturnType<typeof recordingFetch> {
  return recordingFetch((url) => {
    if (url.pathname === '/rozvrh/0/') return htmlResponse(WEEK_0);
    if (url.pathname === '/rozvrh/1/') return htmlResponse(WEEK_1);
    return new Response('', { status: 301, headers: { location: `${url.pathname}/` } });
  });
}

describe('buildKomarovUrl', () => {
  it('appends the week offset and a trailing slash', () => {
    assert.equal(buildKomarovUrl(SOURCE, 0).href, 'https://www.tenis-komarov.cz/rozvrh/0/');
    assert.equal(
      buildKomarovUrl({ ...SOURCE, url: 'https://www.tenis-komarov.cz/rozvrh' }, 2).href,
      'https://www.tenis-komarov.cz/rozvrh/2/',
    );
  });
});

describe('Komárov connector', () => {
  it('reads a day of the current week with one GET', async () => {
    const fetchFn = site();
    const connector = createKomarovConnector({ fetch: fetchFn, now: () => NOON });
    assert.deepEqual(await connector.getFreeSlots(KOMAROV, '2026-11-26'), [
      slot('17:00', '18:30', 1),
      slot('21:30', '22:00', 1),
      slot('22:00', '23:00', 3),
    ]);
    assert.equal(fetchFn.calls.length, 1);
    const call = fetchFn.calls[0];
    assert.equal(call?.url.href, 'https://www.tenis-komarov.cz/rozvrh/0/');
    assert.equal(new Headers(call?.init?.headers).get('user-agent'), 'SpotRadar/1.0');
    assert.ok(call?.init?.signal instanceof AbortSignal);
  });

  it('drops half-hours that already started today', async () => {
    const connector = createKomarovConnector({
      fetch: site(),
      now: () => Date.parse('2026-11-26T16:20:00Z'), // 17:20 Prague
    });
    assert.deepEqual((await connector.getFreeSlots(KOMAROV, '2026-11-26')).slice(0, 1), [
      slot('17:30', '18:30', 1),
    ]);
  });

  it('switches the week offset for a later date', async () => {
    const fetchFn = site();
    const connector = createKomarovConnector({ fetch: fetchFn, now: () => NOON });
    assert.deepEqual(await connector.getFreeSlots(KOMAROV, '2026-11-30'), [
      slot('07:00', '09:00', 2),
      slot('09:00', '14:00', 1),
      slot('20:30', '21:30', 1),
      slot('21:30', '22:00', 2),
      slot('22:00', '23:00', 3),
    ]);
    assert.equal(fetchFn.calls[0]?.url.pathname, '/rozvrh/1/');
  });

  it('serves the other days of a loaded week from the cache until it expires', async () => {
    const fetchFn = site();
    let t = NOON;
    const connector = createKomarovConnector({ fetch: fetchFn, now: () => t });
    await connector.getFreeSlots(KOMAROV, '2026-11-26');
    await connector.getFreeSlots(KOMAROV, '2026-11-28');
    await connector.getFreeSlots(KOMAROV, '2026-11-27');
    assert.equal(fetchFn.calls.length, 1);
    await connector.getFreeSlots(KOMAROV, '2026-11-30');
    assert.equal(fetchFn.calls.length, 2);
    t += WEEK_CACHE_TTL_MS + 1;
    await connector.getFreeSlots(KOMAROV, '2026-11-28');
    assert.equal(fetchFn.calls.length, 3);
  });

  it('computes the week offset from Prague local today, not from UTC', async () => {
    // Sunday 29.11. 23:30 UTC is already Monday 30.11. in Prague: that is the current week.
    const fetchFn = recordingFetch(() => htmlResponse(komarovWeekStartingAt(WEEK_0, '2026-11-30')));
    const connector = createKomarovConnector({
      fetch: fetchFn,
      now: () => Date.parse('2026-11-29T23:30:00Z'),
    });
    await connector.getFreeSlots(KOMAROV, '2026-11-30');
    assert.equal(fetchFn.calls[0]?.url.pathname, '/rozvrh/0/');
  });

  it('rejects dates before the current week without a request', async () => {
    const fetchFn = site();
    const connector = createKomarovConnector({ fetch: fetchFn, now: () => NOON });
    await assert.rejects(connector.getFreeSlots(KOMAROV, '2026-11-20'), /before the current one/);
    assert.equal(fetchFn.calls.length, 0);
  });

  it('rejects HTTP errors and a page that does not show the date', async () => {
    const down = createKomarovConnector({
      fetch: () => Promise.resolve(new Response('busy', { status: 503 })),
      now: () => NOON,
    });
    await assert.rejects(down.getFreeSlots(KOMAROV, '2026-11-26'), /HTTP 503/);

    // The site clamps unknown weeks to the current one: its headings do not match the date.
    const clamped = createKomarovConnector({
      fetch: () => Promise.resolve(htmlResponse(WEEK_0)),
      now: () => NOON,
    });
    await assert.rejects(clamped.getFreeSlots(KOMAROV, '2026-12-08'), KomarovParseError);
  });

  it('times out slow answers', async () => {
    const connector = createKomarovConnector({
      timeoutMs: 10,
      now: () => NOON,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(connector.getFreeSlots(KOMAROV, '2026-11-26'), UpstreamTimeoutError);
  });

  it('rejects changed markup instead of returning partial data', async () => {
    const connector = createKomarovConnector({
      fetch: () => Promise.resolve(htmlResponse('<html><body>Nová stránka</body></html>')),
      now: () => NOON,
    });
    await assert.rejects(connector.getFreeSlots(KOMAROV, '2026-11-26'), KomarovParseError);
  });

  it('rejects other source types', async () => {
    const connector = createKomarovConnector({ fetch: site(), now: () => NOON });
    await assert.rejects(
      connector.getFreeSlots({ ...KOMAROV, source: { type: 'none' } }, '2026-11-26'),
      /komarov\/tennis is not a Komárov source/,
    );
  });
});

describe('Komárov stub', () => {
  const TODAY = '2026-12-02'; // a Wednesday: the week of Mon 30.11.

  it('shows the recorded week shifted to the week of the requested offset', () => {
    const shifted = komarovWeekStartingAt(WEEK_0, '2026-11-30');
    assert.deepEqual(
      [...parseKomarovWeek(shifted).keys()],
      [
        '2026-11-30',
        '2026-12-01',
        '2026-12-02',
        '2026-12-03',
        '2026-12-04',
        '2026-12-05',
        '2026-12-06',
      ],
    );
  });

  it('serves /rozvrh/N/ relative to today and 404 for other paths', async () => {
    const week0 = serveKomarovStub(
      new URL('https://www.tenis-komarov.cz/rozvrh/0/'),
      undefined,
      TODAY,
    );
    assert.equal(week0.status, 200);
    assert.equal(parseKomarovWeek(await week0.text()).has('2026-12-02'), true);
    const week1 = serveKomarovStub(
      new URL('https://www.tenis-komarov.cz/rozvrh/1/'),
      undefined,
      TODAY,
    );
    assert.equal(parseKomarovWeek(await week1.text()).has('2026-12-07'), true);
    const clamped = serveKomarovStub(
      new URL('https://www.tenis-komarov.cz/rozvrh/-1/'),
      undefined,
      TODAY,
    );
    assert.equal(parseKomarovWeek(await clamped.text()).has('2026-11-30'), true);
    assert.equal(
      serveKomarovStub(new URL('https://www.tenis-komarov.cz/'), undefined, TODAY).status,
      404,
    );
  });

  it('gives the real connector free courts on today and tomorrow', async () => {
    const connector = createKomarovConnector({
      fetch: (input, init) => Promise.resolve(serveKomarovStub(new URL(input), init, TODAY)),
      now: () => Date.parse('2026-12-02T08:00:00Z'), // 09:00 Prague
    });
    for (const date of ['2026-12-02', '2026-12-03', '2026-12-07']) {
      const slots = await connector.getFreeSlots(KOMAROV, date);
      assert.ok(slots.length > 0, `${date} has free slots`);
    }
  });
});
