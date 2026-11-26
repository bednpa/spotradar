import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import {
  KomarovParseError,
  freeSlotsOf,
  komarovWeekOffset,
  mondayOf,
  parseKomarovDay,
  parseKomarovWeek,
} from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

// Real recordings of https://www.tenis-komarov.cz/rozvrh/0/ and /1/ (2026-11-26, winter: 3 courts).
const WEEK_0 = fixture('rozvrh-0-2026-11-26.html');
const WEEK_1 = fixture('rozvrh-1-2026-11-26.html');

describe('parseKomarovDay (recorded 2026-11-26)', () => {
  it('aggregates the free courts of Thursday 26.11. per interval', () => {
    assert.deepEqual(parseKomarovDay(WEEK_0, '2026-11-26'), [
      slot('07:00', '08:00', 2),
      slot('08:00', '09:00', 1),
      slot('10:00', '11:00', 1),
      slot('17:00', '18:30', 1),
      slot('21:30', '22:00', 1),
      slot('22:00', '23:00', 3),
    ]);
  });

  it('reads a weekend day that closes early (closed cells are not free)', () => {
    assert.deepEqual(parseKomarovDay(WEEK_0, '2026-11-28'), [
      slot('07:00', '08:00', 2),
      slot('18:30', '19:00', 1),
      slot('19:00', '21:00', 2),
    ]);
  });

  it('reads a day of the next week page', () => {
    assert.deepEqual(parseKomarovDay(WEEK_1, '2026-11-30'), [
      slot('07:00', '09:00', 2),
      slot('09:00', '14:00', 1),
      slot('20:30', '21:30', 1),
      slot('21:30', '22:00', 2),
      slot('22:00', '23:00', 3),
    ]);
  });

  it('shows all seven days of the week page', () => {
    assert.deepEqual(
      [...parseKomarovWeek(WEEK_0).keys()],
      [
        '2026-11-23',
        '2026-11-24',
        '2026-11-25',
        '2026-11-26',
        '2026-11-27',
        '2026-11-28',
        '2026-11-29',
      ],
    );
    assert.equal(parseKomarovWeek(WEEK_1).has('2026-12-06'), true);
  });

  it('drops half-hours that already started today and trims a running interval', () => {
    // 17:20: the 17:00 half-hour is running, 17:30 is still ahead.
    assert.deepEqual(
      parseKomarovDay(WEEK_0, '2026-11-26', { date: '2026-11-26', minutes: 17 * 60 + 20 }),
      [slot('17:30', '18:30', 1), slot('21:30', '22:00', 1), slot('22:00', '23:00', 3)],
    );
    // Exactly at 17:30 that half-hour has started too.
    assert.deepEqual(
      parseKomarovDay(WEEK_0, '2026-11-26', { date: '2026-11-26', minutes: 17 * 60 + 30 }),
      [slot('18:00', '18:30', 1), slot('21:30', '22:00', 1), slot('22:00', '23:00', 3)],
    );
    assert.deepEqual(
      parseKomarovDay(WEEK_0, '2026-11-26', { date: '2026-11-26', minutes: 23 * 60 }),
      [],
    );
  });

  it('keeps future days whole and has nothing for days before today', () => {
    const now = { date: '2026-11-26', minutes: 23 * 60 };
    assert.equal(parseKomarovDay(WEEK_0, '2026-11-28', now).length, 3);
    // Monday 23.11. still shows colours of the past.
    assert.deepEqual(parseKomarovDay(WEEK_0, '2026-11-23', now), []);
    assert.equal(parseKomarovDay(WEEK_0, '2026-11-23').length > 0, true);
  });

  it('freeSlotsOf without a clock keeps everything', () => {
    const day = parseKomarovWeek(WEEK_0).get('2026-11-26');
    assert.ok(day);
    assert.equal(freeSlotsOf(day, '2026-11-26').length, 6);
  });

  it('counts discounted cells as free and a court only when both quarters of a half hour are free', () => {
    // Court 1 Thursday 22:00 column: first quarters discounted, last quarter booked.
    const html = WEEK_0.replace(
      /(<tr><th class = 'timetable-day' rowspan=3>Čt[\s\S]*?)<td><div class="free"><\/div><div class="free"><\/div><div class="free"><\/div><div class="free"><\/div><\/td>\n<\/tr>/,
      '$1<td><div class="discount"></div><div class="discount"></div><div class="discount"></div><div class="single"></div></td>\n</tr>',
    );
    assert.notEqual(html, WEEK_0);
    // 22:00-22:30 three courts, 22:30-23:00 only two (court 1's last quarter is booked).
    assert.deepEqual(parseKomarovDay(html, '2026-11-26').slice(-3), [
      slot('21:30', '22:00', 1),
      slot('22:00', '22:30', 3),
      slot('22:30', '23:00', 2),
    ]);
  });
});

