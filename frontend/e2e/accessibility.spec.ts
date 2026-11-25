/** Keyboard and accessibility scenarios of the calendar and venues pages. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  addDays,
  addressBox,
  longDate,
  mainNav,
  openSlotWithFreeVenue,
  today,
  tomorrow,
} from './helpers.ts';

test.describe('keyboard and accessibility', () => {
  test('cells are buttons with descriptive labels and open the panel with Enter', async ({
    page,
  }) => {
    await page.goto(`/?view=day&date=${tomorrow()}`);
    const cell = page.locator('button.cell-free:not([disabled])').first();
    // the accessible name (a visually hidden text, so it always contains the visible text)
    await expect(cell).toHaveAccessibleName(/^\w+day \d+ \w+, \d\d:00–\d\d:00: \d+ venues? free$/);
    await cell.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(/^\d\d:00–\d\d:00$/);
  });

  test('focus stays inside the open panel and the page behind is inert', async ({ page }) => {
    await page.goto(`/?view=day&date=${tomorrow()}`);
    await page.locator('button.cell-free:not([disabled])').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('main')).toHaveJSProperty('inert', true);
    await expect(page.locator('header.topbar')).toHaveJSProperty('inert', true);

    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(inside).toBe(true);
    }
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Shift+Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(inside).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('main')).toHaveJSProperty('inert', false);
  });

  test('arrow keys move between hour cells', async ({ page }) => {
    await page.goto(`/?view=day&date=${tomorrow()}`);
    const ten = page.locator('button.cell[data-hour="10"]');
    await ten.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('button.cell[data-hour="11"]')).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(ten).toBeFocused();
  });

  test('arrow keys move between days in the week view', async ({ page }) => {
    await page.goto(`/?view=week&date=${tomorrow()}`);
    const cell = page.locator(`button.cell[data-date="${tomorrow()}"][data-hour="10"]`);
    await cell.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('button.cell[data-hour="10"]:focus')).toHaveCount(1);
    await expect(cell).not.toBeFocused();
  });

  test('the date strip is keyboard accessible', async ({ page }) => {
    await page.goto(`/?view=day&date=${tomorrow()}`);
    const strip = page.getByRole('group', { name: 'Select a day' });
    const first = strip.getByRole('button', { name: `Today, ${longDate(today())}` });
    await first.focus();
    await page.keyboard.press('ArrowRight');
    const second = strip.getByRole('button', { name: longDate(tomorrow()) });
    await expect(second).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(strip.getByRole('button', { name: longDate(addDays(today(), 2)) })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`date=${addDays(today(), 2)}`));
    // focus is kept on the (re-rendered) pill
    await expect(strip.getByRole('button', { name: longDate(addDays(today(), 2)) })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await page.keyboard.press('End');
    await expect(strip.getByRole('button', { name: longDate(addDays(today(), 14)) })).toBeFocused();
  });

  test('the view switcher and filters are reachable by their labels', async ({ page }) => {
    await page.goto('/');
    for (const name of ['Day', 'Week', 'Month', 'Year']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(addressBox(page)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Sport' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Max distance' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Select a day' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
    await expect(mainNav(page).getByRole('link')).toHaveText(['Reserve', 'Venues']);
  });

  test('the address field follows the ARIA combobox pattern', async ({ page }) => {
    await page.goto('/');
    const box = addressBox(page);
    await expect(box).toHaveAttribute('aria-autocomplete', 'list');
    await expect(box).toHaveAttribute('aria-controls', 'address-listbox');
    await expect(box).toHaveAttribute('aria-expanded', 'false');
    await box.fill('Brno');
    const listbox = page.getByRole('listbox', { name: 'Address suggestions' });
    await expect(listbox).toBeVisible();
    await expect(box).toHaveAttribute('aria-expanded', 'true');
    await expect(listbox.getByRole('option').first()).toBeVisible();
    await box.press('ArrowDown');
    const activeId = await box.getAttribute('aria-activedescendant');
    expect(activeId).toMatch(/^address-option-\d+$/);
    await expect(page.locator(`#${activeId}`)).toHaveAttribute('aria-selected', 'true');
    await box.press('Escape');
    await expect(listbox).toBeHidden();
  });

  test('the user can tab from the address field to the in-field location button', async ({
    page,
  }) => {
    await page.goto('/');
    await addressBox(page).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Use my location' })).toBeFocused();
  });

  test('month and year views explain the searchable window; year grid is a group', async ({
    page,
  }) => {
    await page.goto(`/?view=month&date=${tomorrow()}`);
    await expect(page.locator('.window-hint')).toContainText(
      'only known for today and the next 14 days',
    );
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await expect(page.locator('.window-hint')).toBeVisible();
    await expect(page.getByRole('group', { name: /^\d{4}$/ })).toBeVisible();
  });

  test('navigating moves focus to the page content and the title changes', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/free badminton courts in Brno/);
    await mainNav(page).getByRole('link', { name: 'Venues' }).click();
    await expect(page).toHaveTitle(/^Venues/);
    await expect(page.locator('main')).toBeFocused();
  });
});

test.describe('automated accessibility checks (axe)', () => {
  test('calendar page has no detectable violations', async ({ page }) => {
    await page.goto(`/?view=week&date=${today()}`);
    await expect(page.getByRole('grid')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('calendar page with open suggestions and the day view has no violations', async ({
    page,
  }) => {
    await page.goto(`/?view=day&date=${tomorrow()}`);
    await expect(page.getByRole('grid')).toBeVisible();
    await addressBox(page).fill('Brno');
    await expect(page.getByRole('option').first()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('slot panel has no violations', async ({ page }) => {
    await page.goto(`/?view=day&date=${tomorrow()}`);
    await openSlotWithFreeVenue(page, 'kuklenska');
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(results.violations).toEqual([]);
  });

  test('venues page has no detectable violations', async ({ page }) => {
    await page.goto('/venues');
    await expect(page.locator('.vcard').first()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test('venues empty state has no violations', async ({ page }) => {
    await page.goto('/venues?q=zzzzqq');
    await expect(page.getByRole('heading', { name: /No venues match/ })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});

test.describe('automated accessibility checks (axe, dark mode)', () => {
  test.use({ colorScheme: 'dark' });

  test('calendar and venues pages have no violations in dark mode', async ({ page }) => {
    await page.goto(`/?view=week&date=${today()}`);
    await expect(page.getByRole('grid')).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.goto('/venues');
    await expect(page.locator('.vcard').first()).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});
