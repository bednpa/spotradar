import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fakeClock, slot } from '../../testHelpers.ts';
import { createRezzyConnector } from './connector.ts';
import { serveRezzyStub } from './stub.ts';

describe('serveRezzyStub', () => {
  const stubFetch = (input: string | URL): Promise<Response> =>
    Promise.resolve(serveRezzyStub(new URL(input)));

  it('serves the recorded area detail and blockers of tenant 15 / area 33 for any date', async () => {
    const area = serveRezzyStub(
      new URL('https://www.rezzy.eu/api/sportarea/v1/Tenants/15/SportAreas/33?date=2027-02-03'),
    );
    assert.equal(area.status, 200);
    const detail = (await area.json()) as { id: number; availablePlayfields: unknown[] };
    assert.equal(detail.id, 33);
    assert.equal(detail.availablePlayfields.length, 4);
    const blockers = serveRezzyStub(
      new URL(
        'https://www.rezzy.eu/api/reservation/v1/Tenants/15/SportAreas/33/CustomerSchedules/ReservationBlockers?date=2027-02-03',
      ),
    );
    assert.equal(((await blockers.json()) as unknown[]).length, 8);
  });

  it('answers 404 for another tenant, area or path', () => {
    assert.equal(
      serveRezzyStub(new URL('https://www.rezzy.eu/api/sportarea/v1/Tenants/99/SportAreas/1'))
        .status,
      404,
    );
    assert.equal(serveRezzyStub(new URL('https://www.rezzy.eu/')).status, 404);
  });

  it('feeds the real connector', async () => {
    const connector = createRezzyConnector({ fetch: stubFetch, now: fakeClock().now });
    const slots = await connector.getFreeSlots(
      { venueId: 'v', sport: 'tennis', source: { type: 'rezzy', tenantId: 15, sportAreaId: 33 } },
      '2026-11-26',
    );
    assert.deepEqual(slots[0], slot('09:00', '11:00', 2));
    await assert.rejects(
      connector.getFreeSlots(
        { venueId: 'v', sport: 'tennis', source: { type: 'rezzy', tenantId: 99, sportAreaId: 1 } },
        '2026-11-26',
      ),
      /HTTP 404/,
    );
  });
});
