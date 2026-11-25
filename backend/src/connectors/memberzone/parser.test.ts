import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import {
  MemberzoneDateNotShownError,
  MemberzoneParseError,
  parseMemberzoneForm,
  parseMemberzoneSchedule,
  parseMemberzoneWeek,
} from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

// Hala Sprint, recorded 2026-11-25: plain GET (week 25.11.-1.12.) and the date-switch
// postbacks for 26.11. (week 26.11.-2.12.) and 24.12. (week 24.12.-30.12.).
const TODAY_GET = fixture('sprint-2026-11-25.html');
const SWITCHED_26_11 = fixture('sprint-2026-11-26-post.html');
const SWITCHED_24_12 = fixture('sprint-2026-12-24-post.html');

/** A minimal week page in the real markup: 7 headers from 25.11. and the given cards. */
function weekPage(cards: string[], headers?: string[]): string {
  const days = headers ?? [
    'STŘEDA&nbsp;&nbsp;&nbsp;25.11.',
    'ČTVRTEK&nbsp;&nbsp;&nbsp;26.11.',
    'PÁTEK&nbsp;&nbsp;&nbsp;27.11.',
    'SOBOTA&nbsp;&nbsp;&nbsp;28.11.',
    'NEDĚLE&nbsp;&nbsp;&nbsp;29.11.',
    'PONDĚLÍ&nbsp;&nbsp;&nbsp;30.11.',
    'ÚTERÝ&nbsp;&nbsp;&nbsp;1.12.',
  ];
  const ths = days.map((d, i) => `<th id="DATUM${i + 1}" scope="col">${d}</th>`).join('');
  return `<form id="form1"><table id="tableLekce"><tr>${ths}</tr><tr><td>${cards.join('')}</td></tr></table></form>`;
}

interface CardOptions {
  ids?: string;
  date?: string; // "26. 11. 2026"
  time?: string; // "7:00"
  length?: string;
  range?: string;
}

function card(o: CardOptions = {}): string {
  const date = o.date ?? '26. 11. 2026';
  const time = o.time ?? '7:00';
  const length = o.length ?? '60';
  const range = o.range ?? '7:00 - 8:00';
  return `<div class="mycard_skupinovky2" data-identifi="kurty">
    <input type="hidden" data-identifi="KurtyName" value="Badminton kurt" />
    <input type="hidden" data-identifi="KurtyID" value="${o.ids ?? '8,9'}" />
    <input type="hidden" data-identifi="DatumLekce2" value="${date}" />
    <input type="hidden" data-identifi="DelkaLekce" value="${length}" />
    <input type="hidden" data-identifi="DatumCas" value="${date} ${time}:00" />
    <span data-identifi="SkupCasOdDo">${range}</span></div>`;
}

