import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { addDays } from '@spotradar/shared';
import { VENUE_RECORDS } from '../../data/venues.ts';
import { htmlResponse, recordingFetch, targetOf } from '../../testHelpers.ts';
import type { RecordedFetch } from '../../testHelpers.ts';
import type { AvailabilityTarget } from '../types.ts';
import { createBizzyConnector } from './connector.ts';
import { BizzyParseError } from './parser.ts';
import { bizzyPageStartingAt } from './stubPages.ts';

function fx(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** The badminton offering of a real venue as a connector target. */
function venue(id: string): AvailabilityTarget {
  const found = VENUE_RECORDS.find((v) => v.id === id);
  if (!found) throw new Error(id);
  return targetOf(found, 'badminton');
}

const JEHNICE = venue('badminton-jehnice');
const LISEN = venue('badminton-lisen');
const XARENA = venue('x-arena-slatina');

const slot = (start: string, end: string, freeCourts: number) => ({ start, end, freeCourts });

/** GET -> the venue's recorded start page with a session cookie; POSTs answer from `posts` in order. */
function replay(start: string, posts: string[]): RecordedFetch {
  let postIndex = 0;
  return recordingFetch((_url, init) => {
    if (init?.method === 'POST') {
      const html = posts[postIndex++];
      if (html === undefined) return htmlResponse('unexpected POST', 500);
      return htmlResponse(html);
    }
    const res = htmlResponse(start);
    res.headers.append('set-cookie', 'JSESSIONID=abc123; Path=/; HttpOnly');
    return res;
  });
}

function headersOf(call: { init?: RequestInit } | undefined): Record<string, string> {
  return (call?.init?.headers ?? {}) as Record<string, string>;
}

function bodyOf(call: { init?: RequestInit } | undefined): URLSearchParams {
  return new URLSearchParams(String(call?.init?.body ?? ''));
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Bizzy connector: request flow per venue', () => {
  it('Jehnice (default view is 8 days): one GET serves the whole week', async () => {
    const fetchFn = replay(fx('jehnice-2026-11-25-today.html'), []);
    const connector = createBizzyConnector({ fetch: fetchFn });
    assert.equal(connector.type, 'bizzy');

    assert.deepEqual(await connector.getFreeSlots(JEHNICE, '2026-11-26'), [
      slot('17:00', '18:00', 1),
      slot('19:00', '21:00', 1),
    ]);
    assert.deepEqual(await connector.getFreeSlots(JEHNICE, '2026-12-01'), [
      slot('17:00', '18:00', 4),
      slot('18:00', '20:00', 2),
    ]);
    assert.deepEqual(await connector.getFreeSlots(JEHNICE, '2026-11-28'), []);

    assert.equal(fetchFn.calls.length, 1);
    const [get] = fetchFn.calls;
    assert.equal(get?.url.href, JEHNICE.source.type === 'bizzy' ? JEHNICE.source.scheduleUrl : '');
    assert.equal(get?.init?.method, undefined);
    assert.equal(headersOf(get)['user-agent'], 'SpotRadar/1.0');
    assert.equal(headersOf(get).cookie, undefined);
    assert.ok(get?.init?.signal);
  });

  it('Jehnice, a date after the window: a date picker postback moves the window', async () => {
    const fetchFn = replay(fx('jehnice-2026-11-25-today.html'), [
      fx('jehnice-2026-11-25-saturday-ajax.html'),
    ]);
    const connector = createBizzyConnector({ fetch: fetchFn });
    assert.deepEqual(await connector.getFreeSlots(JEHNICE, '2026-12-03'), [
      slot('16:00', '18:00', 3),
    ]);
    // the new window (28/11 - 5/12) is cached as well
    assert.deepEqual(await connector.getFreeSlots(JEHNICE, '2026-12-02'), [
      slot('17:00', '18:00', 2),
      slot('19:00', '20:00', 1),
    ]);
    assert.equal(fetchFn.calls.length, 2);

    const post = fetchFn.calls[1];
    assert.equal(post?.init?.method, 'POST');
    assert.equal(post?.url.host, 'badminton-jehnice.e-rezervace.cz');
    assert.match(post?.url.pathname ?? '', /^\/Branch\/pages\/Schedule\.faces/);
    assert.equal(headersOf(post).cookie, 'JSESSIONID=abc123');
    assert.equal(headersOf(post)['user-agent'], 'SpotRadar/1.0');
    assert.equal(headersOf(post)['content-type'], 'application/x-www-form-urlencoded');
    assert.equal(post?.init?.redirect, 'manual');
    const body = bodyOf(post);
    assert.equal(body.get('AJAXREQUEST'), 'scheduleNavigForm:schedule-navig-region');
    assert.equal(body.get('AJAX:EVENTS_COUNT'), '1');
    assert.equal(body.get('scheduleNavigForm'), 'scheduleNavigForm');
    assert.ok(body.get('javax.faces.ViewState'));
    assert.equal(body.get('scheduleNavigForm:j_id210'), '40001');
    assert.equal(body.get('scheduleNavigForm:view_filter_menu'), 'horizontal_service_dayandweek');
    assert.equal(body.get('scheduleNavigForm:schedule_calendarInputDate'), '3.12.2026');
    assert.equal(body.get('scheduleNavigForm:schedule_calendarInputCurrentDate'), '12/2026');
    assert.equal(body.get('scheduleNavigForm:j_id205'), 'scheduleNavigForm:j_id205');
  });

  it('Líšeň (one-day default): GET + view switch, then 7 consecutive dates need no more requests', async () => {
    const fetchFn = replay(fx('lisen-2026-11-25-today.html'), [
      fx('lisen-2026-11-25-week-ajax.html'),
    ]);
    const connector = createBizzyConnector({ fetch: fetchFn });

    const results = [];
    for (let i = 0; i < 7; i++) {
      results.push(await connector.getFreeSlots(LISEN, addDays('2026-11-25', i)));
    }
    assert.equal(fetchFn.calls.length, 2);
    assert.deepEqual(results[0], [slot('21:00', '22:00', 5)]);
    assert.deepEqual(results[3], [
      slot('08:00', '09:30', 5),
      slot('09:30', '10:00', 6),
      slot('10:00', '11:00', 4),
      slot('11:00', '12:00', 5),
      slot('12:00', '20:00', 6),
    ]);
    assert.ok(results.every((r) => r.length > 0));

    const [get, post] = fetchFn.calls;
    assert.equal(get?.init?.method, undefined);
    assert.equal(post?.init?.method, 'POST');
    assert.equal(headersOf(post).cookie, 'JSESSIONID=abc123');
    const body = bodyOf(post);
    assert.equal(body.get('AJAXREQUEST'), 'scheduleNavigForm:schedule-navig-region');
    assert.equal(body.get('scheduleNavigForm:j_id210'), '41439');
    assert.equal(body.get('scheduleNavigForm:view_filter_menu'), 'horizontal_service_dayandweek');
    // the view switch keeps the session's date
    assert.equal(body.get('scheduleNavigForm:schedule_calendarInputDate'), '25.11.2026');
    assert.equal(body.get('scheduleNavigForm:schedule_calendarInputCurrentDate'), '11/2026');
    assert.equal(body.get('scheduleNavigForm:j_id220'), 'scheduleNavigForm:j_id220');
    assert.equal(body.has('scheduleNavigForm:j_id205'), false);
  });

  it('X-Arena uses its own ids (j_id214 hidden input, j_id224 view menu)', async () => {
    const fetchFn = replay(fx('xarena-2026-11-25-today.html'), [
      fx('xarena-2026-11-25-week-ajax.html'),
    ]);
    const connector = createBizzyConnector({
      fetch: fetchFn,
      now: () => Date.parse('2026-11-20T10:00:00Z'),
    });
    const slots = await connector.getFreeSlots(XARENA, '2026-11-28');
    assert.deepEqual(slots.slice(0, 2), [slot('09:00', '10:00', 4), slot('10:00', '11:00', 3)]);
    const body = bodyOf(fetchFn.calls[1]);
    assert.equal(body.get('scheduleNavigForm:j_id214'), '40106');
    assert.equal(body.get('scheduleNavigForm:j_id224'), 'scheduleNavigForm:j_id224');
    assert.equal(body.has('scheduleNavigForm:j_id209'), false);
  });

  it('Líšeň, a later window: view switch, then a date picker postback with the wanted date', async () => {
    const week = fx('lisen-2026-11-25-week-ajax.html');
    const later = bizzyPageStartingAt(week, week, '2026-12-10');
    const fetchFn = replay(fx('lisen-2026-11-25-today.html'), [week, later]);
    const connector = createBizzyConnector({ fetch: fetchFn });

    const slots = await connector.getFreeSlots(LISEN, '2026-12-12');
    assert.ok(slots.length > 0);
    assert.equal(fetchFn.calls.length, 3);
    const body = bodyOf(fetchFn.calls[2]);
    assert.equal(body.get('scheduleNavigForm:schedule_calendarInputDate'), '12.12.2026');
    assert.equal(body.get('scheduleNavigForm:schedule_calendarInputCurrentDate'), '12/2026');
    assert.equal(body.get('scheduleNavigForm:j_id205'), 'scheduleNavigForm:j_id205');
    assert.equal(body.has('scheduleNavigForm:j_id220'), false);
    assert.equal(headersOf(fetchFn.calls[2]).cookie, 'JSESSIONID=abc123');
    // the whole later window is cached
    await connector.getFreeSlots(LISEN, '2026-12-16');
    assert.equal(fetchFn.calls.length, 3);
  });
});

