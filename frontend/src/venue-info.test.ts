import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_MAPS_LINK_TEXT,
  googleMapsLink,
  groupOpeningHours,
  multisportText,
  renderMultisportBadge,
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

test('multisport text and badge', () => {
  assert.equal(multisportText(undefined), 'unknown');
  assert.equal(multisportText({ accepted: false }), 'not accepted');
  assert.equal(multisportText({ accepted: true }), 'accepted');
  assert.equal(
    multisportText({ accepted: true, terms: '1 card = 60 min' }),
    'accepted – 1 card = 60 min',
  );
  assert.equal(renderMultisportBadge(undefined), '');
  assert.match(
    renderMultisportBadge({ accepted: true, terms: 'a & b' }),
    /MultiSport accepted.*a &amp; b/,
  );
  assert.match(renderMultisportBadge({ accepted: false }), /MultiSport not accepted/);
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
