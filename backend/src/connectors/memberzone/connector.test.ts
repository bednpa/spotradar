import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { VENUE_RECORDS } from '../../data/venues.ts';
import type { SportId } from '@spotradar/shared';
import { fakeClock, htmlResponse, recordingFetch, slot, targetOf } from '../../testHelpers.ts';
import type { AvailabilityTarget } from '../types.ts';
import { createHostLimiter } from '../hostLimiter.ts';
import { createMemberzoneConnector, WEEK_CACHE_TTL_MS } from './connector.ts';
import { MemberzoneParseError } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const TODAY_GET = fixture('sprint-2026-11-25.html');
const SWITCHED_24_12 = fixture('sprint-2026-12-24-post.html');

/** A real venue's offering (badminton by default) as a connector target. */
function venue(id: string, sport: SportId = 'badminton'): AvailabilityTarget {
  const found = VENUE_RECORDS.find((v) => v.id === id);
  if (!found) throw new Error(`unknown venue ${id}`);
  return targetOf(found, sport);
}

const SPRINT = venue('hala-sprint');
const BOOKING_PAGE =
  'https://memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3&NAZEV=Badminton%20hala';
const POST_URL =
  'https://memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3&NAZEV=Badminton+hala';

function page(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: [
      ['content-type', 'text/html'],
      ['set-cookie', 'ASP.NET_SessionId=sess1; path=/; HttpOnly'],
    ],
  });
}

/** The real site: plain GET = week starting today, POST = the week of `myDate` (only 24.12. recorded). */
function sprintSite(): ReturnType<typeof recordingFetch> {
  return recordingFetch((_url, init) => {
    if (init?.method !== 'POST') return page(TODAY_GET);
    const myDate = new URLSearchParams(String(init.body)).get('myDate');
    return myDate === '2026-12-24'
      ? page(SWITCHED_24_12)
      : page('<html>unexpected postback</html>');
  });
}

function postBody(call: { init?: RequestInit } | undefined): URLSearchParams {
  return new URLSearchParams(String(call?.init?.body));
}

