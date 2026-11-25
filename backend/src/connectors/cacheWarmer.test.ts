import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { VENUE_RECORDS } from '../data/venues.ts';
import { createVenueRepository } from '../repositories/venueRepository.ts';
import type { VenueRecord } from '../repositories/venueRepository.ts';
import { fakeClock, fakeConnector, silentLogger, slot } from '../testHelpers.ts';
import { createAvailabilityService } from './availabilityService.ts';
import { createCacheWarmer } from './cacheWarmer.ts';

const found = VENUE_RECORDS.find((v) => v.id === 'kuklenska');
if (!found) throw new Error('kuklenska missing');
const BASE: VenueRecord = found;

function venue(id: string, host: string): VenueRecord {
  return { ...BASE, id, source: { type: 'clubspire', baseUrl: `https://${host}/`, tabIdx: 1 } };
}

const A1 = venue('a1', 'a.example');
const A2 = venue('a2', 'a.example');
const B1 = venue('b1', 'b.example');
// No connector is registered for Bizzy in these tests -> never warmed.
const BIZZY: VenueRecord = {
  ...BASE,
  id: 'bizzy-venue',
  source: { type: 'bizzy', scheduleUrl: 'https://c.example/s' },
};

const WEEK = [
  '2026-11-24',
  '2026-11-25',
  '2026-11-26',
  '2026-11-27',
  '2026-11-28',
  '2026-11-29',
  '2026-11-30',
];

const refused = (): Error =>
  new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) });

type Impl = (venue: VenueRecord, date: string) => Promise<ReturnType<typeof slot>[]>;

function setup(
  impl: Impl = () => Promise.resolve([slot('10:00', '11:00', 1)]),
  clock = fakeClock(),
) {
  const connector = fakeConnector('clubspire', impl);
  const infos: string[] = [];
  const logger = { info: (m: string) => infos.push(m), warn: () => undefined };
  const availability = createAvailabilityService({
    connectors: [connector],
    now: clock.now,
    logger: silentLogger,
  });
  const warmer = createCacheWarmer({
    venues: createVenueRepository([A1, A2, B1, BIZZY]),
    availability,
    now: clock.now,
    logger,
  });
  return { connector, infos, availability, warmer, clock };
}

