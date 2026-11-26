import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PADELOS_SEARCH_URL, buildPadelosBody, createPadelosConnector } from './connector.ts';
import { servePadelosStub } from './stub.ts';

const URL_SEARCH = new URL(PADELOS_SEARCH_URL);

function post(clubId: string | undefined, date: string): RequestInit {
  return {
    method: 'POST',
    headers: clubId ? { 'x-clubos-club': clubId } : {},
    body: buildPadelosBody(date),
  };
}

describe('servePadelosStub', () => {
  it('serves Slatina (216930) for any date with the slot dates rewritten', async () => {
    const res = servePadelosStub(URL_SEARCH, post('216930', '2027-03-04'));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('"date": "2027-03-04"'));
    assert.ok(!text.includes('2026-11-27'));
  });

  it('the explicit date argument wins over the body', async () => {
    const text = await servePadelosStub(
      URL_SEARCH,
      post('216930', '2027-03-04'),
      '2027-05-06',
    ).text();
    assert.ok(text.includes('"date": "2027-05-06"'));
    assert.ok(!text.includes('2027-03-04'));
  });

  it('serves the empty Kraví hora answer, with the requested id, for unknown clubs', async () => {
    const body = (await servePadelosStub(URL_SEARCH, post('999', '2026-12-01')).json()) as {
      data: { id: string; availability: unknown[] }[];
    };
    assert.equal(body.data[0]?.id, '999');
    assert.deepEqual(body.data[0]?.availability, []);
  });

  it('answers 400 without a club header and 404 for other paths', () => {
    assert.equal(servePadelosStub(URL_SEARCH, post(undefined, '2026-12-01')).status, 400);
    assert.equal(
      servePadelosStub(new URL('https://api.padelos.co/other'), post('216930', '2026-12-01'))
        .status,
      404,
    );
  });

  it('feeds the real connector: free courts on any date, an empty day for other clubs', async () => {
    const connector = createPadelosConnector({
      fetch: (input, init) => Promise.resolve(servePadelosStub(new URL(input), init)),
    });
    const target = (clubId: string): Parameters<typeof connector.getFreeSlots>[0] => ({
      venueId: 'v',
      sport: 'padel',
      source: { type: 'padelos', clubId },
    });
    const slatina = await connector.getFreeSlots(target('216930'), '2027-03-04');
    assert.equal(slatina[0]?.start, '07:00');
    assert.equal(slatina.at(-1)?.freeCourts, 10);
    assert.deepEqual(await connector.getFreeSlots(target('216928'), '2027-03-04'), []);
  });
});
