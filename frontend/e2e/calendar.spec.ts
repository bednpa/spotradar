import { expect, test } from '@playwright/test';
import {
  addDays,
  addressBox,
  dayTitle,
  longDate,
  mainNav,
  openDay,
  openSlotWithFreeVenue,
  today,
  tomorrow,
  viewButton,
} from './helpers.ts';

test.describe('layout and navigation', () => {
  test('shows Reserve/Venues navigation, the sport filter, address field and the footer', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = mainNav(page);
    await expect(nav.getByRole('link', { name: 'Reserve' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Venues' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    const sport = page.getByRole('group', { name: 'Sport' });
    await expect(sport.getByRole('button', { name: 'Badminton' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(addressBox(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
    await expect(page).toHaveURL(/sport=badminton/);
    await expect(page.getByRole('contentinfo')).toContainText('SpotRadar never books anything');
  });

  test('the removed filters are gone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Go to date')).toHaveCount(0);
    await expect(page.getByLabel('From', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('To', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Only show free')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next free court' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Find address' })).toHaveCount(0);
  });

  test('Reserve and Venues switch pages client-side and the back button works', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('grid')).toBeVisible();

    await mainNav(page).getByRole('link', { name: 'Venues' }).click();
    await expect(page).toHaveURL(/\/venues$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Venues' })).toBeVisible();
    await expect(mainNav(page).getByRole('link', { name: 'Venues' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('#page-calendar')).toBeHidden();
    await expect(page.locator('.vcard').first()).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/\/\?view=/);
    await expect(page.locator('#page-calendar')).toBeVisible();
    await expect(page.locator('#page-venues')).toBeHidden();
    await expect(mainNav(page).getByRole('link', { name: 'Reserve' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('grid')).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/venues$/);
    await expect(page.locator('#page-venues')).toBeVisible();

    await mainNav(page).getByRole('link', { name: 'Reserve' }).click();
    await expect(page.getByRole('grid')).toBeVisible();
  });

  test('week is the default view on wide screens: 7 days by fixed 06–22 hour rows', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(viewButton(page, 'Week')).toHaveAttribute('aria-pressed', 'true');
    const grid = page.getByRole('grid', { name: /Week calendar/ });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader')).toHaveCount(8); // corner + 7 days
    await expect(grid.getByRole('rowheader')).toHaveCount(17); // 06:00 … 22:00
    await expect(page.locator('#period-title')).toHaveText(/\d{4}$/);
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
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page.locator('#period-title')).toHaveText(dayTitle(today()));
  });

  test('a day outside the searchable window is shown as not available yet', async ({ page }) => {
    await page.goto(`/?view=day&date=${addDays(today(), 30)}`);
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
});

test.describe('date strip', () => {
  test('has one pill per searchable day and highlights today', async ({ page }) => {
    await page.goto('/');
    const strip = page.getByRole('group', { name: 'Select a day' });
    await expect(strip.getByRole('button')).toHaveCount(15);
    const todayPill = strip.getByRole('button', { name: `Today, ${longDate(today())}` });
    await expect(todayPill).toHaveAttribute('aria-pressed', 'true');
    await expect(todayPill).toContainText('Today');
    await expect(strip.getByRole('button', { name: longDate(tomorrow()) })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('selecting a day jumps the Day view to that date', async ({ page }) => {
    await openDay(page);
    const target = addDays(today(), 3);
    const strip = page.getByRole('group', { name: 'Select a day' });
    await strip.getByRole('button', { name: longDate(target) }).click();
    await expect(page.locator('#period-title')).toHaveText(dayTitle(target));
    await expect(strip.getByRole('button', { name: longDate(target) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page).toHaveURL(new RegExp(`date=${target}`));
    await expect(page.getByRole('grid', { name: /hours/ })).toBeVisible();
  });

  test('in Week view the week stays and the pill is selected; Month switches to Week', async ({
    page,
  }) => {
    await page.goto(`/?view=week&date=${today()}`);
    const target = addDays(today(), 2);
    const strip = page.getByRole('group', { name: 'Select a day' });
    await strip.getByRole('button', { name: longDate(target) }).click();
    await expect(viewButton(page, 'Week')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(new RegExp(`date=${target}`));

    await viewButton(page, 'Month').click();
    await strip.getByRole('button', { name: longDate(tomorrow()) }).click();
    await expect(viewButton(page, 'Week')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('grid', { name: /Week calendar/ })).toBeVisible();
  });
});

test.describe('hour slot details', () => {
  test('only free hours are highlighted; there are no "check" cells', async ({ page }) => {
    await openDay(page);
    await expect(page.locator('button.cell-free:not([disabled])').first()).toBeVisible();
    await expect(page.locator('button.cell-check')).toHaveCount(0);
    await expect(page.getByText('to check on website')).toHaveCount(0);
  });

  test('Hala Sprint (MemberZone) shows live free courts with a "Checked … ago" note', async ({
    page,
  }) => {
    await openDay(page);
    const dialog = await openSlotWithFreeVenue(page, 'hala-sprint');
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(/^\d\d:00–\d\d:00$/);

    const sprint = dialog.locator('li[data-venue-id="hala-sprint"]');
    await expect(sprint).toHaveAttribute('data-state', 'free');
    await expect(sprint).toContainText('Hala Sprint');
    await expect(sprint).toContainText(/\d+ courts? free/);
    await expect(sprint).toContainText(/Checked (just now|\d+ min ago|\d+ h ago)/);
    await expect(sprint.locator('time')).toHaveAttribute('title', /^Checked at \d\d:\d\d$/);
    await expect(sprint.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d\d-\d\dT/);
    const book = sprint.getByRole('link', { name: /Book on venue's website/ });
    await expect(book).toHaveAttribute('href', /^https:\/\//);
    await expect(book).toHaveAttribute('target', '_blank');
    await expect(book).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(
      sprint.getByRole('link', { name: /Rating & reviews on Google Maps/ }),
    ).toHaveAttribute('href', /google\.com\/maps\/search/);
  });

  test('Kuklenská shows price, MultiSport and website in the panel', async ({ page }) => {
    await openDay(page);
    const dialog = await openSlotWithFreeVenue(page, 'kuklenska');
    const item = dialog.locator('li[data-venue-id="kuklenska"]');
    await expect(item).toContainText('Sportcentrum Kuklenská');
    await expect(item).toContainText(/Kč/);
    await expect(item).toContainText('MultiSport accepted');
    await expect(item.getByRole('link', { name: /^Website/ })).toHaveAttribute(
      'href',
      /^https?:\/\//,
    );
    await expect(dialog.locator('li[data-state="free"]').first()).toBeVisible();
  });

  test('venues without live data are collapsed under "check on website"', async ({ page }) => {
    await openDay(page);
    await page.locator('button.cell[data-hour="12"]').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const section = dialog.locator('details.check-venues');
    await expect(section.locator('summary')).toContainText(
      /\d+ venues? without live data – check on website/,
    );
    const isOpen = await section.evaluate((el: HTMLDetailsElement) => el.open);
    if (!isOpen) await section.locator('summary').click();

    // Centrum Viktoria's connector fails in stub mode → status "unavailable" → listed as "check".
    const viktoria = section.locator('li[data-venue-id="centrum-viktoria"]');
    await expect(viktoria).toHaveAttribute('data-state', 'check');
    await expect(viktoria).toContainText('check on website');
    await expect(viktoria.getByRole('link', { name: /Book on venue's website/ })).toHaveAttribute(
      'href',
      /^https?:\/\//,
    );
    // Full or closed venues are not listed at all.
    await expect(dialog.locator('li[data-state="full"], li[data-state="closed"]')).toHaveCount(0);
    // Free venues (if any) are not inside the "check" section.
    await expect(section.locator('li[data-state="free"]')).toHaveCount(0);
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

test.describe('legend', () => {
  test('the legend shows which venues have live data', async ({ page }) => {
    await page.goto('/');
    const legend = page.locator('#legend');
    await expect(legend.getByRole('heading', { name: 'Venues and data quality' })).toBeVisible();
    const live = legend.locator('li[data-coverage="live"]');
    await expect(live).toHaveCount(3);
    // the legend is sorted by name, not by live status, so check the names without relying on order
    for (const name of ['Sportcentrum Kuklenská', 'Hala Sprint', 'Sportcentrum Ivanovice']) {
      await expect(live.filter({ hasText: name })).toHaveCount(1);
    }
    await expect(legend.locator('li[data-coverage="unavailable"]')).toHaveCount(1);
    await expect(legend.locator('li[data-coverage="unavailable"]')).toContainText(
      'Centrum Viktoria',
    );
    await expect(legend.locator('li[data-coverage="unknown"]')).toHaveCount(3);
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
    await addressBox(page).fill('Praha');
    await addressBox(page).press('Enter');
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
    await addressBox(page).fill('Brno centrum');
    await addressBox(page).press('Enter');
    await page.getByRole('button', { name: '20 km', exact: true }).click();
    await page.locator('button.cell-free:not([disabled])').first().click();
    await expect(page.getByRole('dialog')).toContainText(/\d+\.\d km away/);
  });

  test('address not found', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '5 km', exact: true })).toBeDisabled();
    await addressBox(page).fill('nowhere');
    await addressBox(page).press('Enter');
    await expect(page.locator('#location-status')).toContainText('Address not found');
    await expect(page.getByRole('button', { name: '5 km', exact: true })).toBeDisabled();
  });

  test('geocoder unavailable on Enter', async ({ page }) => {
    await page.route('**/api/geocode?**', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'down', code: 'GEOCODER_UNAVAILABLE' }),
      }),
    );
    await page.goto('/');
    await addressBox(page).fill('Brno');
    await addressBox(page).press('Enter');
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

test.describe('address suggestions', () => {
  test('typing shows live suggestions; clicking one sets the location', async ({ page }) => {
    await page.goto('/');
    const box = addressBox(page);
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await box.fill('Kukl');
    const options = page.getByRole('listbox', { name: 'Address suggestions' }).getByRole('option');
    await expect(options.first()).toBeVisible();
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    await expect(options.first()).toContainText('Brno');

    const label = (await options.first().innerText()).trim();
    await options.first().click();
    await expect(page.locator('#location-status')).toContainText(`Searching near: ${label}`);
    await expect(box).toHaveValue(label);
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await expect(page).toHaveURL(/lat=/);
    await expect(page.getByRole('button', { name: '5 km', exact: true })).toBeEnabled();
  });

  test('keyboard: ArrowDown + Enter selects, Escape closes', async ({ page }) => {
    await page.goto('/');
    const box = addressBox(page);
    await box.fill('Brno');
    const options = page.getByRole('option');
    await expect(options.first()).toBeVisible();

    await box.press('ArrowDown');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await expect(box).toHaveAttribute('aria-activedescendant', /address-option-0/);
    await box.press('ArrowDown');
    await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await box.press('ArrowUp');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');

    await box.press('Escape');
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await expect(options).toHaveCount(0);

    await box.press('ArrowDown');
    await box.press('ArrowDown');
    await box.press('Enter');
    await expect(page.locator('#location-status')).toContainText('Searching near:');
  });

  test('Enter without a selection resolves the free text with /api/geocode', async ({ page }) => {
    await page.goto('/');
    const box = addressBox(page);
    await box.fill('Praha');
    await expect(page.getByRole('option').first()).toBeVisible();
    await box.press('Enter');
    await expect(page.locator('#location-status')).toContainText('Searching near: Praha, Česko');
  });

  test('no matching places shows an empty state', async ({ page }) => {
    await page.goto('/');
    await addressBox(page).fill('nowhere');
    await expect(page.locator('#suggest-status')).toHaveText('No matching places');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(addressBox(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('a failing suggest service shows a non-blocking error', async ({ page }) => {
    await page.goto('/');
    await addressBox(page).fill('fail');
    await expect(page.locator('#suggest-status')).toContainText('Suggestions unavailable');
    // the calendar keeps working and Enter still resolves the text
    await expect(page.getByRole('grid')).toBeVisible();
    await addressBox(page).press('Enter');
    await expect(page.locator('#location-status')).toContainText('Searching near:');
  });

  test('shows a loading hint while suggestions load and ignores stale responses', async ({
    page,
  }) => {
    await page.route('**/api/geocode/suggest**', async (route) => {
      const q = new URL(route.request().url()).searchParams.get('q') ?? '';
      if (q === 'Br') await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suggestions: [{ lat: 49.2, lng: 16.6, label: `Result for ${q}` }],
        }),
      });
    });
    await page.goto('/');
    const box = addressBox(page);
    await box.fill('Br');
    await expect(page.locator('#suggest-status')).toHaveText('Searching places…');
    await box.fill('Brno');
    const options = page.getByRole('option');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('Result for Brno');
    // the slow "Br" response arrives later and must not replace the newer list
    await page.waitForTimeout(1200);
    await expect(options.first()).toContainText('Result for Brno');
  });

  test('clearing the location resets the filter', async ({ page }) => {
    await page.goto('/');
    await addressBox(page).fill('Brno centrum');
    await addressBox(page).press('Enter');
    await expect(page.locator('#location-status')).toContainText('Searching near:');
    await page.getByRole('button', { name: 'Clear location' }).click();
    await expect(page.locator('#location-status')).toHaveText('');
    await expect(addressBox(page)).toHaveValue('');
    await expect(page).not.toHaveURL(/lat=/);
    await expect(page.getByRole('button', { name: '5 km', exact: true })).toBeDisabled();
  });
});

test.describe('geolocation granted', () => {
  test.use({
    geolocation: { latitude: 49.1951, longitude: 16.6068 },
    permissions: ['geolocation'],
  });

  test('the arrow button in the address field uses the browser location', async ({ page }) => {
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
  test('restores view, date, sport, location and distance', async ({ page }) => {
    const date = tomorrow();
    await page.goto(
      `/?view=day&date=${date}&sport=badminton&lat=49.1951&lng=16.6068&maxDistanceKm=10`,
    );
    await expect(viewButton(page, 'Day')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#period-title')).toHaveText(dayTitle(date));
    await expect(
      page.getByRole('group', { name: 'Sport' }).getByRole('button', { name: 'Badminton' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '10 km', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('rowheader')).toHaveCount(17);
  });

  test('old links with time filters still load with the full hour range', async ({ page }) => {
    await page.goto(`/?view=day&date=${tomorrow()}&timeFrom=08%3A00&timeTo=10%3A00&free=1`);
    await expect(page.getByRole('rowheader')).toHaveCount(17);
  });

  test('a changed view survives a reload', async ({ page }) => {
    await page.goto('/');
    await viewButton(page, 'Month').click();
    await expect(page).toHaveURL(/view=month/);
    await page.reload();
    await expect(viewButton(page, 'Month')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('grid', { name: /\d{4}$/ })).toBeVisible();
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

  test('the date strip scrolls inside itself and the nav fits', async ({ page }) => {
    await page.goto('/');
    await expect(mainNav(page).getByRole('link', { name: 'Reserve' })).toBeVisible();
    await expect(mainNav(page).getByRole('link', { name: 'Venues' })).toBeVisible();
    const strip = page.getByRole('group', { name: 'Select a day' });
    await strip.getByRole('button', { name: longDate(addDays(today(), 10)) }).click();
    await expect(page.locator('#period-title')).toHaveText(dayTitle(addDays(today(), 10)));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