describe('cache warmer', () => {
  it('reads 7 days from today (Prague) for every supported venue', async () => {
    const { connector, warmer, infos } = setup();
    const report = await warmer.runOnce();
    assert.equal(connector.calls.length, 21);
    for (const id of ['a1', 'a2', 'b1']) {
      assert.deepEqual(
        connector.calls.filter((c) => c.venueId === id).map((c) => c.date),
        WEEK,
      );
    }
    assert.equal(
      connector.calls.some((c) => c.venueId === 'bizzy-venue'),
      false,
    );
    assert.deepEqual(
      { read: report.read, skipped: report.skipped, failed: report.failed },
      { read: 21, skipped: 0, failed: 0 },
    );
    assert.deepEqual(report.skippedHosts, []);
    assert.equal(infos.length, 1);
    assert.match(infos[0] ?? '', /^\[warmer\] pass in \d+ ms: 21 read, 0 skipped, 0 failed/);
  });

  it('runs hosts in parallel but one read at a time per host', async () => {
    const active = new Map<string, number>();
    let maxPerHost = 0;
    let maxTotal = 0;
    let total = 0;
    const { warmer } = setup(async (v) => {
      const host = v.id.startsWith('a') ? 'a' : 'b';
      active.set(host, (active.get(host) ?? 0) + 1);
      total++;
      maxPerHost = Math.max(maxPerHost, active.get(host) ?? 0);
      maxTotal = Math.max(maxTotal, total);
      await new Promise((resolve) => setImmediate(resolve));
      active.set(host, (active.get(host) ?? 1) - 1);
      total--;
      return [];
    });
    await warmer.runOnce();
    assert.equal(maxPerHost, 1);
    assert.equal(maxTotal, 2);
  });

  it('skips the rest of a host after a connection error but still warms other hosts', async () => {
    const { connector, warmer, availability } = setup((v) =>
      v.id.startsWith('a') ? Promise.reject(refused()) : Promise.resolve([]),
    );
    const report = await warmer.runOnce();
    assert.equal(connector.calls.filter((c) => c.venueId.startsWith('a')).length, 1);
    assert.equal(connector.calls.filter((c) => c.venueId === 'b1').length, 7);
    assert.deepEqual(
      { read: report.read, skipped: report.skipped, failed: report.failed },
      { read: 7, skipped: 13, failed: 1 },
    );
    assert.deepEqual(report.skippedHosts, ['a.example']);
    assert.equal(availability.isHostBackedOff('a.example'), true);
  });

  it('skips backed-off hosts entirely', async () => {
    const { connector, warmer, availability } = setup((v) =>
      v.id.startsWith('a') ? Promise.reject(refused()) : Promise.resolve([]),
    );
    await availability.getAvailability(A1, WEEK[0] ?? ''); // puts a.example into backoff
    connector.calls.length = 0;
    const report = await warmer.runOnce();
    assert.equal(
      connector.calls.some((c) => c.venueId.startsWith('a')),
      false,
    );
    assert.equal(report.skipped, 14);
    assert.deepEqual(report.skippedHosts, ['a.example']);
    assert.equal(report.read, 7);
  });

  it('after a non-connection error skips only the rest of that venue in this pass', async () => {
    const { connector, warmer } = setup((v, date) =>
      v.id === 'a1' && date === '2026-11-26'
        ? Promise.reject(new Error('HTTP 500'))
        : Promise.resolve([]),
    );
    const report = await warmer.runOnce();
    // a1: 24th, 25th, 26th (fails), then its 4 later dates are skipped; a2 and b1 are warmed fully.
    assert.deepEqual(
      connector.calls.filter((c) => c.venueId === 'a1').map((c) => c.date),
      WEEK.slice(0, 3),
    );
    assert.equal(connector.calls.filter((c) => c.venueId === 'a2').length, 7);
    assert.equal(connector.calls.length, 17);
    assert.deepEqual(
      { read: report.read, skipped: report.skipped, failed: report.failed },
      { read: 16, skipped: 4, failed: 1 },
    );
    assert.deepEqual(report.skippedHosts, []);
  });

  it('does not re-read entries that stay fresh until the next pass', async () => {
    const { connector, warmer, clock } = setup();
    await warmer.runOnce();
    clock.advance(4 * 60 * 1000); // younger than ttl - interval (5 min)
    const report = await warmer.runOnce();
    assert.equal(connector.calls.length, 21);
    assert.equal(report.skipped, 21);
    clock.advance(2 * 60 * 1000); // would expire before the pass after this one
    assert.equal((await warmer.runOnce()).read, 21);
  });

  it('never overlaps passes', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { connector, warmer } = setup(async () => {
      await gate;
      return [];
    });
    const first = warmer.runOnce();
    const second = warmer.runOnce();
    release();
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(r1, r2);
    assert.equal(connector.calls.length, 21);
  });

  it('uses the Prague date for "today"', async () => {
    const clock = fakeClock(new Date('2026-11-24T23:30:00Z')); // already Nov 25 in Prague
    const { connector, warmer } = setup(undefined, clock);
    await warmer.runOnce();
    assert.equal(connector.calls[0]?.date, '2026-11-25');
  });

  it('start() runs immediately and every interval, stop() ends the timer', async (t) => {
    t.after(() => mock.timers.reset());
    mock.timers.enable({ apis: ['setInterval'] });
    const { warmer, infos } = setup();
    const passes = (): number => infos.filter((m) => m.startsWith('[warmer]')).length;
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    };

    warmer.start();
    warmer.start(); // second call must not add a second timer
    await settle();
    assert.equal(passes(), 1);

    mock.timers.tick(10 * 60 * 1000);
    await settle();
    assert.equal(passes(), 2);

    warmer.stop();
    mock.timers.tick(30 * 60 * 1000);
    await settle();
    assert.equal(passes(), 2);
  });

  it('does nothing until started or run', () => {
    const { connector } = setup();
    assert.equal(connector.calls.length, 0);
  });
});
