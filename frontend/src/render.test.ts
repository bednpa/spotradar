import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  renderCalendar,
  renderDistanceChips,
  renderEmptyVenues,
  renderError,
  renderFilters,
  renderLegend,
  renderMainNav,
  renderSkeleton,
  renderSportChips,
  renderToolbar,
  safeHref,
} from './render.ts';
import { getDefaultState } from './query.ts';
import type { AppState } from './query.ts';
import { NOW, hours, makeCalendar, makeVenue } from './test-fixtures.test.ts';

const data = makeCalendar('2026-11-25', '2026-12-09');
const success = { status: 'success', data } as const;

function state(overrides: Partial<AppState> = {}): AppState {
  return { ...getDefaultState(NOW, true), ...overrides };
}

test('escapeHtml and safeHref', () => {
  assert.equal(
    escapeHtml(`<a href="x">'&'</a>`),
    '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
  );
  assert.equal(safeHref('https://example.com'), 'https://example.com');
  assert.equal(safeHref('javascript:alert(1)'), null);
});

test('main nav has Reserve and Venues links; the active one has aria-current', () => {
  const calendar = renderMainNav('calendar');
  assert.match(calendar, /href="\/" data-route="calendar" aria-current="page">Reserve</);
  assert.match(calendar, /href="\/venues" data-route="venues">Venues</);
  assert.doesNotMatch(calendar, /data-route="venues" aria-current/);
  assert.match(renderMainNav('venues'), /data-route="venues" aria-current="page">Venues</);
});

test('sport chips mark the selected sport', () => {
  assert.match(
    renderSportChips('badminton'),
    /data-sport="badminton" aria-pressed="true">Badminton</,
  );
});

test('toolbar has view switcher, today, prev/next and the period title', () => {
  const html = renderToolbar(state({ view: 'week' }));
  for (const label of ['Day', 'Week', 'Month', 'Year'])
    assert.match(html, new RegExp(`>${label}</button>`));
  assert.match(html, /data-view="week"[^>]*aria-pressed="true"/);
  assert.match(html, /data-view="day"[^>]*aria-pressed="false"/);
  assert.match(html, /aria-label="Previous week"/);
  assert.match(html, /aria-label="Next week"/);
  assert.match(html, />Today</);
  assert.match(html, /23–29 November 2026/);
  assert.match(renderToolbar(state({ view: 'month' })), /aria-label="Next month"/);
});

test('week view: 7 columns, hour rows trimmed to the slots (07–22), aria labels, disabled past cells', () => {
  const html = renderCalendar(state({ view: 'week' }), success, NOW);
  assert.equal((html.match(/role="columnheader"/g) ?? []).length, 8);
  assert.equal((html.match(/role="rowheader"/g) ?? []).length, 15);
  assert.doesNotMatch(html, />06:00</);
  assert.match(html, />21:00</);
  assert.doesNotMatch(html, />22:00</);
  assert.match(html, />Thursday 26 November, 08:00–09:00: 1 venue free<\/span><\/button>/);
  // Monday is in the past: disabled.
  assert.match(html, / disabled>[^]*?Monday 23 November, 08:00–09:00: in the past<\/span>/);
  assert.match(html, /aria-current="date"/);
  assert.match(html, /class="cell-n" aria-hidden="true">1</);
});

test('no amber "check" cells any more: hours with only unread venues are plain', () => {
  const html = renderCalendar(state({ view: 'week' }), success, NOW);
  assert.doesNotMatch(html, /cell-check|cell-tag|to check on website/);
  const day = renderCalendar(state({ view: 'day', date: '2026-11-26' }), success, NOW);
  assert.doesNotMatch(day, /cell-check|to check on website/);
  assert.match(day, /12:00–13:00: nothing free/);
});

test('day view shows venues and courts', () => {
  const html = renderCalendar(state({ view: 'day', date: '2026-11-26' }), success, NOW);
  assert.match(html, /1 venue · 3 courts free/);
  assert.match(html, /Nothing free/);
  assert.equal((html.match(/role="rowheader"/g) ?? []).length, 15);
});

test('day view starts at the first hour with a slot (14:00)', () => {
  const late = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('viktoria', 'Afternoon Hall', { openingHours: hours('14:00', '17:00') }) },
  ]);
  const html = renderCalendar(
    state({ view: 'day', date: '2026-11-26' }),
    { status: 'success', data: late },
    NOW,
  );
  const labels = [...html.matchAll(/role="rowheader" class="rh">(\d\d:00)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ['14:00', '15:00', '16:00']);
});

test('day and week show the empty state instead of an empty grid when nothing is open or free', () => {
  const closed = makeCalendar('2026-11-25', '2026-11-27', [
    { venue: makeVenue('closed', 'Closed Hall', { openingHours: hours(null) }) },
  ]);
  const calendar = { status: 'success', data: closed } as const;
  const day = renderCalendar(state({ view: 'day', date: '2026-11-26' }), calendar, NOW);
  assert.match(day, /data-testid="no-slots"/);
  assert.match(day, /No slots this day/);
  assert.doesNotMatch(day, /role="grid"/);
  const week = renderCalendar(state({ view: 'week' }), calendar, NOW);
  assert.match(week, /No slots this week/);
  assert.doesNotMatch(week, /role="grid"/);
});

