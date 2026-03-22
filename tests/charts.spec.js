const { test, expect } = require('@playwright/test');
const { routeDashboardApis } = require('./playwright-fixtures');

test.describe('Chart Rendering Tests', () => {
  test.beforeEach(async ({ page }) => {
    await routeDashboardApis(page);
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await expect(page.locator('#hero-tokens')).toBeVisible({ timeout: 10000 });
  });

  test('dashboard sparklines render', async ({ page }) => {
    await expect(page.locator('.sparkline')).toHaveCount(4);
  });

  test('compare chart renders horizontal bars', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="compare"]')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Compare")');

    await expect(page.locator('#compare-chart-container svg.main-svg').first()).toBeVisible({ timeout: 10000 });
    const bars = await page.locator('#compare-chart-container .barlayer path').count();
    expect(bars).toBeGreaterThan(0);
  });

  test('distribution chart renders a donut chart', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="distribution"]')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Distribution")');

    await expect(page.locator('#distribution-chart-container svg.main-svg').first()).toBeVisible({ timeout: 10000 });
    const slices = await page.locator('#distribution-chart-container .slice').count();
    expect(slices).toBeGreaterThan(0);
  });

  test('timeline and daily charts render from historical data', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="timeline"]')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Timeline")');
    await expect(page.locator('#timeline-chart-container svg.main-svg').first()).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.subnav-btn[data-tab="calendar"]')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Daily")');
    await expect(page.locator('#calendar-container svg.main-svg').first()).toBeVisible({ timeout: 10000 });
  });
});