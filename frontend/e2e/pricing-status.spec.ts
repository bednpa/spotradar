import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { CalendarResponse, FreeSlot, SportId, Venue, VenuesResponse } from '@spotradar/shared';
import { addDays, openDay, openSlotWithFreeVenue, tomorrow } from './helpers.ts';

const SPORT: SportId = 'badminton';
const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** A venue for crafted API responses (tests only). Pricing/multisport are left out on purpose. */
function craftedVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: 'crafted',
    name: 'Crafted Hall',
    district: 'Brno-Střed',
    address: 'Test street 1, Brno',
    location: { lat: 49.2, lng: 16.6 },
    sports: [SPORT],
    courts: 2,
    openingHours: {
      approximate: false,
      days: Object.fromEntries(
        WEEK_DAYS.map((d) => [d, { open: '08:00', close: '22:00' }]),
      ) as Venue['openingHours']['days'],
    },
    bookingUrl: 'https://example.com/crafted',
    availabilitySource: 'clubspire',
    ...overrides,
  };
}

/** Routes /api/calendar to one live venue with a single free slot 14:00–16:00 on every day. */
async function routeCraftedCalendar(
  page: Page,
  venue: Venue,
  freeSlots: FreeSlot[] = [{ start: '14:00', end: '16:00', freeCourts: 2 }],
): Promise<void> {
  await page.route('**/api/calendar**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const from = params.get('from') ?? tomorrow();
    const to = params.get('to') ?? from;
    const days: CalendarResponse['days'] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      days.push({
        date,
        venues: [
          {
            venueId: venue.id,
            availability: {
              status: 'live',
              checkedAt: new Date().toISOString(),
              freeSlots,
            },
          },
        ],
      });
    }
    const body: CalendarResponse = {
      query: { sport: SPORT, from, to },
      venues: [{ venue }],
      days,
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('trimmed hour rows', () => {
  test('a day whose first slot is 14:00 starts its grid at 14:00', async ({ page }) => {
    await routeCraftedCalendar(page, craftedVenue());
    await openDay(page);
    const rows = page.getByRole('grid').getByRole('rowheader');
    await expect(rows).toHaveText(['14:00', '15:00']);
  });

  test('a week uses one shared range for all its days', async ({ page }) => {
    await routeCraftedCalendar(page, craftedVenue());
    await page.goto(`/?view=week&date=${tomorrow()}`);
    await expect(
      page.getByRole('grid', { name: /Week calendar/ }).getByRole('rowheader'),
    ).toHaveText(['14:00', '15:00']);
  });

  test('nothing open or free shows the empty state, not an empty grid', async ({ page }) => {
    const closed = craftedVenue({
      openingHours: {
        approximate: false,
        days: Object.fromEntries(WEEK_DAYS.map((d) => [d, null])) as Venue['openingHours']['days'],
      },
    });
    // A closed venue has no free slots (a live free slot would still be shown as free).
    await routeCraftedCalendar(page, closed, []);
    await page.goto(`/?view=day&date=${tomorrow()}`);
    await expect(page.getByTestId('no-slots')).toContainText('No slots this day');
    await expect(page.getByRole('grid')).toHaveCount(0);
  });
});

for (const viewport of [
  { name: 'phone 375 px', width: 375, height: 740 },
  { name: 'desktop 1280 px', width: 1280, height: 800 },
]) {
  test.describe(`live status is one line on ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    async function expectSingleLine(page: Page, selector: string): Promise<void> {
      const statuses = page.locator(selector);
      await expect(statuses.first()).toBeVisible();
      const count = await statuses.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const { height, lineHeight, whiteSpace } = await statuses.nth(i).evaluate((el) => {
          const style = getComputedStyle(el);
          return {
            height: el.getBoundingClientRect().height,
            lineHeight: parseFloat(style.lineHeight),
            whiteSpace: style.whiteSpace,
          };
        });
        expect(whiteSpace).toBe('nowrap');
        expect(height).toBeGreaterThan(0);
        expect(height).toBeLessThanOrEqual(lineHeight + 1);
      }
    }

    test('in the venue list', async ({ page }) => {
      await page.goto('/venues');
      await expect(page.locator('.vcard').first()).toBeVisible();
      await expectSingleLine(page, '.vcard [data-testid="live-status"]');
    });

    test('in the slot panel (free and "check on website" venues)', async ({ page }) => {
      await openDay(page);
      await page.locator('button.cell-free:not([disabled])').first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expectSingleLine(
        page,
        '[role="dialog"] li[data-state="free"] [data-testid="live-status"]',
      );
      const section = dialog.locator('details.check-venues');
      if ((await section.count()) > 0) {
        if (!(await section.evaluate((el: HTMLDetailsElement) => el.open))) {
          await section.locator('summary').click();
        }
        await expectSingleLine(
          page,
          '[role="dialog"] li[data-state="check"] [data-testid="live-status"]',
        );
      }
    });
  });
}

test.describe('price and MultiSport', () => {
  test('clicking a slot shows one price and the MultiSport label', async ({ page }) => {
    await openDay(page);
    const dialog = await openSlotWithFreeVenue(page, 'kuklenska');
    const item = dialog.locator('li[data-venue-id="kuklenska"]');
    await expect(item.getByTestId('slot-price')).toHaveCount(1);
    await expect(item.getByTestId('slot-price')).toHaveText(/^\d+ Kč \/ h$/);
    await expect(item.getByTestId('multisport')).toContainText(/^MultiSport/);
    // The old free-text price must be gone: exactly one "Kč / h" price line per venue
    // (plus the optional "→ … with MultiSport" line).
    const priceLines = await item.locator('.fact').filter({ hasText: /Kč/ }).count();
    expect(priceLines).toBeLessThanOrEqual(2);
  });

  test('the venue list shows "from NNN Kč / h" that expands to the price table', async ({
    page,
  }) => {
    await page.goto('/venues');
    const card = page.locator('.vcard[data-venue-id="kuklenska"]');
    const details = card.getByTestId('price-details');
    await expect(details.locator('summary')).toHaveText(/^from \d+ Kč \/ h$/);
    await expect(details).not.toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details.locator('li').first()).toBeVisible();
    await expect(details.locator('li').first()).toContainText(/\d\d:\d\d–\d\d:\d\d: \d+ Kč \/ h/);
  });

  test('a venue without pricing or MultiSport data shows the unknown labels in the panel', async ({
    page,
  }) => {
    await routeCraftedCalendar(page, craftedVenue());
    await openDay(page);
    await page.locator('button.cell-free:not([disabled])').first().click();
    const item = page.getByRole('dialog').locator('li[data-venue-id="crafted"]');
    await expect(item.getByTestId('slot-price')).toHaveText('Price on website');
    await expect(item.getByTestId('multisport')).toHaveText('MultiSport: unknown');
    await expect(item).not.toContainText('with MultiSport');
  });

  test('a venue without pricing or MultiSport data shows the unknown labels in the list', async ({
    page,
  }) => {
    await page.route('**/api/venues**', (route) => {
      const body: VenuesResponse = {
        query: {},
        venues: [{ venue: craftedVenue(), liveAvailability: false }],
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    });
    await page.goto('/venues');
    const card = page.locator('.vcard[data-venue-id="crafted"]');
    await expect(card.getByTestId('price-unknown')).toHaveText('Price on website');
    await expect(card.getByTestId('price-details')).toHaveCount(0);
    await expect(card.getByTestId('multisport')).toHaveText('MultiSport: unknown');
    await expect(card.getByTestId('live-status')).toHaveText('● Check on website');
  });
});
