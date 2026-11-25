import { expect, test } from '@playwright/test';
import { mainNav } from './helpers.ts';

test.describe('venues page', () => {
  test('lists every venue as a card with its details', async ({ page }) => {
    await page.goto('/venues');
    await expect(page.getByRole('heading', { level: 2, name: 'Venues' })).toBeVisible();
    await expect(mainNav(page).getByRole('link', { name: 'Venues' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const cards = page.locator('.vcard');
    await expect(cards).toHaveCount(7);
    await expect(page.locator('.result-count')).toHaveText('7 venues');

    const kuklenska = page.locator('.vcard[data-venue-id="kuklenska"]');
    await expect(kuklenska.getByRole('heading', { level: 3 })).toHaveText('Sportcentrum Kuklenská');
    await expect(kuklenska).toContainText('Brno-Židenice');
    await expect(kuklenska.getByLabel('Sports and activities')).toContainText('Badminton');
    await expect(kuklenska).toContainText('Courts');
    await expect(kuklenska).toContainText('Opening hours');
    await expect(kuklenska.locator('.hours')).toContainText(/\d\d:\d\d–\d\d:\d\d/);
    await expect(kuklenska).toContainText(/from \d+ Kč \/ h/);
    await expect(kuklenska.getByTestId('multisport')).toHaveText('1 card = 50 % off');
    await expect(kuklenska.getByTestId('live-status')).toHaveAttribute('data-status', 'live');
    await expect(kuklenska.getByRole('link', { name: /^Website/ })).toHaveAttribute(
      'href',
      /^https?:\/\//,
    );
    await expect(kuklenska.getByRole('link', { name: /Book on venue's website/ })).toHaveAttribute(
      'target',
      '_blank',
    );
    await expect(
      kuklenska.getByRole('link', { name: /Rating & reviews on Google Maps/ }),
    ).toHaveAttribute('href', /google\.com\/maps\/search/);

    // Bizzy venues (Jehnice, Líšeň, X-Arena) have a connector now and show live data too.
    await expect(
      page.locator('.vcard[data-venue-id="badminton-jehnice"]').getByTestId('live-status'),
    ).toHaveAttribute('data-status', 'live');
    // Other activities are listed as extra tags.
    await expect(page.locator('.vcard[data-venue-id="centrum-viktoria"] .tags')).toContainText(
      'Squash',
    );
  });

  test('search filters the list (diacritics-insensitive) and is kept in the URL', async ({
    page,
  }) => {
    await page.goto('/venues');
    await expect(page.locator('.vcard')).toHaveCount(7);
    await page.getByLabel('Search venues').fill('lisen');
    await expect(page.locator('.vcard')).toHaveCount(1);
    await expect(page.locator('.vcard')).toContainText('Badminton Líšeň');
    await expect(page.locator('.result-count')).toHaveText('1 venue');
    await expect(page).toHaveURL(/\/venues\?q=lisen/);

    await page.getByLabel('Search venues').fill('');
    await expect(page.locator('.vcard')).toHaveCount(7);
  });

  test('a shared search link restores the query and the results', async ({ page }) => {
    await page.goto('/venues?q=lisen&sport=badminton');
    await expect(page.getByLabel('Search venues')).toHaveValue('lisen');
    await expect(page.locator('.vcard')).toHaveCount(1);
    await expect(
      page.getByRole('group', { name: 'Sport' }).getByRole('button', { name: 'Badminton' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('the sport filter keeps badminton venues', async ({ page }) => {
    await page.goto('/venues');
    await page
      .getByRole('group', { name: 'Sport' })
      .getByRole('button', { name: 'Badminton' })
      .click();
    await expect(page).toHaveURL(/sport=badminton/);
    await expect(page.locator('.vcard')).toHaveCount(7);
    await page.getByRole('button', { name: 'All sports' }).click();
    await expect(page).not.toHaveURL(/sport=/);
  });

  test('shows an empty state for a search without results and can clear it', async ({ page }) => {
    await page.goto('/venues');
    await page.getByLabel('Search venues').fill('zzzzqq');
    await expect(page.getByRole('heading', { name: 'No venues match “zzzzqq”' })).toBeVisible();
    await expect(page.locator('.vcard')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.locator('.vcard')).toHaveCount(7);
    await expect(page.getByLabel('Search venues')).toHaveValue('');
  });

  test('shows a loading skeleton while fetching', async ({ page }) => {
    await page.route('**/api/venues**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });
    await page.goto('/venues');
    await expect(page.locator('.skeleton').first()).toBeVisible();
    await expect(page.locator('.vcard').first()).toBeVisible();
  });

  test('shows an error with "Try again" that recovers', async ({ page }) => {
    let fail = true;
    await page.route('**/api/venues**', (route) => {
      if (!fail) return route.continue();
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal error', code: 'INTERNAL_ERROR' }),
      });
    });
    await page.goto('/venues');
    await expect(page.getByRole('alert')).toContainText('Internal error');
    fail = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.vcard')).toHaveCount(7);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('uses the real /api/venues endpoint with the search text', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/venues')) requests.push(new URL(request.url()).search);
    });
    await page.goto('/venues');
    await expect(page.locator('.vcard')).toHaveCount(7);
    await page.getByLabel('Search venues').fill('jehnice');
    await expect(page.locator('.vcard')).toHaveCount(1);
    expect(requests).toContain('?q=jehnice');
  });
});

test.describe('venues page on a phone', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('cards stack without horizontal page overflow', async ({ page }) => {
    await page.goto('/venues');
    await expect(page.locator('.vcard').first()).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