describe('parseMemberzoneSchedule – recorded pages', () => {
  it('today (plain GET): only the late-evening window is left', () => {
    assert.deepEqual(parseMemberzoneSchedule(TODAY_GET, '2026-11-25'), [slot('21:00', '22:00', 2)]);
  });

  it('busy day: counts distinct free courts per half-hour and merges equal neighbours', () => {
    assert.deepEqual(parseMemberzoneSchedule(SWITCHED_26_11, '2026-11-26'), [
      slot('07:00', '08:00', 4),
      slot('09:00', '09:30', 4),
      slot('09:30', '10:30', 5),
      slot('10:30', '11:00', 3),
      slot('11:00', '11:30', 2),
      slot('11:30', '12:00', 3),
      slot('12:00', '14:30', 6),
      slot('14:30', '15:00', 4),
      slot('15:00', '15:30', 1),
      slot('19:00', '20:00', 1),
      slot('21:00', '22:00', 2),
    ]);
  });

  it('a Saturday: windows overlap every 30 minutes and are merged without gaps', () => {
    const saturday = parseMemberzoneSchedule(SWITCHED_26_11, '2026-11-28');
    assert.deepEqual(saturday[0], slot('07:00', '10:00', 6));
    assert.deepEqual(saturday.at(-1), slot('19:30', '22:00', 6));
    assert.ok(saturday.some((s) => s.start === '18:00' && s.freeCourts === 5));
  });

  it('days without any free window are empty (closed / fully booked), not an error', () => {
    assert.deepEqual(parseMemberzoneSchedule(SWITCHED_24_12, '2026-12-25'), []);
    assert.deepEqual(parseMemberzoneSchedule(SWITCHED_24_12, '2026-12-26'), []);
    assert.deepEqual(parseMemberzoneSchedule(SWITCHED_24_12, '2026-12-24'), [
      slot('07:00', '08:00', 6),
      slot('08:00', '09:00', 5),
      slot('09:00', '12:00', 6),
    ]);
  });

  it('returns all 7 days of the page, identical to the same day on another page', () => {
    const week = parseMemberzoneWeek(TODAY_GET, '2026-11-25');
    assert.deepEqual(
      [...week.keys()],
      [
        '2026-11-25',
        '2026-11-26',
        '2026-11-27',
        '2026-11-28',
        '2026-11-29',
        '2026-11-30',
        '2026-12-01',
      ],
    );
    const switched = parseMemberzoneWeek(SWITCHED_26_11, '2026-11-26');
    assert.equal(switched.size, 7);
    for (const date of ['2026-11-26', '2026-11-27', '2026-12-01']) {
      assert.deepEqual(week.get(date), switched.get(date), date);
    }
  });

  it('does not use another day of the page for the requested date', () => {
    const week = parseMemberzoneWeek(TODAY_GET, '2026-11-26');
    assert.notDeepEqual(week.get('2026-11-26'), week.get('2026-11-25'));
    assert.deepEqual(week.get('2026-11-25'), [slot('21:00', '22:00', 2)]);
  });

  it('throws MemberzoneDateNotShownError when the date is not one of the 7 days', () => {
    assert.throws(
      () => parseMemberzoneSchedule(TODAY_GET, '2026-12-03'),
      MemberzoneDateNotShownError,
    );
    assert.throws(
      () => parseMemberzoneSchedule(SWITCHED_26_11, '2026-11-25'),
      MemberzoneDateNotShownError,
    );
  });
});

describe('parseMemberzoneSchedule – court logic (real card markup)', () => {
  it('a court is free in a half-hour when any card covering it lists the court', () => {
    const html = weekPage([
      card({ ids: '8,9', time: '7:00', range: '7:00 - 8:00' }),
      card({ ids: '9,10', time: '7:30', range: '7:30 - 8:30' }),
    ]);
    assert.deepEqual(parseMemberzoneSchedule(html, '2026-11-26'), [
      slot('07:00', '07:30', 2),
      slot('07:30', '08:00', 3),
      slot('08:00', '08:30', 2),
    ]);
  });

  it('supports other window lengths and ignores windows of days the page does not show', () => {
    const html = weekPage([
      card({ ids: '8', length: '90', range: '7:00 - 8:30' }),
      card({ ids: '8', date: '9. 12. 2026' }),
    ]);
    assert.deepEqual(parseMemberzoneSchedule(html, '2026-11-26'), [slot('07:00', '08:30', 1)]);
  });

  it('copes with a year boundary (headers have no year)', () => {
    const html = weekPage(
      [card({ ids: '8', date: '1. 1. 2027', time: '8:00', range: '8:00 - 9:00' })],
      [
        'ČTVRTEK 31.12.',
        'PÁTEK 1.1.',
        'SOBOTA 2.1.',
        'NEDĚLE 3.1.',
        'PONDĚLÍ 4.1.',
        'ÚTERÝ 5.1.',
        'STŘEDA 6.1.',
      ],
    );
    assert.deepEqual(parseMemberzoneSchedule(html, '2027-01-01'), [slot('08:00', '09:00', 1)]);
    assert.deepEqual(parseMemberzoneSchedule(html, '2026-12-31'), []);
  });
});

