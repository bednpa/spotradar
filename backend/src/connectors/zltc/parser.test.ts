import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import {
  ZltcApiError,
  ZltcParseError,
  buildZltcQuery,
  isBookableDate,
  parseZltcBookings,
  parseZltcConfig,
  parseZltcCourts,
  seasonCourts,
  zltcDayTimestamp,
  zltcFreeSlots,
} from './parser.ts';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

// Real Firestore REST answers of project zltc-prod-c9e6c (recorded 2026-11-26, winter season).
const COURTS = parseZltcCourts(fixture('courts.json'));
const CONFIG = parseZltcConfig(fixture('config-reservations.json'));
const DAY_26 = fixture('reservations-2026-11-26.json');
const DAY_27 = fixture('reservations-2026-11-27.json');
const DAY_28 = fixture('reservations-2026-11-28.json');

function slotsOf(day: unknown, date: string, now?: { date: string; minutes: number }) {
  return zltcFreeSlots(COURTS, CONFIG, parseZltcBookings(day, date), date, now);
}

describe('ŽLTC courts and config', () => {
  it('reads the 12 courts and the season flags', () => {
    assert.equal(COURTS.length, 12);
    const winter = COURTS.filter((c) => c.winter).map((c) => c.name);
    assert.deepEqual(winter.sort(), ['Nafukovací hala 1', 'Nafukovací hala 2', 'Pevná hala']);
    assert.equal(COURTS.filter((c) => c.summer).length, 9);
  });

  it('uses the courts of the current season only', () => {
    assert.deepEqual(
      seasonCourts(COURTS, CONFIG)
        .map((c) => c.name)
        .sort(),
      ['Nafukovací hala 1', 'Nafukovací hala 2', 'Pevná hala'],
    );
    const summer = seasonCourts(COURTS, { ...CONFIG, isSummer: true });
    assert.equal(summer.length, 9);
    assert.ok(summer.every((c) => c.name.startsWith('Antuka')));
    assert.throws(() => seasonCourts([], CONFIG), ZltcParseError);
  });

  it('reads the winter opening segments and the booking limits', () => {
    assert.deepEqual(CONFIG, {
      isSummer: false,
      reservationsEnabled: true,
      lastAllowedDate: '2027-04-11',
      openIdx: 14,
      closeIdx: 41,
    });
  });

  it('has no booking for a day when reservations are off or the day is after the last allowed one', () => {
    assert.equal(isBookableDate(CONFIG, '2027-04-11'), true);
    assert.equal(isBookableDate(CONFIG, '2027-04-12'), false);
    assert.equal(isBookableDate({ ...CONFIG, reservationsEnabled: false }, '2026-11-26'), false);
    assert.equal(isBookableDate({ ...CONFIG, lastAllowedDate: undefined }, '2030-01-01'), true);
    assert.deepEqual(
      zltcFreeSlots(COURTS, CONFIG, parseZltcBookings(DAY_28, '2026-11-28'), '2027-04-12'),
      [],
    );
    assert.deepEqual(
      zltcFreeSlots(COURTS, { ...CONFIG, reservationsEnabled: false }, new Map(), '2026-11-28'),
      [],
    );
  });
});

describe('zltcDayTimestamp / buildZltcQuery', () => {
  it('is local Prague midnight in UTC, DST-correct', () => {
    assert.equal(zltcDayTimestamp('2026-11-26'), '2026-11-25T23:00:00Z');
    assert.equal(zltcDayTimestamp('2026-07-01'), '2026-06-30T22:00:00Z');
    assert.equal(zltcDayTimestamp('2027-03-28'), '2027-03-27T23:00:00Z'); // last winter day
    assert.equal(zltcDayTimestamp('2027-03-29'), '2027-03-28T22:00:00Z'); // first summer day
  });

  it('matches the recorded body of the club app and projects only dates and reservations', () => {
    assert.deepEqual(buildZltcQuery('2026-11-26'), {
      structuredQuery: {
        select: { fields: [{ fieldPath: 'dates' }, { fieldPath: 'reservations' }] },
        from: [{ collectionId: 'reservations' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'dates' },
            op: 'ARRAY_CONTAINS',
            value: { timestampValue: '2026-11-25T23:00:00Z' },
          },
        },
      },
    });
    assert.doesNotMatch(JSON.stringify(buildZltcQuery('2026-11-26')), /customer|creator|name/);
  });
});

