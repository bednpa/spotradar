import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../../testHelpers.ts';
import { MemberproParseError, parseMemberproGrid, toMemberproDate } from './parser.ts';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

// Sportcentrum Ivanovice, recorded 2026-11-25 (badminton grid after choosing the sport + date).
const TODAY = fixture('badminton-2026-11-25.html');
const BUSY = fixture('badminton-2026-11-26.html');
const SATURDAY = fixture('badminton-2026-11-28.html');
const CLOSED = fixture('badminton-2026-12-24.html');

/** One real-markup cell: free = enabled `btnrez` with a time title. */
function cell(kind: 'free' | 'blocked' | 'closed', title: string, colspan = 2): string {
  const attrs = {
    free: `title="${title}" class="btnrez"`,
    blocked: 'disabled="disabled" title="Blokováno" class="btnrezclose" class="btnrez"',
    closed: 'disabled="disabled" title="Zavřeno" class="btnrezclose2" class="btnrez"',
  }[kind];
  return `<td colspan="${colspan}"><input type="submit" value=" " ${attrs} /></DIV></td>`;
}

/** A grid page for 26.11.2026 with one row per list of cells. */
function grid(rows: string[][], shownDate = '26.11.2026'): string {
  const trs = rows
    .map(
      (cells, i) =>
        `<tr id="TAB_ROZPIS_TabPanel_l_1_RADEK_DAY_${i + 1}"><td>Badminton ${i + 1}</td>${cells.join('')}</tr>`,
    )
    .join('');
  return `<form id="form1"><input type="hidden" name="DATUM_HF" id="DATUM_HF" value="${shownDate}" />
    <table><tr id="TAB_ROZPIS_TabPanel_l_1_RADEK_DAY_99"><td></td><td height="1"></td></tr>${trs}</table></form>`;
}

describe('toMemberproDate', () => {
  it('formats YYYY-MM-DD as DD.MM.YYYY', () => {
    assert.equal(toMemberproDate('2026-11-05'), '05.11.2026');
  });
});

describe('parseMemberproGrid – recorded pages', () => {
  it('today: aggregates the three courts per half-hour and merges equal neighbours', () => {
    assert.deepEqual(parseMemberproGrid(TODAY, '2026-11-25'), [
      slot('07:00', '09:00', 3),
      slot('09:00', '11:00', 2),
      slot('11:00', '12:00', 3),
      slot('12:00', '12:30', 2),
      slot('12:30', '13:30', 3),
      slot('13:30', '14:30', 2),
      slot('14:30', '15:00', 3),
      slot('15:00', '18:00', 1),
      slot('20:00', '21:00', 1),
    ]);
  });

  it('busy day: matches the free cells of each court row', () => {
    // Badminton 1 free 10:00-11:00, 12:00-17:00, 18:00-19:00; Badminton 2 free 9:00-15:00;
    // Badminton 3 free 9:00-10:30, 11:30-15:00 and 20:30-21:00 (counted by hand from the page).
    assert.deepEqual(parseMemberproGrid(BUSY, '2026-11-26'), [
      slot('09:00', '10:00', 2),
      slot('10:00', '10:30', 3),
      slot('10:30', '11:00', 2),
      slot('11:00', '11:30', 1),
      slot('11:30', '12:00', 2),
      slot('12:00', '15:00', 3),
      slot('15:00', '17:00', 1),
      slot('18:00', '19:00', 1),
      slot('20:30', '21:00', 1),
    ]);
  });

  it('Saturday grid', () => {
    const slots = parseMemberproGrid(SATURDAY, '2026-11-28');
    assert.deepEqual(slots[0], slot('08:00', '09:30', 3));
    assert.deepEqual(slots.at(-1), slot('18:00', '21:00', 3));
    assert.equal(slots.length, 7);
  });

  it('closed day (every cell blocked or closed) is an empty list, not an error', () => {
    assert.deepEqual(parseMemberproGrid(CLOSED, '2026-12-24'), []);
  });

  it('never returns the data of another date', () => {
    assert.throws(
      () => parseMemberproGrid(BUSY, '2026-11-25'),
      /shows 26\.11\.2026, expected 25\.11\.2026/,
    );
    assert.throws(() => parseMemberproGrid(CLOSED, '2026-11-26'), MemberproParseError);
  });
});