describe('Bizzy connector: cache and queue', () => {
  it('refetches after the cache lifetime', async () => {
    let t = Date.parse('2026-11-25T10:00:00Z');
    const fetchFn = replay(fx('jehnice-2026-11-25-today.html'), []);
    const connector = createBizzyConnector({
      fetch: fetchFn,
      now: () => t,
      cacheTtlMs: 15 * 60_000,
    });
    await connector.getFreeSlots(JEHNICE, '2026-11-26');
    t += 14 * 60_000;
    await connector.getFreeSlots(JEHNICE, '2026-11-27');
    assert.equal(fetchFn.calls.length, 1);
    t += 2 * 60_000;
    await connector.getFreeSlots(JEHNICE, '2026-11-26');
    assert.equal(fetchFn.calls.length, 2);
  });

  it('concurrent requests for one venue share one GET + POST (cache re-checked after the wait)', async () => {
    const fetchFn = replay(fx('lisen-2026-11-25-today.html'), [
      fx('lisen-2026-11-25-week-ajax.html'),
    ]);
    const connector = createBizzyConnector({ fetch: fetchFn });
    const dates = Array.from({ length: 7 }, (_, i) => addDays('2026-11-25', i));
    const results = await Promise.all(dates.map((d) => connector.getFreeSlots(LISEN, d)));
    assert.equal(results.length, 7);
    assert.equal(fetchFn.calls.length, 2);
  });

  it('returns copies, so callers cannot corrupt the cache', async () => {
    const connector = createBizzyConnector({
      fetch: replay(fx('jehnice-2026-11-25-today.html'), []),
    });
    const first = await connector.getFreeSlots(JEHNICE, '2026-11-26');
    first[0] = slot('00:00', '01:00', 99);
    assert.deepEqual(
      (await connector.getFreeSlots(JEHNICE, '2026-11-26'))[0],
      slot('17:00', '18:00', 1),
    );
  });

  it('rejects targets of another source type', async () => {
    const connector = createBizzyConnector({ fetch: replay('', []) });
    await assert.rejects(
      connector.getFreeSlots(venue('kuklenska'), '2026-11-26'),
      /kuklenska\/badminton is not a Bizzy source/,
    );
  });
});

