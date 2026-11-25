import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type {
  CalendarResponse,
  CalendarVenue,
  SportId,
  Venue,
  VenueAvailability,
  VenuesResponse,
} from '@spotradar/shared';
import { addDays, mainNav, openDay, tomorrow } from './helpers.ts';

const SPORT: SportId = 'badminton';
const WEEK_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function pricing(price: number): Venue['pricing'] {
  return {
    currency: 'CZK',
    unit: 'hour',
    rules: [{ days: [...WEEK_DAYS], from: '08:00', to: '22:00', price }],
  };
}

function venue(id: string, name: string, overrides: Partial<Venue> = {}): Venue {
  return {
    id,
    name,
    district: 'Brno-Střed',
    address: `${name} street 1, Brno`,
    location: { lat: 49.2, lng: 16.6 },
    sports: [SPORT],
    courts: 2,
    openingHours: {
      approximate: false,
      days: Object.fromEntries(
        WEEK_DAYS.map((d) => [d, { open: '08:00', close: '22:00' }]),
      ) as Venue['openingHours']['days'],
    },
    bookingUrl: `https://example.com/${id}`,
    availabilitySource: 'clubspire',
    multisport: { category: 'unknown' },
    ...overrides,
  };
}

/**
 * Crafted venues with explicit distance / price / MultiSport terms so every order is known:
 *  free list     distance: Alfa 1, Beta 2, Gama 3, Delta 4
 *                price 0 cards: Gama 250, Beta 300, Alfa 400, Delta (unknown, last)
 *                price 2 cards: Alfa 0, Gama 0 (tie -> nearer Alfa first), Beta 300 (no MultiSport), Delta
 *  check list    Zeta (0.4 km, 100 Kč), Eta (5 km, 50 Kč)
 */
const HALF = { category: 'half-per-card' } as const;
const CRAFTED: CalendarVenue[] = [
  { venue: venue('alfa', 'Alfa Hall', { pricing: pricing(400), multisport: HALF }), distanceKm: 1 },
  {
    venue: venue('beta', 'Beta Hall', {
      pricing: pricing(300),
      multisport: { category: 'not-accepted' },
    }),
    distanceKm: 2,
  },
  {
    venue: venue('gama', 'Gama Hall', {
      pricing: pricing(250),
      multisport: {
        category: 'half-per-card',
        limits: { maxPlayersPerCourt: 4, onlyBookingMinutes: 60 },
      },
    }),
    distanceKm: 3,
  },
  { venue: venue('delta', 'Delta Hall'), distanceKm: 4 },
  {
    venue: venue('zeta', 'Zeta Check', { pricing: pricing(100), multisport: HALF }),
    distanceKm: 0.4,
  },
  { venue: venue('eta', 'Eta Check', { pricing: pricing(50), multisport: HALF }), distanceKm: 5 },
];
const CHECK_IDS = new Set(['zeta', 'eta']);

