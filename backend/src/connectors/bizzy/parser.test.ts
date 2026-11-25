import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { addDays, isValidDate } from '@spotradar/shared';
import {
  BizzyParseError,
  bizzyDaySlots,
  extractScheduleJson,
  parseBizzyDays,
  parseBizzyNav,
  parseBizzySchedule,
  readSelectedView,
} from './parser.ts';
import { bizzyPageStartingAt } from './stubPages.ts';

const FIXTURE_DIR = new URL('./fixtures/', import.meta.url);

function fx(name: string): string {
  return readFileSync(new URL(name, FIXTURE_DIR), 'utf8');
}

const REFERENCE = { referenceDate: '2026-11-25' };

function isParseError(err: unknown): boolean {
  return err instanceof BizzyParseError;
}

const slot = (start: string, end: string, freeCourts: number) => ({ start, end, freeCourts });

describe('parseBizzySchedule on the recorded fixtures', () => {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.html'));

  it('has the 12 fixtures', () => {
    assert.equal(files.length, 12);
  });

  for (const file of files) {
    it(`parses ${file}`, () => {
      const days = parseBizzySchedule(fx(file), REFERENCE);
      // The default Jehnice page and every "week" response show 8 days, Líšeň / X-Arena single
      // days otherwise; Jehnice stays in the 8-day view for date postbacks.
      const venue = file.split('-')[0];
      const multi = venue === 'jehnice' || file.includes('-week-');
      assert.equal(days.size, multi ? 8 : 1);
      for (const [date, slots] of days) {
        assert.ok(isValidDate(date), date);
        let previousEnd = '';
        for (const s of slots) {
          assert.ok(s.start < s.end, `${file} ${date} ${s.start}-${s.end}`);
          assert.ok(s.start >= previousEnd, `${file} ${date} sorted and disjoint`);
          assert.ok(s.freeCourts >= 1 && s.freeCourts <= 6);
          assert.match(s.start, /^\d\d:\d\d$/);
          previousEnd = s.end;
        }
      }
    });
  }
});

