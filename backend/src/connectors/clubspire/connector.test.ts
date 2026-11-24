import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { VENUE_RECORDS } from '../../data/venues.ts';
import { htmlResponse, recordingFetch, slot } from '../../testHelpers.ts';
import type { VenueRecord } from '../../repositories/venueRepository.ts';
import { buildClubspireUrl, createClubspireConnector } from './connector.ts';

const KUKLENSKA_HTML = readFileSync(
  new URL('./fixtures/kuklenska-2026-11-25.html', import.meta.url),
  'utf8',
);

function venue(id: string): VenueRecord {
  const found = VENUE_RECORDS.find((v) => v.id === id);
  if (!found) throw new Error(`unknown venue ${id}`);
  return found;
}

describe('buildClubspireUrl', () => {
  it('builds timeline/day URL with local-midnight timestamp (winter, CET)', () => {
    const url = buildClubspireUrl(
      { type: 'clubspire', baseUrl: 'https://kuklenska.clubspire.cz/', tabIdx: 0 },
      '2026-11-25',
    );
    assert.equal(
      url.href,
      `https://kuklenska.clubspire.cz/timeline/day?tabIdx=0&criteriaTimestamp=${Date.parse('2026-11-24T23:00:00Z')}&resetFilter=true`,
    );
  });

  it('uses the summer-time offset and keeps port and tabIdx', () => {
    const url = buildClubspireUrl(
      { type: 'clubspire', baseUrl: 'https://rezervace.centrumviktoria.cz:18443/', tabIdx: 1 },
      '2026-07-01',
    );
    assert.equal(url.host, 'rezervace.centrumviktoria.cz:18443');
    assert.equal(url.pathname, '/timeline/day');
    assert.equal(url.searchParams.get('tabIdx'), '1');
    assert.equal(
      url.searchParams.get('criteriaTimestamp'),
      String(Date.parse('2026-06-30T22:00:00Z')),
    );
    assert.equal(url.searchParams.get('resetFilter'), 'true');
  });
});

describe('ClubSpire connector', () => {
  it('fetches the timeline with User-Agent and a timeout signal, then parses it', async () => {
    const fetchFn = recordingFetch(() => htmlResponse(KUKLENSKA_HTML));
    const connector = createClubspireConnector({ fetch: fetchFn });
    const slots = await connector.getFreeSlots(venue('kuklenska'), '2026-11-25');
    assert.equal(slots[0]?.start, '07:00');
    assert.deepEqual(slots.at(-1), slot('21:00', '22:00', 1));
    assert.equal(fetchFn.calls.length, 1);
    const call = fetchFn.calls[0];
    assert.equal(call?.url.host, 'kuklenska.clubspire.cz');
    assert.deepEqual(call?.init?.headers, { 'user-agent': 'SpotRadar/1.0' });
    assert.ok(call?.init?.signal instanceof AbortSignal);
  });

  it('rejects on a non-2xx response', async () => {
    const connector = createClubspireConnector({
      fetch: recordingFetch(() => htmlResponse('nope', 503)),
    });
    await assert.rejects(connector.getFreeSlots(venue('kuklenska'), '2026-11-25'), /HTTP 503/);
  });

  it('rejects on a page that is not a timeline', async () => {
    const connector = createClubspireConnector({
      fetch: recordingFetch(() => htmlResponse('<html>maintenance</html>')),
    });
    await assert.rejects(connector.getFreeSlots(venue('kuklenska'), '2026-11-25'));
  });

  it('rejects when the request times out', async () => {
    const hanging = recordingFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const connector = createClubspireConnector({ fetch: hanging, timeoutMs: 20 });
    await assert.rejects(connector.getFreeSlots(venue('kuklenska'), '2026-11-25'), /aborted/);
  });

  it('rejects for a venue that is not a ClubSpire venue', async () => {
    const connector = createClubspireConnector({ fetch: recordingFetch(() => htmlResponse('')) });
    await assert.rejects(
      connector.getFreeSlots(venue('hala-sprint'), '2026-11-25'),
      /not a ClubSpire/,
    );
  });

  it('allows only one concurrent request per host but parallel requests across hosts', async () => {
    let active = 0;
    let maxActiveSameHost = 0;
    const activeByHost = new Map<string, number>();
    const fetchFn = recordingFetch(async (url) => {
      active++;
      const n = (activeByHost.get(url.host) ?? 0) + 1;
      activeByHost.set(url.host, n);
      maxActiveSameHost = Math.max(maxActiveSameHost, n);
      await new Promise((r) => setTimeout(r, 15));
      activeByHost.set(url.host, n - 1);
      active--;
      return htmlResponse(KUKLENSKA_HTML);
    });
    const connector = createClubspireConnector({ fetch: fetchFn });
    const kuklenska = venue('kuklenska');
    await Promise.all([
      connector.getFreeSlots(kuklenska, '2026-11-25'),
      connector.getFreeSlots(kuklenska, '2026-11-26'),
      connector.getFreeSlots(kuklenska, '2026-11-27'),
    ]);
    assert.equal(maxActiveSameHost, 1);
    assert.equal(fetchFn.calls.length, 3);
    assert.equal(active, 0);

    // Different hosts overlap.
    let overlap = 0;
    let maxOverlap = 0;
    const slowFetch = recordingFetch(async () => {
      overlap++;
      maxOverlap = Math.max(maxOverlap, overlap);
      await new Promise((r) => setTimeout(r, 15));
      overlap--;
      return htmlResponse(KUKLENSKA_HTML);
    });
    const parallel = createClubspireConnector({ fetch: slowFetch });
    await Promise.all([
      parallel.getFreeSlots(kuklenska, '2026-11-25'),
      parallel.getFreeSlots(venue('centrum-viktoria'), '2026-11-25'),
    ]);
    assert.equal(maxOverlap, 2);
  });
});
