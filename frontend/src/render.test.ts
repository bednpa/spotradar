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
  renderSkeleton,
  renderSportNav,
  renderToolbar,
  safeHref,
} from './render.ts';
import { getDefaultState } from './query.ts';
import type { AppState } from './query.ts';
import { NOW, makeCalendar } from './test-fixtures.test.ts';

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

test('sport nav marks the selected sport with aria-current', () => {
  const html = renderSportNav('badminton');
  assert.match(html, /data-sport="badminton" aria-current="page">Badminton</);
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

test('week view: 7 columns, hour rows, aria labels, disabled past cells', () => {
  const html = renderCalendar(state({ view: 'week', fromHour: 6, toHour: 23 }), success, NOW);
  assert.equal((html.match(/role="columnheader"/g) ?? []).length, 8);
  assert.equal((html.match(/role="rowheader"/g) ?? []).length, 17);
  assert.match(html, /aria-label="Thursday 26 November, 08:00–09:00: 1 venue free"/);
  // Monday is in the past: disabled.
  assert.match(html, /aria-label="Monday 23 November, 08:00–09:00: in the past" disabled/);
  assert.match(html, /aria-current="date"/);
  assert.match(html, /class="cell-n">1</);
  assert.match(html, /class="cell-tag">check</);
});

test('time filter narrows the hour rows', () => {
  const html = renderCalendar(state({ view: 'week', fromHour: 8, toHour: 10 }), success, NOW);
  assert.equal((html.match(/role="rowheader"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /06:00–07:00/);
});

test('only free hides check cells', () => {
  const html = renderCalendar(
    state({ view: 'day', date: '2026-11-26', onlyFree: true }),
    success,
    NOW,
  );
  assert.doesNotMatch(html, /to check on website/);
  assert.match(html, /nothing free/);
});

test('day view shows venues and courts', () => {
  const html = renderCalendar(state({ view: 'day', date: '2026-11-26' }), success, NOW);
  assert.match(html, /1 venue · 3 courts free/);
  assert.match(html, /2 venues to check on website/);
  assert.match(html, /Nothing free/);
});

test('week view outside the window shows "not available yet" cells', () => {
  const html = renderCalendar(state({ view: 'week', date: '2026-12-09' }), success, NOW);
  assert.match(html, /Thursday 10 December, 08:00–09:00: not available yet" disabled/);
});

test('month view summarises days inside the window and disables the rest', () => {
  const html = renderCalendar(state({ view: 'month', date: '2026-11-25' }), success, NOW);
  assert.match(html, /data-action="open-day" data-date="2026-11-26"/);
  assert.match(html, /Thursday 26 November: 3 free hours, best at 08:00/);
  assert.match(html, /Tuesday 24 November: in the past/);
  assert.match(html, /Tuesday 1 December: 3 free hours/);
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

test('filters are labelled and the distance filter follows the location', () => {
  const withoutOrigin = renderFilters(state(), { status: 'idle' });
  for (const label of ['Go to date', 'From', 'To', 'Address', 'Only show free']) {
    assert.match(withoutOrigin, new RegExp(`>${label}|${label}</label>`));
  }
  assert.match(withoutOrigin, /for="goto-date"/);
  assert.match(withoutOrigin, /Use my location/);
  assert.match(withoutOrigin, /Next free court/);
  assert.match(withoutOrigin, /data-km="5" aria-pressed="false" disabled/);
  assert.match(withoutOrigin, /<option value="6" selected>06:00/);
  assert.match(withoutOrigin, /<option value="23" selected>23:00/);

  const origin = { lat: 1, lng: 2, label: 'Brno', source: 'address' } as const;
  const located = renderFilters(state({ origin, maxDistanceKm: 5, onlyFree: true }), {
    status: 'set',
    origin,
  });
  assert.match(located, /Searching near: Brno/);
  assert.match(located, /data-km="5" aria-pressed="true"/);
  assert.doesNotMatch(located, /data-km="5" aria-pressed="true" disabled/);
  assert.match(located, /id="only-free" type="checkbox" checked/);
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
  assert.match(html, /badge-live">Live</);
  assert.match(html, /Check on website/);
  assert.match(html, /1\.5 km/);
  assert.equal(renderLegend({ ...data, venues: [] }), '');
});
