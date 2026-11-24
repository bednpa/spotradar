import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SearchQuery } from '@spotradar/shared';
import { createAvailabilityService } from '../connectors/availabilityService.ts';
import { VENUE_RECORDS } from '../data/venues.ts';
import { createVenueRepository } from '../repositories/venueRepository.ts';
import type { ConnectorImpl } from '../testHelpers.ts';
import {
  FIXED_NOW,
  TODAY,
  TOMORROW,
  fakeClock,
  fakeConnector,
  silentLogger,
  slot,
} from '../testHelpers.ts';
import { searchVenues } from './search.ts';

const venues = createVenueRepository(VENUE_RECORDS);

function run(query: Partial<SearchQuery>, impl: ConnectorImpl, now: () => Date = () => FIXED_NOW) {
  const connector = fakeConnector('clubspire', impl);
  const availability = createAvailabilityService({
    connectors: [connector],
    now,
    logger: silentLogger,
  });
  return searchVenues(
    { sport: 'badminton', date: TOMORROW, ...query },
    { venues, availability, now },
  ).then((results) => ({ results, connector }));
}

const noSlots: ConnectorImpl = () => Promise.resolve([]);

describe('searchVenues', () => {
  it('returns all venues with public data only (no source) when no origin is given', async () => {
    const { results } = await run({}, noSlots);
    assert.equal(results.length, VENUE_RECORDS.length);
    for (const r of results) {
      assert.ok(!('source' in r.venue));
      assert.equal(r.distanceKm, undefined);
    }
    // No free court anywhere -> sorted by name (Czech collation).
    const names = results.map((r) => r.venue.name);
    assert.deepEqual(
      names,
      names.toSorted((a, b) => a.localeCompare(b, 'cs')),
    );
  });

  it('maps connector outcomes to live / unavailable / unknown', async () => {
    const { results } = await run({}, (venue) =>
      venue.id === 'kuklenska'
        ? Promise.resolve([slot('10:00', '11:00', 2)])
        : Promise.reject(new Error('down')),
    );
    const status = new Map(results.map((r) => [r.venue.id, r.availability.status]));
    assert.equal(status.get('kuklenska'), 'live');
    assert.equal(status.get('centrum-viktoria'), 'unavailable');
    assert.equal(status.get('hala-sprint'), 'unknown');
    // A failing connector never fails the search; free venue first.
    assert.equal(results[0]?.venue.id, 'kuklenska');
  });

  it('computes rounded distances and sorts by distance among equally free venues', async () => {
    const origin = { lat: 49.1951, lng: 16.6068 };
    const { results } = await run(origin, noSlots);
    const distances = results.map((r) => r.distanceKm);
    for (const r of results) {
      assert.equal(typeof r.distanceKm, 'number');
      assert.equal(r.distanceKm, Math.round((r.distanceKm ?? 0) * 10) / 10);
    }
    const sorted = distances.map(Number);
    assert.deepEqual(
      sorted,
      sorted.toSorted((a, b) => a - b),
    );
  });

  it('drops venues farther than maxDistanceKm', async () => {
    const origin = { lat: 49.1951, lng: 16.6068 };
    const { results, connector } = await run({ ...origin, maxDistanceKm: 3 }, noSlots);
    assert.ok(results.length > 0 && results.length < VENUE_RECORDS.length);
    assert.ok(results.every((r) => (r.distanceKm ?? Infinity) <= 3));
    const ids = results.map((r) => r.venue.id);
    assert.ok(!ids.includes('badminton-jehnice'));
    // Filtered-out venues are not fetched.
    assert.ok(connector.calls.every((c) => ids.includes(c.venueId)));
  });

  it('returns an empty list when nothing is within maxDistanceKm', async () => {
    const { results } = await run({ lat: 50.0755, lng: 14.4378, maxDistanceKm: 5 }, noSlots);
    assert.deepEqual(results, []);
  });

  it('filters by sport', async () => {
    const connector = fakeConnector('clubspire', noSlots);
    const availability = createAvailabilityService({
      connectors: [connector],
      now: () => FIXED_NOW,
      logger: silentLogger,
    });
    const squashOnly = createVenueRepository([
      { ...VENUE_RECORDS[0]!, sports: [] },
      VENUE_RECORDS[1]!,
    ]);
    const results = await searchVenues(
      { sport: 'badminton', date: TOMORROW },
      { venues: squashOnly, availability, now: () => FIXED_NOW },
    );
    assert.deepEqual(
      results.map((r) => r.venue.id),
      ['centrum-viktoria'],
    );
  });

  it('sets freeCourtsAtTime only for live venues when time is given', async () => {
    const { results } = await run({ time: '10:30' }, (venue) =>
      venue.id === 'kuklenska'
        ? Promise.resolve([slot('10:00', '11:00', 3)])
        : venue.id === 'centrum-viktoria'
          ? Promise.resolve([slot('15:00', '16:00', 1)])
          : Promise.reject(new Error('down')),
    );
    const byId = new Map(results.map((r) => [r.venue.id, r]));
    assert.equal(byId.get('kuklenska')?.freeCourtsAtTime, 3);
    assert.equal(byId.get('centrum-viktoria')?.freeCourtsAtTime, 0);
    assert.equal(byId.get('hala-sprint')?.freeCourtsAtTime, undefined);
    // venue with unavailable status: no freeCourtsAtTime either
    const { results: noTime } = await run({}, () => Promise.resolve([slot('10:00', '11:00', 3)]));
    assert.ok(noTime.every((r) => r.freeCourtsAtTime === undefined));
  });

  it('sorts venues free at the requested time before those that are not', async () => {
    const { results } = await run({ time: '10:30', lat: 49.1951, lng: 16.6068 }, (venue) =>
      Promise.resolve(
        venue.id === 'centrum-viktoria'
          ? [slot('10:00', '11:00', 1)] // the only venue free at 10:30
          : venue.id === 'kuklenska'
            ? [slot('16:00', '17:00', 1)] // free later that day, not at 10:30
            : [],
      ),
    );
    assert.equal(results[0]?.venue.id, 'centrum-viktoria');
    // Kuklenská is free only later that day, so it ranks with the non-free venues (by distance).
    const kuklenska = results.find((r) => r.venue.id === 'kuklenska');
    assert.equal(kuklenska?.freeCourtsAtTime, 0);
    assert.ok(results.indexOf(kuklenska as NonNullable<typeof kuklenska>) > 0);
  });

  it("removes today's slots that already ended (now = 09:00 Prague)", async () => {
    const { results } = await run({ date: TODAY, time: '09:30' }, (venue) =>
      Promise.resolve(
        venue.id === 'kuklenska'
          ? [
              slot('07:00', '08:00', 1), // ended
              slot('08:00', '09:00', 1), // ended exactly now
              slot('09:00', '10:00', 2), // running
              slot('10:00', '11:00', 4),
            ]
          : [],
      ),
    );
    const kuklenska = results.find((r) => r.venue.id === 'kuklenska');
    assert.deepEqual(kuklenska?.availability.freeSlots, [
      slot('09:00', '10:00', 2),
      slot('10:00', '11:00', 4),
    ]);
    assert.equal(kuklenska?.freeCourtsAtTime, 2);
  });

  it('keeps all slots for a future date', async () => {
    const { results } = await run({ date: TOMORROW }, (venue) =>
      Promise.resolve(venue.id === 'kuklenska' ? [slot('07:00', '08:00', 1)] : []),
    );
    assert.deepEqual(results.find((r) => r.venue.id === 'kuklenska')?.availability.freeSlots, [
      slot('07:00', '08:00', 1),
    ]);
  });

  it('a venue whose only slots already ended is no longer sorted as free', async () => {
    const clock = fakeClock(new Date('2026-11-24T20:00:00Z')); // 21:00 Prague
    const { results } = await run(
      { date: TODAY },
      (venue) =>
        Promise.resolve(
          venue.id === 'kuklenska'
            ? [slot('07:00', '08:00', 1)]
            : venue.id === 'centrum-viktoria'
              ? [slot('21:30', '22:00', 1)]
              : [],
        ),
      clock.now,
    );
    assert.equal(results[0]?.venue.id, 'centrum-viktoria');
    assert.deepEqual(results.find((r) => r.venue.id === 'kuklenska')?.availability.freeSlots, []);
  });
});
