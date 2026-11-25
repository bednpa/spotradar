/** Shared helpers of the E2E specs (not a spec file itself). */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

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
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

export const tomorrow = (): string => addDays(today(), 1);

function parts(date: string): { weekday: string; day: number; month: string; year: number } {
  const [y, m, d] = date.split('-').map(Number);
  return {
    weekday: WEEKDAYS[new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? '',
    day: d ?? 1,
    month: MONTHS[(m ?? 1) - 1] ?? '',
    year: y ?? 1970,
  };
}

/** "2026-11-25" → "Wednesday 25 November" (accessible name of a date pill). */
export function longDate(date: string): string {
  const p = parts(date);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "2026-11-25" → "Wednesday 25 November 2026" (the Day view title). */
export function dayTitle(date: string): string {
  return `${longDate(date)} ${parts(date).year}`;
}

export async function openDay(page: Page, date = tomorrow()): Promise<void> {
  await page.goto(`/?view=day&date=${date}`);
  await expect(page.getByRole('grid')).toBeVisible();
}

export function viewButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

export function mainNav(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Main' });
}

export function addressBox(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Address' });
}

/** Opens (in the current Day/Week grid) the first free slot where `venueId` has free courts. */
export async function openSlotWithFreeVenue(page: Page, venueId: string): Promise<Locator> {
  const cells = page.locator('button.cell-free:not([disabled])');
  await expect(cells.first()).toBeVisible();
  const count = await cells.count();
  const dialog = page.getByRole('dialog');
  for (let i = 0; i < count; i++) {
    await cells.nth(i).click();
    await expect(dialog).toBeVisible();
    if ((await dialog.locator(`li[data-venue-id="${venueId}"][data-state="free"]`).count()) > 0) {
      return dialog;
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  throw new Error(`No free slot with ${venueId} found`);
}
