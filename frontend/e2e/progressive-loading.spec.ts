import { expect, test } from '@playwright/test';
import type { Page, Request, Response } from '@playwright/test';
import { getSearchWindow } from '@spotradar/shared';
import { addDays, tomorrow } from './helpers.ts';

/** Monday of the week containing `date` ("YYYY-MM-DD"). */
function mondayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

function calendarParams(url: string): { from: string | null; to: string | null } | null {
  const parsed = new URL(url);
  if (parsed.pathname !== '/api/calendar') return null;
  return { from: parsed.searchParams.get('from'), to: parsed.searchParams.get('to') };
}

function isMultiDay(url: string): boolean {
  const params = calendarParams(url);
  return params !== null && params.from !== params.to;
}

/** The range the app prefetches after showing the week of `date` (clamped to the window). */
function nextWeekRange(date: string): { from: string; to: string } {
  const windowEnd = getSearchWindow(new Date()).to;
  const from = addDays(mondayOf(date), 7);
  const end = addDays(from, 6);
  return { from, to: end < windowEnd ? end : windowEnd };
}

function matchesRange(url: string, range: { from: string; to: string }): boolean {
  const params = calendarParams(url);
  return params?.from === range.from && params.to === range.to;
}

/** Holds back the /api/calendar requests matching `filter` until `release()` is called. */
async function gateRequests(page: Page, filter: (url: string) => boolean): Promise<() => void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/calendar**', async (route) => {
    if (filter(route.request().url())) await gate;
    await route.continue();
  });
  return release;
}

const gateMultiDayRequests = (page: Page): Promise<() => void> => gateRequests(page, isMultiDay);

test.describe('progressive loading', () => {
  test('shows the focused day first, skeleton for the rest, then the full week', async ({
    page,
  }) => {
    const release = await gateMultiDayRequests(page);
    await page.goto(`/?view=week&date=${tomorrow()}`);

    const calendar = page.locator('#calendar');
    const status = page.locator('#calendar-status');
    await expect(status).toHaveText('Loading the rest of the week…');
    await expect(calendar).toHaveAttribute('aria-busy', 'true');

    // the other days are non-interactive, aria-hidden placeholders
    const placeholder = calendar.locator('[data-skeleton]').first();
    await expect(placeholder).toBeVisible();
    await expect(
      page.locator('#calendar [aria-hidden="true"] > [data-skeleton]').first(),
    ).toBeVisible();
    await expect(calendar.locator('[data-skeleton] button')).toHaveCount(0);

    // the focused day already has real, clickable cells
    const free = calendar.locator(`button.cell-free[data-date="${tomorrow()}"]`).first();
    await expect(free).toBeVisible();
    await free.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    release();
    await expect(status).toBeEmpty();
    await expect(calendar.locator('[data-skeleton]')).toHaveCount(0);
    await expect(calendar).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('grid', { name: /Week calendar/ })).toBeVisible();
  });

  test('the initial loading state is a skeleton grid announced by the live region', async ({
    page,
  }) => {
    const release = await gateRequests(page, () => true);
    await page.goto(`/?view=week&date=${tomorrow()}`);
    const calendar = page.locator('#calendar');
    await expect(calendar).toHaveAttribute('aria-busy', 'true');
    await expect(calendar.locator('.skeleton-grid')).toBeVisible();
    await expect(calendar.locator('.skeleton-grid')).toHaveAttribute('aria-hidden', 'true');
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading availability…' }),
    ).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);
    release();
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(calendar.locator('.skeleton-grid')).toHaveCount(0);
    await expect(page.locator('#calendar-status')).toBeEmpty();
  });

  test('a failing day request is ignored when the range succeeds', async ({ page }) => {
    await page.route('**/api/calendar**', async (route) => {
      if (isMultiDay(route.request().url())) return route.continue();
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Day unavailable', code: 'INTERNAL_ERROR' }),
      });
    });
    await page.goto(`/?view=week&date=${tomorrow()}`);
    await expect(page.getByRole('grid', { name: /Week calendar/ })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
      page.locator(`#calendar button.cell-free[data-date="${tomorrow()}"]`).first(),
    ).toBeVisible();
  });

  test('a failing range keeps the loaded day visible with an error and "Try again"', async ({
    page,
  }) => {
    let fail = true;
    await page.route('**/api/calendar**', async (route) => {
      if (fail && isMultiDay(route.request().url())) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Availability is temporarily unavailable',
            code: 'INTERNAL_ERROR',
          }),
        });
      }
      return route.continue();
    });
    await page.goto(`/?view=week&date=${tomorrow()}`);

    const calendar = page.locator('#calendar');
    await expect(calendar.getByRole('alert')).toContainText(
      'Availability is temporarily unavailable',
    );
    await expect(page.locator('#calendar-status')).toBeEmpty();
    await expect(calendar).toHaveAttribute('aria-busy', 'false');
    // the focused day stays usable
    const free = calendar.locator(`button.cell-free[data-date="${tomorrow()}"]`).first();
    await expect(free).toBeVisible();

    // "Try again" keeps the visible day on screen while the range reloads
    fail = false;
    const release = await gateRequests(page, (url) => isMultiDay(url));
    await calendar.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#calendar-status')).toHaveText('Loading the rest of the week…');
    await expect(calendar.locator('.skeleton-grid')).toHaveCount(0);
    await expect(free).toBeVisible();
    release();
    await expect(page.locator('#calendar-status')).toBeEmpty();
    await expect(calendar.getByRole('alert')).toHaveCount(0);
    await expect(calendar.locator('[data-skeleton]')).toHaveCount(0);
    await expect(page.getByRole('grid', { name: /Week calendar/ })).toBeVisible();
  });

  test('month view shows skeleton days while the window loads', async ({ page }) => {
    const release = await gateMultiDayRequests(page);
    await page.goto(`/?view=month&date=${tomorrow()}`);
    const calendar = page.locator('#calendar');
    await expect(page.locator('#calendar-status')).toHaveText('Loading the rest of the month…');
    await expect(calendar.locator('.mday-skeleton').first()).toBeVisible();
    await expect(
      calendar.locator(`[data-action="open-day"][data-date="${tomorrow()}"]`),
    ).toBeVisible();
    release();
    await expect(page.locator('#calendar-status')).toBeEmpty();
    await expect(calendar.locator('.mday-skeleton')).toHaveCount(0);
  });
});

