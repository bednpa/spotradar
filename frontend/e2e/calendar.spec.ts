import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Today's date in Europe/Prague as "YYYY-MM-DD". */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/** "2026-11-25" → "Wednesday 25 November 2026" (the Day view title). */
function dayTitle(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}

const tomorrow = (): string => addDays(today(), 1);

async function openDay(page: Page, date = tomorrow()): Promise<void> {
  await page.goto(`/?view=day&date=${date}`);
  await expect(page.getByRole('grid')).toBeVisible();
}

function viewButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true });
}

test.describe('layout and navigation', () => {
  test('shows the sport menu, filters and the footer disclaimer', async ({ page }) => {
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Sport' });
    await expect(nav.getByRole('button', { name: 'Badminton' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByLabel('Go to date')).toHaveValue(today());
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('6');
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('23');
    await expect(page.getByRole('contentinfo')).toContainText('SpotRadar never books anything');
  });

  test('week is the default view on wide screens: 7 days by hour rows', async ({ page }) => {
    await page.goto('/');
    await expect(viewButton(page, 'Week')).toHaveAttribute('aria-pressed', 'true');
    const grid = page.getByRole('grid', { name: /Week calendar/ });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader')).toHaveCount(8); // corner + 7 days
    await expect(grid.getByRole('rowheader')).toHaveCount(17); // 06:00 … 22:00
    await expect(page.getByRole('heading', { level: 2, name: /\d{4}$/ })).toBeVisible();
  });

  test('switches between Day, Week, Month and Year', async ({ page }) => {
    await page.goto(`/?view=week&date=${tomorrow()}`);

    await viewButton(page, 'Day').click();
    await expect(viewButton(page, 'Day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#period-title')).toHaveText(dayTitle(tomorrow()));
    await expect(page.getByRole('grid', { name: /hours/ })).toBeVisible();
    await expect(page).toHaveURL(/view=day/);

    await viewButton(page, 'Month').click();
    await expect(page.getByRole('grid', { name: /\d{4}$/ })).toBeVisible();
    await expect(page.locator('[data-action="open-day"]').first()).toBeVisible();

    await viewButton(page, 'Year').click();
    await expect(page.locator('#period-title')).toHaveText(/^\d{4}$/);
    await expect(page.locator('[data-action="open-month"]')).toHaveCount(12);

    await viewButton(page, 'Week').click();
    await expect(page.getByRole('grid', { name: /Week calendar/ })).toBeVisible();
  });

  test('previous, next and Today move the calendar', async ({ page }) => {
    await openDay(page);
    await expect(page.locator('#period-title')).toHaveText(dayTitle(tomorrow()));

    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.locator('#period-title')).toHaveText(dayTitle(addDays(tomorrow(), 1)));
    await expect(page).toHaveURL(new RegExp(`date=${addDays(tomorrow(), 1)}`));

    await page.getByRole('button', { name: 'Previous day' }).click();
    await page.getByRole('button', { name: 'Previous day' }).click();
    await expect(page.locator('#period-title')).toHaveText(dayTitle(today()));

    await page.getByRole('button', { name: 'Next day' }).click();
    await page.getByRole('button', { name: 'Next day' }).click();
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.locator('#period-title')).toHaveText(dayTitle(today()));
  });

  test('a day outside the searchable window is shown as not available yet', async ({ page }) => {
    await openDayOutsideWindow(page);
    await expect(page.getByRole('heading', { name: 'Not available yet' })).toBeVisible();
    await page.getByRole('button', { name: 'Go to today' }).click();
    await expect(page.getByRole('grid')).toBeVisible();
  });

  test('month → day and year → month drill down', async ({ page }) => {
    await page.goto(`/?view=month&date=${tomorrow()}`);
    await page.locator(`[data-action="open-day"][data-date="${tomorrow()}"]`).click();
    await expect(viewButton(page, 'Day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#period-title')).toHaveText(dayTitle(tomorrow()));

    await viewButton(page, 'Year').click();
    await page.locator('[data-action="open-month"]').nth(5).click();
    await expect(viewButton(page, 'Month')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the date filter jumps the calendar', async ({ page }) => {
    await openDay(page);
    const target = addDays(today(), 3);
    await page.getByLabel('Go to date').fill(target);
    await expect(page.locator('#period-title')).toHaveText(dayTitle(target));
  });

  test('the time filter narrows the visible hours', async ({ page }) => {
    await openDay(page);
    await page.getByLabel('From', { exact: true }).selectOption('8');
    await page.getByLabel('To', { exact: true }).selectOption('10');
    await expect(page.getByRole('rowheader')).toHaveText(['08:00', '09:00']);
    await expect(page).toHaveURL(/timeFrom=08%3A00/);
    await expect(page).toHaveURL(/timeTo=10%3A00/);
  });
});

async function openDayOutsideWindow(page: Page): Promise<void> {
  await page.goto(`/?view=day&date=${addDays(today(), 30)}`);
}

test.describe('hour slot details', () => {
  test('a free hour lists Kuklenská as free with a booking link', async ({ page }) => {
    await openDay(page);
    const freeCell = page.locator('button.cell-free:not([disabled])').first();
    await expect(freeCell).toBeVisible();
    await expect(freeCell).toHaveAttribute('aria-label', /venues? free$/);
    await freeCell.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(/^\d\d:00–\d\d:00$/);

    const kuklenska = dialog.locator('li[data-venue-id="kuklenska"]');
    await expect(kuklenska).toHaveAttribute('data-state', 'free');
    await expect(kuklenska).toContainText('Sportcentrum Kuklenská');
    await expect(kuklenska).toContainText(/\d+ courts? free/);
    await expect(kuklenska).toContainText('Live · checked');
    const book = kuklenska.getByRole('link', { name: /Book on venue's website/ });
    await expect(book).toHaveAttribute('href', /^https:\/\//);
    await expect(book).toHaveAttribute('target', '_blank');
    await expect(book).toHaveAttribute('rel', 'noopener noreferrer');

    // Every venue is listed (7 in Brno), free first.
    await expect(dialog.locator('li[data-venue-id]')).toHaveCount(7);
    await expect(dialog.locator('li[data-venue-id]').first()).toHaveAttribute('data-state', 'free');
  });

  test('the panel closes with Escape and with the close button', async ({ page }) => {
    await openDay(page);
    const cell = page.locator('button.cell-free:not([disabled])').first();
    await cell.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(cell).toBeFocused();

    await cell.click();
    await page.getByRole('button', { name: 'Close details' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('an hour where nothing is free shows the empty state', async ({ page }) => {
    await openDay(page);
    const emptyCell = page.locator('button.cell-none:not([disabled])').first();
    await expect(emptyCell).toBeVisible();
    await emptyCell.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/No badminton venue is free at \d\d:00–\d\d:00/);
    await expect(dialog.locator('li[data-state="free"]')).toHaveCount(0);
  });

  test('week view cells open the same panel', async ({ page }) => {
    await page.goto(`/?view=week&date=${tomorrow()}`);
    const cell = page.locator(`button.cell-free[data-date="${tomorrow()}"]`).first();
    await expect(cell).toBeVisible();
    await cell.click();
    await expect(page.getByRole('dialog').locator('li[data-state="free"]')).not.toHaveCount(0);
  });
});

test.describe('next free court and legend', () => {
  test('"Next free court" opens the earliest free hour', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Next free court' }).click();
    await expect(page.locator('#next-free-status')).toContainText('Next free court:');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('li[data-venue-id="kuklenska"]')).toHaveAttribute(
      'data-state',
      'free',
    );
    await expect(viewButton(page, 'Day')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the legend shows which venues are live', async ({ page }) => {
    await page.goto('/');
    const legend = page.locator('#legend');
    await expect(legend.getByRole('heading', { name: 'Venues and data quality' })).toBeVisible();
    await expect(legend.locator('li[data-coverage="live"]')).toHaveCount(1);
    await expect(legend.locator('li[data-coverage="live"]')).toContainText(
      'Sportcentrum Kuklenská',
    );
    await expect(legend.locator('li[data-coverage="unavailable"]')).toHaveCount(1);
    await expect(legend.locator('li[data-coverage="unknown"]')).toHaveCount(5);
  });
});

test.describe('loading, error and empty states', () => {
  test('shows a loading skeleton while fetching', async ({ page }) => {
    await page.route('**/api/calendar**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.goto('/');
    await expect(page.locator('.skeleton').first()).toBeVisible();
    await expect(page.getByRole('grid')).toBeVisible();
  });

  test('shows an error with "Try again" that recovers', async ({ page }) => {
    let fail = true;
    await page.route('**/api/calendar**', (route) => {
      if (!fail) return route.continue();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal error', code: 'INTERNAL_ERROR' }),
      });
    });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('Internal error');
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('address far away + 10 km shows the empty state and can be cleared', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Address').fill('Praha');
    await page.getByRole('button', { name: 'Find address' }).click();
    await expect(page.locator('#location-status')).toContainText('Searching near: Praha');
    await page.getByRole('button', { name: '10 km', exact: true }).click();
    await expect(page.getByRole('button', { name: '10 km', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.state-empty')).toContainText('No badminton venues within 10 km');
    await expect(page).toHaveURL(/maxDistanceKm=10/);

    await page.getByRole('button', { name: 'Clear distance' }).click();
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Any', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a near address with a distance filter shows distances in the panel', async ({ page }) => {
    await openDay(page);
    await page.getByLabel('Address').fill('Brno centrum');
    await page.getByRole('button', { name: 'Find address' }).click();
    await page.getByRole('button', { name: '20 km', exact: true }).click();
    await page.locator('button.cell-free:not([disabled])').first().click();
    await expect(page.getByRole('dialog')).toContainText(/\d+\.\d km away/);
  });

  test('address not found', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '5 km', exact: true })).toBeDisabled();
    await page.getByLabel('Address').fill('nowhere');
    await page.getByRole('button', { name: 'Find address' }).click();
    await expect(page.locator('#location-status')).toContainText('Address not found');
    await expect(page.getByRole('button', { name: '5 km', exact: true })).toBeDisabled();
  });

  test('geocoder unavailable', async ({ page }) => {
    await page.route('**/api/geocode*', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'down', code: 'GEOCODER_UNAVAILABLE' }),
      }),
    );
    await page.goto('/');
    await page.getByLabel('Address').fill('Brno');
    await page.getByRole('button', { name: 'Find address' }).click();
    await expect(page.locator('#location-status')).toContainText('unavailable');
  });

  test('geolocation denied shows a message and keeps distance disabled', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback | null) => {
            fail?.({
              code: 1,
              message: 'denied',
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3,
            });
          },
        },
      });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.locator('#location-status')).toContainText('Location access was denied');
    await expect(page.getByRole('button', { name: '5 km', exact: true })).toBeDisabled();
  });
});

