import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import { createIsportsystemConnector } from './connector.ts';
import { serveIsportsystemStub } from './stub.ts';

const SOURCE = {
  type: 'isportsystem',
  baseUrl: 'https://squashslovan.isportsystem.cz',
  sportId: 1,
} as const;
const TARGET = { venueId: 'squash-slovan', sport: 'squash', source: SOURCE } as const;

function stubFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return Promise.resolve(serveIsportsystemStub(new URL(url), init));
}

describe('serveIsportsystemStub', () => {
  it('shows the recorded schema starting at the requested date', async () => {
    for (const date of ['2026-11-26', '2026-12-30', '2027-01-02', '2027-03-15']) {
      // A fresh connector per date: the answer of one date also holds the following days.
      const connector = createIsportsystemConnector({ fetch: stubFetch });
      // Day 1 of the answer: courts 1 and 2 are free 19:00-20:00 (by phone only).
      assert.deepEqual(await connector.getFreeSlots(TARGET, date), [slot('19:00', '20:00', 2)]);
    }
  });

  it('serves the following days of the answer too (day 2 = recorded 27.11.)', async () => {
    const connector = createIsportsystemConnector({ fetch: stubFetch });
    await connector.getFreeSlots(TARGET, '2026-12-30'); // answer holds 30.12.-2.1.
    assert.deepEqual(await connector.getFreeSlots(TARGET, '2026-12-31'), [
      slot('06:00', '08:00', 3),
      slot('15:00', '17:00', 3),
      slot('17:00', '18:00', 2),
    ]);
  });

  it('rejects other URLs and requests without a valid date', () => {
    const url = new URL('https://squashslovan.isportsystem.cz/ajax/ajax.schema.php');
    assert.throws(() =>
      serveIsportsystemStub(new URL('https://squashslovan.isportsystem.cz/'), undefined),
    );
    assert.throws(() => serveIsportsystemStub(url, { method: 'POST', body: 'day=1' }), /date/);
  });
});
