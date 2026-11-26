import { readFileSync } from 'node:fs';
import { addDays, isValidDate } from '@spotradar/shared';
import { czechWeekdayName } from './parser.ts';

const RECORDED_START = '2026-11-26';
const RECORDED_DAYS = 4;

let recorded: string | undefined;

function fixture(): string {
  recorded ??= readFileSync(
    new URL('./fixtures/slovan-2026-11-26-schema.html', import.meta.url),
    'utf8',
  );
  return recorded;
}

/**
 * The recorded 4-day answer (26.-29.11.2026) moved to start at `start`: the n-th day heading
 * ("Čtvrtek 26.11.") and `data-date` become the n-th day from `start`, the cells stay as
 * recorded. Day 1 is the recorded 26.11.: courts 1 and 2 are free (by phone) 19:00-20:00.
 */
export function isportsystemSchemaStartingAt(html: string, start: string): string {
  const dates = Array.from({ length: RECORDED_DAYS }, (_, i) => addDays(start, i));
  let index = 0;
  return html
    .replace(/<h3>[^<]*<\/h3>/g, () => {
      const date = dates[index++] ?? start;
      const [, month, day] = date.split('-').map(Number);
      return `<h3>${czechWeekdayName(date)} ${day}.${month}.</h3>`;
    })
    .replace(/data-date="(\d{4}-\d{2}-\d{2})"/g, (attr, date: string) => {
      const offset = [...Array(RECORDED_DAYS).keys()].find(
        (i) => addDays(RECORDED_START, i) === date,
      );
      return offset === undefined ? attr : `data-date="${addDays(start, offset)}"`;
    });
}

/**
 * Stub mode for iSportSystem (`POST {baseUrl}/ajax/ajax.schema.php`, form with day/month/year):
 * answers with the recorded multi-day schema whose headings start at the requested date, so the
 * real parser finds the day for any date. Other requests throw.
 */
export function serveIsportsystemStub(url: URL, init: RequestInit | undefined): Response {
  if (!url.pathname.endsWith('/ajax/ajax.schema.php') || init?.method !== 'POST') {
    throw new Error(`Stub mode: ${url.href} is unreachable`);
  }
  const body = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
  const date = `${body.get('year')}-${String(body.get('month')).padStart(2, '0')}-${String(body.get('day')).padStart(2, '0')}`;
  if (!isValidDate(date)) throw new Error('Stub mode: iSportSystem request without a valid date');
  return new Response(isportsystemSchemaStartingAt(fixture(), date), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}