describe('parseMemberproGrid – cell classification (real cell markup)', () => {
  it('counts only enabled btnrez cells with a time title', () => {
    const html = grid([
      [
        cell('free', '7:00 26.11.2026 čtvrtek '),
        cell('blocked', ''),
        cell('closed', ''),
        cell('free', '8:30 26.11.2026 čtvrtek '),
      ],
      [cell('free', '7:00 26.11.2026 čtvrtek '), cell('free', '7:30 26.11.2026 čtvrtek ')],
    ]);
    assert.deepEqual(parseMemberproGrid(html, '2026-11-26'), [
      slot('07:00', '07:30', 2),
      slot('07:30', '08:00', 1),
      slot('08:30', '09:00', 1),
    ]);
  });

  it('treats unknown variants as not free', () => {
    const html = grid([
      [
        '<td colspan="2"><input type="submit" title="Rezervováno" class="btnrez" /></td>', // no time title
        '<td colspan="2"><input type="submit" title="7:30 26.11.2026 čtvrtek " class="btnrezclose" /></td>',
        '<td colspan="2"><input type="submit" title="8:00 26.11.2026 čtvrtek " disabled="disabled" class="btnrez" /></td>',
        '<td colspan="2"><input type="submit" title="8:30 26.11.2026 čtvrtek " class="btnrez2" /></td>',
        '<td colspan="2"><input type="submit" title="9:00 26.11.2026 čtvrtek " /></td>',
        cell('free', '9:30 26.11.2026 čtvrtek '),
      ],
    ]);
    assert.deepEqual(parseMemberproGrid(html, '2026-11-26'), [slot('09:30', '10:00', 1)]);
  });

  it('a wider cell covers several half-hours', () => {
    const html = grid([[cell('free', '7:00 26.11.2026 čtvrtek ', 4)]]);
    assert.deepEqual(parseMemberproGrid(html, '2026-11-26'), [slot('07:00', '08:00', 1)]);
  });

  it('ignores rows without inputs (spacer row RADEK_DAY_99) when counting courts', () => {
    assert.deepEqual(parseMemberproGrid(grid([[cell('blocked', '')]]), '2026-11-26'), []);
  });
});

describe('parseMemberproGrid – changed markup is an error, never partial data', () => {
  it('rejects the sport-less initial page and other pages without a grid', () => {
    assert.throws(
      () => parseMemberproGrid(fixture('initial-get.html'), '2026-11-25'),
      /No court rows/,
    );
    assert.throws(() => parseMemberproGrid('<html>maintenance</html>', '2026-11-25'), /DATUM_HF/);
  });

  it('rejects renamed row ids and a missing date field', () => {
    assert.throws(
      () => parseMemberproGrid(BUSY.replaceAll('RADEK_DAY_', 'ROW_'), '2026-11-26'),
      /No court rows/,
    );
    assert.throws(
      () => parseMemberproGrid(BUSY.replace('id="DATUM_HF"', 'id="DATE"'), '2026-11-26'),
      /DATUM_HF/,
    );
  });

  it('rejects a free cell that belongs to another date than the page', () => {
    const html = grid([[cell('free', '7:00 27.11.2026 pátek ')]]);
    assert.throws(() => parseMemberproGrid(html, '2026-11-26'), /27\.11\.2026/);
  });

  it('rejects free cells with a start that is not on a half-hour or an odd colspan', () => {
    assert.throws(
      () => parseMemberproGrid(grid([[cell('free', '7:10 26.11.2026 čtvrtek ')]]), '2026-11-26'),
      MemberproParseError,
    );
    assert.throws(
      () => parseMemberproGrid(grid([[cell('free', '7:00 26.11.2026 čtvrtek ', 3)]]), '2026-11-26'),
      /colspan/,
    );
  });
});
