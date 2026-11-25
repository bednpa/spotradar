import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlainLeftClick, isRoute, routeFromPath, routeUrl } from './router.ts';

test('routeFromPath maps the two pages and falls back to the calendar', () => {
  assert.equal(routeFromPath('/'), 'calendar');
  assert.equal(routeFromPath('/venues'), 'venues');
  assert.equal(routeFromPath('/venues/'), 'venues');
  assert.equal(routeFromPath('/unknown'), 'calendar');
  assert.equal(routeFromPath('/venues/extra'), 'calendar');
  assert.equal(routeFromPath(''), 'calendar');
});

test('routeUrl builds path and optional query', () => {
  assert.equal(routeUrl('calendar'), '/');
  assert.equal(routeUrl('venues'), '/venues');
  assert.equal(routeUrl('calendar', 'view=day&date=2026-11-25'), '/?view=day&date=2026-11-25');
  assert.equal(routeUrl('venues', '?q=lisen'), '/venues?q=lisen');
  assert.equal(routeUrl('venues', ''), '/venues');
});

test('isPlainLeftClick ignores modified and non-primary clicks', () => {
  const plain = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  assert.equal(isPlainLeftClick(plain), true);
  assert.equal(isPlainLeftClick({ ...plain, ctrlKey: true }), false);
  assert.equal(isPlainLeftClick({ ...plain, metaKey: true }), false);
  assert.equal(isPlainLeftClick({ ...plain, shiftKey: true }), false);
  assert.equal(isPlainLeftClick({ ...plain, altKey: true }), false);
  assert.equal(isPlainLeftClick({ ...plain, button: 1 }), false);
  assert.equal(isPlainLeftClick({ ...plain, defaultPrevented: true }), false);
});

test('isRoute narrows known routes', () => {
  assert.equal(isRoute('calendar'), true);
  assert.equal(isRoute('venues'), true);
  assert.equal(isRoute('x'), false);
  assert.equal(isRoute(undefined), false);
});
