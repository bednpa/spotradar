import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSearchWindow } from '@spotradar/shared';
import {
  buildDateStrip,
  renderDateStrip,
  stripKeyTarget,
  viewAfterDateSelect,
} from './date-strip.ts';
import { NOW } from './test-fixtures.test.ts';

const window = getSearchWindow(NOW);

test('one pill per searchable day, today first, with accessible names', () => {
  const items = buildDateStrip(window, '2026-11-27');
  assert.equal(items.length, 15);
  assert.equal(items[0]?.date, '2026-11-25');
  assert.equal(items[14]?.date, '2026-12-09');
  assert.deepEqual(items[0], {
    date: '2026-11-25',
    weekday: 'Wed',
    day: 25,
    isToday: true,
    selected: false,
    ariaLabel: 'Today, Wednesday 25 November',
  });
  assert.equal(items[1]?.ariaLabel, 'Thursday 26 November');
  assert.deepEqual(
    items.filter((i) => i.selected).map((i) => i.date),
    ['2026-11-27'],
  );
});

test('no pill is selected when the date is outside the window', () => {
  assert.equal(buildDateStrip(window, '2026-12-20').filter((i) => i.selected).length, 0);
});

test('rendered strip: group, buttons with aria-pressed, Today label', () => {
  const html = renderDateStrip(window, '2026-11-26');
  assert.match(html, /role="group" aria-label="Select a day"/);
  assert.equal((html.match(/data-action="pick-date"/g) ?? []).length, 15);
  assert.match(
    html,
    /aria-pressed="true"><span class="day-pill-wd" aria-hidden="true">Thu<\/span><span class="day-pill-num" aria-hidden="true">26<\/span><span class="visually-hidden">Thursday 26 November</,
  );
  assert.match(
    html,
    /aria-pressed="false"><span class="day-pill-wd" aria-hidden="true">Today<\/span>[^]*?visually-hidden">Today, Wednesday 25 November</,
  );
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
});

test('selecting a day in month/year view switches to the default day/week view', () => {
  assert.equal(viewAfterDateSelect('month', true), 'week');
  assert.equal(viewAfterDateSelect('year', false), 'day');
  assert.equal(viewAfterDateSelect('day', true), 'day');
  assert.equal(viewAfterDateSelect('week', false), 'week');
});

test('strip keyboard navigation clamps at the ends', () => {
  assert.equal(stripKeyTarget('ArrowRight', 0, 15), 1);
  assert.equal(stripKeyTarget('ArrowRight', 14, 15), 14);
  assert.equal(stripKeyTarget('ArrowLeft', 0, 15), 0);
  assert.equal(stripKeyTarget('ArrowLeft', 5, 15), 4);
  assert.equal(stripKeyTarget('Home', 7, 15), 0);
  assert.equal(stripKeyTarget('End', 7, 15), 14);
  assert.equal(stripKeyTarget('Enter', 7, 15), null);
  assert.equal(stripKeyTarget('ArrowRight', 0, 0), null);
});
