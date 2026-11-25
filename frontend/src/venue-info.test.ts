import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_MAPS_LINK_TEXT,
  googleMapsLink,
  groupOpeningHours,
  renderMultisportBadge,
  renderPriceSummary,
} from './venue-info.ts';
import { hours } from './test-fixtures.test.ts';
import { externalLink, telHref } from './html.ts';

test('groupOpeningHours merges identical consecutive days', () => {
  assert.deepEqual(groupOpeningHours(hours('07:00', '22:00')), [
    { days: 'Mon–Sun', text: '07:00–22:00' },
  ]);
  const mixed = hours('07:00', '22:00');
  mixed.days.sat = { open: '09:00', close: '20:00' };
  mixed.days.sun = null;
  assert.deepEqual(groupOpeningHours(mixed), [
    { days: 'Mon–Fri', text: '07:00–22:00' },
    { days: 'Sat', text: '09:00–20:00' },
    { days: 'Sun', text: 'Closed' },
  ]);
  const two = hours('07:00', '22:00');
  two.days.tue = null;
  two.days.wed = null;
  assert.deepEqual(
    groupOpeningHours(two).map((g) => g.days),
    ['Mon', 'Tue, Wed', 'Thu–Sun'],
  );
  assert.deepEqual(groupOpeningHours(hours(null)), [{ days: 'Mon–Sun', text: 'Closed' }]);
});

test('multisport badge uses the shared label and shows the note', () => {
  assert.match(renderMultisportBadge(undefined), /badge-neutral[^>]*>MultiSport: unknown</);
  assert.match(renderMultisportBadge({ accepted: false }), />No MultiSport</);
  assert.match(
    renderMultisportBadge({ accepted: true }),
    /badge-multisport[^>]*>MultiSport accepted</,
  );
  const html = renderMultisportBadge({
    accepted: true,
    coverage: { kind: 'minutesPerCard', minutes: 30 },
    note: 'a & b',
  });
  assert.match(html, /title="a &amp; b"/);
  assert.match(html, />MultiSport · 30 min \/ card<\/span>/);
  assert.match(html, /fact-terms">a &amp; b</);
});

test('price summary: short form, expandable table, note and unknown', () => {
  const html = renderPriceSummary({
    currency: 'CZK',
    unit: 'hour',
    rules: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '07:00', to: '15:00', price: 280 }],
    note: 'x <y>',
  });
  assert.match(html, /<details[^>]*><summary>from 280 Kč \/ h<\/summary>/);
  assert.match(html, /<li>Mon–Fri 07:00–15:00: 280 Kč \/ h<\/li>/);
  assert.match(html, /x &lt;y&gt;/);
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

test('externalLink and telHref only accept safe values', () => {
  assert.equal(externalLink(undefined, 'x'), '');
  assert.equal(externalLink('javascript:alert(1)', 'x'), '');
  assert.match(
    externalLink('https://a.cz/?a=1&b=2', 'Site'),
    /href="https:\/\/a\.cz\/\?a=1&amp;b=2"/,
  );
  assert.equal(telHref('+420 123 456 789'), 'tel:+420123456789');
  assert.equal(telHref('(0)5 1234-5678'), 'tel:0512345678');
  assert.equal(telHref('call me'), null);
});
