import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { addDays, toLocalDateTime } from '@spotradar/shared';
import { createBizzyConnector } from './connectors/bizzy/connector.ts';
import {
  createAvailabilityService,
  createDefaultConnectors,
} from './connectors/availabilityService.ts';
import { parseMemberproGrid } from './connectors/memberpro/parser.ts';
import { parseMemberzoneSchedule, parseMemberzoneWeek } from './connectors/memberzone/parser.ts';
import { VENUE_RECORDS } from './data/venues.ts';
import { HttpError } from './errors.ts';
import { createVenueRepository } from './repositories/venueRepository.ts';
import { getCalendar } from './services/calendar.ts';
import { createStubFetch, createStubGeocoder, createStubSuggester, isStubMode } from './stubs.ts';
import { FIXED_NOW, TOMORROW, silentLogger, targetOf } from './testHelpers.ts';
import type { SportId } from '@spotradar/shared';
import type { AvailabilityTarget } from './connectors/types.ts';

const slot = (start: string, end: string, freeCourts: number) => ({ start, end, freeCourts });

/** A real venue's offering (badminton by default) as an availability target. */
function venue(id: string, sport: SportId = 'badminton'): AvailabilityTarget {
  const found = VENUE_RECORDS.find((v) => v.id === id);
  if (!found) throw new Error(id);
  return targetOf(found, sport);
}