describe('parseBizzySchedule slots', () => {
  it('Líšeň Saturday (half-hour columns, 6 courts): hand-verified from the bookings', () => {
    // Events (col,row inclusive): [0,5]-[1,5] court 6 08:00-09:00, [2,5] court 6 09:00-09:30,
    // [4,0]-[5,0] court 1 10:00-11:00, [4,5]-[7,5] court 6 10:00-12:00,
    // [24,0]-[27,5] all six courts 20:00-22:00 (a multi-cell, multi-court booking).
    const days = parseBizzySchedule(fx('lisen-2026-11-25-saturday-ajax.html'), REFERENCE);
    assert.deepEqual([...days.keys()], ['2026-11-28']);
    assert.deepEqual(days.get('2026-11-28'), [
      slot('08:00', '09:30', 5),
      slot('09:30', '10:00', 6),
      slot('10:00', '11:00', 4),
      slot('11:00', '12:00', 5),
      slot('12:00', '20:00', 6),
    ]);
  });

  it('X-Arena Saturday (hourly columns): bookings cut the day as recorded', () => {
    // [0,0]-[0,5] books all courts 08:00-09:00, [1,3] and [1,0] two courts at 09:00,
    // [2,5] [2,0] [2,1] three courts at 10:00, [5,0]-[6,5] all courts 13:00-15:00.
    const slots = parseBizzySchedule(fx('xarena-2026-11-25-saturday-ajax.html'), REFERENCE).get(
      '2026-11-28',
    );
    assert.deepEqual(slots?.slice(0, 3), [
      slot('09:00', '10:00', 4),
      slot('10:00', '11:00', 3),
      slot('11:00', '13:00', 6),
    ]);
    assert.deepEqual(slots?.[3], slot('15:00', '16:00', 6));
    assert.ok(!slots?.some((s) => s.start < '15:00' && s.end > '13:00'));
  });

  it('weekend hours differ from weekdays (Jehnice Sunday starts at 08:00, 14 columns)', () => {
    const days = parseBizzyDays(fx('jehnice-2026-11-25-saturday-ajax.html'), REFERENCE);
    assert.equal(days.get('2026-11-28')?.cells.length, 15);
    assert.equal(days.get('2026-11-29')?.cells.length, 14);
    assert.equal(days.get('2026-11-29')?.cells[0]?.start, 8 * 60);
    assert.equal(days.get('2026-11-28')?.cells[0]?.start, 7 * 60);
    assert.equal(days.get('2026-11-28')?.stepMinutes, 60);
  });

  it('Jehnice week: 8 consecutive dates, fully booked days are empty', () => {
    const days = parseBizzySchedule(fx('jehnice-2026-11-25-week-ajax.html'), REFERENCE);
    assert.deepEqual(
      [...days.keys()],
      Array.from({ length: 8 }, (_, i) => addDays('2026-11-25', i)),
    );
    // 25/11 is past/booked all day, Saturday and Sunday are fully booked.
    assert.deepEqual(days.get('2026-11-25'), []);
    assert.deepEqual(days.get('2026-11-28'), []);
    // Thursday: courts 1..5 are booked until 17:00 (events [0,0]-[9,4] cover 07:00-17:00).
    const thursday = days.get('2026-11-26') ?? [];
    assert.deepEqual(thursday, [slot('17:00', '18:00', 1), slot('19:00', '21:00', 1)]);
    assert.deepEqual(days.get('2026-12-01'), [
      slot('17:00', '18:00', 4),
      slot('18:00', '20:00', 2),
    ]);
  });

  it('Líšeň and X-Arena week responses show 8 dates and agree with the single-day postbacks', () => {
    for (const venue of ['lisen', 'xarena']) {
      const week = parseBizzySchedule(fx(`${venue}-2026-11-25-week-ajax.html`), REFERENCE);
      assert.equal(week.size, 8);
      assert.deepEqual(
        [...week.keys()],
        Array.from({ length: 8 }, (_, i) => addDays('2026-11-25', i)),
      );
      const tomorrow = parseBizzySchedule(fx(`${venue}-2026-11-25-tomorrow-ajax.html`), {
        referenceDate: '2026-11-26',
      });
      assert.deepEqual(tomorrow.get('2026-11-26'), week.get('2026-11-26'));
      const saturday = parseBizzySchedule(fx(`${venue}-2026-11-25-saturday-ajax.html`), {
        referenceDate: '2026-11-28',
      });
      assert.deepEqual(saturday.get('2026-11-28'), week.get('2026-11-28'));
    }
  });

  it('cells that already started (pastTimeData) are not free', () => {
    const html = fx('lisen-2026-11-25-today.html');
    // Recorded at 19:42: columns up to 19:30 are past, 20:00-22:00 is booked except 21:00+ ...
    assert.deepEqual(parseBizzySchedule(html).get('2026-11-25'), [slot('21:00', '22:00', 5)]);
    const noPast = html.replace(
      /"pastTimeData":\[\[[^\]]*\]\]/,
      '"pastTimeData":[[-1,-1,-1,-1,-1,-1]]',
    );
    assert.notEqual(noPast, html);
    // Without the marker the morning is free (all recorded bookings start at 19:00).
    assert.deepEqual(parseBizzySchedule(noPast).get('2026-11-25')?.[0], slot('07:00', '19:00', 6));
  });

  it('bizzyDaySlots drops columns that start before the cutoff', () => {
    const day = parseBizzyDays(fx('xarena-2026-11-25-tomorrow-ajax.html'), {
      referenceDate: '2026-11-26',
    }).get('2026-11-26');
    assert.ok(day);
    assert.equal(bizzyDaySlots(day)[0]?.start, '07:00');
    assert.deepEqual(bizzyDaySlots(day, 12 * 60 + 30).slice(0, 2), [
      slot('13:00', '14:00', 6),
      slot('14:00', '15:00', 5),
    ]);
    assert.deepEqual(bizzyDaySlots(day, 24 * 60), []);
    assert.deepEqual(bizzyDaySlots(day, -60), bizzyDaySlots(day));
  });

  it('a closed grid has no free slots', () => {
    const html = fx('lisen-2026-11-25-saturday-ajax.html').replace(
      '"closed":false',
      '"closed":true',
    );
    assert.deepEqual(parseBizzySchedule(html, REFERENCE).get('2026-11-28'), []);
  });
});

