import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AvailabilitySourceConfig } from '@spotradar/shared';
import { fakeClock, recordingFetch, slot } from '../../testHelpers.ts';
import { UpstreamTimeoutError } from '../timeout.ts';
import type { AvailabilityTarget } from '../types.ts';
import { SESSION_REUSE_MS, buildStarezDateUrl, createStarezConnector } from './connector.ts';
import { StarezParseError } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const TODAY_PAGE = fixture('beach-2026-11-25-today.html');
const AJAX: Record<string, string> = {
  '26.11.2026': fixture('beach-2026-11-26-ajax.json'),
  '28.11.2026': fixture('beach-2026-11-28-ajax.json'),
};
const URL_BEACH = 'https://beach.starez.cz/vstupenky-rezervace';
const SOURCE: Extract<AvailabilitySourceConfig, { type: 'starez' }> = {
  type: 'starez',
  url: URL_BEACH,
  facility: 'Beachvolejbal',
};
const BEACH: AvailabilityTarget = {
  venueId: 'beach-riviera',
  sport: 'beach-volleyball',
  source: SOURCE,
};

function answer(body: string, contentType: string): Response {
  return new Response(body, {
    status: 200,
    headers: [
      ['content-type', contentType],
      ['set-cookie', 'PHPSESSID=s1; path=/; HttpOnly'],
    ],
  });
}

/** The real site: GET = today's page + session; XHR with the session cookie = JSON of that day. */
function beachSite(): ReturnType<typeof recordingFetch> {
  return recordingFetch((url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const date = url.searchParams.get('date');
    if (date === null) return answer(TODAY_PAGE, 'text/html');
    const json = AJAX[date];
    if (headers['x-requested-with'] !== 'XMLHttpRequest' || headers.cookie !== 'PHPSESSID=s1') {
      // Without XHR + session the server stores the date and redirects.
      return new Response('<h1>Redirect</h1>', { status: 302, headers: { location: URL_BEACH } });
    }
    return json ? answer(json, 'application/json') : answer('{"snippets":{}}', 'application/json');
  });
}

describe('buildStarezDateUrl', () => {
  it('adds date=DD.MM.YYYY and do=getDate', () => {
    assert.equal(
      buildStarezDateUrl(SOURCE, '2026-11-26').href,
      `${URL_BEACH}?date=26.11.2026&do=getDate`,
    );
  });
});

describe('STAREZ connector', () => {
  it('reads today from the plain page with one GET', async () => {
    const fetchFn = beachSite();
    const connector = createStarezConnector({ fetch: fetchFn });
    assert.deepEqual(await connector.getFreeSlots(BEACH, '2026-11-25'), [
      slot('15:00', '16:00', 2),
      slot('20:00', '21:00', 1),
    ]);
    assert.equal(fetchFn.calls.length, 1);
    const get = fetchFn.calls[0];
    assert.equal(get?.url.href, URL_BEACH);
    assert.deepEqual(get?.init?.headers, { 'user-agent': 'SpotRadar/1.0' });
    assert.ok(get?.init?.signal instanceof AbortSignal);
  });

  it('switches the date with the AJAX request and the session cookie', async () => {
    const fetchFn = beachSite();
    const connector = createStarezConnector({ fetch: fetchFn });
    assert.deepEqual(await connector.getFreeSlots(BEACH, '2026-11-26'), []);
    assert.equal(fetchFn.calls.length, 2); // GET (session) + XHR
    const xhr = fetchFn.calls[1];
    assert.equal(xhr?.url.searchParams.get('date'), '26.11.2026');
    assert.equal(xhr?.url.searchParams.get('do'), 'getDate');
    assert.deepEqual(xhr?.init?.headers, {
      'user-agent': 'SpotRadar/1.0',
      cookie: 'PHPSESSID=s1',
      'x-requested-with': 'XMLHttpRequest',
      accept: 'application/json',
    });
  });

  it('reuses the session for the next date (one request), then starts over after expiry', async () => {
    const fetchFn = beachSite();
    const clock = fakeClock();
    const connector = createStarezConnector({ fetch: fetchFn, now: () => clock.now().getTime() });
    await connector.getFreeSlots(BEACH, '2026-11-26');
    await connector.getFreeSlots(BEACH, '2026-11-28');
    assert.equal(fetchFn.calls.length, 3);
    clock.advance(SESSION_REUSE_MS + 1);
    await connector.getFreeSlots(BEACH, '2026-11-28');
    assert.equal(fetchFn.calls.length, 5); // fresh GET + XHR
  });

  it('falls back to a clean GET when the reused session answers garbage', async () => {
    let broken = false;
    const site = beachSite();
    const fetchFn = recordingFetch((url, init) =>
      broken && url.searchParams.has('date')
        ? answer('{"redirect":"/"}', 'application/json')
        : site(url, init),
    );
    const connector = createStarezConnector({ fetch: fetchFn });
    await connector.getFreeSlots(BEACH, '2026-11-26');
    broken = true;
    await assert.rejects(connector.getFreeSlots(BEACH, '2026-11-28'), StarezParseError);
    // reused XHR failed → GET + XHR again, which also failed: 2 + 3 requests
    assert.equal(fetchFn.calls.length, 5);
  });

  it('rejects HTTP errors, a date the page does not show and other source types', async () => {
    const down = createStarezConnector({
      fetch: () => Promise.resolve(new Response('busy', { status: 503 })),
    });
    await assert.rejects(down.getFreeSlots(BEACH, '2026-11-25'), /HTTP 503/);

    const connector = createStarezConnector({ fetch: beachSite() });
    // No recording for 27.11: the site answers without the snippet.
    await assert.rejects(connector.getFreeSlots(BEACH, '2026-11-27'), StarezParseError);
    await assert.rejects(
      connector.getFreeSlots({ ...BEACH, source: { type: 'none' } }, '2026-11-25'),
      /beach-riviera\/beach-volleyball is not a STAREZ source/,
    );
  });

  it('times out slow answers', async () => {
    const connector = createStarezConnector({
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          // Like the real fetch: reject with the signal's abort reason.
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(connector.getFreeSlots(BEACH, '2026-11-25'), UpstreamTimeoutError);
  });

  it('rejects changed markup instead of returning partial data', async () => {
    const connector = createStarezConnector({
      fetch: () => Promise.resolve(answer('<html><body>Nová stránka</body></html>', 'text/html')),
    });
    await assert.rejects(connector.getFreeSlots(BEACH, '2026-11-25'), StarezParseError);
  });
});
