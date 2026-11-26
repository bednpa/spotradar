import { readFileSync } from 'node:fs';
import type { GeocodeResponse } from '@spotradar/shared';
import { addDays, isValidDate, toLocalDateTime } from '@spotradar/shared';
import { bizzyPageStartingAt } from './connectors/bizzy/stubPages.ts';
import { serveIsportsystemStub } from './connectors/isportsystem/stub.ts';
import { serveReenioStub } from './connectors/reenio/stub.ts';
import { servePadelosStub } from './connectors/padelos/stub.ts';
import { serveRezzyStub } from './connectors/rezzy/stub.ts';
import { serveKomarovStub } from './connectors/komarov/stub.ts';
import { serveZltcStub } from './connectors/zltc/stub.ts';
import {
  FIRESTORE_API_ORIGIN,
  PADELOS_API_ORIGIN,
  REZZY_API_ORIGIN,
} from './connectors/apiOrigins.ts';
import { HttpError } from './errors.ts';
import type { Suggester } from './services/suggest.ts';
import type { FetchFn } from './connectors/types.ts';
import type { Geocoder } from './services/geocode.ts';

/**
 * Stub mode (`SPOTRADAR_STUB_EXTERNAL=1`, used by the Playwright E2E tests):
 * no network access. The real ClubSpire connector and parser still run; only
 * the injected `fetch` is fake.
 */
export function isStubMode(env: NodeJS.ProcessEnv): boolean {
  return env.SPOTRADAR_STUB_EXTERNAL === '1';
}

const KUKLENSKA_HOST = 'kuklenska.clubspire.cz';
const MEMBERZONE_HOST = 'memberzone.cz';

const fixtureCache = new Map<string, string>();

