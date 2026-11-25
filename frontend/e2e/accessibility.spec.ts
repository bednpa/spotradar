/** Keyboard and accessibility scenarios of the calendar UI. */
import { expect, test } from '@playwright/test';

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const tomorrow = (): string => addDays(today(), 1);

test.describe('keyboard and accessibility', () => {
  test('cells are buttons with descriptive labels and open the panel with Enter', async ({
    page,
  }) => {
    await page.goto(`/?view=day&date=${tomorrow()}`);
    const cell = page.locator('button.cell-free:not([disabled])').first();
    await expect(cell).toHaveAttribute(
      'aria-label',
      /^\w+day \d+ \w+, \d\d:00–\d\d:00: \d+ venues? free$/,
    );
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

    for (let i = 0; i < 12; i++) {
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

  test('the view switcher and filters are reachable by their labels', async ({ page }) => {
    await page.goto('/');
    for (const name of ['Day', 'Week', 'Month', 'Year']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }
    for (const label of ['Go to date', 'From', 'To', 'Address', 'Only show free']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('group', { name: 'Max distance' })).toBeVisible();
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

  test('the date filter ignores dates outside the searchable window', async ({ page }) => {
    await page.goto(`/?view=day&date=${tomorrow()}`);
    const input = page.getByLabel('Go to date', { exact: true });
    await input.fill(addDays(today(), 30));
    await expect(input).toHaveValue(tomorrow());
    await expect(page).toHaveURL(new RegExp(`date=${tomorrow()}`));
  });
});