test.describe('geolocation granted', () => {
  test.use({
    geolocation: { latitude: 49.1951, longitude: 16.6068 },
    permissions: ['geolocation'],
  });

  test('uses the browser location as the origin', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Use my location' }).click();
    await expect(page.locator('#location-status')).toContainText('Searching near: Your location');
    await page.getByRole('button', { name: '20 km', exact: true }).click();
    await expect(page).toHaveURL(/lat=49\.1951/);
    await expect(page).toHaveURL(/maxDistanceKm=20/);
    await expect(page.getByRole('grid')).toBeVisible();
  });
});

test.describe('shareable URL state', () => {
  test('restores view, date, time range, location, distance and "only free"', async ({ page }) => {
    const date = tomorrow();
    await page.goto(
      `/?view=day&date=${date}&timeFrom=08%3A00&timeTo=20%3A00&lat=49.1951&lng=16.6068&maxDistanceKm=10&free=1`,
    );
    await expect(viewButton(page, 'Day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#period-title')).toHaveText(dayTitle(date));
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('8');
    await expect(page.getByLabel('To', { exact: true })).toHaveValue('20');
    await expect(page.getByLabel('Only show free')).toBeChecked();
    await expect(page.getByRole('button', { name: '10 km', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('rowheader')).toHaveCount(12);
    await expect(page.locator('button.cell-check')).toHaveCount(0);
  });

  test('a changed view survives a reload', async ({ page }) => {
    await page.goto('/');
    await viewButton(page, 'Month').click();
    await expect(page).toHaveURL(/view=month/);
    await page.reload();
    await expect(viewButton(page, 'Month')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('grid', { name: /\d{4}$/ })).toBeVisible();
  });

  test('"Only show free" hides check-on-website hours', async ({ page }) => {
    await openDay(page);
    await expect(page.locator('button.cell-check').first()).toBeVisible();
    await page.getByLabel('Only show free').check();
    await expect(page.locator('button.cell-check')).toHaveCount(0);
    await expect(page).toHaveURL(/free=1/);
  });
});

test.describe('small screens', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('defaults to the Day view without horizontal page overflow; the panel is a sheet', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(viewButton(page, 'Day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('grid')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Next day' }).click();
    await page.locator('button.cell-free:not([disabled])').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(355);
    expect(box?.y ?? 0).toBeGreaterThan(50);
  });
});