/** Reads a connector fixture once (path relative to `connectors/`). */
function fixture(path: string): string {
  let html = fixtureCache.get(path);
  if (html === undefined) {
    html = readFileSync(new URL(`./connectors/${path}`, import.meta.url), 'utf8');
    fixtureCache.set(path, html);
  }
  return html;
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

const SPRINT_FIXTURE = 'memberzone/fixtures/sprint-2026-11-26-post.html';
const SPRINT_FIXTURE_START = '2026-11-26';
const IVANOVICE_INITIAL_FIXTURE = 'memberpro/fixtures/initial-get.html';
const IVANOVICE_GRID_FIXTURE = 'memberpro/fixtures/badminton-2026-11-26.html';
const IVANOVICE_GRID_DATE = '26.11.2026';
const IVANOVICE_SQUASH_FIXTURE = 'memberpro/fixtures/ivanovice-squash-2026-11-26.html';
const IVANOVICE_TABLE_TENNIS_FIXTURE = 'memberpro/fixtures/ivanovice-table-tennis-2026-11-26.html';
const SPRINT_TENNIS_FIXTURE = 'memberzone/fixtures/sprint-tennis-2026-11-25.html';
const SPRINT_TENNIS_FIXTURE_START = '2026-11-25';
const VIKTORIA_HOST = 'rezervace.centrumviktoria.cz:18443';
const FITNESS_BOBY_HOST = 'rezervace.fitnessboby.cz:28080';
const STAREZ_BEACH_HOST = 'beach.starez.cz';
const STAREZ_BEACH_FIXTURE = 'starez/fixtures/beach-2026-11-25-today.html';
const STAREZ_BEACH_DATE = '2026-11-25';

/**
 * Hosts whose connector module ships its own stub (recorded answer rewritten to the requested
 * date, see each `connectors/<system>/stub.ts`).
 */
const HOST_STUBS: Record<string, (url: URL, init: RequestInit | undefined) => Response> = {
  'tjteslabrno.reenio.cz': serveReenioStub,
  'squashslovan.isportsystem.cz': serveIsportsystemStub,
  [new URL(PADELOS_API_ORIGIN).host]: (url, init) => servePadelosStub(url, init),
  [new URL(REZZY_API_ORIGIN).host]: (url) => serveRezzyStub(url),
  'www.tenis-komarov.cz': (url, init) =>
    serveKomarovStub(url, init, toLocalDateTime(new Date()).date),
  [new URL(FIRESTORE_API_ORIGIN).host]: (url, init) =>
    serveZltcStub(url, init, toLocalDateTime(new Date()).date),
};

/**
 * ClubSpire timelines per host and tab. Viktoria's badminton tab (1) is deliberately missing,
 * so E2E keeps one "unavailable" venue ("check on website").
 */
const CLUBSPIRE_TABS: Record<string, Record<string, string>> = {
  [VIKTORIA_HOST]: {
    '0': 'clubspire/fixtures/viktoria-squash-2026-11-26.html',
    '2': 'clubspire/fixtures/viktoria-beach-volleyball-2026-11-26.html',
    '3': 'clubspire/fixtures/viktoria-padel-tennis-2026-11-26.html',
  },
  [FITNESS_BOBY_HOST]: { '4': 'clubspire/fixtures/fitnessboby-squash-2026-11-26.html' },
};

function serveClubspireTab(url: URL): Response {
  const path = CLUBSPIRE_TABS[url.host]?.[url.searchParams.get('tabIdx') ?? ''];
  if (!path) throw new Error(`Stub mode: ${url.href} is unreachable`);
  return htmlResponse(fixture(path));
}

/** The recorded Beach Riviéra grid of 2026-11-25 shown as `date`. */
export function starezBeachPageFor(html: string, date: string): string {
  return html
    .replaceAll(`data-active-date="${STAREZ_BEACH_DATE}"`, `data-active-date="${date}"`)
    .replaceAll(`data-active-date-raw="${STAREZ_BEACH_DATE}"`, `data-active-date-raw="${date}"`);
}

/**
 * STAREZ (beach.starez.cz): a GET returns today's page with a session cookie; the AJAX date
 * switch (`?date=DD.MM.YYYY&do=getDate`, XHR + cookie) returns JSON with the grid snippet.
 * Every day shows the recorded 25.11. grid.
 */
function serveStarez(url: URL, init: RequestInit | undefined): Response {
  const page = fixture(STAREZ_BEACH_FIXTURE);
  const requested = pickerToIso(url.searchParams.get('date'));
  if (url.searchParams.get('do') !== 'getDate' || requested === undefined) {
    const res = htmlResponse(starezBeachPageFor(page, toLocalDateTime(new Date()).date));
    res.headers.append('set-cookie', 'PHPSESSID=stub; path=/');
    return res;
  }
  if (headerValue(init, 'x-requested-with') !== 'XMLHttpRequest') {
    throw new Error('Stub mode: STAREZ date switch without X-Requested-With');
  }
  if (!headerValue(init, 'cookie')?.includes('PHPSESSID=stub')) {
    throw new Error('Stub mode: STAREZ date switch without the session cookie');
  }
  const snippet = starezBeachPageFor(page, requested);
  return new Response(JSON.stringify({ snippets: { 'snippet--reservation': snippet } }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
const CZECH_WEEKDAYS = ['NEDĚLE', 'PONDĚLÍ', 'ÚTERÝ', 'STŘEDA', 'ČTVRTEK', 'PÁTEK', 'SOBOTA'];

/** "2026-11-05" -> "5. 11. 2026" (how MemberZone writes dates in its hidden fields). */
function spacedDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

/**
 * The recorded Hala Sprint week (7 days from 2026-11-26) moved to start at `start`:
 * date headers, the date of every window card and the date input are rewritten, so the
 * real parser accepts the page for any date. Free windows repeat day by day.
 */
export function sprintWeekStartingAt(
  html: string,
  start: string,
  recordedStart: string = SPRINT_FIXTURE_START,
): string {
  const newDates = new Map<string, string>();
  for (let i = 0; i < 7; i++) {
    newDates.set(spacedDate(addDays(recordedStart, i)), addDays(start, i));
  }
  return html
    .replace(/<th id="DATUM(\d)"([^>]*)>[^<]*<\/th>/g, (_, n: string, attrs: string) => {
      const date = addDays(start, Number(n) - 1);
      const [, month, day] = date.split('-').map(Number);
      const weekday = CZECH_WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
      return `<th id="DATUM${n}"${attrs}>${weekday}&nbsp;&nbsp;&nbsp;${day}.${month}.</th>`;
    })
    .replace(/\b\d{1,2}\. \d{1,2}\. \d{4}\b/g, (old) => {
      const date = newDates.get(old);
      return date ? spacedDate(date) : old;
    })
    .replace(/(id="myDate"[^>]*value=")[^"]*/, `$1${start}`);
}

/** The recorded Ivanovice grid for 26.11.2026, shown for `date` ("YYYY-MM-DD"). */
export function ivanoviceGridFor(html: string, date: string): string {
  const [y, m, d] = date.split('-');
  return html.replaceAll(IVANOVICE_GRID_DATE, `${d}.${m}.${y}`);
}

/** The two memberzone.cz systems: Hala Sprint (MemberZone) and Ivanovice (MemberPro). */
function serveMemberzone(url: URL, init: RequestInit | undefined): Response {
  const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
  const isPost = init?.method === 'POST';
  if (url.pathname.startsWith('/sprint_tenis/')) {
    // A plain GET shows the week from today, a date-switch postback the week from `myDate`.
    const start = isPost ? body.get('myDate') : toLocalDateTime(new Date()).date;
    if (!start || !isValidDate(start)) throw new Error('Stub mode: Sprint postback without a date');
    // ID_Sportoviste=1 is the tennis hall (recorded as a GET of the week from 25.11. in the
    // evening, when 25.11. had nothing left): the week is shifted one day back so the requested
    // day shows the recorded 26.11. and stays inside the 7 shown days.
    if (url.searchParams.get('ID_Sportoviste') === '1') {
      return htmlResponse(
        sprintWeekStartingAt(
          fixture(SPRINT_TENNIS_FIXTURE),
          addDays(start, -1),
          SPRINT_TENNIS_FIXTURE_START,
        ),
      );
    }
    return htmlResponse(sprintWeekStartingAt(fixture(SPRINT_FIXTURE), start));
  }
  if (url.pathname.startsWith('/ivanovice/')) {
    if (!isPost) return htmlResponse(fixture(IVANOVICE_INITIAL_FIXTURE));
    const [d, m, y] = (body.get('DATUM_HF') ?? '').split('.');
    const date = `${y}-${m}-${d}`;
    if (!isValidDate(date)) throw new Error('Stub mode: Ivanovice postback without a date');
    // The sport button decides the grid (all recorded for 26.11.2026).
    const grid = body.has('BTN4')
      ? IVANOVICE_SQUASH_FIXTURE
      : body.has('BTN3')
        ? IVANOVICE_TABLE_TENNIS_FIXTURE
        : IVANOVICE_GRID_FIXTURE;
    return htmlResponse(ivanoviceGridFor(fixture(grid), date));
  }
  throw new Error(`Stub mode: ${url.href} is unreachable`);
}

const BIZZY_FIXTURE_PREFIX: Record<string, string> = {
  'badminton-jehnice.e-rezervace.cz': 'jehnice',
  'badmintonlisen.e-rezervace.cz': 'lisen',
  'xarena.e-rezervace.cz': 'xarena',
};
const BIZZY_SCHEDULE_PATH = '/Branch/pages/Schedule.faces';
const BIZZY_NAV_REGION = 'scheduleNavigForm:schedule-navig-region';

/** "25.11.2026" (the date picker's input) -> "2026-11-25", undefined when it is not a date. */
function pickerToIso(value: string | null): string | undefined {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value ?? '');
  if (!m) return undefined;
  const iso = `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return isValidDate(iso) ? iso : undefined;
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  return new Headers(init?.headers).get(name) ?? undefined;
}

/**
 * The three Bizzy venues (Jehnice, Líšeň, X-Arena). A GET returns the venue's recorded start page
 * (Jehnice: 8 days, the others: 1 day) and sets `JSESSIONID=stub`; every A4J POST returns the
 * recorded "today + 7 days" response. Both are rewritten by `bizzyPageStartingAt`: the window
 * starts at the date picker value of the POST (the connector's requested date, or the session's
 * date for the view switch), else today, and every day is the same recorded weekday.
 */
function serveBizzy(url: URL, init: RequestInit | undefined): Response {
  const prefix = BIZZY_FIXTURE_PREFIX[url.host];
  // The form action carries a `;jsessionid=...` path parameter.
  if (!prefix || url.pathname.split(';')[0] !== BIZZY_SCHEDULE_PATH) {
    throw new Error(`Stub mode: ${url.href} is unreachable`);
  }
  const week = fixture(`bizzy/fixtures/${prefix}-2026-11-25-week-ajax.html`);
  const today = toLocalDateTime(new Date()).date;
  if (init?.method !== 'POST') {
    const html = bizzyPageStartingAt(
      fixture(`bizzy/fixtures/${prefix}-2026-11-25-today.html`),
      week,
      today,
    );
    const res = htmlResponse(html);
    res.headers.append('set-cookie', 'JSESSIONID=stub; Path=/');
    return res;
  }
  const body = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
  if (body.get('AJAXREQUEST') !== BIZZY_NAV_REGION) {
    throw new Error('Stub mode: Bizzy postback without AJAXREQUEST of the navigation region');
  }
  if (!headerValue(init, 'cookie')?.includes('JSESSIONID=stub')) {
    throw new Error('Stub mode: Bizzy postback without the session cookie');
  }
  const start = pickerToIso(body.get('scheduleNavigForm:schedule_calendarInputDate')) ?? today;
  return htmlResponse(bizzyPageStartingAt(week, week, start));
}

/**
 * Kuklenská (ClubSpire) returns the sanitized fixture for any date; Centrum Viktoria serves its
 * squash, beach and padel tabs (not badminton) and Fitness Boby its squash tab. Hala Sprint
 * (badminton + tennis) and Ivanovice (badminton, squash, table tennis) on memberzone.cz serve their
 * recorded pages with the dates rewritten to the requested date. Badminton Jehnice, Badminton
 * Líšeň and X-Arena (Bizzy) replay their recorded pages with every day set to the same recorded
 * weekday, so any date shows the same free hours (see `serveBizzy`). Beach Riviéra (STAREZ) shows
 * its recorded grid for any date. The hosts in `HOST_STUBS` (Reenio, iSportSystem, PadelOS,
 * Rezzy, Komárov, ŽLTC) answer through their connector's `stub.ts`. Every other host or tab fails.
 */
export function createStubFetch(): FetchFn {
  return (input, init) => {
    const url = new URL(input);
    try {
      if (url.host === KUKLENSKA_HOST) {
        return Promise.resolve(
          htmlResponse(fixture('clubspire/fixtures/kuklenska-2026-11-25.html')),
        );
      }
      if (url.host === MEMBERZONE_HOST) return Promise.resolve(serveMemberzone(url, init));
      if (Object.hasOwn(CLUBSPIRE_TABS, url.host)) return Promise.resolve(serveClubspireTab(url));
      if (url.host === STAREZ_BEACH_HOST) return Promise.resolve(serveStarez(url, init));
      if (Object.hasOwn(BIZZY_FIXTURE_PREFIX, url.host))
        return Promise.resolve(serveBizzy(url, init));
      const serve = HOST_STUBS[url.host];
      if (serve) return Promise.resolve(serve(url, init));
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return Promise.reject(new Error(`Stub mode: ${url.host} is unreachable`));
  };
}

const STUB_BRNO_SUGGESTIONS: GeocodeResponse[] = [
  { lat: 49.19411, lng: 16.63409, label: 'Kuklenská, Židenice, Brno' },
  { lat: 49.19532, lng: 16.63253, label: 'SportCentrum Kuklenská, Židenice, Brno' },
  { lat: 49.1951, lng: 16.6068, label: 'Brno' },
];

/** "nowhere" → no suggestions, "fail" → GEOCODER_UNAVAILABLE, "praha" → Prague, else Brno. */
export function createStubSuggester(): Suggester {
  return {
    suggest(q) {
      const lower = q.toLowerCase();
      if (lower.includes('fail')) {
        return Promise.reject(
          new HttpError('GEOCODER_UNAVAILABLE', 'Geocoding service is unavailable'),
        );
      }
      if (lower.includes('nowhere')) return Promise.resolve([]);
      if (lower.includes('praha')) {
        return Promise.resolve([{ lat: 50.0755, lng: 14.4378, label: 'Praha' }]);
      }
      return Promise.resolve(STUB_BRNO_SUGGESTIONS.map((s) => ({ ...s })));
    },
  };
}

export function createStubGeocoder(): Geocoder {
  return {
    geocode(q) {
      const lower = q.toLowerCase();
      if (lower.includes('nowhere')) {
        return Promise.reject(new HttpError('LOCATION_NOT_FOUND', `No location found for "${q}"`));
      }
      if (lower.includes('praha')) {
        return Promise.resolve({ lat: 50.0755, lng: 14.4378, label: 'Praha, Česko' });
      }
      return Promise.resolve({ lat: 49.1951, lng: 16.6068, label: 'Brno, Česko' });
    },
  };
}
