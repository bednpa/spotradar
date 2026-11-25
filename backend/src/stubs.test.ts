import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { toLocalDateTime } from '@spotradar/shared';
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
import { FIXED_NOW, TOMORROW, silentLogger } from './testHelpers.ts';

function venue(id: string) {
  const found = VENUE_RECORDS.find((v) => v.id === id);
  if (!found) throw new Error(id);
  return found;
}

describe('stub mode', () => {
  it('is enabled only by SPOTRADAR_STUB_EXTERNAL=1', () => {
    assert.equal(isStubMode({ SPOTRADAR_STUB_EXTERNAL: '1' }), true);
    assert.equal(isStubMode({ SPOTRADAR_STUB_EXTERNAL: '0' }), false);
    assert.equal(isStubMode({}), false);
  });

  it('feeds the real ClubSpire parser: Kuklenská live, Viktoria unavailable, others unknown', async () => {
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
      'unknown',
    );
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
      assert.equal(status.get('badminton-jehnice'), 'unknown');
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
