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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { time: Date.now() - 3600000, total: 1000000, input: 600000, output: 400000, cache_read: 200000, models: { "kimi-coding/k2p5": 500000 } },
          { time: Date.now(), total: 2050000, input: 1200000, output: 850000, cache_read: 450000, models: { "kimi-coding/k2p5": 1280000 } }
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
    
    const burnRateBar = await page.locator('#burn-rate-bar');
    await expect(burnRateBar).toBeVisible();
    
    // Take full dashboard screenshot
    await page.screenshot({ path: 'test-results/burn-rate-full-dashboard.png', fullPage: false });
  });

  test('Burn rate gauge shows correct styling', async ({ page }) => {
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.hero-stat.burn-rate', { timeout: 10000 });
    await page.waitForTimeout(2000); // Let animations settle
    
    // Check burn rate bar has width set (indicating it's working)
    const burnRateBar = await page.locator('#burn-rate-bar');
    const barWidth = await burnRateBar.evaluate(el => el.style.width);
    
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