describe('year inference', () => {
  it('uses the calendar input of the page (no hint needed)', () => {
    const days = parseBizzySchedule(fx('jehnice-2026-11-25-week-ajax.html'));
    assert.equal(days.size, 8);
  });

  it('crosses the December to January rollover', () => {
    const week = fx('jehnice-2026-11-25-week-ajax.html');
    const html = bizzyPageStartingAt(week, week, '2026-12-29');
    assert.deepEqual(
      [...parseBizzySchedule(html).keys()],
      [
        '2026-12-29',
        '2026-12-30',
        '2026-12-31',
        '2027-01-01',
        '2027-01-02',
        '2027-01-03',
        '2027-01-04',
        '2027-01-05',
      ],
    );
  });

  it('needs a hint for bare A4J fragments', () => {
    const fragment = fx('jehnice-2026-11-25-tomorrow-ajax.html');
    assert.throws(() => parseBizzySchedule(fragment), isParseError);
    assert.equal(parseBizzySchedule(fragment, { referenceDate: '2026-11-26' }).size, 8);
  });

  it('rejects a hint that puts the weekday on the wrong date', () => {
    const fragment = fx('jehnice-2026-11-25-tomorrow-ajax.html');
    assert.throws(
      () => parseBizzySchedule(fragment, { referenceDate: '2025-11-26' }),
      /does not match/,
    );
  });
});

