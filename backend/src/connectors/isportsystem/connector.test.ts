import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AvailabilitySourceConfig } from '@spotradar/shared';
import { fakeClock, htmlResponse, recordingFetch, slot } from '../../testHelpers.ts';
import { UpstreamTimeoutError } from '../timeout.ts';
import type { AvailabilityTarget } from '../types.ts';
import {
  ANSWER_REUSE_MS,
  buildIsportsystemBody,
  buildIsportsystemUrl,
  createIsportsystemConnector,
} from './connector.ts';
import { IsportsystemParseError } from './parser.ts';

const HTML = readFileSync(
  new URL('./fixtures/slovan-2026-11-26-schema.html', import.meta.url),
  'utf8',
);
const SOURCE: Extract<AvailabilitySourceConfig, { type: 'isportsystem' }> = {
  type: 'isportsystem',
  baseUrl: 'https://squashslovan.isportsystem.cz',
  sportId: 1,
};
const SQUASH: AvailabilityTarget = { venueId: 'squash-slovan', sport: 'squash', source: SOURCE };

describe('request builders', () => {
  it('posts the page-load form of the requested day', () => {
    assert.equal(
      buildIsportsystemUrl(SOURCE).href,
      'https://squashslovan.isportsystem.cz/ajax/ajax.schema.php',
    );
    assert.equal(
      buildIsportsystemBody(SOURCE, '2026-11-26'),
      'id_sport=1&day=26&month=11&year=2026&event=pageLoad&timetableWidth=970',
    );
    assert.equal(
      buildIsportsystemBody(SOURCE, '2027-01-02'),
      'id_sport=1&day=2&month=1&year=2027&event=pageLoad&timetableWidth=970',
    );
  });
});

describe('iSportSystem connector', () => {
  it('reads the day with one POST', async () => {
    const fetchFn = recordingFetch(() => htmlResponse(HTML));
    const connector = createIsportsystemConnector({ fetch: fetchFn });
    assert.equal(connector.type, 'isportsystem');
    assert.deepEqual(await connector.getFreeSlots(SQUASH, '2026-11-27'), [
      slot('06:00', '08:00', 3),
      slot('15:00', '17:00', 3),
      slot('17:00', '18:00', 2),
    ]);
    assert.equal(fetchFn.calls.length, 1);
    const call = fetchFn.calls[0];
    assert.equal(call?.url.href, 'https://squashslovan.isportsystem.cz/ajax/ajax.schema.php');
    assert.equal(call?.init?.method, 'POST');
    assert.equal(call?.init?.body, buildIsportsystemBody(SOURCE, '2026-11-27'));
    const headers = call?.init?.headers as Record<string, string>;
    assert.equal(headers['user-agent'], 'SpotRadar/1.0');
    assert.equal(headers['content-type'], 'application/x-www-form-urlencoded');
    assert.ok(call?.init?.signal instanceof AbortSignal);
  });

  it('reuses the answer for the other days it holds and asks again for a missing day', async () => {
    const fetchFn = recordingFetch(() => htmlResponse(HTML));
    const clock = fakeClock();
    const connector = createIsportsystemConnector({
      fetch: fetchFn,
      now: () => clock.now().getTime(),
    });
    await connector.getFreeSlots(SQUASH, '2026-11-26');
    assert.deepEqual(await connector.getFreeSlots(SQUASH, '2026-11-28'), []);
    assert.equal(fetchFn.calls.length, 1);
    // A day outside the answer: new request carrying the new date (the recording lacks it → error).
    await assert.rejects(connector.getFreeSlots(SQUASH, '2026-12-05'), IsportsystemParseError);
    assert.equal(fetchFn.calls.length, 2);
    assert.match(String(fetchFn.calls[1]?.init?.body), /day=5&month=12&year=2026/);
    // After expiry the same day is requested again.
    clock.advance(ANSWER_REUSE_MS + 1);
    await connector.getFreeSlots(SQUASH, '2026-11-28');
    assert.equal(fetchFn.calls.length, 3);
    assert.match(String(fetchFn.calls[2]?.init?.body), /day=28&month=11/);
  });

  it('rejects HTTP errors, a wrong source type and a timeout', async () => {
    const down = createIsportsystemConnector({
      fetch: () => Promise.resolve(new Response('busy', { status: 503 })),
    });
    await assert.rejects(down.getFreeSlots(SQUASH, '2026-11-26'), /HTTP 503/);

    const connector = createIsportsystemConnector({
      fetch: () => Promise.resolve(htmlResponse(HTML)),
    });
    await assert.rejects(
      connector.getFreeSlots({ ...SQUASH, source: { type: 'none' } }, '2026-11-26'),
      /squash-slovan\/squash is not an iSportSystem source/,
    );

    const slow = createIsportsystemConnector({
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    });
    await assert.rejects(slow.getFreeSlots(SQUASH, '2026-11-26'), UpstreamTimeoutError);
  });

  it('rejects changed markup instead of returning partial data', async () => {
    const connector = createIsportsystemConnector({
      fetch: () => Promise.resolve(htmlResponse('<html><body>Nová stránka</body></html>')),
    });
    await assert.rejects(connector.getFreeSlots(SQUASH, '2026-11-26'), IsportsystemParseError);
  });
});
