import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { VenuesResponse } from '@spotradar/shared';
import { openDay, openSlotWithFreeVenue, today, tomorrow } from './helpers.ts';

/** Centrum Viktoria's outdoor sand courts are open 1 May – 30 Sep ("YYYY-MM-DD" date). */
function viktoriaBeachInSeason(date: string): boolean {
  const monthDay = date.slice(5);
  return monthDay >= '05-01' && monthDay <= '09-30';
}

/** The sport chip in the calendar filters / venue list (accessible name = English name). */
function sportChip(page: Page, name: string): Locator {
  return page.getByRole('group', { name: 'Sport' }).getByRole('button', { name, exact: true });
}

test.describe('multiple sports', () => {
  test('the calendar lists every sport; switching sport changes URL, title, calendar and panel', async ({
    page,
  }) => {
    await openDay(page);
    const chips = page.getByRole('group', { name: 'Sport' }).getByRole('button');
    await expect(chips).toHaveText([
      /Badminton/,
      /Tennis/,
      /Squash/,
      /Padel/,
      /Table tennis/,
      /Volleyball/,
      /Beach volleyball/,
    ]);
    await expect(sportChip(page, 'Badminton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveTitle('SpotRadar – free badminton courts in Brno');

    await sportChip(page, 'Squash').click();
    await expect(page).toHaveURL(/sport=squash/);
    await expect(sportChip(page, 'Squash')).toHaveAttribute('aria-pressed', 'true');
    await expect(sportChip(page, 'Badminton')).toHaveAttribute('aria-pressed', 'false');
    await expect(page).toHaveTitle('SpotRadar – free squash courts in Brno');

    // The panel lists squash venues (live through ClubSpire / MemberPro), not badminton halls.
    const dialog = await openSlotWithFreeVenue(page, 'fitness-boby');
    await expect(dialog.locator('li[data-venue-id="fitness-boby"]')).toContainText('Fitness Boby');
    await expect(dialog.locator('li[data-venue-id="badminton-lisen"]')).toHaveCount(0);
    await expect(
      dialog
        .locator('li[data-venue-id="fitness-boby"]')
        .getByRole('link', { name: /Book on venue's website/ }),
    ).toHaveAttribute('href', /fitnessboby\.cz:28080\/timeline\/day\?tabIdx=4/);
    await page.keyboard.press('Escape');

    // Back/forward restores the sport from the URL.
    await page.goBack();
    await expect(sportChip(page, 'Badminton')).toHaveAttribute('aria-pressed', 'true');
    expect(page.url()).not.toContain('sport=squash');
  });

  test('a sport in the URL is selected on load; padel only counts the 3 padel courts', async ({
    page,
  }) => {
    await page.goto(`/?view=day&date=${tomorrow()}&sport=padel`);
    await expect(sportChip(page, 'Padel')).toHaveAttribute('aria-pressed', 'true');
    const dialog = await openSlotWithFreeVenue(page, 'centrum-viktoria');
    const viktoria = dialog.locator('li[data-venue-id="centrum-viktoria"]');
    await expect(viktoria.locator('.pill-free')).toHaveText(/^[123] courts? free$/);
    // Padel venues without a connector are offered as "check on website".
    await expect(
      dialog.locator('li[data-venue-id="padel-powers-slatina"][data-state="check"]'),
    ).toHaveCount(1);
  });

  test('beach volleyball: STAREZ is live, outdoor Viktoria is closed out of season', async ({
    page,
  }) => {
    await page.goto(`/?view=day&date=${tomorrow()}&sport=beach-volleyball`);
    const dialog = await openSlotWithFreeVenue(page, 'beach-riviera');
    await expect(dialog.locator('li[data-venue-id="beach-riviera"]')).toContainText(
      'Beach Riviéra',
    );
    // Out of season (outside 1 May – 30 Sep) Viktoria's sand courts are never free or "check".
    if (!viktoriaBeachInSeason(tomorrow())) {
      await expect(dialog.locator('li[data-venue-id="centrum-viktoria"]')).toHaveCount(0);
    }
  });

  test('empty state when no venue of a sport is within the distance', async ({ page }) => {
    // The only volleyball hall (Lesná) is ~3.5 km from the centre.
    await page.goto(
      `/?view=day&date=${tomorrow()}&sport=volleyball&lat=49.1951&lng=16.6068&maxDistanceKm=2`,
    );
    await expect(page.locator('.state-empty')).toContainText('No volleyball venues within 2 km');
    await page.getByRole('button', { name: 'Clear distance' }).click();
    await expect(page.locator('.state-empty')).toHaveCount(0);
    await expect(page.getByRole('grid')).toBeVisible();
  });

  test('venue list: sport filter, per-sport details and sport tags', async ({ page }) => {
    await page.goto('/venues');
    const viktoria = page.locator('.vcard[data-venue-id="centrum-viktoria"]');
    const tags = viktoria.getByLabel('Sports and activities');
    for (const sport of ['Badminton', 'Squash', 'Padel', 'Beach volleyball', 'Tennis']) {
      await expect(tags).toContainText(sport);
    }
    // All sports: one group per sport.
    await expect(viktoria.locator('.offering')).toHaveCount(5);

    await sportChip(page, 'Table tennis').click();
    await expect(page).toHaveURL(/\/venues\?sport=table-tennis/);
    const cards = page.locator('.vcard');
    await expect(cards.first()).toBeVisible();
    for (const id of await cards.evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-venue-id')),
    )) {
      await expect(page.locator(`.vcard[data-venue-id="${id}"] .offering`)).toHaveCount(1);
    }
    const ivanovice = page.locator('.vcard[data-venue-id="sportcentrum-ivanovice"]');
    const tableTennis = ivanovice.getByRole('group', { name: 'Table tennis' });
    await expect(tableTennis).toContainText('2 courts');
    await expect(tableTennis.getByTestId('live-status')).toHaveAttribute('data-status', 'live');
    await expect(page.locator('.vcard[data-venue-id="kuklenska"]')).toHaveCount(0);

    // Seasonal offering: the season is shown, plus "closed" when today is outside it.
    await sportChip(page, 'Beach volleyball').click();
    const viktoriaBeach = page.locator('.vcard[data-venue-id="centrum-viktoria"] .offering');
    await expect(viktoriaBeach).toContainText('Season 1 May – 30 Sep');
    if (!viktoriaBeachInSeason(today())) {
      await expect(viktoriaBeach).toContainText('Closed out of season');
    }
    // Unknown hours are labelled, not invented.
    await expect(page.locator('.vcard[data-venue-id="beach-riviera"] .offering')).toContainText(
      'Opening hours unknown',
    );
  });

  test('venue list: empty state for a sport without venues', async ({ page }) => {
    await page.route('**/api/venues**', (route) => {
      const body: VenuesResponse = { query: { sport: 'volleyball' }, venues: [] };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.goto('/venues?sport=volleyball');
    await expect(page.locator('.state-empty')).toContainText(
      'No volleyball venues in SpotRadar yet',
    );
    await expect(page.getByRole('button', { name: 'Show all sports' })).toBeVisible();
  });
});
