/**
 * The existing connectors' parsers on real pages of the new sports, recorded 2026-11-25/26:
 * Centrum Viktoria squash / beach / padel (ClubSpire tabs 0, 2, 3), Fitness Boby squash
 * (ClubSpire tab 4), Ivanovice squash and table tennis (MemberPro sport buttons) and
 * Hala Sprint indoor tennis (MemberZone ID_Sportoviste=1).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { slot } from '../testHelpers.ts';
import { parseClubspireTimeline } from './clubspire/parser.ts';
import { ClubspireParseError } from './clubspire/parser.ts';
import { parseMemberproGrid } from './memberpro/parser.ts';
import { parseMemberzoneWeek } from './memberzone/parser.ts';

function fixture(path: string): string {
  return readFileSync(new URL(`./${path}`, import.meta.url), 'utf8');
}

const maxCourts = (slots: { freeCourts: number }[]): number =>
  Math.max(0, ...slots.map((s) => s.freeCourts));

describe('ClubSpire timelines of other sports', () => {
  const VIKTORIA_SQUASH = fixture('clubspire/fixtures/viktoria-squash-2026-11-26.html');
  const VIKTORIA_BEACH = fixture('clubspire/fixtures/viktoria-beach-volleyball-2026-11-26.html');
  const VIKTORIA_PADEL_TENNIS = fixture('clubspire/fixtures/viktoria-padel-tennis-2026-11-26.html');
  const BOBY_SQUASH = fixture('clubspire/fixtures/fitnessboby-squash-2026-11-26.html');

  it('Viktoria squash (tab 0): 6 courts, 30-minute cells', () => {
    const slots = parseClubspireTimeline(VIKTORIA_SQUASH);
    assert.deepEqual(slots.slice(0, 3), [
      slot('07:00', '07:30', 4),
      slot('07:30', '08:00', 4),
      slot('08:00', '08:30', 6),
    ]);
    assert.equal(maxCourts(slots), 6);
  });

  it('Viktoria beach volleyball (tab 2): 5 courts (the season is applied elsewhere)', () => {
    assert.equal(maxCourts(parseClubspireTimeline(VIKTORIA_BEACH)), 5);
  });

  it('Viktoria tab 3 mixes padel and tennis: the court-name filter keeps the 3 padel courts', () => {
    const all = parseClubspireTimeline(VIKTORIA_PADEL_TENNIS);
    assert.equal(maxCourts(all), 5); // Padel 1-3 + "Tenis" + "Hřiště - osvětlené"
    const padel = parseClubspireTimeline(VIKTORIA_PADEL_TENNIS, { courtNamePrefixes: ['Padel'] });
    assert.equal(maxCourts(padel), 3);
    assert.deepEqual(padel.slice(0, 2), [slot('07:00', '07:15', 3), slot('07:15', '07:30', 3)]);
    // Case-insensitive prefixes; several prefixes add up.
    const tennis = parseClubspireTimeline(VIKTORIA_PADEL_TENNIS, { courtNamePrefixes: ['TENIS'] });
    assert.equal(maxCourts(tennis), 1);
    const both = parseClubspireTimeline(VIKTORIA_PADEL_TENNIS, {
      courtNamePrefixes: ['padel', 'tenis'],
    });
    assert.equal(maxCourts(both), 4);
    assert.deepEqual(
      parseClubspireTimeline(VIKTORIA_PADEL_TENNIS, { courtNamePrefixes: ['Squash'] }),
      [],
    );
  });

  it('throws when a court filter is set but the page has no court names', () => {
    const withoutNames = VIKTORIA_PADEL_TENNIS.replaceAll('class="hall"', 'class="room"');
    assert.throws(
      () => parseClubspireTimeline(withoutNames, { courtNamePrefixes: ['Padel'] }),
      ClubspireParseError,
    );
  });

  it('Fitness Boby squash (other ClubSpire host, tab 4): 5 courts from 06:00', () => {
    const slots = parseClubspireTimeline(BOBY_SQUASH);
    assert.deepEqual(slots.slice(0, 4), [
      slot('06:00', '06:30', 5),
      slot('06:30', '07:00', 3),
      slot('07:00', '07:30', 3),
      slot('07:30', '08:00', 4),
    ]);
    assert.equal(maxCourts(slots), 5);
  });
});

describe('MemberPro grids of other sports (Ivanovice)', () => {
  it('squash (BTN4): 4 courts', () => {
    const slots = parseMemberproGrid(
      fixture('memberpro/fixtures/ivanovice-squash-2026-11-26.html'),
      '2026-11-26',
    );
    assert.deepEqual(slots.slice(0, 4), [
      slot('07:00', '08:00', 2),
      slot('09:00', '14:30', 4),
      slot('14:30', '15:30', 3),
      slot('15:30', '16:00', 4),
    ]);
    assert.equal(maxCourts(slots), 4);
  });

  it('table tennis (BTN3 "Ping-pong"): 2 tables', () => {
    const slots = parseMemberproGrid(
      fixture('memberpro/fixtures/ivanovice-table-tennis-2026-11-26.html'),
      '2026-11-26',
    );
    assert.deepEqual(slots.slice(0, 4), [
      slot('07:00', '08:00', 2),
      slot('09:00', '19:30', 2),
      slot('19:30', '20:30', 1),
      slot('20:30', '21:00', 2),
    ]);
    assert.equal(maxCourts(slots), 2);
  });

  it('checks the requested date on other sports too', () => {
    assert.throws(() =>
      parseMemberproGrid(
        fixture('memberpro/fixtures/ivanovice-squash-2026-11-26.html'),
        '2026-11-27',
      ),
    );
  });
});

describe('MemberZone week of Hala Sprint indoor tennis', () => {
  it('reads 7 days from 25.11. with at most 6 courts', () => {
    const week = parseMemberzoneWeek(
      fixture('memberzone/fixtures/sprint-tennis-2026-11-25.html'),
      '2026-11-26',
    );
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
    const all = [...week.values()].flat();
    assert.deepEqual(
      [...week].map(([d, s]) => [d, s.length]),
      [
        ['2026-11-25', 0], // recorded in the evening: nothing left that day
        ['2026-11-26', 4],
        ['2026-11-27', 9],
        ['2026-11-28', 10],
        ['2026-11-29', 8],
        ['2026-11-30', 8],
        ['2026-12-01', 4],
      ],
    );
    assert.ok(all.length > 0);
    assert.ok(maxCourts(all) <= 6);
  });
});
