import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import { createReenioConnector } from './connector.ts';
import { serveReenioStub } from './stub.ts';

const SOURCE = {
  type: 'reenio',
  baseUrl: 'https://tjteslabrno.reenio.cz/cs',
  resourceId: 51584,
} as const;
const TARGET = { venueId: 'tj-tesla-brno', sport: 'volleyball', source: SOURCE } as const;
const EXPECTED = [slot('06:00', '07:45', 1), slot('09:30', '11:00', 1), slot('21:30', '22:30', 1)];

function stubFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return Promise.resolve(serveReenioStub(new URL(url), init));
}

describe('serveReenioStub', () => {
  it('serves the recorded free time for any requested date, also across DST', async () => {
    const now = () => Date.parse('2026-01-01T00:00:00Z');
    const connector = createReenioConnector({ fetch: stubFetch, now });
    for (const date of ['2026-11-27', '2026-12-05', '2027-03-29', '2027-07-01']) {
      assert.deepEqual(await connector.getFreeSlots(TARGET, date), EXPECTED, date);
    }
  });

  it('keeps the booking lead time of the real parser', async () => {
    // 06:30 local on the requested day: bookable from 08:30, so the first gap is gone.
    const connector = createReenioConnector({
      fetch: stubFetch,
      now: () => Date.parse('2026-12-05T05:30:00Z'),
    });
    assert.deepEqual(await connector.getFreeSlots(TARGET, '2026-12-05'), EXPECTED.slice(1));
  });

  it('rejects other URLs and requests without a date', () => {
    const url = new URL('https://tjteslabrno.reenio.cz/cs/api/Term/List');
    assert.throws(() => serveReenioStub(new URL('https://tjteslabrno.reenio.cz/cs/'), undefined));
    assert.throws(() => serveReenioStub(url, { method: 'POST', body: new FormData() }), /date/);
  });
});
