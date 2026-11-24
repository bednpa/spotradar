import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { FreeSlot } from '@spotradar/shared';
import { ClubspireParseError, parseClubspireTimeline } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function slot(start: string, end: string, freeCourts: number): FreeSlot {
  return { start, end, freeCourts };
}

describe('parseClubspireTimeline', () => {
  it('parses the Kuklenská timeline (hourly cells, 4 courts)', () => {
    // Court occupancy by hour (7:00 ... 21:00), F = booked, . = free:
    //   Kurt 1: F . F F . . . . F F F F F F F
    //   Kurt 2: F F F F . . . . F F F F F F F
    //   Kurt 3: . . . . . . . . F F F F F F F
    //   Kurt 4: F F F F . . . F . . F F F F .
    assert.deepEqual(parseClubspireTimeline(fixture('kuklenska-2026-11-25.html')), [
      slot('07:00', '08:00', 1),
      slot('08:00', '09:00', 2),
      slot('09:00', '10:00', 1),
      slot('10:00', '11:00', 1),
      slot('11:00', '12:00', 4),
      slot('12:00', '13:00', 4),
      slot('13:00', '14:00', 4),
      slot('14:00', '15:00', 3),
      slot('15:00', '16:00', 1),
      slot('16:00', '17:00', 1),
      // 17:00-21:00 fully booked
      slot('21:00', '22:00', 1),
    ]);
  });

  it('parses the Viktoria timeline (half-hour zoom cells, disabled edge cells, substitute classes)', () => {
    // Header starts at 6:00 (disabled on every court) and ends with disabled 22:00 / 23:00.
    // Cells with "full_substitute can_book_substitute" are booked, not free.
    assert.deepEqual(parseClubspireTimeline(fixture('viktoria-2026-11-25.html')), [
      slot('07:00', '07:30', 1),
      slot('07:30', '08:00', 1),
      slot('10:00', '10:30', 2),
      slot('10:30', '11:00', 2),
      slot('11:00', '11:30', 3),
      slot('11:30', '12:00', 3),
      slot('12:00', '12:30', 3),
      slot('12:30', '13:00', 3),
      slot('13:00', '13:30', 3),
      slot('13:30', '14:00', 3),
      slot('14:00', '14:30', 3),
      slot('14:30', '15:00', 3),
      slot('19:00', '19:30', 1),
      slot('19:30', '20:00', 1),
      slot('21:00', '21:30', 3),
      slot('21:30', '22:00', 3),
    ]);
  });

  it('handles colspan > 1, leading disabled cells without data-time-id, and substitute cells', () => {
    assert.deepEqual(parseClubspireTimeline(fixture('edge-cases.html')), [
      slot('09:00', '10:00', 1),
      slot('10:00', '11:00', 2),
    ]);
  });

  it('returns [] for an empty schedule', () => {
    assert.deepEqual(parseClubspireTimeline(fixture('empty-schedule.html')), []);
  });

  it('returns [] when the schedule has no header', () => {
    const html =
      "<div id='hours_body'><table class='schedule'><tr data-row-id='x'><td class='can_book'></td></tr></table></div>";
    assert.deepEqual(parseClubspireTimeline(html), []);
  });

  it('classifies precedence: disabled/full beat can_book, unknown classes are not free', () => {
    const html = `
      <div id='hours_head'><table class='schedule'><tr>
        <td id='time_col_1'>8:00</td><td id='time_col_2'>9:00</td><td id='time_col_3'>10:00</td><td id='time_col_4'>11:00</td>
      </tr></table></div>
      <div id='hours_body'><table class='schedule'><tr data-row-id='a'>
        <td class='can_book full'></td><td class='can_book disabled'></td><td class='blocked'></td><td class='can_book_substitute'></td>
      </tr></table></div>`;
    assert.deepEqual(parseClubspireTimeline(html), [slot('11:00', '12:00', 1)]);
  });

  it('throws on a page without any schedule table', () => {
    assert.throws(
      () => parseClubspireTimeline('<html><body>Error 500</body></html>'),
      ClubspireParseError,
    );
    assert.throws(() => parseClubspireTimeline(''), ClubspireParseError);
  });
});