describe('parseKomarovDay rejects unexpected pages', () => {
  it('throws when the date is not on the page', () => {
    assert.throws(() => parseKomarovDay(WEEK_0, '2026-11-30'), /does not show 2026-11-30/);
    assert.throws(() => parseKomarovDay(WEEK_0, '2026-11-30'), KomarovParseError);
  });

  it('throws when the timetable is missing', () => {
    assert.throws(() => parseKomarovWeek('<html><body>Údržba</body></html>'), KomarovParseError);
    assert.throws(
      () => parseKomarovWeek(WEEK_0.replace('id="rezervacni-system"', 'id="jiny"')),
      KomarovParseError,
    );
  });

  it('throws for an unknown cell class', () => {
    const html = WEEK_0.replace('<div class="free">', '<div class="blocked">');
    assert.throws(() => parseKomarovWeek(html), /unknown cell class/);
  });

  it('throws when an hour does not have four quarters', () => {
    const html = WEEK_0.replace('<div class="mass"></div>', '');
    assert.throws(() => parseKomarovWeek(html), /4 quarters/);
  });

  it('throws when the court rows do not match the rowspan', () => {
    assert.throws(
      () => parseKomarovWeek(WEEK_0.replace('rowspan=3>Po', 'rowspan=2>Po')),
      /outside of a day/,
    );
    assert.throws(
      () => parseKomarovWeek(WEEK_0.replace('rowspan=3>Po', 'rowspan=4>Po')),
      /too few court rows/,
    );
  });

  it('throws when the hour columns do not match the hour header', () => {
    const html = WEEK_0.replace('<th>22<span class="timetable-minutes">:00</span></th>', '');
    assert.throws(() => parseKomarovWeek(html), /hour cells/);
  });

  it('throws for a cell that spans columns or a day heading without a date', () => {
    assert.throws(
      () =>
        parseKomarovWeek(
          WEEK_0.replace('<td><div class="mass">', '<td colspan=2><div class="mass">'),
        ),
      /spanning cell/,
    );
    assert.throws(
      () => parseKomarovWeek(WEEK_0.replace('Po<br>23.11.2026', 'Po<br>pondělí')),
      /no valid date/,
    );
  });
});

describe('week offsets', () => {
  it('computes the Monday of a week', () => {
    assert.equal(mondayOf('2026-11-26'), '2026-11-23');
    assert.equal(mondayOf('2026-11-23'), '2026-11-23');
    assert.equal(mondayOf('2026-11-29'), '2026-11-23');
  });

  it('counts whole weeks from the current Monday–Sunday week', () => {
    assert.equal(komarovWeekOffset('2026-11-26', '2026-11-26'), 0);
    assert.equal(komarovWeekOffset('2026-11-29', '2026-11-23'), 0);
    assert.equal(komarovWeekOffset('2026-11-30', '2026-11-29'), 1);
    assert.equal(komarovWeekOffset('2026-12-14', '2026-11-26'), 3);
    assert.equal(komarovWeekOffset('2026-11-22', '2026-11-23'), -1);
    // Across the DST change and the new year.
    assert.equal(komarovWeekOffset('2027-01-04', '2026-12-30'), 1);
    assert.equal(komarovWeekOffset('2027-03-29', '2027-03-24'), 1);
  });
});