describe('parseMemberzoneSchedule – changed markup is an error, never partial data', () => {
  it('rejects a page without the schedule table', () => {
    assert.throws(
      () => parseMemberzoneSchedule('<html>maintenance</html>', '2026-11-25'),
      MemberzoneParseError,
    );
    assert.throws(
      () =>
        parseMemberzoneSchedule(TODAY_GET.replace('id="tableLekce"', 'id="table"'), '2026-11-25'),
      MemberzoneParseError,
    );
  });

  it('rejects missing or unparsable date headers', () => {
    assert.throws(
      () => parseMemberzoneSchedule(TODAY_GET.replace('id="DATUM7"', 'id="X7"'), '2026-11-25'),
      /Expected 7 date headers/,
    );
    assert.throws(
      () =>
        parseMemberzoneSchedule(
          TODAY_GET.replace('STŘEDA&nbsp;&nbsp;&nbsp;25.11.', 'STŘEDA'),
          '2026-11-25',
        ),
      MemberzoneParseError,
    );
  });

  it('rejects headers that are not consecutive days', () => {
    const html = weekPage(
      [],
      [
        'STŘEDA 25.11.',
        'PÁTEK 27.11.',
        'SOBOTA 28.11.',
        'NEDĚLE 29.11.',
        'PONDĚLÍ 30.11.',
        'ÚTERÝ 1.12.',
        'STŘEDA 2.12.',
      ],
    );
    assert.throws(() => parseMemberzoneSchedule(html, '2026-11-25'), /not consecutive/);
  });

  it('rejects a card without court IDs, date, time or with inconsistent values', () => {
    const cases: [string, string][] = [
      ['no court IDs', card({ ids: '' })],
      ['non-numeric court ID', card({ ids: '8,x' })],
      ['unparsable DatumCas', card().replace('26. 11. 2026 7:00:00', 'soon')],
      [
        'DatumLekce2 differs from DatumCas',
        card().replace('DatumLekce2" value="26. 11. 2026', 'DatumLekce2" value="27. 11. 2026'),
      ],
      ['length not a multiple of 30', card({ length: '45', range: '7:00 - 7:45' })],
      ['start not on a half-hour', card({ time: '7:15', range: '7:15 - 8:15' })],
      ['range does not match the length', card({ range: '7:00 - 9:00' })],
      ['range missing', card().replace('data-identifi="SkupCasOdDo"', 'data-identifi="other"')],
      ['window runs past midnight', card({ time: '23:30', range: '23:30 - 0:30' })],
    ];
    for (const [label, html] of cases) {
      assert.throws(
        () => parseMemberzoneSchedule(weekPage([card({ ids: '1' }), html]), '2026-11-26'),
        MemberzoneParseError,
        label,
      );
    }
  });

  it('a card of a day the page does not show is still validated', () => {
    assert.throws(
      () =>
        parseMemberzoneSchedule(weekPage([card({ date: '9. 12. 2026', ids: '' })]), '2026-11-26'),
      MemberzoneParseError,
    );
  });
});

describe('parseMemberzoneForm', () => {
  it('reads the form action, all hidden inputs and the selected window length', () => {
    const form = parseMemberzoneForm(TODAY_GET);
    assert.equal(form.action, './Sportoviste.aspx?ID_Sportoviste=3&NAZEV=Badminton+hala');
    assert.ok(form.fields.has('__VIEWSTATE'));
    assert.equal(form.fields.get('__VIEWSTATEGENERATOR'), '84305767');
    assert.equal(form.fields.get('DropDownDelka'), '60');
    assert.equal(form.fields.has('__EVENTVALIDATION'), false);
    assert.ok([...form.fields.keys()].some((k) => k.endsWith('$hfKurtyID')));
  });

  it('rejects a page without the form', () => {
    assert.throws(() => parseMemberzoneForm('<html></html>'), MemberzoneParseError);
  });
});