async function routeCalendar(page: Page, venues: CalendarVenue[] = CRAFTED): Promise<void> {
  await page.route('**/api/calendar**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const from = params.get('from') ?? tomorrow();
    const to = params.get('to') ?? from;
    const days: CalendarResponse['days'] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      days.push({
        date,
        venues: venues.map(
          ({ venue: v }): { venueId: string; availability: VenueAvailability } => ({
            venueId: v.id,
            availability: CHECK_IDS.has(v.id)
              ? { status: 'unknown', freeSlots: [] }
              : {
                  status: 'live',
                  checkedAt: new Date().toISOString(),
                  freeSlots: [{ start: '14:00', end: '16:00', freeCourts: 2 }],
                },
          }),
        ),
      });
    }
    const body: CalendarResponse = { query: { sport: SPORT, from, to }, venues, days };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/** Directory with the same venues; the locations are the reverse of the name order. */
async function routeVenues(page: Page, status = 200): Promise<void> {
  await page.route('**/api/venues**', (route) => {
    if (status !== 200) {
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Boom' } }),
      });
    }
    const lat: Record<string, number> = { alfa: 49.5, beta: 49.4, gama: 49.3, delta: 49.2 };
    const body: VenuesResponse = {
      query: {},
      venues: CRAFTED.filter(({ venue: v }) => v.id in lat).map(({ venue: v }) => ({
        venue: { ...v, location: { lat: lat[v.id] ?? 49.2, lng: 16.6 } },
        liveAvailability: false,
      })),
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

function sortGroup(scope: Locator): Locator {
  return scope.getByRole('group', { name: 'Sort by' });
}

function cardsGroup(scope: Locator): Locator {
  return scope.getByRole('group', { name: 'MultiSport cards' });
}

const names = (names: string[]): string[] => names;

test.describe('slot panel: sort by and MultiSport cards', () => {
  test('distance -> price -> 2 cards -> distance changes order and prices in place', async ({
    page,
  }) => {
    await routeCalendar(page);
    await openDay(page);
    await page.locator('button.cell-free:not([disabled])').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const free = dialog.locator('li[data-state="free"] h3');
    const check = dialog.locator('li[data-state="check"] h3');
    const price = (id: string): Locator =>
      dialog.locator(`li[data-venue-id="${id}"]`).getByTestId('slot-price');

    // default: distance, 0 cards
    await expect(sortGroup(dialog).getByRole('button', { name: 'Distance' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      cardsGroup(dialog).getByRole('button', { name: '0', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(free).toHaveText(names(['Alfa Hall', 'Beta Hall', 'Gama Hall', 'Delta Hall']));
    await expect(price('alfa')).toHaveText('400 Kč / h');
    await expect(price('gama')).toHaveText('250 Kč / h');
    await expect(price('delta')).toHaveText('Price on website');
    await expect(page).not.toHaveURL(/sort=|cards=/);

    // the "check on website" list is a separate section, sorted by the same rule
    await dialog.locator('details.check-venues summary').click();
    await expect(check).toHaveText(['Zeta Check', 'Eta Check']);

    // sort by price: cheapest first, unknown price last; the dialog stays open, focus stays
    const priceButton = sortGroup(dialog).getByRole('button', { name: 'Price' });
    await priceButton.click();
    await expect(priceButton).toHaveAttribute('aria-pressed', 'true');
    await expect(priceButton).toBeFocused();
    await expect(dialog).toBeVisible();
    await expect(free).toHaveText(['Gama Hall', 'Beta Hall', 'Alfa Hall', 'Delta Hall']);
    await expect(check).toHaveText(['Eta Check', 'Zeta Check']);
    await expect(dialog.locator('details.check-venues')).toHaveAttribute('open', '');
    await expect(page).toHaveURL(/sort=price/);
    await expect(page).not.toHaveURL(/cards=/);

    // 2 cards: prices are recomputed and the order follows
    const twoCards = cardsGroup(dialog).getByRole('button', { name: '2', exact: true });
    await twoCards.click();
    await expect(twoCards).toHaveAttribute('aria-pressed', 'true');
    await expect(twoCards).toBeFocused();
    await expect(page).toHaveURL(/sort=price/);
    await expect(page).toHaveURL(/cards=2/);
    await expect(free).toHaveText(['Alfa Hall', 'Gama Hall', 'Beta Hall', 'Delta Hall']);
    await expect(price('alfa')).toHaveText('400 Kč → 0 Kč');
    await expect(
      dialog.locator('li[data-venue-id="alfa"]').getByTestId('slot-price-cards'),
    ).toHaveText('with 2 cards');
    await expect(price('gama')).toHaveText('250 Kč → 0 Kč');
    // no MultiSport: price unchanged, no cards used
    await expect(price('beta')).toHaveText('300 Kč / h');
    await expect(dialog.locator('li[data-venue-id="beta"]').getByTestId('multisport')).toHaveText(
      'No MultiSport',
    );
    await expect(
      dialog.locator('li[data-venue-id="beta"]').getByTestId('slot-price-cards'),
    ).toHaveCount(0);
    // unknown price stays unknown and last
    await expect(price('delta')).toHaveText('Price on website');
    await expect(dialog.locator('li[data-venue-id="delta"]').getByTestId('multisport')).toHaveText(
      'MultiSport: unknown',
    );
    // limits: tooltip and visible short text
    const gamaBadge = dialog.locator('li[data-venue-id="gama"]').getByTestId('multisport');
    await expect(gamaBadge).toHaveAttribute(
      'title',
      'max 4 players per court · 60-min bookings only',
    );
    await expect(
      dialog.locator('li[data-venue-id="gama"]').getByTestId('multisport-limits'),
    ).toHaveText('max 4 players per court · 60-min bookings only');
    await expect(
      dialog.locator('li[data-venue-id="alfa"]').getByTestId('multisport-limits'),
    ).toHaveCount(0);

    // back to distance: nearest first again, the cards stay
    const distanceButton = sortGroup(dialog).getByRole('button', { name: 'Distance' });
    await distanceButton.click();
    await expect(distanceButton).toBeFocused();
    await expect(free).toHaveText(['Alfa Hall', 'Beta Hall', 'Gama Hall', 'Delta Hall']);
    await expect(check).toHaveText(['Zeta Check', 'Eta Check']);
    await expect(price('gama')).toHaveText('250 Kč → 0 Kč');
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page).toHaveURL(/cards=2/);
  });

  test('sort and cards survive a reload and a shared link', async ({ page }) => {
    await routeCalendar(page);
    await page.goto(`/?view=day&date=${tomorrow()}&sort=price&cards=2`);
    await expect(page.getByRole('grid')).toBeVisible();
    await page.locator('button.cell-free:not([disabled])').first().click();
    const dialog = page.getByRole('dialog');
    await expect(sortGroup(dialog).getByRole('button', { name: 'Price' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      cardsGroup(dialog).getByRole('button', { name: '2', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.locator('li[data-state="free"] h3')).toHaveText([
      'Alfa Hall',
      'Gama Hall',
      'Beta Hall',
      'Delta Hall',
    ]);
  });

  test('without a location, Distance keeps the API order; Price still sorts', async ({ page }) => {
    // No origin → no distanceKm; the API order here is Delta, Gama, Beta, Alfa.
    const order = ['delta', 'gama', 'beta', 'alfa'];
    const noLocation = order.map((id) => {
      const entry = CRAFTED.find((c) => c.venue.id === id);
      if (!entry) throw new Error(id);
      return { venue: entry.venue };
    });
    await routeCalendar(page, noLocation);
    await openDay(page);
    await page.locator('button.cell-free:not([disabled])').first().click();
    const dialog = page.getByRole('dialog');
    const free = dialog.locator('li[data-state="free"] h3');
    await expect(free).toHaveText(['Delta Hall', 'Gama Hall', 'Beta Hall', 'Alfa Hall']);
    await sortGroup(dialog).getByRole('button', { name: 'Price' }).click();
    await expect(free).toHaveText(['Gama Hall', 'Beta Hall', 'Alfa Hall', 'Delta Hall']);
    await sortGroup(dialog).getByRole('button', { name: 'Distance' }).click();
    await expect(free).toHaveText(['Delta Hall', 'Gama Hall', 'Beta Hall', 'Alfa Hall']);
  });

  test('invalid sort and cards values fall back to the defaults', async ({ page }) => {
    await routeCalendar(page);
    await page.goto(`/?view=day&date=${tomorrow()}&sort=cheap&cards=9`);
    await expect(page.getByRole('grid')).toBeVisible();
    await page.locator('button.cell-free:not([disabled])').first().click();
    const dialog = page.getByRole('dialog');
    await expect(sortGroup(dialog).getByRole('button', { name: 'Distance' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      cardsGroup(dialog).getByRole('button', { name: '0', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('venues page: sort by and MultiSport cards', () => {
  test('price sort, cards and URL persistence after a reload', async ({ page }) => {
    await routeVenues(page);
    await page.goto('/venues');
    const cards = page.locator('.vcard h3');
    // no location: distance = the order of the API (by name)
    await expect(cards).toHaveText(['Alfa Hall', 'Beta Hall', 'Gama Hall', 'Delta Hall']);

    const controls = page.locator('#venues-filters');
    await sortGroup(controls).getByRole('button', { name: 'Price' }).click();
    await expect(cards).toHaveText(['Gama Hall', 'Beta Hall', 'Alfa Hall', 'Delta Hall']);
    await expect(page).toHaveURL(/sort=price/);
    await expect(page.locator('.vcard[data-venue-id="alfa"]').getByTestId('price-from')).toHaveText(
      'from 400 Kč / h',
    );

    await cardsGroup(controls).getByRole('button', { name: '2', exact: true }).click();
    await expect(page).toHaveURL(/cards=2/);
    await expect(page.locator('.vcard[data-venue-id="alfa"]').getByTestId('price-from')).toHaveText(
      'from 400 Kč → 0 Kč / h',
    );
    await expect(cards).toHaveText(['Alfa Hall', 'Gama Hall', 'Beta Hall', 'Delta Hall']);
    // the unknown price and the venue without MultiSport are unchanged
    await expect(page.locator('.vcard[data-venue-id="beta"]').getByTestId('price-from')).toHaveText(
      'from 300 Kč / h',
    );
    await expect(
      page.locator('.vcard[data-venue-id="delta"]').getByTestId('price-unknown'),
    ).toHaveText('Price on website');
    // the price table stays expandable
    const details = page.locator('.vcard[data-venue-id="alfa"]').getByTestId('price-details');
    await details.locator('summary').click();
    await expect(details.locator('li').first()).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/sort=price/);
    await expect(page).toHaveURL(/cards=2/);
    await expect(
      sortGroup(page.locator('#venues-filters')).getByRole('button', { name: 'Price' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      cardsGroup(page.locator('#venues-filters')).getByRole('button', {
        name: '2',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.vcard h3')).toHaveText([
      'Alfa Hall',
      'Gama Hall',
      'Beta Hall',
      'Delta Hall',
    ]);
  });

  test('the values are shared with the calendar page and distance uses its location', async ({
    page,
  }) => {
    await routeCalendar(page);
    await routeVenues(page);
    await page.goto(`/?view=day&date=${tomorrow()}&lat=49.2&lng=16.6&sort=price&cards=1`);
    await expect(page.getByRole('grid')).toBeVisible();

    await mainNav(page).getByRole('link', { name: 'Venues' }).click();
    await expect(page).toHaveURL(/\/venues\?.*sort=price/);
    await expect(page).toHaveURL(/cards=1/);
    const controls = page.locator('#venues-filters');
    await expect(sortGroup(controls).getByRole('button', { name: 'Price' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // 1 card: Alfa 400 -> 200, Gama 250 -> 125, Beta 300
    await expect(page.locator('.vcard h3')).toHaveText([
      'Gama Hall',
      'Alfa Hall',
      'Beta Hall',
      'Delta Hall',
    ]);

    // the locations are the reverse of the names: nearest to 49.2/16.6 is Delta
    await sortGroup(controls).getByRole('button', { name: 'Distance' }).click();
    await expect(page.locator('.vcard h3')).toHaveText([
      'Delta Hall',
      'Gama Hall',
      'Beta Hall',
      'Alfa Hall',
    ]);
    await expect(page.locator('.vcard[data-venue-id="delta"]')).toContainText('0.0 km away');

    // back on the calendar page the change is kept
    await mainNav(page).getByRole('link', { name: 'Reserve' }).click();
    await expect(page).not.toHaveURL(/sort=/);
    await expect(page).toHaveURL(/cards=1/);
  });

  test('error state of the list still offers a retry', async ({ page }) => {
    await routeVenues(page, 500);
    await page.goto('/venues?sort=price&cards=2');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    // the controls stay usable and reflect the URL
    await expect(
      sortGroup(page.locator('#venues-filters')).getByRole('button', { name: 'Price' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

/**
 * Both groups on one row, nothing sticking out of the controls or the viewport.
 * Retried so the slot panel's slide-in animation can finish first.
 */
async function expectSideBySide(page: Page, scope: Locator): Promise<void> {
  await expect(async () => {
    const sortBox = await sortGroup(scope).boundingBox();
    const cardsBox = await cardsGroup(scope).boundingBox();
    const controlsBox = await scope.locator('.list-controls').boundingBox();
    if (!sortBox || !cardsBox || !controlsBox) throw new Error('list controls not rendered');
    expect(Math.abs(sortBox.y - cardsBox.y)).toBeLessThan(2);
    expect(cardsBox.x).toBeGreaterThanOrEqual(sortBox.x + sortBox.width);
    const right = Math.min(
      controlsBox.x + controlsBox.width,
      page.viewportSize()?.width ?? Infinity,
    );
    expect(cardsBox.x + cardsBox.width).toBeLessThanOrEqual(right + 1);
    // The buttons themselves must not spill out of their pill either.
    const lastCard = await cardsGroup(scope).getByRole('button').last().boundingBox();
    if (!lastCard) throw new Error('cards buttons not rendered');
    expect(lastCard.x + lastCard.width).toBeLessThanOrEqual(cardsBox.x + cardsBox.width + 1);
  }).toPass({ timeout: 5000 });
}

test.describe('list controls layout', () => {
  for (const width of [320, 375, 1280]) {
    test(`Sort by and MultiSport cards sit side by side at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await routeCalendar(page);
      await routeVenues(page);

      await openDay(page);
      await page.locator('button.cell-free:not([disabled])').first().click();
      const dialog = page.getByRole('dialog');
      await expect(sortGroup(dialog)).toBeVisible();
      await expectSideBySide(page, dialog);

      await page.goto('/venues');
      const main = page.getByRole('main');
      await expect(sortGroup(main)).toBeVisible();
      await expectSideBySide(page, main);
    });
  }
});