describe('MemberZone connector', () => {
  it('today: one GET with User-Agent and a timeout signal, no postback needed', async () => {
    const fetchFn = sprintSite();
    const connector = createMemberzoneConnector({ fetch: fetchFn });
    const slots = await connector.getFreeSlots(SPRINT, '2026-11-25');
    assert.deepEqual(slots, [slot('21:00', '22:00', 2)]);
    assert.equal(fetchFn.calls.length, 1);
    const call = fetchFn.calls[0];
    assert.equal(call?.url.href, BOOKING_PAGE);
    assert.deepEqual(call?.init?.headers, { 'user-agent': 'SpotRadar/1.0' });
    assert.ok(call?.init?.signal instanceof AbortSignal);
  });

  it('another week: GET, then a date-switch POST of the form with the session cookie', async () => {
    const fetchFn = sprintSite();
    const connector = createMemberzoneConnector({ fetch: fetchFn });
    const slots = await connector.getFreeSlots(SPRINT, '2026-12-24');
    assert.deepEqual(slots, [
      slot('07:00', '08:00', 6),
      slot('08:00', '09:00', 5),
      slot('09:00', '12:00', 6),
    ]);

    assert.equal(fetchFn.calls.length, 2);
    const post = fetchFn.calls[1];
    assert.equal(post?.url.href, POST_URL);
    assert.equal(post?.init?.method, 'POST');
    assert.equal(post?.init?.redirect, 'manual');
    assert.deepEqual(post?.init?.headers, {
      'user-agent': 'SpotRadar/1.0',
      cookie: 'ASP.NET_SessionId=sess1',
      'content-type': 'application/x-www-form-urlencoded',
    });
    assert.ok(post?.init?.signal instanceof AbortSignal);
    const body = postBody(post);
    assert.equal(body.get('__EVENTTARGET'), 'btnHidePom');
    assert.equal(body.get('__EVENTARGUMENT'), '');
    assert.equal(body.get('myDate'), '2026-12-24');
    assert.equal(body.get('DropDownDelka'), '60');
    assert.equal(body.get('__VIEWSTATEGENERATOR'), '84305767');
    assert.ok((body.get('__VIEWSTATE') ?? '').length > 20);
  });

  it('a closed day inside a switched week is [] (not an error)', async () => {
    const fetchFn = sprintSite();
    const connector = createMemberzoneConnector({ fetch: fetchFn });
    await connector.getFreeSlots(SPRINT, '2026-12-24');
    assert.deepEqual(await connector.getFreeSlots(SPRINT, '2026-12-25'), []);
    assert.deepEqual(await connector.getFreeSlots(SPRINT, '2026-12-26'), []);
    assert.equal(fetchFn.calls.length, 2);
  });

  it('serves the other 6 days of a loaded week from the cache without new requests', async () => {
    const fetchFn = sprintSite();
    const connector = createMemberzoneConnector({ fetch: fetchFn });
    await connector.getFreeSlots(SPRINT, '2026-11-25');
    for (const date of ['2026-11-26', '2026-11-27', '2026-11-28', '2026-12-01']) {
      const slots = await connector.getFreeSlots(SPRINT, date);
      assert.ok(slots.length > 0, date);
    }
    assert.equal(fetchFn.calls.length, 1);

    await connector.getFreeSlots(SPRINT, '2026-12-24'); // GET + POST for the next week
    await connector.getFreeSlots(SPRINT, '2026-12-27');
    assert.equal(fetchFn.calls.length, 3);
  });

  it('a calendar burst of 7 dates needs one request and never runs two at once', async () => {
    let active = 0;
    let maxActive = 0;
    const inner = sprintSite();
    const fetchFn = recordingFetch(async (url, init) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return inner(url, init);
    });
    const connector = createMemberzoneConnector({ fetch: fetchFn });
    const dates = [
      '2026-11-25',
      '2026-11-26',
      '2026-11-27',
      '2026-11-28',
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
    ];
    const results = await Promise.all(dates.map((d) => connector.getFreeSlots(SPRINT, d)));
    assert.equal(results.length, 7);
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(maxActive, 1);
  });

  it('cached days expire after the TTL and are then read again', async () => {
    const clock = fakeClock();
    const fetchFn = sprintSite();
    const connector = createMemberzoneConnector({
      fetch: fetchFn,
      now: () => clock.now().getTime(),
    });
    await connector.getFreeSlots(SPRINT, '2026-11-26');
    clock.advance(WEEK_CACHE_TTL_MS - 1);
    await connector.getFreeSlots(SPRINT, '2026-11-27');
    assert.equal(fetchFn.calls.length, 1);
    clock.advance(1);
    await connector.getFreeSlots(SPRINT, '2026-11-27');
    assert.equal(fetchFn.calls.length, 2);
  });

  it('returns copies, so callers cannot corrupt the cache', async () => {
    const connector = createMemberzoneConnector({ fetch: sprintSite() });
    const first = await connector.getFreeSlots(SPRINT, '2026-11-25');
    first[0] = slot('00:00', '01:00', 99);
    assert.deepEqual(await connector.getFreeSlots(SPRINT, '2026-11-25'), [
      slot('21:00', '22:00', 2),
    ]);
  });

  it('rejects on a non-2xx response (GET and POST) and does not cache the failure', async () => {
    const get503 = createMemberzoneConnector({ fetch: recordingFetch(() => page('nope', 503)) });
    await assert.rejects(get503.getFreeSlots(SPRINT, '2026-11-25'), /HTTP 503/);

    const post500 = createMemberzoneConnector({
      fetch: recordingFetch((_url, init) =>
        init?.method === 'POST' ? page('err', 500) : page(TODAY_GET),
      ),
    });
    await assert.rejects(post500.getFreeSlots(SPRINT, '2026-12-24'), /HTTP 500/);

    let fail = true;
    const flaky = createMemberzoneConnector({
      fetch: recordingFetch(() => (fail ? page('nope', 503) : page(TODAY_GET))),
    });
    await assert.rejects(flaky.getFreeSlots(SPRINT, '2026-11-25'));
    fail = false;
    assert.deepEqual(await flaky.getFreeSlots(SPRINT, '2026-11-25'), [slot('21:00', '22:00', 2)]);
  });

  it('rejects when a request times out', async () => {
    const hanging = recordingFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const connector = createMemberzoneConnector({ fetch: hanging, timeoutMs: 20 });
    await assert.rejects(connector.getFreeSlots(SPRINT, '2026-11-25'), /aborted/);
  });

  it('rejects on changed markup', async () => {
    const maintenance = createMemberzoneConnector({
      fetch: recordingFetch(() => htmlResponse('<html>maintenance</html>')),
    });
    await assert.rejects(maintenance.getFreeSlots(SPRINT, '2026-11-25'), MemberzoneParseError);

    const renamed = createMemberzoneConnector({
      fetch: recordingFetch(() =>
        page(TODAY_GET.replaceAll('data-identifi="KurtyID"', 'data-identifi="X"')),
      ),
    });
    await assert.rejects(renamed.getFreeSlots(SPRINT, '2026-11-25'), MemberzoneParseError);
  });

  it('never returns another day when the postback did not switch the week', async () => {
    // The server answers the postback with the unchanged "this week" page.
    const fetchFn = recordingFetch(() => page(TODAY_GET));
    const connector = createMemberzoneConnector({ fetch: fetchFn });
    await assert.rejects(connector.getFreeSlots(SPRINT, '2026-12-24'), /not shown/);
    assert.equal(fetchFn.calls.length, 2);
  });

  it('refuses to post the form to another host', async () => {
    const evil = TODAY_GET.replace(
      'action="./Sportoviste.aspx?ID_Sportoviste=3&amp;NAZEV=Badminton+hala"',
      'action="https://evil.example/post"',
    );
    assert.notEqual(evil, TODAY_GET);
    const fetchFn = recordingFetch(() => page(evil));
    const connector = createMemberzoneConnector({ fetch: fetchFn });
    await assert.rejects(connector.getFreeSlots(SPRINT, '2026-12-24'), /unexpected host/);
    assert.equal(fetchFn.calls.length, 1);
  });

  it('rejects for a venue that is not a MemberZone venue', async () => {
    const connector = createMemberzoneConnector({ fetch: recordingFetch(() => page('')) });
    await assert.rejects(
      connector.getFreeSlots(venue('kuklenska'), '2026-11-25'),
      /not a MemberZone/,
    );
  });

  it('uses the shared host limiter', async () => {
    const limiter = createHostLimiter();
    const hosts: string[] = [];
    const wrapped = {
      run: <T>(host: string, task: () => Promise<T>): Promise<T> => {
        hosts.push(host);
        return limiter.run(host, task);
      },
    };
    const connector = createMemberzoneConnector({ fetch: sprintSite(), limiter: wrapped });
    await connector.getFreeSlots(SPRINT, '2026-12-24');
    assert.deepEqual(hosts, ['memberzone.cz']); // GET + POST are one limiter task
  });
});
