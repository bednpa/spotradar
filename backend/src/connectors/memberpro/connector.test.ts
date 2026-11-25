import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { VENUE_RECORDS } from '../../data/venues.ts';
import type { SportId } from '@spotradar/shared';
import { fakeClock, htmlResponse, recordingFetch, slot, targetOf } from '../../testHelpers.ts';
import type { AvailabilityTarget } from '../types.ts';
import { readHiddenFields } from '../aspnet.ts';
import { createHostLimiter } from '../hostLimiter.ts';
import { createMemberzoneConnector } from '../memberzone/connector.ts';
import { buildMemberproBody, createMemberproConnector, SESSION_REUSE_MS } from './connector.ts';
import { MemberproParseError } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const INITIAL_GET = fixture('initial-get.html');
const GRIDS: Record<string, string> = {
  '25.11.2026': fixture('badminton-2026-11-25.html'),
  '26.11.2026': fixture('badminton-2026-11-26.html'),
  '28.11.2026': fixture('badminton-2026-11-28.html'),
  '24.12.2026': fixture('badminton-2026-12-24.html'),
};

/** A real venue's offering (badminton by default) as a connector target. */
function venue(id: string, sport: SportId = 'badminton'): AvailabilityTarget {
  const found = VENUE_RECORDS.find((v) => v.id === id);
  if (!found) throw new Error(`unknown venue ${id}`);
  return targetOf(found, sport);
}

const IVANOVICE = venue('sportcentrum-ivanovice');
const URL_IVANOVICE = 'https://memberzone.cz/ivanovice/';

function page(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: [
      ['content-type', 'text/html'],
      ['set-cookie', 'ASP.NET_SessionId=iv1; path=/; HttpOnly'],
    ],
  });
}

/** The real site: GET = sport buttons only, POST (with the session cookie) = grid of DATUM_HF. */
function ivanoviceSite(): ReturnType<typeof recordingFetch> {
  return recordingFetch((_url, init) => {
    if (init?.method !== 'POST') return page(INITIAL_GET);
    const headers = init.headers as Record<string, string>;
    const body = new URLSearchParams(String(init.body));
    const grid = GRIDS[body.get('DATUM_HF') ?? ''];
    if (headers.cookie !== 'ASP.NET_SessionId=iv1' || !grid) return page(INITIAL_GET);
    return page(grid);
  });
}

function postBody(call: { init?: RequestInit } | undefined): URLSearchParams {
  return new URLSearchParams(String(call?.init?.body));
}

describe('buildMemberproBody', () => {
  it('adds the date, the UTC-midnight raw value and the badminton button to the hidden fields', () => {
    const body = buildMemberproBody(
      new URLSearchParams({ __VIEWSTATE: 'vs', DATUM_HF: '01.01.2020' }),
      '2026-11-05',
      { name: 'BTN5', value: 'Badminton' },
    );
    const raw = String(Date.UTC(2026, 10, 5));
    assert.equal(body.get('__VIEWSTATE'), 'vs');
    assert.equal(body.get('DATUM_HF'), '05.11.2026');
    assert.equal(body.get('ASPxFormLayout2$Datepicker2'), '05.11.2026');
    assert.equal(body.get('ASPxFormLayout2_Datepicker2_Raw'), raw);
    assert.deepEqual(JSON.parse(body.get('ASPxFormLayout2$Datepicker2$State') ?? ''), {
      rawValue: raw,
      useMinDateInsteadOfNull: false,
    });
    assert.equal(body.get('BTN5'), 'Badminton');
  });
});

