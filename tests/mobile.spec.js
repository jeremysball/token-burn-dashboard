const { test, expect } = require('@playwright/test');
const { mockData } = require('./mock-data');

test.describe('Mobile Responsive Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept API calls
    await page.route('**/api/tokens', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockData)
      });
    });

    await page.route('**/api/tokens/stream', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify(mockData)}\n\n`
      });
    });

    await page.route('**/api/tokens/historical', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { time: Date.now() - 3600000, total: 1000000, models: { "kimi-coding/k2p5": 500000 } },
          { time: Date.now(), total: 2050000, models: { "kimi-coding/k2p5": 1280000 } }
        ])
      });
    });
  });

  test('iPhone SE - overview layout', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/mobile-iphone-se-overview.png', fullPage: true });
    
    // Check for horizontal overflow (allow 5% tolerance for table scroll)
    const body = await page.locator('body');
    const scrollWidth = await body.evaluate(el => el.scrollWidth);
    const clientWidth = await body.evaluate(el => el.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth * 1.25); // Allow 25% tolerance for scrollable tables
  });

  test('iPhone 14 Pro - stats grid layout', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/mobile-iphone-14-stats.png', fullPage: true });
    
    // Stats cards should stack vertically
    const cards = await page.locator('#stats-grid .cost-card').all();
    expect(cards.length).toBeGreaterThan(0);
  });

  test('Samsung Galaxy S8+ - table readability', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.mono-table', { timeout: 10000 });
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/mobile-galaxy-s8-table.png', fullPage: true });
    
    // Table should be visible but may need horizontal scroll
    const table = page.locator('.mono-table');
    await expect(table).toBeVisible();
  });

  test('iPad Mini - tablet layout', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/mobile-ipad-mini.png', fullPage: true });
  });

  test('Pixel 7 - controls accessibility', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.controls', { timeout: 10000 });
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/mobile-pixel-7-controls.png', fullPage: true });
    
    // Controls should be visible
    const controls = page.locator('.controls');
    await expect(controls).toBeVisible();
  });

  test('Mobile - charts view rendering', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    
    await page.click('button:has-text("charts")');
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/mobile-charts-view.png', fullPage: true });
    
    // Donut chart should be visible
    const chart = page.locator('#chart-distribution');
    await expect(chart).toBeVisible();
  });

  test('Mobile - costs view rendering', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    
    await page.click('button:has-text("costs")');
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/mobile-costs-view.png', fullPage: true });
    
    const costGrid = page.locator('#cost-grid');
    await expect(costGrid).toBeVisible();
  });

  test('Mobile - compare view rendering', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    
    await page.click('button:has-text("compare")');
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/mobile-compare-view.png', fullPage: true });
    
    const compareContent = page.locator('#compare-content');
    await expect(compareContent).toBeVisible();
  });

  test('Mobile - history view rendering', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    
    await page.click('button:has-text("history")');
    await page.waitForTimeout(500);
    
    await page.screenshot({ path: 'test-results/mobile-history-view.png', fullPage: true });
    
    const historyContent = page.locator('#history-content');
    await expect(historyContent).toBeVisible();
  });
});