describe('changed markup', () => {
  const saturday = fx('lisen-2026-11-25-saturday-ajax.html');

  function breaks(html: string, message: RegExp): void {
    assert.notEqual(html, saturday, 'the test must change the markup');
    assert.throws(
      () => parseBizzySchedule(html, REFERENCE),
      (err) => {
        assert.ok(isParseError(err), String(err));
        assert.match((err as Error).message, message);
        return true;
      },
    );
  }

  it('throws when scheduleData is missing or unreadable', () => {
    breaks(saturday.replace('var scheduleData', 'var somethingElse'), /no "var scheduleData"/);
    breaks(saturday.replace('"binId":"bin_drop",', '"binId":bin_drop,'), /not valid JSON/);
    breaks(saturday.replace('"grids":[', '"gridz":['), /no grids/);
  });

  it('throws when a grid has no table', () => {
    breaks(saturday.replace('id="schedule_0"', 'id="other_0"'), /no table#schedule_0/);
  });

  it('throws on a column-count or hour-label mismatch', () => {
    breaks(saturday.replace('"cols":28', '"cols":27'), /28 hour labels for 27 columns/);
    breaks(saturday.replace('>8:30<', '>8:45<'), /irregular hour labels/);
    breaks(saturday.replace('"rows":6', '"rows":7'), /does not match the grid rows/);
    breaks(
      saturday
        .replace('"rows":6', '"rows":7')
        .replace('"pastTimeData":[[-1,-1,-1,-1,-1,-1]]', '"pastTimeData":null'),
      /court rows do not match 7/,
    );
  });

  it('throws when cell ids do not follow the row/column order', () => {
    breaks(
      saturday.replace('id="sched_0_i_1_3"', 'id="sched_0_i_3_1"'),
      /cell 31 is not sched_0_i_1_3/,
    );
  });

  it('throws when an event is out of range or swaps axes', () => {
    breaks(saturday.replace('"end":[27,5]', '"end":[28,5]'), /outside grid 0/);
    breaks(saturday.replace('"end":[27,5]', '"end":[5,27]'), /outside grid 0/);
    breaks(saturday.replace('"end":[27,5]', '"end":[27]'), /invalid end/);
    breaks(saturday.replaceAll('"gridId":0', '"gridId":9'), /unknown grid/);
  });

  it('throws on an unparsable or contradicting date', () => {
    breaks(saturday.replaceAll('So 28/11', 'So 31/2'), /not a valid date/);
    breaks(saturday.replaceAll('So 28/11', 'Po 28/11'), /does not match/);
    breaks(saturday.replaceAll('So 28/11', 'sobota'), /not "<weekday> D\/M"/);
    breaks(saturday.replaceAll('So 28/11', 'So 29/11'), /does not match/);
  });
});

describe('extractScheduleJson', () => {
  it('finds the object although strings contain braces and JS follows', () => {
    const html =
      'x<script>var scheduleData = {"a":"}{ \\" }","b":{"c":[1,{"d":2}]}};\nvar other = {x: 1};</script>';
    assert.equal(extractScheduleJson(html), '{"a":"}{ \\" }","b":{"c":[1,{"d":2}]}}');
  });

  it('rejects an unterminated object', () => {
    assert.throws(() => extractScheduleJson('var scheduleData = {"a":1'), isParseError);
  });
});

describe('parseBizzyNav', () => {
  it('reads the per-venue ids from the GET pages', () => {
    const jehnice = parseBizzyNav(fx('jehnice-2026-11-25-today.html'));
    assert.equal(jehnice.dateChangeId, 'scheduleNavigForm:j_id205');
    assert.equal(jehnice.viewChangeId, 'scheduleNavigForm:j_id220');
    assert.equal(jehnice.hiddenName, 'scheduleNavigForm:j_id210');
    assert.equal(jehnice.hiddenValue, '40001');
    assert.equal(jehnice.inputDate, '25.11.2026');
    assert.equal(jehnice.inputCurrentDate, '11/2026');
    assert.match(jehnice.actionUrl, /^\/Branch\/pages\/Schedule\.faces/);
    assert.ok(jehnice.viewState.length > 10);

    const lisen = parseBizzyNav(fx('lisen-2026-11-25-today.html'));
    assert.equal(lisen.dateChangeId, 'scheduleNavigForm:j_id205');
    assert.equal(lisen.hiddenName, 'scheduleNavigForm:j_id210');
    assert.equal(lisen.hiddenValue, '41439');

    const xarena = parseBizzyNav(fx('xarena-2026-11-25-today.html'));
    assert.equal(xarena.dateChangeId, 'scheduleNavigForm:j_id209');
    assert.equal(xarena.viewChangeId, 'scheduleNavigForm:j_id224');
    assert.equal(xarena.hiddenName, 'scheduleNavigForm:j_id214');
    assert.equal(xarena.hiddenValue, '40106');
  });

  it('knows which view is shown', () => {
    assert.equal(
      readSelectedView(fx('jehnice-2026-11-25-today.html')),
      'horizontal_service_dayandweek',
    );
    assert.equal(readSelectedView(fx('lisen-2026-11-25-today.html')), 'horizontal_service_day');
    assert.equal(readSelectedView(fx('lisen-2026-11-25-saturday-ajax.html')), undefined);
  });

  it('throws when an id, the form or the view state is missing', () => {
    const page = fx('lisen-2026-11-25-today.html');
    const without = (from: string, to: string): string => {
      const html = page.replaceAll(from, to);
      assert.notEqual(html, page);
      return html;
    };
    for (const html of [
      without("'onchanged'", "'onchangedX'"),
      without('name="scheduleNavigForm:j_id210"', 'name="scheduleNavigForm:other"'),
      without('id="scheduleNavigForm"', 'id="otherForm"'),
      without('name="javax.faces.ViewState"', 'name="other"'),
      without('id="scheduleNavigForm:schedule_calendarInputDate"', 'id="x"'),
    ]) {
      assert.throws(() => parseBizzyNav(html), isParseError);
    }
    const noMenuAction = page.replace(
      /(<select id="scheduleNavigForm:view_filter_menu"[^>]*?)'parameters'/,
      "$1'params'",
    );
    assert.notEqual(noMenuAction, page);
    assert.throws(() => parseBizzyNav(noMenuAction), /view menu action id/);
  });
});