describe('MemberPro connector', () => {
  it('GETs the page, then POSTs its hidden fields with the date and the session cookie', async () => {
    const fetchFn = ivanoviceSite();
    const connector = createMemberproConnector({ fetch: fetchFn });
    const slots = await connector.getFreeSlots(IVANOVICE, '2026-11-25');
    assert.deepEqual(slots[0], slot('07:00', '09:00', 3));
    assert.deepEqual(slots.at(-1), slot('20:00', '21:00', 1));
    assert.equal(slots.length, 9);

    assert.equal(fetchFn.calls.length, 2);
    const get = fetchFn.calls[0];
    assert.equal(get?.url.href, URL_IVANOVICE);
    assert.deepEqual(get?.init?.headers, { 'user-agent': 'SpotRadar/1.0' });
    assert.ok(get?.init?.signal instanceof AbortSignal);

    const post = fetchFn.calls[1];
    assert.equal(post?.url.href, URL_IVANOVICE);
    assert.equal(post?.init?.method, 'POST');
    assert.equal(post?.init?.redirect, 'manual');
    assert.deepEqual(post?.init?.headers, {
      'user-agent': 'SpotRadar/1.0',
      cookie: 'ASP.NET_SessionId=iv1',
      'content-type': 'application/x-www-form-urlencoded',
    });
    assert.ok(post?.init?.signal instanceof AbortSignal);
    const body = postBody(post);
    const initial = readHiddenFields(INITIAL_GET);
    for (const name of [
      '__VIEWSTATE',
      '__EVENTVALIDATION',
      'ID_TYP_SPORTOVISTE',
      'ToolkitScriptManager2_HiddenField',
    ]) {
      assert.equal(body.get(name), initial.get(name), name);
    }
    assert.equal(body.get('DATUM_HF'), '25.11.2026');
    assert.equal(body.get('ASPxFormLayout2$Datepicker2'), '25.11.2026');
    assert.equal(body.get('ASPxFormLayout2_Datepicker2_Raw'), String(Date.UTC(2026, 10, 25)));
    assert.equal(body.get('BTN5'), 'Badminton');
  });

  it('posts the sport button of the source and keeps one session per sport', async () => {
    const fetchFn = ivanoviceSite();
    const connector = createMemberproConnector({ fetch: fetchFn });
    const squash = venue('sportcentrum-ivanovice', 'squash');
    await connector.getFreeSlots(IVANOVICE, '2026-11-25');
    await connector.getFreeSlots(squash, '2026-11-26');
    // A badminton session is never reused for squash: GET + POST again.
    assert.equal(fetchFn.calls.length, 4);
    const squashPost = postBody(fetchFn.calls[3]);
    assert.equal(squashPost.get('BTN4'), 'Squash');
    assert.equal(squashPost.get('BTN5'), null);
    // The squash session is reused for the next squash date (one POST).
    await connector.getFreeSlots(squash, '2026-11-28');
    assert.equal(fetchFn.calls.length, 5);
    assert.equal(postBody(fetchFn.calls[4]).get('BTN4'), 'Squash');
    const tableTennis = venue('sportcentrum-ivanovice', 'table-tennis');
    await connector.getFreeSlots(tableTennis, '2026-11-28');
    assert.equal(postBody(fetchFn.calls.at(-1)).get('BTN3'), 'Ping-pong');
  });

  it('a closed day gives []', async () => {
    const connector = createMemberproConnector({ fetch: ivanoviceSite() });
    assert.deepEqual(await connector.getFreeSlots(IVANOVICE, '2026-12-24'), []);
  });

  it('reuses the session and the fresh hidden fields for the next date (one POST each)', async () => {
    const fetchFn = ivanoviceSite();
    const connector = createMemberproConnector({ fetch: fetchFn });
    await connector.getFreeSlots(IVANOVICE, '2026-11-25');
    const second = await connector.getFreeSlots(IVANOVICE, '2026-11-26');
    const third = await connector.getFreeSlots(IVANOVICE, '2026-11-28');
    assert.deepEqual(second[0], slot('09:00', '10:00', 2));
    assert.deepEqual(third[0], slot('08:00', '09:30', 3));

    assert.equal(fetchFn.calls.length, 4); // GET + 3 POSTs
    const reused = fetchFn.calls[2];
    assert.equal(reused?.init?.method, 'POST');
    const headers = reused?.init?.headers as Record<string, string>;
    assert.equal(headers.cookie, 'ASP.NET_SessionId=iv1');
    // The hidden fields come from the previous answer, not from the first page.
    assert.equal(
      postBody(reused).get('__VIEWSTATE'),
      readHiddenFields(GRIDS['25.11.2026'] ?? '').get('__VIEWSTATE'),
    );
    assert.equal(postBody(reused).get('DATUM_HF'), '26.11.2026');
  });

  it('starts over with a clean GET once the reusable session is too old', async () => {
    const clock = fakeClock();
    const fetchFn = ivanoviceSite();
    const connector = createMemberproConnector({
      fetch: fetchFn,
      now: () => clock.now().getTime(),
    });
    await connector.getFreeSlots(IVANOVICE, '2026-11-25');
    clock.advance(SESSION_REUSE_MS);
    await connector.getFreeSlots(IVANOVICE, '2026-11-26');
    assert.deepEqual(
      fetchFn.calls.map((c) => c.init?.method ?? 'GET'),
      ['GET', 'POST', 'GET', 'POST'],
    );
  });

  it('falls back to a clean GET + POST when the reused session fails', async () => {
    let posts = 0;
    const inner = ivanoviceSite();
    const fetchFn = recordingFetch((url, init) => {
      if (init?.method === 'POST' && ++posts === 2) return page('expired', 500);
      return inner(url, init);
    });
    const connector = createMemberproConnector({ fetch: fetchFn });
    await connector.getFreeSlots(IVANOVICE, '2026-11-25');
    const slots = await connector.getFreeSlots(IVANOVICE, '2026-11-26');
    assert.deepEqual(slots[0], slot('09:00', '10:00', 2));
    assert.deepEqual(
      fetchFn.calls.map((c) => c.init?.method ?? 'GET'),
      ['GET', 'POST', 'POST', 'GET', 'POST'],
    );
  });

  it('rejects on a non-2xx response (GET and POST)', async () => {
    const get503 = createMemberproConnector({
      fetch: recordingFetch(() => htmlResponse('nope', 503)),
    });
    await assert.rejects(get503.getFreeSlots(IVANOVICE, '2026-11-25'), /HTTP 503/);

    const post500 = createMemberproConnector({
      fetch: recordingFetch((_url, init) =>
        init?.method === 'POST' ? page('err', 500) : page(INITIAL_GET),
      ),
    });
    await assert.rejects(post500.getFreeSlots(IVANOVICE, '2026-11-25'), /HTTP 500/);
  });

  it('rejects when a request times out', async () => {
    const hanging = recordingFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const connector = createMemberproConnector({ fetch: hanging, timeoutMs: 20 });
    await assert.rejects(connector.getFreeSlots(IVANOVICE, '2026-11-25'), /aborted/);
  });

  it('rejects on changed markup and on an answer for another date', async () => {
    // Session lost: the POST answer is the sport-less start page again.
    const noGrid = createMemberproConnector({ fetch: recordingFetch(() => page(INITIAL_GET)) });
    await assert.rejects(noGrid.getFreeSlots(IVANOVICE, '2026-11-25'), MemberproParseError);

    const renamed = createMemberproConnector({
      fetch: recordingFetch((_url, init) =>
        page(
          init?.method === 'POST'
            ? (GRIDS['25.11.2026'] ?? '').replaceAll('RADEK_DAY_', 'ROW_')
            : INITIAL_GET,
        ),
      ),
    });
    await assert.rejects(renamed.getFreeSlots(IVANOVICE, '2026-11-25'), MemberproParseError);

    const wrongDay = createMemberproConnector({
      fetch: recordingFetch((_url, init) =>
        page(init?.method === 'POST' ? (GRIDS['26.11.2026'] ?? '') : INITIAL_GET),
      ),
    });
    await assert.rejects(wrongDay.getFreeSlots(IVANOVICE, '2026-11-25'), /expected 25\.11\.2026/);
  });

  it('rejects for a venue that is not a MemberPro venue', async () => {
    const connector = createMemberproConnector({ fetch: recordingFetch(() => page('')) });
    await assert.rejects(
      connector.getFreeSlots(venue('hala-sprint'), '2026-11-25'),
      /not a MemberPro/,
    );
  });

  it('serializes with the MemberZone connector when they share one limiter', async () => {
    let active = 0;
    let maxActive = 0;
    const hosts = new Set<string>();
    const inner = ivanoviceSite();
    const fetchFn = recordingFetch(async (url, init) => {
      hosts.add(url.host);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      // Sprint's page is not needed for this test: any answer works, the read just has to fail.
      return url.pathname.startsWith('/ivanovice') ? inner(url, init) : page('<html></html>');
    });
    const limiter = createHostLimiter();
    const memberpro = createMemberproConnector({ fetch: fetchFn, limiter });
    const memberzone = createMemberzoneConnector({ fetch: fetchFn, limiter });
    await Promise.allSettled([
      memberpro.getFreeSlots(IVANOVICE, '2026-11-25'),
      memberzone.getFreeSlots(venue('hala-sprint'), '2026-11-25'),
      memberpro.getFreeSlots(IVANOVICE, '2026-11-26'),
    ]);
    assert.deepEqual([...hosts], ['memberzone.cz']);
    assert.equal(maxActive, 1);
    assert.equal(fetchFn.calls.length, 2 + 1 + 1);
  });
});
