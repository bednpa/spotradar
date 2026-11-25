import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VENUE_RECORDS } from '../data/venues.ts';
import { fakeClock, fakeConnector, silentLogger, slot, targetOf } from '../testHelpers.ts';
import {
  AVAILABILITY_CACHE_TTL_MS,
  AVAILABILITY_STALE_MAX_AGE_MS,
  BACKOFF_INITIAL_MS,
  createAvailabilityService,
  createDefaultConnectors,
  isConnectionError,
  sourceHost,
} from './availabilityService.ts';
import { UpstreamTimeoutError } from './timeout.ts';
import type { AvailabilityConnector, AvailabilityTarget } from './types.ts';

/** The badminton offering of a real venue as an availability target. */
function venue(id: string): AvailabilityTarget {
  const found = VENUE_RECORDS.find((v) => v.id === id);
  if (!found) throw new Error(`unknown venue ${id}`);
  return targetOf(found, 'badminton');
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

  it('registers connectors for ClubSpire, MemberZone, MemberPro and Bizzy', () => {
    const service = createAvailabilityService({
      connectors: createDefaultConnectors({ fetch: () => Promise.reject(new Error('no network')) }),
      now: fakeClock().now,
      logger: silentLogger,
    });
    for (const id of [
      'kuklenska',
      'centrum-viktoria',
      'hala-sprint',
      'sportcentrum-ivanovice',
      'badminton-jehnice',
      'badminton-lisen',
      'x-arena-slatina',
    ]) {
      assert.equal(service.supports(venue(id)), true, id);
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
      logger: { info: () => undefined, warn: (m) => warnings.push(m) },
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

    clock.advance(1); // exactly 15 minutes old -> expired: served stale, refreshed in background
    const stale = await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(stale.checkedAt, firstCheckedAt);
    await settle();
    assert.equal(connector.calls.length, 2);
    const refreshed = await service.getAvailability(KUKLENSKA, DATE);
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

const MIN = 60 * 1000;
const refused = (): Error =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
  });
const KUKLENSKA_HOST = sourceHost(KUKLENSKA.source) ?? '';

/** Lets fire-and-forget background work settle. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('stale-while-revalidate', () => {
  function setup(impl: () => Promise<ReturnType<typeof slot>[]>) {
    const clock = fakeClock();
    const connector = fakeConnector('clubspire', impl);
    const warnings: string[] = [];
    const infos: string[] = [];
    const service = createAvailabilityService({
      connectors: [connector],
      now: clock.now,
      logger: { info: (m) => infos.push(m), warn: (m) => warnings.push(m) },
    });
    return { clock, connector, service, warnings, infos };
  }

  it('serves a fresh entry without touching the connector', async () => {
    const { clock, connector, service } = setup(() => Promise.resolve([slot('10:00', '11:00', 1)]));
    await service.getAvailability(KUKLENSKA, DATE);
    clock.advance(AVAILABILITY_CACHE_TTL_MS - 1);
    await service.getAvailability(KUKLENSKA, DATE);
    await settle();
    assert.equal(connector.calls.length, 1);
  });

  it('serves a stale entry with its original checkedAt and refreshes in the background', async () => {
    let freeCourts = 1;
    const { clock, connector, service } = setup(() =>
      Promise.resolve([slot('10:00', '11:00', freeCourts)]),
    );
    const first = await service.getAvailability(KUKLENSKA, DATE);
    clock.advance(AVAILABILITY_CACHE_TTL_MS + MIN);
    freeCourts = 2;
    const stale = await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(stale.checkedAt, first.checkedAt);
    assert.equal(stale.freeSlots[0]?.freeCourts, 1);
    await settle();
    assert.equal(connector.calls.length, 2);
    const refreshed = await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(refreshed.checkedAt, clock.now().toISOString());
    assert.equal(refreshed.freeSlots[0]?.freeCourts, 2);
    assert.equal(connector.calls.length, 2);
  });

  it('shares one background refresh between concurrent stale requests', async () => {
    const { clock, connector, service } = setup(() => Promise.resolve([]));
    await service.getAvailability(KUKLENSKA, DATE);
    clock.advance(AVAILABILITY_CACHE_TTL_MS);
    await Promise.all([
      service.getAvailability(KUKLENSKA, DATE),
      service.getAvailability(KUKLENSKA, DATE),
    ]);
    await settle();
    assert.equal(connector.calls.length, 2);
  });

  it('reads blocking when the entry is older than staleMaxAge', async () => {
    const { clock, connector, service } = setup(() => Promise.resolve([]));
    await service.getAvailability(KUKLENSKA, DATE);
    clock.advance(AVAILABILITY_STALE_MAX_AGE_MS);
    const result = await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(connector.calls.length, 2);
    assert.equal(result.checkedAt, clock.now().toISOString());
  });

  it('keeps the stale entry and does not reject when the background refresh fails', async () => {
    let fail = false;
    const { clock, connector, service, warnings } = setup(() =>
      fail ? Promise.reject(new Error('boom')) : Promise.resolve([slot('10:00', '11:00', 1)]),
    );
    const first = await service.getAvailability(KUKLENSKA, DATE);
    clock.advance(AVAILABILITY_CACHE_TTL_MS + MIN);
    fail = true;
    const stale = await service.getAvailability(KUKLENSKA, DATE);
    await settle();
    assert.equal(connector.calls.length, 2);
    assert.equal(stale.status, 'live');
    assert.equal(warnings.length, 1);
    const again = await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(again.status, 'live');
    assert.equal(again.checkedAt, first.checkedAt);
  });

  it('evicts entries older than staleMaxAge on the next write', async () => {
    const { clock, connector, service } = setup(() => Promise.resolve([]));
    await service.getAvailability(KUKLENSKA, DATE);
    clock.advance(AVAILABILITY_STALE_MAX_AGE_MS + MIN);
    await service.getAvailability(KUKLENSKA, '2026-11-26'); // write sweeps the old entry
    await service.getAvailability(KUKLENSKA, DATE); // must be a blocking read again
    assert.equal(connector.calls.length, 3);
  });

  it('logs every read with duration and outcome', async () => {
    let fail = false;
    const { service, infos } = setup(() =>
      fail ? Promise.reject(new Error('boom')) : Promise.resolve([]),
    );
    await service.getAvailability(KUKLENSKA, DATE);
    fail = true;
    await service.getAvailability(KUKLENSKA, '2026-11-26');
    assert.match(
      infos[0] ?? '',
      /^\[availability\] kuklenska\/badminton 2026-11-25 read in \d+ ms \(ok\)$/,
    );
    assert.match(
      infos[1] ?? '',
      /^\[availability\] kuklenska\/badminton 2026-11-26 read in \d+ ms \(failed: boom\)$/,
    );
  });
});

describe('warning rate limit', () => {
  it('warns once per host per hour and reports the suppressed count', async () => {
    const clock = fakeClock();
    const warnings: string[] = [];
    const service = createAvailabilityService({
      connectors: [fakeConnector('clubspire', () => Promise.reject(new Error('HTTP 500')))],
      now: clock.now,
      logger: { info: () => undefined, warn: (m) => warnings.push(m) },
    });
    for (const date of ['2026-11-25', '2026-11-26', '2026-11-27']) {
      await service.getAvailability(KUKLENSKA, date);
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /HTTP 500/);
    assert.doesNotMatch(warnings[0] ?? '', /suppressed/);

    clock.advance(60 * MIN);
    await service.getAvailability(KUKLENSKA, '2026-11-28');
    assert.equal(warnings.length, 2);
    assert.match(warnings[1] ?? '', /2 failures suppressed/);
  });

  it('limits connection and other failures separately, so a parse error is not hidden', async () => {
    const clock = fakeClock();
    const warnings: string[] = [];
    let error: Error = refused();
    const service = createAvailabilityService({
      connectors: [fakeConnector('clubspire', () => Promise.reject(error))],
      now: clock.now,
      logger: { info: () => undefined, warn: (m) => warnings.push(m) },
    });
    await service.getAvailability(KUKLENSKA, '2026-11-25');
    clock.advance(BACKOFF_INITIAL_MS + MIN); // past the backoff, well within the warning hour
    error = new Error('schedule table missing');
    await service.getAvailability(KUKLENSKA, '2026-11-26');
    await service.getAvailability(KUKLENSKA, '2026-11-27');
    assert.equal(warnings.length, 2);
    assert.match(warnings[0] ?? '', /unreachable \(ECONNREFUSED\)/);
    assert.match(
      warnings[1] ?? '',
      /read failed for kuklenska\/badminton on 2026-11-26: schedule table missing/,
    );
  });

  it('never throws synchronously when a connector throws instead of rejecting', async () => {
    const clock = fakeClock();
    let throwNow = false;
    const connector: AvailabilityConnector = {
      type: 'clubspire',
      getFreeSlots: () => {
        if (throwNow) throw new Error('sync boom');
        return Promise.resolve([slot('10:00', '11:00', 1)]);
      },
    };
    const service = createAvailabilityService({
      connectors: [connector],
      now: clock.now,
      logger: silentLogger,
    });
    await service.getAvailability(KUKLENSKA, DATE);
    clock.advance(AVAILABILITY_CACHE_TTL_MS + MIN);
    throwNow = true;
    // stale path (background refresh) and blocking path both stay non-throwing
    assert.equal((await service.getAvailability(KUKLENSKA, DATE)).status, 'live');
    assert.equal((await service.getAvailability(KUKLENSKA, '2026-11-26')).status, 'unavailable');
    assert.equal(await service.warm(KUKLENSKA, '2026-11-27'), 'failed');
  });

  it('describes unreachable hosts clearly', async () => {
    const warnings: string[] = [];
    const service = createAvailabilityService({
      connectors: [fakeConnector('clubspire', () => Promise.reject(refused()))],
      now: fakeClock().now,
      logger: { info: () => undefined, warn: (m) => warnings.push(m) },
    });
    await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(
      warnings[0],
      `${KUKLENSKA_HOST} unreachable (ECONNREFUSED): its venues show "check on website"; next warning in 60 min`,
    );
  });
});

describe('host backoff', () => {
  function setup() {
    const clock = fakeClock();
    let fail = true;
    const connector = fakeConnector('clubspire', () =>
      fail ? Promise.reject(refused()) : Promise.resolve([slot('10:00', '11:00', 1)]),
    );
    const service = createAvailabilityService({
      connectors: [connector],
      now: clock.now,
      logger: silentLogger,
    });
    return {
      clock,
      connector,
      service,
      recover: () => {
        fail = false;
      },
    };
  }

  it('returns unavailable immediately without calling the connector while backed off', async () => {
    const { connector, service } = setup();
    assert.equal((await service.getAvailability(KUKLENSKA, DATE)).status, 'unavailable');
    assert.equal(service.isHostBackedOff(KUKLENSKA_HOST), true);
    const other = await service.getAvailability(KUKLENSKA, '2026-11-26');
    assert.deepEqual(other, { status: 'unavailable', freeSlots: [] });
    assert.equal(connector.calls.length, 1);
  });

  it('doubles the backoff on each further connection failure, capped at 60 minutes', async () => {
    const { clock, connector, service } = setup();
    const expected = [5, 10, 20, 40, 60, 60];
    let calls = 0;
    for (const minutes of expected) {
      await service.getAvailability(KUKLENSKA, DATE);
      calls++;
      assert.equal(connector.calls.length, calls);
      clock.advance(minutes * MIN - 1);
      assert.equal(service.isHostBackedOff(KUKLENSKA_HOST), true, `${minutes} min - 1 ms`);
      clock.advance(1);
      assert.equal(service.isHostBackedOff(KUKLENSKA_HOST), false, `${minutes} min`);
    }
  });

  it('resets after a success', async () => {
    const { clock, connector, service, recover } = setup();
    await service.getAvailability(KUKLENSKA, DATE);
    clock.advance(5 * MIN);
    await service.getAvailability(KUKLENSKA, DATE); // fails again -> 10 min
    clock.advance(10 * MIN);
    recover();
    assert.equal((await service.getAvailability(KUKLENSKA, DATE)).status, 'live');
    assert.equal(service.isHostBackedOff(KUKLENSKA_HOST), false);
    assert.equal(connector.calls.length, 3);
  });

  it('does not back off on non-connection errors', async () => {
    const connector = fakeConnector('clubspire', () => Promise.reject(new Error('HTTP 500')));
    const service = createAvailabilityService({
      connectors: [connector],
      now: fakeClock().now,
      logger: silentLogger,
    });
    await service.getAvailability(KUKLENSKA, DATE);
    await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(service.isHostBackedOff(KUKLENSKA_HOST), false);
    assert.equal(connector.calls.length, 2);
  });

  it('still serves a usable cache entry while the host is backed off', async () => {
    const clock = fakeClock();
    let fail = false;
    const connector = fakeConnector('clubspire', () =>
      fail ? Promise.reject(refused()) : Promise.resolve([slot('10:00', '11:00', 1)]),
    );
    const service = createAvailabilityService({
      connectors: [connector],
      now: clock.now,
      logger: silentLogger,
    });
    await service.getAvailability(KUKLENSKA, DATE);
    fail = true;
    await service.getAvailability(KUKLENSKA, '2026-11-26'); // backs the host off
    const cached = await service.getAvailability(KUKLENSKA, DATE);
    assert.equal(cached.status, 'live');
    assert.equal(connector.calls.length, 2);
  });

  it('warm() skips backed-off hosts, fresh entries, and reports failures', async () => {
    const { clock, connector, service, recover } = setup();
    assert.equal(await service.warm(KUKLENSKA, DATE), 'failed');
    assert.equal(await service.warm(KUKLENSKA, DATE), 'skipped'); // backed off
    clock.advance(5 * MIN);
    recover();
    assert.equal(await service.warm(KUKLENSKA, DATE), 'ok');
    assert.equal(await service.warm(KUKLENSKA, DATE, { refreshIfOlderThanMs: 5 * MIN }), 'skipped');
    clock.advance(5 * MIN);
    assert.equal(await service.warm(KUKLENSKA, DATE, { refreshIfOlderThanMs: 5 * MIN }), 'ok');
    assert.equal(connector.calls.length, 3);
  });
});

describe('isConnectionError', () => {
  it('recognises connection codes on nested causes', () => {
    assert.equal(isConnectionError(refused()), true);
    const deep = new Error('outer', { cause: new Error('mid', { cause: { code: 'ENOTFOUND' } }) });
    assert.equal(isConnectionError(deep), true);
    for (const code of ['ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EAI_AGAIN']) {
      assert.equal(isConnectionError({ code }), true, code);
    }
    assert.equal(isConnectionError({ code: 'UND_ERR_CONNECT_TIMEOUT' }), true);
    assert.equal(isConnectionError({ code: 'UND_ERR_SOCKET' }), true);
  });

  it('recognises our own timeout, also as a cause', () => {
    assert.equal(isConnectionError(new UpstreamTimeoutError(8000)), true);
    assert.equal(
      isConnectionError(new TypeError('x', { cause: new UpstreamTimeoutError(1) })),
      true,
    );
    assert.equal(new UpstreamTimeoutError(8000).message, 'Request timed out after 8000 ms');
  });

  it('rejects other errors', () => {
    assert.equal(isConnectionError(new Error('HTTP 500')), false);
    assert.equal(isConnectionError(new Error('x', { cause: { code: 'EACCES' } })), false);
    assert.equal(isConnectionError('ECONNREFUSED'), false);
    assert.equal(isConnectionError(undefined), false);
  });
});

describe('sourceHost', () => {
  it('maps every source type to its host', () => {
    assert.equal(
      sourceHost({ type: 'clubspire', baseUrl: 'https://a.example/x/', tabIdx: 1 }),
      'a.example',
    );
    assert.equal(
      sourceHost({ type: 'bizzy', scheduleUrl: 'https://b.example/s?x=1' }),
      'b.example',
    );
    assert.equal(
      sourceHost({ type: 'memberzone', url: 'https://c.example:8443/p' }),
      'c.example:8443',
    );
    assert.equal(
      sourceHost({
        type: 'memberpro',
        url: 'https://d.example/p',
        sportButton: { name: 'BTN5', value: 'Badminton' },
      }),
      'd.example',
    );
    assert.equal(
      sourceHost({ type: 'starez', url: 'https://beach.example/rez', facility: 'Beach' }),
      'beach.example',
    );
    assert.equal(sourceHost({ type: 'none' }), undefined);
    assert.equal(sourceHost({ type: 'memberzone', url: 'not a url' }), undefined);
  });
});