test.describe('prefetching the next week', () => {
  test('the next week is requested in the background and renders instantly', async ({ page }) => {
    const range = nextWeekRange(tomorrow());
    const requests: string[] = [];
    page.on('request', (request: Request) => {
      if (matchesRange(request.url(), range)) requests.push(request.url());
    });
    const prefetchRequest = page.waitForRequest((request) => matchesRange(request.url(), range));
    const prefetchResponse = page.waitForResponse(
      (response: Response) => matchesRange(response.url(), range) && response.ok(),
    );

    await page.goto(`/?view=week&date=${tomorrow()}`);
    await expect(page.getByRole('grid', { name: /Week calendar/ })).toBeVisible();
    await prefetchRequest;
    await prefetchResponse;

    // From now on the network is closed: the next week can only render if the app already
    // has it (stored, or its in-flight prefetch finishing). A new request would stay blocked.
    const release = await gateRequests(page, () => true);

    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page).toHaveURL(new RegExp(`date=${addDays(tomorrow(), 7)}`));
    await expect(page.getByRole('grid', { name: /Week calendar/ })).toBeVisible();
    await expect(page.locator('#calendar')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#calendar-status')).toBeEmpty();
    await expect(page.locator('#calendar [data-skeleton], #calendar .skeleton-grid')).toHaveCount(
      0,
    );
    // the range was requested exactly once (by the prefetch)
    expect(requests).toHaveLength(1);
    release();
  });

  test('month view does not prefetch', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', (request: Request) => {
      if (calendarParams(request.url())) calls.push(request.url());
    });
    await page.goto(`/?view=month&date=${tomorrow()}`);
    await expect(page.getByRole('grid', { name: /\d{4}$/ })).toBeVisible();
    await expect(page.locator('#calendar [data-skeleton]')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    // one focused day + the whole window, nothing else
    expect(calls).toHaveLength(2);
  });
});
