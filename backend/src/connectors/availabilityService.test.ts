import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VENUE_RECORDS } from '../data/venues.ts';
import type { VenueRecord } from '../repositories/venueRepository.ts';
import { fakeClock, fakeConnector, silentLogger, slot } from '../testHelpers.ts';
import {
  AVAILABILITY_CACHE_TTL_MS,
  createAvailabilityService,
  createDefaultConnectors,
} from './availabilityService.ts';

function venue(id: string): VenueRecord {
  const found = VENUE_RECORDS.find((v) => v.id === id);
  if (!found) throw new Error(`unknown venue ${id}`);
  return found;
}

const KUKLENSKA = venue('kuklenska');
const DATE = '2026-11-25';

describe('availability service', () => {
  it('returns "live" with checkedAt and free slots on success', async () => {
    const clock = fakeClock();
    const connector = fakeConnector('clubspire', () =>
      Promise.resolve([slot('10:00', '11:00', 2)]),
    );
    const service = createAvailabilityService({
      connectors: [connector],
      now: clock.now,
      logger: silentLogger,
    });
    assert.deepEqual(await service.getAvailability(KUKLENSKA, DATE), {
      status: 'live',
      checkedAt: clock.now().toISOString(),
      freeSlots: [slot('10:00', '11:00', 2)],
    });
  });

  it('returns "unknown" when no connector handles the booking system', async () => {
    const connector = fakeConnector('clubspire', () => Promise.resolve([]));
    const service = createAvailabilityService({
      connectors: [connector],
      now: fakeClock().now,
      logger: silentLogger,
    });
    // Only the Bizzy venues have no connector in the default set (see createDefaultConnectors).
    for (const id of ['badminton-jehnice', 'badminton-lisen', 'x-arena-slatina']) {
      assert.deepEqual(await service.getAvailability(venue(id), DATE), {
        status: 'unknown',
        freeSlots: [],
      });
    }
    assert.equal(connector.calls.length, 0);
  });

  it('registers connectors for ClubSpire, MemberZone and MemberPro but not yet for Bizzy', () => {
    const service = createAvailabilityService({
      connectors: createDefaultConnectors({ fetch: () => Promise.reject(new Error('no network')) }),
      now: fakeClock().now,
      logger: silentLogger,
    });
    for (const id of ['kuklenska', 'centrum-viktoria', 'hala-sprint', 'sportcentrum-ivanovice']) {
      assert.equal(service.supports(venue(id)), true, id);
    }
    for (const id of ['badminton-jehnice', 'badminton-lisen', 'x-arena-slatina']) {
      assert.equal(service.supports(venue(id)), false, id);
    }
  });

  it('supports() reports whether a connector exists for the booking system', () => {
    const service = createAvailabilityService({
      connectors: [fakeConnector('clubspire', () => Promise.resolve([]))],
      now: fakeClock().now,
      logger: silentLogger,
    });
    assert.equal(service.supports(KUKLENSKA), true);
    assert.equal(service.supports(venue('badminton-jehnice')), false);
  });

  it('returns "unavailable" (and logs a warning) when the connector throws', async () => {
    const warnings: string[] = [];
    const connector = fakeConnector('clubspire', () => Promise.reject(new Error('boom')));
    const service = createAvailabilityService({
      connectors: [connector],
      now: fakeClock().now,
      logger: { warn: (m) => warnings.push(m) },
    });
    assert.deepEqual(await service.getAvailability(KUKLENSKA, DATE), {
      status: 'unavailable',
      freeSlots: [],
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /kuklenska.*boom/);
  });

  it('caches successes for 15 minutes and keeps the original checkedAt', async () => {
    const clock = fakeClock();
    const firstCheckedAt = clock.now().toISOString();
    const connector = fakeConnector('clubspire', () =>
      Promise.resolve([slot('10:00', '11:00', 1)]),
    );
    const service = createAvailabilityService({
      connectors: [connector],
      now: clock.now,
      logger: silentLogger,
    });
    await service.getAvailability(KUKLENSKA, DATE);
    clock.advance(AVAILABILITY_CACHE_TTL_MS - 1);
    const cached = await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(connector.calls.length, 1);
    assert.equal(cached.checkedAt, firstCheckedAt);

    clock.advance(1); // exactly 15 minutes old -> expired
    const refreshed = await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(connector.calls.length, 2);
    assert.equal(refreshed.checkedAt, clock.now().toISOString());
  });

  it('caches per venue and date', async () => {
    const connector = fakeConnector('clubspire', () => Promise.resolve([]));
    const service = createAvailabilityService({
      connectors: [connector],
      now: fakeClock().now,
      logger: silentLogger,
    });
    await service.getAvailability(KUKLENSKA, DATE);
    await service.getAvailability(KUKLENSKA, '2026-11-26');
    await service.getAvailability(venue('centrum-viktoria'), DATE);
    assert.equal(connector.calls.length, 3);
  });

  it('does not cache failures', async () => {
    let fail = true;
    const connector = fakeConnector('clubspire', () =>
      fail ? Promise.reject(new Error('down')) : Promise.resolve([slot('10:00', '11:00', 1)]),
    );
    const service = createAvailabilityService({
      connectors: [connector],
      now: fakeClock().now,
      logger: silentLogger,
    });
    assert.equal((await service.getAvailability(KUKLENSKA, DATE)).status, 'unavailable');
    fail = false;
    assert.equal((await service.getAvailability(KUKLENSKA, DATE)).status, 'live');
    assert.equal(connector.calls.length, 2);
  });

  it('de-duplicates concurrent in-flight requests for the same venue and date', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const connector = fakeConnector('clubspire', async () => {
      await gate;
      return [slot('10:00', '11:00', 1)];
    });
    const service = createAvailabilityService({
      connectors: [connector],
      now: fakeClock().now,
      logger: silentLogger,
    });
    const pending = [
      service.getAvailability(KUKLENSKA, DATE),
      service.getAvailability(KUKLENSKA, DATE),
      service.getAvailability(KUKLENSKA, DATE),
    ];
    release();
    const results = await Promise.all(pending);
    assert.equal(connector.calls.length, 1);
    assert.ok(results.every((r) => r.status === 'live'));
  });

  it('does not let callers mutate cached slots', async () => {
    const connector = fakeConnector('clubspire', () =>
      Promise.resolve([slot('10:00', '11:00', 1)]),
    );
    const service = createAvailabilityService({
      connectors: [connector],
      now: fakeClock().now,
      logger: silentLogger,
    });
    const first = await service.getAvailability(KUKLENSKA, DATE);
    first.freeSlots.length = 0;
    const second = await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(second.freeSlots.length, 1);
  });
});
