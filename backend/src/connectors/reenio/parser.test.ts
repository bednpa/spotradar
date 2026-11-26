import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import { ReenioParseError, parseDueDate, parseReenioTerms } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const RESOURCE = 51584;
const LONG_BEFORE = new Date('2026-11-20T00:00:00Z');
const THU = fixture('hala-51584-2026-11-26.json');
const FRI = fixture('hala-51584-2026-11-27.json');
const SAT = fixture('hala-51584-2026-11-28.json');

describe('parseReenioTerms', () => {
  it('Friday: free gaps of both windows, snapped to the grid and at least minLength long', () => {
    // Window 1 (15 min grid, min 45): 06:00-07:45 and 09:30-11:00 are free; 12:30-13:00 is
    // only 30 minutes. Window 2 (min 60): free 21:30-22:30 after the 19:30 collision.
    assert.deepEqual(parseReenioTerms(FRI, '2026-11-27', RESOURCE, LONG_BEFORE), [
      slot('06:00', '07:45', 1),
      slot('09:30', '11:00', 1),
      slot('21:30', '22:30', 1),
    ]);
  });

  it('Thursday: a gap shorter than minLength and a last half hour are not offered', () => {
    assert.deepEqual(parseReenioTerms(THU, '2026-11-26', RESOURCE, LONG_BEFORE), [
      slot('06:00', '07:45', 1),
      slot('08:30', '12:00', 1),
    ]);
  });

  it('Saturday (one window, collision in the middle)', () => {
    assert.deepEqual(parseReenioTerms(SAT, '2026-11-28', RESOURCE, LONG_BEFORE), [
      slot('07:00', '08:00', 1),
      slot('12:00', '17:00', 1),
      slot('18:00', '21:00', 1),
    ]);
  });

  it('drops free time that starts sooner than reservationDueDate (2 h) after now', () => {
    // now = 08:00 local → bookable from 10:00 local.
    assert.deepEqual(
      parseReenioTerms(THU, '2026-11-26', RESOURCE, new Date('2026-11-26T07:00:00Z')),
      [slot('10:00', '12:00', 1)],
    );
    // A remainder shorter than minLength disappears completely.
    assert.deepEqual(
      parseReenioTerms(THU, '2026-11-26', RESOURCE, new Date('2026-11-26T08:30:00Z')),
      [],
    );
  });

  it('snaps the lead-time cut up to the grid', () => {
    // earliest = 08:10 UTC → next 15-minute step is 08:15 UTC = 09:15 local.
    const now = new Date('2026-11-26T06:10:00Z');
    assert.deepEqual(parseReenioTerms(THU, '2026-11-26', RESOURCE, now), [
      slot('09:15', '12:00', 1),
    ]);
  });

  it('treats a collision under any key as busy', () => {
    const json = JSON.parse(SAT) as {
      data: { events: { collisions: Record<string, unknown[]> }[] };
    };
    json.data.events[0]?.collisions['1']?.push({
      start: '2026-11-28T12:00:00Z',
      end: '2026-11-28T14:00:00Z',
      resourceId: 1,
    });
    assert.deepEqual(parseReenioTerms(JSON.stringify(json), '2026-11-28', RESOURCE, LONG_BEFORE), [
      slot('07:00', '08:00', 1),
      slot('12:00', '13:00', 1),
      slot('15:00', '17:00', 1),
      slot('18:00', '21:00', 1),
    ]);
  });

  it('returns no slots for a day without bookable windows', () => {
    const empty = JSON.stringify({
      status: 'OK',
      data: { events: [], startDate: '2026-11-28T23:00:00Z' },
    });
    assert.deepEqual(parseReenioTerms(empty, '2026-11-29', RESOURCE, LONG_BEFORE), []);
  });

  it('ignores a disabled window', () => {
    const json = JSON.parse(SAT) as { data: { events: { isEnabled: boolean }[] } };
    (json.data.events[0] as { isEnabled: boolean }).isEnabled = false;
    assert.deepEqual(
      parseReenioTerms(JSON.stringify(json), '2026-11-28', RESOURCE, LONG_BEFORE),
      [],
    );
  });

  it('rejects a body for another day, another resource, a failure or changed structure', () => {
    assert.throws(
      () => parseReenioTerms(FRI, '2026-11-28', RESOURCE, LONG_BEFORE),
      ReenioParseError,
    );
    assert.throws(
      () => parseReenioTerms(FRI, '2026-11-27', 105438, LONG_BEFORE),
      /resource 105438/,
    );
    assert.throws(
      () => parseReenioTerms('<html>', '2026-11-27', RESOURCE, LONG_BEFORE),
      ReenioParseError,
    );
    assert.throws(
      () =>
        parseReenioTerms('{"status":"ERROR","errorCode":1}', '2026-11-27', RESOURCE, LONG_BEFORE),
      ReenioParseError,
    );
    assert.throws(
      () =>
        parseReenioTerms(
          '{"status":"OK","data":{"events":{}}}',
          '2026-11-27',
          RESOURCE,
          LONG_BEFORE,
        ),
      ReenioParseError,
    );
    const noGrid = FRI.replaceAll('"reservationIntervalSize"', '"gridSize"');
    assert.throws(
      () => parseReenioTerms(noGrid, '2026-11-27', RESOURCE, LONG_BEFORE),
      ReenioParseError,
    );
    const badDue = FRI.replaceAll('"2:00:00"', '"soon"');
    assert.throws(
      () => parseReenioTerms(badDue, '2026-11-27', RESOURCE, LONG_BEFORE),
      ReenioParseError,
    );
  });
});

describe('parseDueDate', () => {
  it('reads h:mm:ss with hours above 24', () => {
    assert.equal(parseDueDate('2:00:00'), 2 * 3600_000);
    assert.equal(parseDueDate('2160:00:00'), 2160 * 3600_000);
    assert.throws(() => parseDueDate(undefined), ReenioParseError);
  });
});