test('week view outside the window shows "not available yet" cells', () => {
  const html = renderCalendar(state({ view: 'week', date: '2026-12-09' }), success, NOW);
  assert.match(html, /Thursday 10 December, 08:00–09:00: not available yet<\/span><\/button>/);
  assert.doesNotMatch(html, /aria-label="Thursday 10 December/);
});

test('month view summarises days inside the window and disables the rest', () => {
  const html = renderCalendar(state({ view: 'month', date: '2026-11-25' }), success, NOW);
  assert.match(html, /data-action="open-day" data-date="2026-11-26"/);
  assert.match(html, /Thursday 26 November: 3 free hours, best at 08:00/);
  assert.match(html, /Tuesday 24 November: in the past/);
  assert.match(html, /Tuesday 1 December: 3 free hours/);
  assert.doesNotMatch(html, /mday-check/);
});

test('year view has 12 months and links to month view', () => {
  const html = renderCalendar(state({ view: 'year' }), success, NOW);
  assert.equal((html.match(/data-action="open-month"/g) ?? []).length, 12);
  assert.match(html, /aria-label="November 2026, has availability"/);
  assert.match(html, /aria-label="March 2026"/);
  assert.match(html, /data-action="open-month" data-date="2026-11-25"/);
  assert.match(html, /data-action="open-month" data-date="2026-12-01"/);
  assert.match(html, /class="d d-window"/);
});

test('month and year views explain the searchable window; year grid is a labelled group', () => {
  const month = renderCalendar(state({ view: 'month' }), success, NOW);
  assert.match(month, /Availability is only known for today and the next 14 days/);
  const year = renderCalendar(state({ view: 'year' }), success, NOW);
  assert.match(year, /Availability is only known for today and the next 14 days/);
  assert.match(year, /role="group" aria-label="2026"/);
  assert.doesNotMatch(renderCalendar(state({ view: 'week' }), success, NOW), /only known for/);
  assert.match(renderCalendar(state(), { status: 'outside' }, NOW), /today and the next 14 days/);
});

test('loading, error, empty and outside states', () => {
  assert.match(renderCalendar(state(), { status: 'loading' }, NOW), /class="skeleton/);
  assert.match(renderSkeleton(), /aria-busy="true"/);
  const err = renderCalendar(state(), { status: 'error', message: 'Boom <b>', issues: [] }, NOW);
  assert.match(err, /role="alert"/);
  assert.match(err, /Boom &lt;b&gt;/);
  assert.match(err, /data-action="retry">Try again</);
  assert.match(renderError('x'), /Try again/);

  const empty = renderCalendar(
    state({ maxDistanceKm: 5 }),
    { status: 'success', data: { ...data, venues: [], days: [] } },
    NOW,
  );
  assert.match(empty, /No badminton venues within 5 km/);
  assert.match(empty, /data-action="clear-distance"/);
  assert.match(renderEmptyVenues(null, 'badminton'), /No badminton venues found/);

  const outside = renderCalendar(state(), { status: 'outside' }, NOW);
  assert.match(outside, /Not available yet/);
  assert.match(outside, /data-action="today"/);
});

test('filters: sport, address combobox with an in-field location button, max distance', () => {
  const html = renderFilters(state(), { status: 'idle' });
  assert.match(html, /id="sport-label" class="label">Sport</);
  assert.match(html, /data-sport="badminton" aria-pressed="true"/);
  assert.match(html, /<label for="address">Address<\/label>/);
  assert.match(html, /id="address" type="text" role="combobox" aria-expanded="false"/);
  assert.match(html, /aria-controls="address-listbox"/);
  assert.match(html, /id="address-listbox" class="listbox" role="listbox"[^>]* hidden/);
  assert.match(html, /id="use-location"[^>]*aria-label="Use my location"/);
  assert.match(html, /data-km="5" aria-pressed="false" disabled/);
  assert.match(html, /id="clear-location"[^>]* hidden/);
});

test('removed controls are gone: time filter, free toggle, next free court, date input', () => {
  const html = renderFilters(state(), { status: 'idle' });
  assert.doesNotMatch(html, /from-hour|to-hour|only-free|Only show free|Next free|goto-date/);
  assert.doesNotMatch(html, /Find address/);
});

test('with an origin: status text, enabled distance chips and a visible clear button', () => {
  const origin = { lat: 1, lng: 2, label: 'Brno', source: 'address' } as const;
  const located = renderFilters(state({ origin, maxDistanceKm: 5 }), { status: 'set', origin });
  assert.match(located, /Searching near: Brno/);
  assert.match(located, /data-km="5" aria-pressed="true"/);
  assert.doesNotMatch(located, /data-km="5" aria-pressed="true" disabled/);
  assert.doesNotMatch(located, /id="clear-location"[^>]* hidden/);
});

test('distance chips', () => {
  const html = renderDistanceChips(null, true);
  assert.match(html, /data-km="" aria-pressed="true"/);
  assert.equal((html.match(/data-km=/g) ?? []).length, 5);
});

test('legend lists venues with their data quality', () => {
  const html = renderLegend(data);
  assert.match(html, /data-venue-id="kuklenska" data-coverage="live"/);
  assert.match(html, /data-venue-id="viktoria" data-coverage="unavailable"/);
  assert.match(html, /data-venue-id="unknown" data-coverage="unknown"/);
  assert.match(html, /badge-live">Live data</);
  assert.match(html, /No live data yet/);
  assert.match(html, /1\.5 km/);
  assert.doesNotMatch(html, /swatch-check/);
  assert.equal(renderLegend({ ...data, venues: [] }), '');
});