describe('stub mode', () => {
  it('is enabled only by SPOTRADAR_STUB_EXTERNAL=1', () => {
    assert.equal(isStubMode({ SPOTRADAR_STUB_EXTERNAL: '1' }), true);
    assert.equal(isStubMode({ SPOTRADAR_STUB_EXTERNAL: '0' }), false);
    assert.equal(isStubMode({}), false);
  });

  it('feeds the real ClubSpire parser: Kuklenská live, Viktoria unavailable, Bizzy live', async () => {
    const service = createAvailabilityService({
      connectors: createDefaultConnectors({ fetch: createStubFetch() }),
      now: () => FIXED_NOW,
      logger: silentLogger,
    });
    const kuklenska = await service.getAvailability(venue('kuklenska'), TOMORROW);
    assert.equal(kuklenska.status, 'live');
    assert.deepEqual(kuklenska.freeSlots[4], { start: '11:00', end: '12:00', freeCourts: 4 });
    // any date returns the same fixture
    const other = await service.getAvailability(venue('kuklenska'), '2026-12-01');
    assert.deepEqual(other.freeSlots, kuklenska.freeSlots);

    assert.equal(
      (await service.getAvailability(venue('centrum-viktoria'), TOMORROW)).status,
      'unavailable',
    );
    assert.equal(
      (await service.getAvailability(venue('badminton-jehnice'), TOMORROW)).status,
      'live',
    );
  });

  it('serves every offering with a connector live (except Viktoria badminton) for any date', async () => {
    const service = createAvailabilityService({
      connectors: createDefaultConnectors({ fetch: createStubFetch() }),
      now: () => FIXED_NOW,
      logger: silentLogger,
    });
    const expectedUnavailable = new Set(['centrum-viktoria/badminton']);
    // The stub builds "today's" pages from the real clock, so use dates relative to it.
    const realToday = toLocalDateTime(new Date()).date;
    for (const record of VENUE_RECORDS) {
      for (const offering of record.offerings) {
        if (!service.supports(offering)) continue;
        const key = `${record.id}/${offering.sport}`;
        for (const date of [addDays(realToday, 1), addDays(realToday, 8)]) {
          const result = await service.getAvailability(venue(record.id, offering.sport), date);
          const expected = expectedUnavailable.has(key) ? 'unavailable' : 'live';
          assert.equal(result.status, expected, `${key} ${date}`);
          // X-Arena's 2-hour lead time uses the real clock: late in the day nothing is left.
          if (expected === 'live' && record.id !== 'x-arena-slatina') {
            assert.ok(result.freeSlots.length > 0, `${key} ${date}`);
          }
        }
      }
    }
  });

  it('serves the sport-specific pages: Viktoria padel only counts padel courts', async () => {
    const service = createAvailabilityService({
      connectors: createDefaultConnectors({ fetch: createStubFetch() }),
      now: () => FIXED_NOW,
      logger: silentLogger,
    });
    const padel = await service.getAvailability(venue('centrum-viktoria', 'padel'), TOMORROW);
    assert.ok(Math.max(...padel.freeSlots.map((s) => s.freeCourts)) <= 3);
    const beach = await service.getAvailability(
      venue('beach-riviera', 'beach-volleyball'),
      '2026-12-02',
    );
    assert.deepEqual(beach.freeSlots, [slot('15:00', '16:00', 2), slot('20:00', '21:00', 1)]);
    const squash = await service.getAvailability(
      venue('sportcentrum-ivanovice', 'squash'),
      TOMORROW,
    );
    assert.ok(Math.max(...squash.freeSlots.map((s) => s.freeCourts)) === 4);
  });

  it('serves Hala Sprint and Ivanovice live for any date through the real connectors', async () => {
    const service = createAvailabilityService({
      connectors: createDefaultConnectors({ fetch: createStubFetch() }),
      now: () => FIXED_NOW,
      logger: silentLogger,
    });
    for (const id of ['hala-sprint', 'sportcentrum-ivanovice']) {
      for (const date of [TOMORROW, '2026-12-08', '2027-01-05']) {
        const result = await service.getAvailability(venue(id), date);
        assert.equal(result.status, 'live', `${id} ${date}`);
        assert.ok(result.freeSlots.length > 0, `${id} ${date}`);
      }
    }
  });

  it('rewrites the recorded Sprint week and Ivanovice grid to the requested date', async () => {
    const fetchFn = createStubFetch();
    const base = parseMemberzoneSchedule(
      readFileSync(
        new URL('./connectors/memberzone/fixtures/sprint-2026-11-26-post.html', import.meta.url),
        'utf8',
      ),
      '2026-11-26',
    );

    // Date switch: the week starts at myDate (also across a year boundary).
    const sprintUrl = 'https://memberzone.cz/sprint_tenis/Sportoviste.aspx?ID_Sportoviste=3';
    const post = await fetchFn(sprintUrl, {
      method: 'POST',
      body: new URLSearchParams({ myDate: '2026-12-30' }).toString(),
    });
    const week = parseMemberzoneWeek(await post.text(), '2026-12-30');
    assert.deepEqual([...week.keys()][6], '2027-01-05');
    assert.deepEqual(week.get('2026-12-30'), base);

    // Plain GET: the week starts today.
    const today = toLocalDateTime(new Date()).date;
    const get = await fetchFn(sprintUrl);
    assert.deepEqual(parseMemberzoneSchedule(await get.text(), today), base);

    const ivanoviceUrl = 'https://memberzone.cz/ivanovice/';
    const start = await fetchFn(ivanoviceUrl);
    assert.equal(start.status, 200);
    const grid = await fetchFn(ivanoviceUrl, {
      method: 'POST',
      body: new URLSearchParams({ DATUM_HF: '05.01.2027' }).toString(),
    });
    const html = await grid.text();
    assert.deepEqual(
      parseMemberproGrid(html, '2027-01-05'),
      parseMemberproGrid(
        readFileSync(
          new URL('./connectors/memberpro/fixtures/badminton-2026-11-26.html', import.meta.url),
          'utf8',
        ),
        '2026-11-26',
      ),
    );
    assert.throws(() => parseMemberproGrid(html, '2026-11-26'), /expected 26\.11\.2026/);
  });

  it('serves the three Bizzy venues live for any date through the real connector and parser', async () => {
    // Every stubbed day is the recorded Thursday 26.11.2026, with nothing counted as already past.
    const expected: Record<string, ReturnType<typeof slot>[]> = {
      'badminton-jehnice': [slot('17:00', '18:00', 1), slot('19:00', '21:00', 1)],
      'badminton-lisen': [
        slot('07:00', '10:00', 6),
        slot('10:00', '11:00', 5),
        slot('11:00', '14:30', 6),
        slot('14:30', '15:00', 5),
        slot('15:00', '15:30', 3),
        slot('15:30', '16:00', 4),
        slot('16:30', '17:00', 1),
        slot('18:00', '19:00', 1),
        slot('21:00', '22:00', 6),
      ],
      'x-arena-slatina': [
        slot('07:00', '08:00', 2),
        slot('08:00', '09:00', 6),
        slot('09:00', '12:00', 5),
        slot('12:00', '14:00', 6),
        slot('14:00', '15:00', 5),
        slot('17:00', '19:00', 1),
        slot('19:00', '21:00', 2),
        slot('21:00', '22:00', 5),
      ],
    };
    const today = toLocalDateTime(new Date()).date;
    const dates = [addDays(today, 3), addDays(today, 20), '2027-01-05', '2028-02-29'];
    for (const [id, slots] of Object.entries(expected)) {
      for (const date of dates) {
        // a fresh connector per date: the first request has to move the window by itself
        const connector = createBizzyConnector({ fetch: createStubFetch() });
        assert.deepEqual(await connector.getFreeSlots(venue(id), date), slots, `${id} ${date}`);
      }
    }
  });

  it('answers Bizzy like the real site: session cookie, A4J window, 8 days per page', async () => {
    const calls: string[] = [];
    const base = createStubFetch();
    const fetchFn: typeof base = (input, init) => {
      calls.push(`${init?.method ?? 'GET'} ${new URL(input).host}`);
      return base(input, init);
    };
    const connector = createBizzyConnector({ fetch: fetchFn });
    const today = toLocalDateTime(new Date()).date;
    // 7 consecutive days = GET + 1 view switch per one-day venue, a single GET at Jehnice
    for (let i = 1; i <= 7; i++) {
      for (const id of ['badminton-jehnice', 'badminton-lisen', 'x-arena-slatina']) {
        const slots = await connector.getFreeSlots(venue(id), addDays(today, i));
        assert.ok(slots.length > 0, `${id} +${i}`);
      }
    }
    assert.deepEqual(calls, [
      'GET badminton-jehnice.e-rezervace.cz',
      'GET badmintonlisen.e-rezervace.cz',
      'POST badmintonlisen.e-rezervace.cz',
      'GET xarena.e-rezervace.cz',
      'POST xarena.e-rezervace.cz',
    ]);

    const raw = createStubFetch();
    const url = 'http://badmintonlisen.e-rezervace.cz/Branch/pages/Schedule.faces';
    const get = await raw(url);
    assert.equal(get.status, 200);
    assert.equal(get.headers.getSetCookie()[0]?.split(';')[0], 'JSESSIONID=stub');
    const post = (body: Record<string, string>, cookie?: string): Promise<Response> =>
      raw(url, {
        method: 'POST',
        headers: cookie ? { cookie } : {},
        body: new URLSearchParams(body).toString(),
      });
    const ajax = { AJAXREQUEST: 'scheduleNavigForm:schedule-navig-region' };
    assert.equal((await post(ajax, 'JSESSIONID=stub')).status, 200);
    await assert.rejects(post(ajax), /session cookie/);
    await assert.rejects(post({ AJAXREQUEST: '_viewRoot' }, 'JSESSIONID=stub'), /AJAXREQUEST/);
    await assert.rejects(raw('http://badmintonlisen.e-rezervace.cz/other'), /unreachable/);
  });

  it('keeps every other memberzone.cz page and host failing', async () => {
    const fetchFn = createStubFetch();
    await assert.rejects(fetchFn('https://memberzone.cz/other/'), /unreachable/);
    await assert.rejects(
      fetchFn('https://memberzone.cz/ivanovice/', { method: 'POST', body: 'DATUM_HF=nonsense' }),
      /without a date/,
    );
    await assert.rejects(
      fetchFn('https://memberzone.cz/sprint_tenis/Sportoviste.aspx', { method: 'POST' }),
      /without a date/,
    );
    await assert.rejects(fetchFn('https://rezervace.centrumviktoria.cz:18443/'), /unreachable/);
  });

  it('serves a 15-day calendar quickly with the stub statuses on every day', async () => {
    const service = createAvailabilityService({
      connectors: createDefaultConnectors({ fetch: createStubFetch() }),
      now: () => FIXED_NOW,
      logger: silentLogger,
    });
    const started = Date.now();
    const calendar = await getCalendar(
      { sport: 'badminton', from: '2026-11-24', to: '2026-12-08' },
      { venues: createVenueRepository(VENUE_RECORDS), availability: service, now: () => FIXED_NOW },
    );
    assert.ok(Date.now() - started < 5000);
    assert.equal(calendar.days.length, 15);
    for (const day of calendar.days) {
      const status = new Map(day.venues.map((v) => [v.venueId, v.availability.status]));
      assert.equal(status.get('kuklenska'), 'live');
      assert.equal(status.get('centrum-viktoria'), 'unavailable');
      assert.equal(status.get('hala-sprint'), 'live');
      assert.equal(status.get('sportcentrum-ivanovice'), 'live');
      assert.equal(status.get('badminton-jehnice'), 'live');
      assert.equal(status.get('badminton-lisen'), 'live');
      assert.equal(status.get('x-arena-slatina'), 'live');
    }
  });

  it('suggests Brno streets by default, Prague for "praha", [] for "nowhere" and fails for "fail"', async () => {
    const suggester = createStubSuggester();
    const brno = await suggester.suggest('Kuklensk');
    assert.ok(brno.length >= 2 && brno.length <= 3);
    assert.equal(brno[0]?.label, 'Kuklenská, Židenice, Brno');
    assert.deepEqual(await suggester.suggest('Praha'), [
      { lat: 50.0755, lng: 14.4378, label: 'Praha' },
    ]);
    assert.deepEqual(await suggester.suggest('nowhere'), []);
    await assert.rejects(
      suggester.suggest('fail'),
      (err: unknown) => err instanceof HttpError && err.code === 'GEOCODER_UNAVAILABLE',
    );
  });

  it('geocodes Brno by default, Praha specially and "nowhere" as not found', async () => {
    const geocoder = createStubGeocoder();
    assert.deepEqual(await geocoder.geocode('Údolní 5'), {
      lat: 49.1951,
      lng: 16.6068,
      label: 'Brno, Česko',
    });
    assert.deepEqual(await geocoder.geocode('Václavské náměstí, PRAHA'), {
      lat: 50.0755,
      lng: 14.4378,
      label: 'Praha, Česko',
    });
    await assert.rejects(
      geocoder.geocode('Nowhere Land'),
      (err: unknown) => err instanceof HttpError && err.code === 'LOCATION_NOT_FOUND',
    );
  });
});
