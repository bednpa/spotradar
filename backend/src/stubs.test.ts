import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createAvailabilityService,
  createDefaultConnectors,
} from './connectors/availabilityService.ts';
import { VENUE_RECORDS } from './data/venues.ts';
import { HttpError } from './errors.ts';
import { createStubFetch, createStubGeocoder, isStubMode } from './stubs.ts';
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
    assert.equal((await service.getAvailability(venue('hala-sprint'), TOMORROW)).status, 'unknown');
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
