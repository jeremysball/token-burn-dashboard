const { test, expect } = require('@playwright/test');
const { routeDashboardApis } = require('./playwright-fixtures');

test.describe('Mobile Responsive Tests', () => {
  test.beforeEach(async ({ page }) => {
    await routeDashboardApis(page);
  });

  test('iPhone SE - dashboard fits without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await expect(page.locator('#hero-tokens')).toBeVisible({ timeout: 10000 });

    const body = page.locator('body');
    const scrollWidth = await body.evaluate(el => el.scrollWidth);
    const clientWidth = await body.evaluate(el => el.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth * 1.1);
  });

  test('iPhone 14 Pro - dashboard cards stack cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await expect(page.locator('.hero-stat')).toHaveCount(3, { timeout: 10000 });
    await expect(page.locator('.top-model-card')).toHaveCount(2);
  });

  test('Samsung Galaxy S8+ - analytics table stays readable', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="models"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.mono-table')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#models-tbody tr')).toHaveCount(2);
  });

  test('iPad Mini - chart tabs render on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="compare"]')).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("Compare")');
    await expect(page.locator('#compare-chart-container svg.main-svg').first()).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("Distribution")');
    await expect(page.locator('#distribution-chart-container svg.main-svg').first()).toBeVisible({ timeout: 10000 });
  });

  test('Pixel 7 - analytics controls stay accessible', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="models"]')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.controls-bar')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.subnav-btn')).toHaveCount(11);
  });

  test('Mobile - git blame and spikes are reachable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="git"]')).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("Git Blame")');
    await expect(page.locator('#git-commits-list .git-commit-item')).toHaveCount(2, { timeout: 10000 });

    await expect(page.locator('.subnav-btn[data-tab="spikes"]')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Spikes")');
    await expect(page.locator('#spikes-list .spike-item')).toHaveCount(2, { timeout: 10000 });
  });
});