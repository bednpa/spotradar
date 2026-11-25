import * as cheerio from 'cheerio';
import type { FreeSlot } from '@spotradar/shared';
import { addDays } from '@spotradar/shared';
import { readHiddenFields } from '../aspnet.ts';
import { freeSlotsFromHalfSlots, HALF_SLOT_MINUTES } from '../halfSlots.ts';

/** Thrown when the page is not the expected MemberZone week schedule (markup changed, error page, ...). */
export class MemberzoneParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemberzoneParseError';
  }
}

/** The page is a valid week schedule, but the requested date is not one of its 7 days. */
export class MemberzoneDateNotShownError extends MemberzoneParseError {
  constructor(message: string) {
    super(message);
    this.name = 'MemberzoneDateNotShownError';
  }
}

const HEADER_DATE_RE = /(\d{1,2})\.\s*(\d{1,2})\./;
const CARD_DATE_RE = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/;
const CARD_DATETIME_RE = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?$/;
const CARD_RANGE_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;
const MINUTES_PER_DAY = 24 * 60;

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Day and month of a "YYYY-MM-DD" date. */
function dayMonth(date: string): { day: number; month: number } {
  const [, m, d] = date.split('-').map(Number);
  return { day: d ?? 0, month: m ?? 0 };
}

interface Card {
  date: string;
  start: number;
  end: number;
  courtIds: string[];
}

type Selection = ReturnType<cheerio.CheerioAPI>;

function field(card: Selection, name: string): string {
  const el = card.find(`[data-identifi="${name}"]`).first();
  const raw = el.is('input') ? el.attr('value') : el.text();
  return (raw ?? '').trim();
}

/** Reads one free-window card; throws when any part is missing or inconsistent. */
function readCard(card: Selection): Card {
  const courtIds = field(card, 'KurtyID')
    .split(',')
    .map((id) => id.trim());
  if (courtIds.length === 0 || courtIds.some((id) => !/^\d+$/.test(id))) {
    throw new MemberzoneParseError('Free-window card without parsable court IDs');
  }

  const when = CARD_DATETIME_RE.exec(field(card, 'DatumCas'));
  if (!when) throw new MemberzoneParseError('Free-window card without parsable date and time');
  const date = isoDate(Number(when[3]), Number(when[2]), Number(when[1]));
  const start = Number(when[4]) * 60 + Number(when[5]);

  const dateOnly = CARD_DATE_RE.exec(field(card, 'DatumLekce2'));
  if (
    !dateOnly ||
    isoDate(Number(dateOnly[3]), Number(dateOnly[2]), Number(dateOnly[1])) !== date
  ) {
    throw new MemberzoneParseError('Free-window card with inconsistent dates');
  }

  const length = Number(field(card, 'DelkaLekce'));
  const end = start + length;
  if (
    !Number.isInteger(length) ||
    length <= 0 ||
    length % HALF_SLOT_MINUTES !== 0 ||
    start % HALF_SLOT_MINUTES !== 0 ||
    end > MINUTES_PER_DAY
  ) {
    throw new MemberzoneParseError(`Free-window card with unsupported time ${start}+${length} min`);
  }

  const range = CARD_RANGE_RE.exec(field(card, 'SkupCasOdDo'));
  if (
    !range ||
    Number(range[1]) * 60 + Number(range[2]) !== start ||
    Number(range[3]) * 60 + Number(range[4]) !== end
  ) {
    throw new MemberzoneParseError(
      'Free-window card whose time range does not match its start/length',
    );
  }
  return { date, start, end, courtIds };
}

/**
 * Parses a MemberZone "Sportoviste.aspx" page: a 7-day week that contains `date`. Returns the
 * free slots of EVERY day of the page (ISO date -> FreeSlot[], courts aggregated per half-hour,
 * consecutive equal half-hours merged). A day without any free window maps to [].
 *
 * Each card (`data-identifi="kurty"`) is a bookable window listing only the courts that are
 * free for its whole length; a court is free in a half-hour when some card covering it lists it.
 *
 * Throws MemberzoneDateNotShownError when `date` is not one of the 7 days and
 * MemberzoneParseError when the schedule table/headers/cards are missing or malformed.
 */
export function parseMemberzoneWeek(html: string, date: string): Map<string, FreeSlot[]> {
  const $ = cheerio.load(html);
  if ($('table#tableLekce').length === 0) {
    throw new MemberzoneParseError('No schedule table (#tableLekce) found in MemberZone page');
  }

  const headers = $('#tableLekce th[id^="DATUM"]').toArray();
  if (headers.length !== 7) {
    throw new MemberzoneParseError(`Expected 7 date headers, found ${headers.length}`);
  }
  const headerDays = headers.map((th) => {
    const match = HEADER_DATE_RE.exec($(th).text());
    if (!match) throw new MemberzoneParseError('Unparsable date header in MemberZone page');
    return { day: Number(match[1]), month: Number(match[2]) };
  });
  const wanted = dayMonth(date);
  const index = headerDays.findIndex((h) => h.day === wanted.day && h.month === wanted.month);
  if (index < 0) {
    throw new MemberzoneDateNotShownError(
      `Requested date ${date} is not shown on the MemberZone page`,
    );
  }

  // Headers carry no year: the other days are derived from the requested date and cross-checked.
  const days = headerDays.map((h, i) => {
    const iso = addDays(date, i - index);
    const check = dayMonth(iso);
    if (check.day !== h.day || check.month !== h.month) {
      throw new MemberzoneParseError('MemberZone date headers are not consecutive days');
    }
    return iso;
  });

  const freeByDay = new Map<string, Map<number, Set<string>>>(days.map((d) => [d, new Map()]));
  $('#tableLekce [data-identifi="kurty"]').each((_, el) => {
    const card = readCard($(el));
    const day = freeByDay.get(card.date);
    if (!day) return; // a window of a day this page does not show: not needed
    for (let t = card.start; t < card.end; t += HALF_SLOT_MINUTES) {
      let courts = day.get(t);
      if (!courts) {
        courts = new Set();
        day.set(t, courts);
      }
      for (const id of card.courtIds) courts.add(id);
    }
  });

  return new Map(days.map((d) => [d, freeSlotsFromHalfSlots(freeByDay.get(d) ?? new Map())]));
}

/** Free slots of one date (see parseMemberzoneWeek). */
export function parseMemberzoneSchedule(html: string, date: string): FreeSlot[] {
  return parseMemberzoneWeek(html, date).get(date) ?? [];
}

export interface MemberzoneForm {
  /** Form action as written in the page (relative to the page URL). */
  action: string;
  /** All hidden inputs of the form plus the selected window length (`DropDownDelka`). */
  fields: URLSearchParams;
}

/** Reads what a date-switch postback needs from a MemberZone page. */
export function parseMemberzoneForm(html: string): MemberzoneForm {
  const $ = cheerio.load(html);
  const form = $('form#form1');
  if (form.length === 0) throw new MemberzoneParseError('No form found in MemberZone page');
  const fields = readHiddenFields(html);
  const length = $('#DropDownDelka option[selected]').attr('value');
  if (length) fields.set('DropDownDelka', length);
  return { action: form.attr('action') ?? '', fields };
}