describe('Bizzy connector: X-Arena 2 hour rule', () => {
  // 2026-11-26 10:30 in Prague (CET, UTC+1)
  const NOW = Date.parse('2026-11-26T09:30:00Z');

  it('hour cells starting earlier than now + 120 min are not free, evaluated at read time', async () => {
    let t = NOW;
    const fetchFn = replay(fx('xarena-2026-11-25-today.html'), [
      fx('xarena-2026-11-25-week-ajax.html'),
    ]);
    const connector = createBizzyConnector({ fetch: fetchFn, now: () => t, cacheTtlMs: DAY_MS });

    // cutoff 12:30: the 13:00 column is the first one that can be booked
    assert.deepEqual(await connector.getFreeSlots(XARENA, '2026-11-26'), [
      slot('13:00', '14:00', 6),
      slot('14:00', '15:00', 5),
      slot('17:00', '19:00', 1),
      slot('19:00', '21:00', 2),
      slot('21:00', '22:00', 5),
    ]);
    // one hour later, same cached page, the cutoff moved to 13:30
    t += 60 * 60_000;
    assert.deepEqual(
      (await connector.getFreeSlots(XARENA, '2026-11-26'))[0],
      slot('14:00', '15:00', 5),
    );
    assert.equal(fetchFn.calls.length, 2);

    // another day is not affected while the lead time does not reach it ...
    assert.equal((await connector.getFreeSlots(XARENA, '2026-11-27'))[0]?.start, '07:00');
    // ... and the full lead time counts across midnight: 23:30 + 2 h = 01:30 on the next day
    t = Date.parse('2026-11-26T22:30:00Z');
    assert.equal((await connector.getFreeSlots(XARENA, '2026-11-27'))[0]?.start, '07:00');
  });

  it('far in the future nothing is cut; a past cutoff leaves nothing free today', async () => {
    const fetchFn = replay(fx('xarena-2026-11-25-today.html'), [
      fx('xarena-2026-11-25-week-ajax.html'),
    ]);
    let t = NOW - 5 * DAY_MS;
    const connector = createBizzyConnector({
      fetch: fetchFn,
      now: () => t,
      cacheTtlMs: 30 * DAY_MS,
    });
    assert.equal((await connector.getFreeSlots(XARENA, '2026-11-26'))[0]?.start, '07:00');
    t = Date.parse('2026-11-26T20:30:00Z'); // 21:30 local, cutoff 23:30
    assert.deepEqual(await connector.getFreeSlots(XARENA, '2026-11-26'), []);
  });

  it('venues without minLeadMinutes keep every cell', async () => {
    const fetchFn = replay(fx('lisen-2026-11-25-today.html'), [
      fx('lisen-2026-11-25-week-ajax.html'),
    ]);
    const connector = createBizzyConnector({ fetch: fetchFn, now: () => NOW });
    assert.equal((await connector.getFreeSlots(LISEN, '2026-11-26'))[0]?.start, '07:00');
  });
});

