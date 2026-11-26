import { readFileSync } from 'node:fs';
import { addDays } from '@spotradar/shared';
import { mondayOf } from './parser.ts';

/** The recorded week page `/rozvrh/0/` (Mon 23.11. – Sun 29.11.2026), trimmed to the timetable. */
const FIXTURE = 'fixtures/rozvrh-0-2026-11-26.html';
const DAY_HEADING_RE =
  /(<th class = 'timetable-day' rowspan=\d+>)([^<]*)<br>\d{2}\.\d{2}\.\d{4}(<\/th>)/g;
const PATH_RE = /^\/rozvrh\/(-?\d+)\/$/;

let fixtureHtml: string | undefined;

function recordedWeek(): string {
  fixtureHtml ??= readFileSync(new URL(FIXTURE, import.meta.url), 'utf8');
  return fixtureHtml;
}

/** "2026-11-26" → "26.11.2026" (how the page writes day headings). */
function czechDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}

/**
 * The recorded Komárov week shown for the Monday–Sunday week starting at `monday`: the seven day
 * headings get the new dates (weekday names stay, so weekend opening hours stay realistic); the
 * free / booked pattern of each weekday is the recorded one.
 */
export function komarovWeekStartingAt(html: string, monday: string): string {
  let day = 0;
  return html.replace(
    DAY_HEADING_RE,
    (_, open: string, weekday: string, close: string) =>
      `${open}${weekday}<br>${czechDate(addDays(monday, day++))}${close}`,
  );
}

/**
 * E2E stub of tenis-komarov.cz: `GET /rozvrh/<N>/` answers the recorded week shifted to the week
 * N weeks after the current Monday–Sunday week of `today` ("YYYY-MM-DD"), like the real site
 * (a negative N is the current week). Every requested date therefore has the recorded free
 * courts of its weekday; past times of today are dropped by the real connector, so late in the
 * evening today may legitimately have nothing left. Other paths answer 404.
 */
export function serveKomarovStub(
  url: URL,
  _init: RequestInit | undefined,
  today: string,
): Response {
  const match = PATH_RE.exec(url.pathname);
  if (!match) return new Response('Not found', { status: 404 });
  const offset = Math.max(0, Number(match[1]));
  const html = komarovWeekStartingAt(recordedWeek(), addDays(mondayOf(today), offset * 7));
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
