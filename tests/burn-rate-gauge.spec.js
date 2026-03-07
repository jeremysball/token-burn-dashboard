const { test, expect } = require('@playwright/test');
const { mockData } = require('./mock-data');

test.describe('Burn Rate Gauge Feature', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept API calls with mock data
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
      const now = Date.now();
      const hour = 60 * 60 * 1000;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { time: now - hour * 12, total: 50000, input: 30000, output: 20000, cache_read: 10000, models: { "kimi-coding/k2p5": 30000 } },
          { time: now - hour * 11, total: 80000, input: 50000, output: 30000, cache_read: 15000, models: { "kimi-coding/k2p5": 50000 } },
          { time: now - hour * 10, total: 120000, input: 70000, output: 50000, cache_read: 20000, models: { "kimi-coding/k2p5": 70000 } },
          { time: now - hour * 9, total: 180000, input: 100000, output: 80000, cache_read: 30000, models: { "kimi-coding/k2p5": 100000 } },
          { time: now - hour * 8, total: 250000, input: 140000, output: 110000, cache_read: 40000, models: { "kimi-coding/k2p5": 140000 } },
          { time: now - hour * 7, total: 350000, input: 200000, output: 150000, cache_read: 55000, models: { "kimi-coding/k2p5": 200000 } },
          { time: now - hour * 6, total: 500000, input: 280000, output: 220000, cache_read: 80000, models: { "kimi-coding/k2p5": 280000 } },
          { time: now - hour * 5, total: 700000, input: 400000, output: 300000, cache_read: 110000, models: { "kimi-coding/k2p5": 400000 } },
          { time: now - hour * 4, total: 950000, input: 550000, output: 400000, cache_read: 150000, models: { "kimi-coding/k2p5": 550000 } },
          { time: now - hour * 3, total: 1250000, input: 720000, output: 530000, cache_read: 200000, models: { "kimi-coding/k2p5": 720000 } },
          { time: now - hour * 2, total: 1600000, input: 920000, output: 680000, cache_read: 260000, models: { "kimi-coding/k2p5": 920000 } },
          { time: now - hour, total: 2050000, input: 1200000, output: 850000, cache_read: 450000, models: { "kimi-coding/k2p5": 1280000 } }
        ])
      });
    });
  });

  test('Burn rate gauge is visible on dashboard', async ({ page }) => {
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.hero-stat.burn-rate', { timeout: 10000 });
    
    // Take screenshot of hero section
    const heroSection = await page.locator('.hero-section');
    await heroSection.screenshot({ path: 'test-results/burn-rate-hero-section.png' });
    
    // Verify burn rate elements exist
    const burnRateStat = await page.locator('.hero-stat.burn-rate');
    await expect(burnRateStat).toBeVisible();
    
    const burnRateLabel = await page.locator('.burn-rate-badge');
    await expect(burnRateLabel).toBeVisible();
    
    const burnRateValue = await page.locator('#burn-rate');
    await expect(burnRateValue).toBeVisible();
    
    const burnRateHeatmap = await page.locator('#burn-rate-heatmap');
    await expect(burnRateHeatmap).toBeVisible();
    
    // Take full dashboard screenshot
    await page.screenshot({ path: 'test-results/burn-rate-full-dashboard.png', fullPage: false });
  });

  test('Burn rate gauge shows correct styling', async ({ page }) => {
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.hero-stat.burn-rate', { timeout: 10000 });
    await page.waitForTimeout(2000); // Let animations settle
    
    // Check heatmap cells are rendered
    const heatmapCells = await page.locator('.heatmap-cell').count();
    expect(heatmapCells).toBeGreaterThan(0);
    
    // Take close-up of burn rate section
    const burnRateSection = await page.locator('.hero-stat.burn-rate');
    await burnRateSection.screenshot({ path: 'test-results/burn-rate-closeup.png' });
    
    // Verify the label text
    const burnRateValue = await page.locator('#burn-rate');
    const text = await burnRateValue.textContent();
    console.log('Burn rate text:', text);
    expect(text).toMatch(/\d+/); // Should contain a number
  });

  test('Burn rate gauge on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.hero-stat.burn-rate', { timeout: 10000 });
    await page.waitForTimeout(1000);
    
    // Take mobile screenshot
    await page.screenshot({ path: 'test-results/burn-rate-mobile.png', fullPage: false });
    
    // Verify burn rate is visible on mobile
    const burnRateStat = await page.locator('.hero-stat.burn-rate');
    await expect(burnRateStat).toBeVisible();
  });

  test('Burn rate updates with live data', async ({ page }) => {
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.hero-stat.burn-rate', { timeout: 10000 });
    
    // Get initial value
    const burnRateValue = await page.locator('#burn-rate');
    const initialText = await burnRateValue.textContent();
    
    // Wait a bit for potential updates
    await page.waitForTimeout(3000);
    
    // Take screenshot showing live state
    await page.screenshot({ path: 'test-results/burn-rate-live.png', fullPage: false });
    
    // Verify value is still showing (not empty)
    const currentText = await burnRateValue.textContent();
    expect(currentText).toMatch(/\d+/);
  });
});
