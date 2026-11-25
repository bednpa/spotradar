import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CalendarQuery } from '@spotradar/shared';
import type { AvailabilityService } from '../connectors/availabilityService.ts';
import { createAvailabilityService } from '../connectors/availabilityService.ts';
import { VENUE_RECORDS } from '../data/venues.ts';
import { createVenueRepository } from '../repositories/venueRepository.ts';
import type { ConnectorImpl } from '../testHelpers.ts';
import { FIXED_NOW, TODAY, TOMORROW, fakeConnector, silentLogger, slot } from '../testHelpers.ts';
import { getCalendar } from './calendar.ts';

const venues = createVenueRepository(VENUE_RECORDS);
const ORIGIN = { lat: 49.1951, lng: 16.6068 };

function run(query: Partial<CalendarQuery>, impl: ConnectorImpl) {
  const connector = fakeConnector('clubspire', impl);
  const availability = createAvailabilityService({
    connectors: [connector],
    now: () => FIXED_NOW,
    logger: silentLogger,
  });
  return getCalendar(
    { sport: 'badminton', from: TODAY, to: '2026-11-26', ...query },
    { venues, availability, now: () => FIXED_NOW },
  ).then((response) => ({ response, connector }));
}

const noSlots: ConnectorImpl = () => Promise.resolve([]);

describe('getCalendar', () => {
  it('returns one day per date ascending, each with one entry per venue in venue order', async () => {
    const { response } = await run({ from: TODAY, to: '2026-11-27' }, noSlots);
    assert.deepEqual(
      response.days.map((d) => d.date),
      ['2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'],
    );
    const ids = response.venues.map((v) => v.venue.id);
    assert.equal(ids.length, VENUE_RECORDS.length);
    for (const day of response.days) {
      assert.deepEqual(
        day.venues.map((v) => v.venueId),
        ids,
      );
    }
  });

  it('supports a single-day range and echoes the query', async () => {
    const { response } = await run({ from: TOMORROW, to: TOMORROW }, noSlots);
    assert.equal(response.days.length, 1);
    assert.equal(response.query.from, TOMORROW);
  });

  it('sorts by name (Czech collation) without origin and never leaks source', async () => {
    const { response } = await run({}, noSlots);
    const names = response.venues.map((v) => v.venue.name);
    assert.deepEqual(
      names,
      names.toSorted((a, b) => a.localeCompare(b, 'cs')),
    );
    assert.ok(response.venues.every((v) => v.distanceKm === undefined));
    assert.equal(JSON.stringify(response).includes('"source"'), false);
  });

  it('sorts by rounded distance with an origin', async () => {
    const { response } = await run(ORIGIN, noSlots);
    const distances = response.venues.map((v) => v.distanceKm);
    for (const d of distances) {
      assert.equal(typeof d, 'number');
      assert.equal(d, Math.round((d ?? 0) * 10) / 10);
    }
    const nums = distances.map(Number);
    assert.deepEqual(
      nums,
      nums.toSorted((a, b) => a - b),
    );
  });

  it('filters by maxDistanceKm and does not fetch filtered-out venues', async () => {
    const { response, connector } = await run({ ...ORIGIN, maxDistanceKm: 3 }, noSlots);
    const ids = response.venues.map((v) => v.venue.id);
    assert.ok(ids.length > 0 && ids.length < VENUE_RECORDS.length);
    assert.ok(!ids.includes('badminton-jehnice'));
    assert.ok(response.venues.every((v) => (v.distanceKm ?? Infinity) <= 3));
    assert.ok(connector.calls.every((c) => ids.includes(c.venueId)));
    for (const day of response.days) {
      assert.deepEqual(
        day.venues.map((v) => v.venueId),
        ids,
      );
    }
  });

  it('returns empty venues and day entries when nothing is in range', async () => {
    const { response } = await run(
      { from: TODAY, to: TOMORROW, lat: 50.0755, lng: 14.4378, maxDistanceKm: 5 },
      noSlots,
    );
    assert.deepEqual(response.venues, []);
    assert.equal(response.days.length, 2);
    assert.ok(response.days.every((d) => d.venues.length === 0));
  });

  it('maps connector outcomes to live / unavailable / unknown for every day', async () => {
    const { response } = await run({}, (venue) =>
      venue.id === 'kuklenska'
        ? Promise.resolve([slot('10:00', '11:00', 2)])
        : Promise.reject(new Error('down')),
    );
    for (const day of response.days) {
      const status = new Map(day.venues.map((v) => [v.venueId, v.availability.status]));
      assert.equal(status.get('kuklenska'), 'live');
      assert.equal(status.get('centrum-viktoria'), 'unavailable');
      assert.equal(status.get('hala-sprint'), 'unknown');
      const unavailable = day.venues.find((v) => v.venueId === 'centrum-viktoria');
      assert.deepEqual(unavailable?.availability.freeSlots, []);
    }
  });

  it("removes today's slots that already ended but keeps future days intact", async () => {
    const { response } = await run({}, (venue) =>
      Promise.resolve(
        venue.id === 'kuklenska'
          ? [slot('07:00', '08:00', 1), slot('08:00', '09:00', 1), slot('10:00', '11:00', 4)]
          : [],
      ),
    );
    const slotsOf = (date: string) =>
      response.days.find((d) => d.date === date)?.venues.find((v) => v.venueId === 'kuklenska')
        ?.availability.freeSlots;
    assert.deepEqual(slotsOf(TODAY), [slot('10:00', '11:00', 4)]);
    assert.equal(slotsOf(TOMORROW)?.length, 3);
  });

  it('maps a rejecting availability service to unavailable', async () => {
    const availability: AvailabilityService = {
      getAvailability: () => Promise.reject(new Error('boom')),
      supports: () => true,
      isHostBackedOff: () => false,
      warm: () => Promise.resolve('skipped'),
    };
    const response = await getCalendar(
      { sport: 'badminton', from: TODAY, to: TOMORROW },
      { venues, availability, now: () => FIXED_NOW },
    );
    assert.equal(response.days.length, 2);
    for (const day of response.days) {
      assert.ok(
        day.venues.every(
          (v) => v.availability.status === 'unavailable' && v.availability.freeSlots.length === 0,
        ),
      );
    }
  });
});
