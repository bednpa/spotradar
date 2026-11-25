import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAvailabilityService } from '../connectors/availabilityService.ts';
import { VENUE_RECORDS } from '../data/venues.ts';
import { createVenueRepository } from '../repositories/venueRepository.ts';
import { FIXED_NOW, fakeConnector, silentLogger } from '../testHelpers.ts';
import { listVenues } from './venues.ts';

const deps = {
  venues: createVenueRepository(VENUE_RECORDS),
  availability: createAvailabilityService({
    connectors: [fakeConnector('clubspire', () => Promise.resolve([]))],
    now: () => FIXED_NOW,
    logger: silentLogger,
  }),
};

const ids = (items: ReturnType<typeof listVenues>): string[] => items.map((i) => i.venue.id);

describe('listVenues', () => {
  it('returns all venues sorted by name without the connector source', () => {
    const items = listVenues({}, deps);
    assert.equal(items.length, VENUE_RECORDS.length);
    const names = items.map((i) => i.venue.name);
    assert.deepEqual(
      names,
      names.toSorted((a, b) => a.localeCompare(b, 'cs')),
    );
    for (const item of items) assert.ok(!('source' in item.venue));
  });

  it('flags venues that have a live connector', () => {
    const live = new Map(listVenues({}, deps).map((i) => [i.venue.id, i.liveAvailability]));
    assert.equal(live.get('kuklenska'), true);
    assert.equal(live.get('centrum-viktoria'), true);
    assert.equal(live.get('badminton-lisen'), false);
  });

  it('filters by sport (venues with an offering for it)', () => {
    const badminton = listVenues({ sport: 'badminton' }, deps);
    assert.equal(badminton.length, 7);
    assert.ok(badminton.every((i) => i.venue.sports.includes('badminton')));
    const padel = ids(listVenues({ sport: 'padel' }, deps));
    assert.ok(padel.includes('centrum-viktoria') && padel.includes('padel-powers-slatina'));
    assert.ok(!padel.includes('kuklenska'));
  });

  it('reports liveSports and liveAvailability per sport filter', () => {
    const item = (sport: Parameters<typeof listVenues>[0]['sport']) =>
      listVenues({ sport, q: 'viktoria' }, deps)[0];
    // Only a ClubSpire connector here: Viktoria's tennis has no connector at all.
    assert.deepEqual(item(undefined)?.liveSports, [
      'badminton',
      'squash',
      'padel',
      'beach-volleyball',
    ]);
    assert.equal(item(undefined)?.liveAvailability, true);
    assert.equal(item('squash')?.liveAvailability, true);
    assert.equal(item('tennis')?.liveAvailability, false);
    const padelPowers = listVenues({ sport: 'padel', q: 'slatina padel' }, deps)[0];
    assert.equal(padelPowers?.liveAvailability, false);
    assert.deepEqual(padelPowers?.liveSports, []);
  });

  it('filters by text ignoring case and diacritics, all words must match', () => {
    assert.deepEqual(ids(listVenues({ q: 'LISEN' }, deps)), ['badminton-lisen']);
    assert.deepEqual(ids(listVenues({ q: 'zidenice kuklenska' }, deps)), ['kuklenska']);
    assert.deepEqual(ids(listVenues({ q: 'Blanenská' }, deps)), ['badminton-jehnice']);
  });

  it('returns an empty list when nothing matches', () => {
    assert.deepEqual(listVenues({ q: 'nonexistent' }, deps), []);
  });
});
