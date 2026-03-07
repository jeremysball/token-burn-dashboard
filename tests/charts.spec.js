const { test, expect } = require('@playwright/test');
const { mockData } = require('./mock-data');

test.describe('Chart Rendering Tests', () => {
  test.beforeEach(async ({ page }) => {
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

  test('Donut chart renders with paths', async ({ page }) => {
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    
    await page.click('button:has-text("charts")');
    await page.waitForTimeout(500);
    
    // Check for SVG paths in donut chart
    const paths = await page.locator('#chart-distribution svg path').all();
    expect(paths.length).toBeGreaterThan(0);
    
    await page.screenshot({ path: 'test-results/chart-donut-desktop.png' });
  });

  test('Sparkline renders in stats cards', async ({ page }) => {
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    await page.waitForTimeout(500);
    
    // Check sparklines in table
    const sparklines = await page.locator('.sparkline').all();
    expect(sparklines.length).toBeGreaterThan(0);
    
    await page.screenshot({ path: 'test-results/chart-sparkline-desktop.png' });
  });

  test('Compare bars render correctly', async ({ page }) => {
    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    await page.waitForSelector('.cost-card', { timeout: 10000 });
    
    await page.click('button:has-text("compare")');
    await page.waitForTimeout(500);
    
    const bars = await page.locator('.compare-bar').all();
    expect(bars.length).toBeGreaterThan(0);
    
    await page.screenshot({ path: 'test-results/chart-compare-desktop.png' });
  });
});
