import { expect, test } from '@playwright/test';
import { openSlotWithFreeVenue, tomorrow } from './helpers.ts';

/**
 * Venues that became live with the PadelOS, Reenio, Rezzy and iSportSystem connectors. In stub
 * mode their recorded answers are replayed for any date (see backend/src/stubs.ts).
 */
test.describe('newly live venues', () => {
  test('padel: Padel Powers Slatina is free; winter-closed Kraví hora is neither free nor "check"', async ({
    page,
  }) => {
    await page.goto(`/?view=day&date=${tomorrow()}&sport=padel`);
    const dialog = await openSlotWithFreeVenue(page, 'padel-powers-slatina');
    const slatina = dialog.locator('li[data-venue-id="padel-powers-slatina"][data-state="free"]');
    await expect(slatina).toContainText('Padel Powers Brno Slatina');
    await expect(slatina.locator('.pill-free')).toHaveText(/^\d+ courts? free$/);
    await expect(slatina.getByRole('link', { name: /Book on venue's website/ })).toHaveAttribute(
      'href',
      /player\.padelos\.co\/company\/217\?clubIds=216930/,
    );
    // Live data with no bookable slot (outdoor courts in winter): never "check on website".
    await expect(dialog.locator('li[data-venue-id="padel-powers-kravi-hora"]')).toHaveCount(0);
    // A padel venue without a connector is still offered as "check on website".
    await expect(
      dialog.locator('li[data-venue-id="padel-club-brno"][data-state="check"]'),
    ).toHaveCount(1);
  });

  test('volleyball: the TJ Tesla hall in Lesná is free through Reenio', async ({ page }) => {
    await page.goto(`/?view=day&date=${tomorrow()}&sport=volleyball`);
    const dialog = await openSlotWithFreeVenue(page, 'tj-tesla-hala-lesna');
    await expect(dialog.locator('li[data-venue-id="tj-tesla-hala-lesna"] .pill-free')).toHaveText(
      '1 court free',
    );
  });

  test('tennis: Kohoutovice is free; squash: Squash Slovan is free', async ({ page }) => {
    await page.goto(`/?view=day&date=${tomorrow()}&sport=tennis`);
    let dialog = await openSlotWithFreeVenue(page, 'tenisova-hala-kohoutovice');
    await expect(
      dialog.locator('li[data-venue-id="tenisova-hala-kohoutovice"][data-state="free"]'),
    ).toContainText('Tenisová hala Kohoutovice');
    await page.keyboard.press('Escape');

    await page.goto(`/?view=day&date=${tomorrow()}&sport=squash`);
    dialog = await openSlotWithFreeVenue(page, 'squash-slovan');
    await expect(
      dialog.locator('li[data-venue-id="squash-slovan"][data-state="free"]'),
    ).toContainText('Squash Slovan');
  });

  test('venue list shows the new sources as live', async ({ page }) => {
    await page.goto('/venues?sport=volleyball');
    await expect(
      page
        .locator('.vcard[data-venue-id="tj-tesla-hala-lesna"]')
        .getByRole('group', { name: 'Volleyball' })
        .getByTestId('live-status'),
    ).toHaveAttribute('data-status', 'live');

    await page.goto('/venues?sport=tennis');
    for (const id of ['tenisova-hala-kohoutovice', 'tenis-komarov', 'zltc-brno']) {
      await expect(
        page
          .locator(`.vcard[data-venue-id="${id}"]`)
          .getByRole('group', { name: 'Tennis' })
          .getByTestId('live-status'),
      ).toHaveAttribute('data-status', 'live');
    }
  });
});
