import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  renderDateChips,
  renderDistanceChips,
  renderResultCard,
  renderResults,
  renderSearchForm,
  safeHref,
  telHref,
} from './render.ts';
import { getDefaultFormValues } from './query.ts';
import { QUERY, makeResponse, makeResult } from './test-fixtures.test.ts';

const NOW = new Date('2026-11-25T12:00:00Z');

test('escapeHtml / safeHref / telHref', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(safeHref('https://a.cz/x'), 'https://a.cz/x');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(telHref('+420 123 456 789'), 'tel:+420123456789');
});

test('live card with slots, booking link attributes and badge', () => {
  const html = renderResultCard(makeResult(), QUERY, NOW);
  assert.match(html, /Sportcentrum Kuklenská/);
  assert.match(html, /Brno-Židenice/);
  assert.match(html, /Live · checked 3 min ago/);
  assert.match(html, /08:00–10:00/);
  assert.match(html, /3 courts/);
  assert.match(html, /Up to 3 courts free/);
  assert.match(
    html,
    /<a class="btn btn-primary" href="https:\/\/example\.com\/book" target="_blank" rel="noopener noreferrer">Book on venue's website/,
  );
  assert.match(html, /Open 07:00–22:00/);
  assert.doesNotMatch(html, /approx/);
  assert.doesNotMatch(html, /away/);
  assert.doesNotMatch(html, /tel:/);
});

test('free courts at the chosen time are the headline', () => {
  const html = renderResultCard(
    makeResult({ freeCourtsAtTime: 3 }),
    { ...QUERY, time: '18:00' },
    NOW,
  );
  assert.match(html, /3 courts free at 18:00/);
  const one = renderResultCard(
    makeResult({ freeCourtsAtTime: 1 }),
    { ...QUERY, time: '18:00' },
    NOW,
  );
  assert.match(one, /1 court free at 18:00/);
});

test('fully booked at the chosen time', () => {
  const html = renderResultCard(
    makeResult({ freeCourtsAtTime: 0 }),
    { ...QUERY, time: '12:00' },
    NOW,
  );
  assert.match(html, /Fully booked at 12:00/);
});

test('live with no slots is fully booked this day', () => {
  const result = makeResult();
  result.availability.freeSlots = [];
  assert.match(renderResultCard(result, QUERY, NOW), /Fully booked this day/);
});

test('unknown availability', () => {
  const html = renderResultCard(
    makeResult({ availability: { status: 'unknown', freeSlots: [] } }),
    QUERY,
    NOW,
  );
  assert.match(html, /Availability unknown – check on website/);
  assert.doesNotMatch(html, /class="slots"/);
  assert.doesNotMatch(html, /headline/);
  assert.match(html, /Book on venue's website/);
});

test('unavailable connector', () => {
  const html = renderResultCard(
    makeResult({ availability: { status: 'unavailable', freeSlots: [] } }),
    QUERY,
    NOW,
  );
  assert.match(html, /Couldn't read availability right now – check on website/);
  assert.match(html, /data-status="unavailable"/);
});

test('distance, phone link, approximate hours and closed day', () => {
  const base = makeResult({ distanceKm: 1.2 });
  base.venue.phone = '+420 123 456 789';
  base.venue.openingHours.approximate = true;
  const html = renderResultCard(base, QUERY, NOW);
  assert.match(html, /1\.2 km away/);
  assert.match(html, /href="tel:\+420123456789"/);
  assert.match(html, /Open 07:00–22:00 \(approx\.\)/);
  // 2026-11-28 is a Saturday – closed in the fixture
  assert.match(renderResultCard(base, { date: '2026-11-28' }, NOW), /Closed \(approx\.\)/);
});

test('venue text is escaped and unsafe booking urls are not linked', () => {
  const result = makeResult();
  result.venue.name = '<script>x</script>';
  result.venue.bookingUrl = 'javascript:alert(1)';
  const html = renderResultCard(result, QUERY, NOW);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /Book on venue/);
});

test('states: idle, loading, empty, error, success', () => {
  assert.match(renderResults({ status: 'idle' }, NOW), /Search courts/);
  const loading = renderResults({ status: 'loading' }, NOW);
  assert.match(loading, /skeleton/);
  assert.match(loading, /Loading results/);
  const empty = renderResults({ status: 'success', response: makeResponse([]) }, NOW);
  assert.match(empty, /No courts found/);
  assert.match(empty, /larger distance/);
  const error = renderResults(
    { status: 'error', message: 'Boom', issues: [{ field: 'time', message: 'bad' }] },
    NOW,
  );
  assert.match(error, /role="alert"/);
  assert.match(error, /Boom/);
  assert.match(error, /time: bad/);
  const ok = renderResults(
    {
      status: 'success',
      response: makeResponse([makeResult(), makeResult()], { ...QUERY, time: '18:00' }),
    },
    NOW,
  );
  assert.match(ok, /2 venues · Wed 25 Nov 2026 at 18:00/);
  assert.equal(ok.match(/<li class="card"/g)?.length, 2);
});

test('search form: labels, chips, date window, badminton preselected', () => {
  const html = renderSearchForm({
    values: getDefaultFormValues(NOW),
    location: { status: 'idle' },
    now: NOW,
  });
  assert.match(html, /<label for="sport">Sport<\/label>/);
  assert.match(html, /<option value="badminton" selected>Badminton/);
  assert.match(html, /<label for="time">Time \(optional\)<\/label>/);
  assert.match(html, /<label for="address">/);
  assert.match(html, /min="2026-11-25" max="2026-12-09"/);
  assert.match(html, /data-date="2026-11-25" aria-pressed="true">Today/);
  assert.match(html, />Tomorrow</);
  assert.match(html, /Use my location/);
  assert.match(html, /data-km="5" aria-pressed="false" disabled/);
});

test('distance chips are enabled with an origin and reflect the selection', () => {
  const html = renderDistanceChips('5', true);
  assert.doesNotMatch(html, /disabled/);
  assert.match(html, /data-km="5" aria-pressed="true"/);
  assert.match(html, /data-km="" aria-pressed="false"/);
  assert.match(renderDistanceChips('', true), /data-km="" aria-pressed="true"/);
});

test('date chips mark only the selected date', () => {
  const html = renderDateChips('2026-11-26', NOW);
  assert.equal(html.match(/aria-pressed="true"/g)?.length, 1);
  assert.match(html, /data-date="2026-11-26" aria-pressed="true">Tomorrow/);
});

test('location status renders errors with the error style', () => {
  const html = renderSearchForm({
    values: getDefaultFormValues(NOW),
    location: { status: 'error', message: 'Location access was denied.' },
    now: NOW,
  });
  assert.match(html, /location-status is-error" role="status">Location access was denied\./);
});