describe('zltcFreeSlots (recorded reservations)', () => {
  it('Saturday 28.11.: courts minus booked segments, equal neighbours merged', () => {
    assert.deepEqual(slotsOf(DAY_28, '2026-11-28'), [
      slot('08:00', '08:30', 1),
      slot('09:00', '09:30', 1),
      slot('09:30', '10:00', 2),
      slot('10:00', '11:30', 1),
      slot('11:30', '14:30', 2),
      slot('14:30', '15:00', 1),
      slot('15:00', '15:30', 2),
      slot('15:30', '17:00', 1),
    ]);
  });

  it('Thursday 26.11.: recurring bookings, empty segment lists and several courts per document', () => {
    assert.deepEqual(slotsOf(DAY_26, '2026-11-26'), [
      slot('08:00', '08:30', 2),
      slot('08:30', '09:00', 3),
      slot('11:00', '12:30', 1),
      slot('12:30', '13:00', 2),
      slot('19:30', '20:00', 1),
      slot('20:00', '20:30', 2),
    ]);
  });

  it('Friday 27.11.', () => {
    assert.deepEqual(slotsOf(DAY_27, '2026-11-27'), [
      slot('09:00', '10:30', 2),
      slot('10:30', '11:30', 1),
      slot('19:00', '19:30', 1),
    ]);
  });

  it('an empty day (only readTime) is free on all three courts for the whole opening time', () => {
    assert.deepEqual(
      parseZltcBookings([{ readTime: '2026-11-26T16:00:00Z' }], '2026-11-30').size,
      0,
    );
    assert.deepEqual(slotsOf([{ readTime: '2026-11-26T16:00:00Z' }], '2026-11-30'), [
      slot('07:00', '21:00', 3),
    ]);
  });

  it('drops half hours that already started today and trims a running interval', () => {
    const now = (minutes: number) => ({ date: '2026-11-28', minutes });
    // 11:40: the 11:30 half hour runs, 12:00 is next.
    assert.deepEqual(slotsOf(DAY_28, '2026-11-28', now(11 * 60 + 40)).slice(0, 2), [
      slot('12:00', '14:30', 2),
      slot('14:30', '15:00', 1),
    ]);
    assert.deepEqual(slotsOf(DAY_28, '2026-11-28', now(17 * 60)), []);
    // Other days are not affected by the clock of today.
    assert.equal(slotsOf(DAY_28, '2026-11-28', { date: '2026-11-27', minutes: 20 * 60 }).length, 8);
    assert.deepEqual(slotsOf(DAY_28, '2026-11-28', { date: '2026-11-29', minutes: 0 }), []);
  });
});

describe('ŽLTC parsers reject unexpected answers', () => {
  it('throws ZltcApiError for a Firestore error answer', () => {
    const denied = {
      error: {
        code: 403,
        message: 'Missing or insufficient permissions.',
        status: 'PERMISSION_DENIED',
      },
    };
    assert.throws(() => parseZltcCourts(denied), ZltcApiError);
    assert.throws(() => parseZltcConfig(denied), /PERMISSION_DENIED/);
    assert.throws(() => parseZltcBookings([{ error: denied.error }], '2026-11-26'), ZltcApiError);
    assert.throws(() => parseZltcBookings(denied, '2026-11-26'), ZltcApiError);
  });

  it('throws ZltcParseError for a changed structure', () => {
    assert.throws(() => parseZltcCourts('nope'), ZltcParseError);
    assert.throws(
      () => parseZltcCourts({ documents: [{ name: 'x/courts/a', fields: {} }] }),
      ZltcParseError,
    );
    assert.throws(() => parseZltcConfig({ fields: {} }), ZltcParseError);
    assert.throws(() => parseZltcConfig({ name: 'x' }), ZltcParseError);
    assert.throws(() => parseZltcBookings({ documents: [] }, '2026-11-26'), ZltcParseError);
    assert.throws(
      () => parseZltcBookings([{ document: { fields: {} } }], '2026-11-26'),
      ZltcParseError,
    );
  });

  it('throws when a reservation entry or segment is malformed', () => {
    const doc = (entry: unknown) => [
      {
        document: {
          name: 'x',
          fields: {
            dates: { arrayValue: { values: [{ timestampValue: '2026-11-25T23:00:00Z' }] } },
            reservations: { arrayValue: { values: [entry] } },
          },
        },
      },
    ];
    const entry = (court: unknown, segments: unknown) => ({
      mapValue: { fields: { court_id: court, segment_idxs: segments } },
    });
    const court = { stringValue: 'c1' };
    const segments = (...n: string[]) => ({
      arrayValue: { values: n.map((integerValue) => ({ integerValue })) },
    });
    assert.deepEqual(
      [...parseZltcBookings(doc(entry(court, segments('20', '21'))), '2026-11-26')],
      [['c1', new Set([20, 21])]],
    );
    assert.throws(
      () => parseZltcBookings(doc(entry(court, segments('99'))), '2026-11-26'),
      /out of range/,
    );
    assert.throws(
      () => parseZltcBookings(doc(entry(court, segments('x'))), '2026-11-26'),
      ZltcParseError,
    );
    assert.throws(
      () => parseZltcBookings(doc(entry({ integerValue: '1' }, segments('20'))), '2026-11-26'),
      ZltcParseError,
    );
    assert.throws(() => parseZltcBookings(doc('x'), '2026-11-26'), ZltcParseError);
  });

  it('throws when the answer holds reservations but none for the asked day', () => {
    assert.throws(() => parseZltcBookings(DAY_28, '2026-11-30'), /none of them for 2026-11-30/);
  });

  it('rejects an invalid last_allowed_reservation_date', () => {
    const config = fixture('config-reservations.json') as {
      fields: Record<string, unknown>;
    };
    config.fields.last_allowed_reservation_date = { stringValue: 'soon' };
    assert.throws(() => parseZltcConfig(config), ZltcParseError);
  });
});
