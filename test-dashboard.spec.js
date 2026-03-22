const { test, expect } = require('@playwright/test');
const { routeDashboardApis } = require('./tests/playwright-fixtures');

test.describe('Token Burn Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await routeDashboardApis(page);
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await expect(page.locator('#hero-tokens')).toBeVisible({ timeout: 10000 });
  });

  test('renders the dashboard hero stats', async ({ page }) => {
    await expect(page.locator('#hero-tokens')).toContainText('2.05M');
    await expect(page.locator('#hero-cost')).toContainText('$');
    await expect(page.locator('#burn-rate')).toContainText('/min');
    await expect(page.locator('.top-model-card')).toHaveCount(2);
    await expect(page.locator('.insight-card')).toHaveCount(4);
  });

  test('shows the live chart and sparkline widgets', async ({ page }) => {
    await expect(page.locator('#dashboard-live-chart')).toBeVisible();
    await expect(page.locator('#hero-spark-tokens .sparkline')).toHaveCount(1);
    await expect(page.locator('#hero-spark-cost .sparkline')).toHaveCount(1);
  });

  test('analytics models tab renders rows and sparklines', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="models"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#models-tbody tr')).toHaveCount(2, { timeout: 10000 });
    await expect(page.locator('#models-tbody')).toContainText('k2p5');
    await expect(page.locator('#models-tbody .sparkline')).toHaveCount(2);
  });

  test('compare and distribution charts render', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="compare"]')).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("Compare")');
    await expect(page.locator('#compare-chart-container svg.main-svg')).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("Distribution")');
    await expect(page.locator('#distribution-chart-container svg.main-svg')).toBeVisible({ timeout: 10000 });
  });

  test('timeline, daily, git, and spike tabs load', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="timeline"]')).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("Timeline")');
    await expect(page.locator('#timeline-chart-container svg.main-svg')).toBeVisible({ timeout: 10000 });

    await page.click('button:has-text("Daily")');
    await expect(page.locator('#calendar-container svg.main-svg')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.subnav-btn[data-tab="git"]')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Git Blame")');
    await expect(page.locator('#git-commits-list .git-commit-item')).toHaveCount(2, { timeout: 10000 });
    await expect(page.locator('#git-files-list .git-file-item')).toHaveCount(3);

    await expect(page.locator('.subnav-btn[data-tab="spikes"]')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Spikes")');
    await expect(page.locator('#spikes-list .spike-item')).toHaveCount(2, { timeout: 10000 });
  });
});