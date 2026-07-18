const { test, expect } = require('@playwright/test');
const { routeDashboardApis } = require('../playwright-fixtures');

const BASE_URL = `http://localhost:${process.env.PORT || 7071}`;

// Asserts the selector actually matched elements (so an empty match can never
// pass this check silently) and that none of them overflow their container.
async function expectNoOverflow(page, selector, minCount = 1) {
  const overflows = await page.$$eval(selector, els =>
    els.map(el => ({
      cls: el.className,
      scroll: el.scrollWidth,
      client: el.clientWidth,
      text: el.textContent?.slice(0, 50)
    }))
  );
  expect(overflows.length, `expected at least ${minCount} match(es) for ${selector}`).toBeGreaterThanOrEqual(minCount);
  for (const o of overflows) {
    expect(o.scroll, `overflow ${selector} ${o.cls} ${o.text}`).toBeLessThanOrEqual(o.client + 2);
  }
}

test.describe('no horizontal overflow on critical selectors', () => {
  test.beforeEach(async ({ page }) => {
    await routeDashboardApis(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page.locator('#hero-tokens')).toBeVisible({ timeout: 10000 });
  });

  test('main dashboard', async ({ page }) => {
    await expectNoOverflow(page, '.mono-dashboard');
    await expectNoOverflow(page, '.top-model-name', 2);
  });

  test('scale tab', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await page.click('button:has-text("Scale")');
    await expect(page.locator('.scale-number')).toBeVisible({ timeout: 10000 });
    await expectNoOverflow(page, '.scale-number');
  });

  test('heatmaps tab - hourly dimension', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await page.click('button:has-text("Heatmaps")');
    await expect(page.locator('.heatmap-y-label').first()).toBeVisible({ timeout: 10000 });
    await expectNoOverflow(page, '.heatmap-y-label', 7);
  });

  test('heatmaps tab - daily dimension', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await page.click('button:has-text("Heatmaps")');
    await page.selectOption('#heatmap-type', 'daily');
    await expect(page.locator('.daily-heatmap-val').first()).toBeVisible({ timeout: 10000 });
    await expectNoOverflow(page, '.daily-heatmap-val');
  });
});

test.describe('overflow screenshots', () => {
  test.beforeEach(async ({ page }) => {
    await routeDashboardApis(page);
  });

  test('desktop+mobile', async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await expect(page.locator('#hero-tokens')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });

    await page.setViewportSize({ width: 375, height: 800 });
    await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  });
});
