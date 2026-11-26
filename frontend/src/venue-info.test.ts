import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_MAPS_LINK_TEXT,
  googleMapsLink,
  openingHoursByDay,
  pricesByDay,
  renderMultisportBadge,
  renderPriceSummary,
} from './venue-info.ts';
import { hours } from './test-fixtures.test.ts';
import { externalLink } from './html.ts';

test('openingHoursByDay lists all 7 days, never merged into ranges', () => {
  const mixed = hours('07:00', '22:00');
  mixed.days.sat = { open: '09:00', close: '20:00' };
  mixed.days.sun = null;
  assert.deepEqual(openingHoursByDay(mixed), [
    { day: 'Mon', text: '07:00–22:00' },
    { day: 'Tue', text: '07:00–22:00' },
    { day: 'Wed', text: '07:00–22:00' },
    { day: 'Thu', text: '07:00–22:00' },
    { day: 'Fri', text: '07:00–22:00' },
    { day: 'Sat', text: '09:00–20:00' },
    { day: 'Sun', text: 'Closed' },
  ]);
});

test('pricesByDay uses the same 7-day format, time ranges sorted, "–" for days without a price', () => {
  const rows = pricesByDay({
    currency: 'CZK',
    unit: 'hour',
    rules: [
      { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '15:00', to: '22:00', price: 380 },
      { days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '07:00', to: '15:00', price: 280 },
      { days: ['sat'], from: '08:00', to: '22:00', price: 400 },
    ],
  });
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[0], { day: 'Mon', text: '07:00–15:00 280 Kč · 15:00–22:00 380 Kč' });
  assert.deepEqual(rows[5], { day: 'Sat', text: '08:00–22:00 400 Kč' });
  assert.deepEqual(rows[6], { day: 'Sun', text: '–' });
});

test('multisport badge uses the shared label, limits in the tooltip and visible text', () => {
  assert.match(renderMultisportBadge(undefined), /badge-neutral[^>]*>MultiSport: not available</);
  assert.match(renderMultisportBadge({ category: 'unknown' }), />MultiSport: not available</);
  const none = renderMultisportBadge({ category: 'not-accepted' });
  assert.match(none, />No MultiSport</);
  assert.doesNotMatch(none, /multisport-limits/);
  const half = renderMultisportBadge({ category: 'half-per-card' });
  assert.match(half, /badge-multisport[^>]*>1 card = 50 % off</);
  assert.doesNotMatch(half, /multisport-limits|title=/);
  const html = renderMultisportBadge({
    category: 'minutes-per-card',
    minutesPerCard: 30,
    limits: { maxPlayersPerCourt: 4, onlyBookingMinutes: 60 },
    note: 'a & b',
  });
  assert.match(html, /title="max 4 players per court · 60-min bookings only · a &amp; b"/);
  assert.match(html, />1 card = 30 min<\/span>/);
  assert.match(
    html,
    /data-testid="multisport-limits">max 4 players per court · 60-min bookings only · a &amp; b</,
  );
});

test('price summary: short form, expandable table, note and unknown', () => {
  const html = renderPriceSummary({
    currency: 'CZK',
    unit: 'hour',
    rules: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '07:00', to: '15:00', price: 280 }],
    note: 'x <y>',
  });
  assert.match(html, /<details[^>]*><summary[^>]*>from 280 Kč \/ h<\/summary>/);
  assert.match(html, /<li><span class="hours-days">Mon<\/span> 07:00–15:00 280 Kč<\/li>/);
  assert.match(html, /<li><span class="hours-days">Sun<\/span> –<\/li>/);
  assert.match(html, /x &lt;y&gt;/);
  const pricing = {
    currency: 'CZK' as const,
    unit: 'hour' as const,
    rules: [{ days: ['mon' as const], from: '07:00', to: '15:00', price: 280 }],
  };
  assert.match(
    renderPriceSummary(pricing, { category: 'half-per-card' }, 1),
    />from 280 Kč → 140 Kč \/ h</,
  );
  assert.match(renderPriceSummary(pricing, { category: 'not-accepted' }, 2), />from 280 Kč \/ h</);
  assert.match(renderPriceSummary(undefined), />Price on website</);
  assert.doesNotMatch(renderPriceSummary(undefined), /<details/);
});

test('Google Maps link is labelled as rating & reviews (no fake rating number)', () => {
  const html = googleMapsLink({ name: 'Hala Sprint', address: 'Brno, Czech' });
  assert.match(
    html,
    /^<a class="link" href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=Hala%20Sprint/,
  );
  assert.ok(html.includes(GOOGLE_MAPS_LINK_TEXT.replace('&', '&amp;')));
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
});

test('externalLink only accepts safe values', () => {
  assert.equal(externalLink(undefined, 'x'), '');
  assert.equal(externalLink('javascript:alert(1)', 'x'), '');
  assert.match(
    externalLink('https://a.cz/?a=1&b=2', 'Site'),
    /href="https:\/\/a\.cz\/\?a=1&amp;b=2"/,
  );
});
