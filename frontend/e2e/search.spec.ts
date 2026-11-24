import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Tomorrow's date in Europe/Prague as "YYYY-MM-DD" (matches the app's "Tomorrow" chip). */
function tomorrow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [y, m, d] = parts.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10);
}

async function searchTomorrow(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await expect(page.getByLabel('Or pick another day')).toHaveValue(tomorrow());
  await page.getByRole('button', { name: 'Search courts' }).click();
}

test.describe('main search flow', () => {
  test('lists venues with live slots, unknown and unavailable badges', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Sport')).toHaveValue('badminton');
    await expect(page.getByRole('contentinfo')).toContainText('SpotRadar never books anything');

    await searchTomorrow(page);

    const cards = page.locator('li.card[data-venue-id]');
    await expect(cards).toHaveCount(7);

    const live = page.locator('li.card[data-status="live"]');
    await expect(live).toHaveCount(1);
    await expect(live).toContainText('Sportcentrum Kuklenská');
    await expect(live.locator('.badge-live')).toContainText('Live · checked');
    expect(await live.locator('.slot').count()).toBeGreaterThan(0);

    const book = live.getByRole('link', { name: /Book on venue's website/ });
    await expect(book).toHaveAttribute('target', '_blank');
    await expect(book).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(book).toHaveAttribute('href', /^https?:\/\//);

    await expect(page.locator('li.card[data-status="unavailable"]')).toHaveCount(1);
    await expect(page.locator('li.card[data-status="unavailable"]')).toContainText(
      "Couldn't read availability right now – check on website",
    );
    await expect(page.locator('li.card[data-status="unknown"]')).toHaveCount(5);
    await expect(page.locator('li.card[data-status="unknown"]').first()).toContainText(
      'Availability unknown – check on website',
    );

    // State is mirrored in the URL.
    await expect(page).toHaveURL(new RegExp(`date=${tomorrow()}`));
  });

  test('time shows free courts at that time for the live venue', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Time (optional)').fill('10:00');
    await searchTomorrow(page);
    const live = page.locator('li.card[data-status="live"]');
    await expect(live.locator('.headline')).toContainText(
      /(courts? free at 10:00|Fully booked at 10:00)/,
    );
  });

  test('shows a loading skeleton while searching', async ({ page }) => {
    await page.route('**/api/search*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Search courts' }).click();
    await expect(page.locator('.skeleton').first()).toBeVisible();
    await expect(page.locator('li.card[data-venue-id]').first()).toBeVisible();
  });

  test('shows an error state when the API fails', async ({ page }) => {
    await page.route('**/api/search*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal error', code: 'INTERNAL_ERROR' }),
      }),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Search courts' }).click();
    await expect(page.getByRole('alert')).toContainText('Internal error');
  });
});

test.describe('origin and distance', () => {
  test('address origin with a distance filter shows distances', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '5 km' })).toBeDisabled();
    await page.getByLabel('Or enter an address').fill('Brno centrum');
    await page.getByRole('button', { name: 'Find address' }).click();
    await expect(page.getByRole('status')).toContainText('Searching near: Brno, Česko');
    await page.getByRole('button', { name: '20 km' }).click();
    await expect(page.getByRole('button', { name: '20 km' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await searchTomorrow(page);
    const first = page.locator('li.card[data-venue-id]').first();
    await expect(first).toBeVisible();
    await expect(page.locator('.meta-distance').first()).toContainText(/\d+\.\d km away/);
    await expect(page).toHaveURL(/maxDistanceKm=20/);
  });

  test('empty state when nothing is within the distance', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Or enter an address').fill('Praha');
    await page.getByRole('button', { name: 'Find address' }).click();
    await page.getByRole('button', { name: '5 km' }).click();
    await searchTomorrow(page);
    await expect(page.locator('.state-empty')).toContainText('No courts found');
    await expect(page.locator('.state-empty')).toContainText('larger distance');
  });

  test('address not found', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Or enter an address').fill('nowhere');
    await page.getByRole('button', { name: 'Find address' }).click();
    await expect(page.getByRole('status')).toContainText('Address not found');
    await expect(page.getByRole('button', { name: '5 km' })).toBeDisabled();
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
    await page.getByLabel('Or enter an address').fill('Brno');
    await page.getByRole('button', { name: 'Find address' }).click();
    await expect(page.getByRole('status')).toContainText('unavailable');
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
    await expect(page.getByRole('status')).toContainText('Location access was denied');
    await expect(page.getByRole('button', { name: '5 km' })).toBeDisabled();
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
    await expect(page.getByRole('status')).toContainText('Searching near: Your location');
    await page.getByRole('button', { name: '20 km' }).click();
    await searchTomorrow(page);
    await expect(page.locator('li.card[data-venue-id]').first()).toBeVisible();
    await expect(page.locator('.meta-distance').first()).toContainText('km away');
  });
});