describe('Bizzy connector: failures', () => {
  it('lets ECONNREFUSED propagate with its cause chain intact', async () => {
    const refused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 185.58.41.50:80'), {
        code: 'ECONNREFUSED',
      }),
    });
    const connector = createBizzyConnector({ fetch: () => Promise.reject(refused) });
    await assert.rejects(connector.getFreeSlots(LISEN, '2026-11-26'), (err: unknown) => {
      assert.equal(err, refused);
      assert.equal((err as { cause?: { code?: string } }).cause?.code, 'ECONNREFUSED');
      return true;
    });
  });

  it('times out a request that never answers', async () => {
    const connector = createBizzyConnector({
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(
      connector.getFreeSlots(LISEN, '2026-11-26'),
      (err: unknown) => err instanceof Error && err.name === 'UpstreamTimeoutError',
    );
  });

  it('turns an HTTP error status into an error (GET and POST)', async () => {
    const getFails = createBizzyConnector({
      fetch: () => Promise.resolve(htmlResponse('oops', 500)),
    });
    await assert.rejects(getFails.getFreeSlots(LISEN, '2026-11-26'), /HTTP 500/);

    const postFails = createBizzyConnector({
      fetch: (_url, init) =>
        Promise.resolve(
          init?.method === 'POST'
            ? htmlResponse('bad gateway', 502)
            : htmlResponse(fx('lisen-2026-11-25-today.html')),
        ),
    });
    await assert.rejects(postFails.getFreeSlots(LISEN, '2026-11-26'), /HTTP 502/);
  });

  it('a failure is not cached: the next call tries again', async () => {
    let fail = true;
    const fetchFn = recordingFetch(() =>
      fail ? htmlResponse('down', 503) : htmlResponse(fx('jehnice-2026-11-25-today.html')),
    );
    const connector = createBizzyConnector({ fetch: fetchFn });
    await assert.rejects(connector.getFreeSlots(JEHNICE, '2026-11-26'), /HTTP 503/);
    fail = false;
    assert.equal((await connector.getFreeSlots(JEHNICE, '2026-11-26')).length, 2);
  });
});

describe('Bizzy connector: changed markup', () => {
  const lisenToday = fx('lisen-2026-11-25-today.html');
  const lisenWeek = fx('lisen-2026-11-25-week-ajax.html');

  async function failsWithParseError(
    page: string,
    posts: string[],
    date = '2026-11-26',
  ): Promise<void> {
    const connector = createBizzyConnector({ fetch: replay(page, posts) });
    await assert.rejects(connector.getFreeSlots(LISEN, date), (err: unknown) => {
      assert.ok(err instanceof BizzyParseError, String(err));
      return true;
    });
  }

  it('missing scheduleData on the GET page or in a postback response', async () => {
    await failsWithParseError(lisenToday.replace('var scheduleData', 'var other'), []);
    await failsWithParseError(lisenToday, [lisenWeek.replace('var scheduleData', 'var other')]);
  });

  it('missing action ids, hidden input or form', async () => {
    await failsWithParseError(lisenToday.replaceAll("'onchanged'", "'onchangedX'"), [lisenWeek]);
    await failsWithParseError(
      lisenToday.replace('name="scheduleNavigForm:j_id210"', 'name="scheduleNavigForm:gone"'),
      [lisenWeek],
    );
    await failsWithParseError(lisenToday.replace('id="scheduleNavigForm"', 'id="otherForm"'), [
      lisenWeek,
    ]);
  });

  it('refuses a form that posts to another host', async () => {
    const hostile = lisenToday.replace(
      /(<form id="scheduleNavigForm"[^>]*action=")\/Branch/,
      '$1https://evil.example/Branch',
    );
    assert.notEqual(hostile, lisenToday);
    const fetchFn = replay(hostile, [lisenWeek]);
    const connector = createBizzyConnector({ fetch: fetchFn });
    await assert.rejects(connector.getFreeSlots(LISEN, '2026-11-26'), /unexpected host/);
    assert.equal(fetchFn.calls.length, 1);
  });

  it('never answers with another day: a response without the wanted date is an error', async () => {
    // the date picker postback "worked" but returned 26/11 only
    await failsWithParseError(
      lisenToday,
      [lisenWeek, fx('lisen-2026-11-25-tomorrow-ajax.html')],
      '2026-12-20',
    );
  });
});
