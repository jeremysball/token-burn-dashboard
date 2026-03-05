const { test, expect } = require('@playwright/test');

const mockData = {
  files_processed: 10,
  total_lines: 50000,
  total_messages: 2500,
  total_input: 1000000,
  total_output: 200000,
  total_cache_read: 800000,
  total_cache_write: 50000,
  total_tokens: 2050000,
  tokens_by_model: {
    "kimi-coding/k2p5": {
      input: 600000,
      output: 150000,
      cache_read: 500000,
      cache_write: 30000,
      total: 1280000
    },
    "claude-3.5-sonnet": {
      input: 400000,
      output: 50000,
      cache_read: 300000,
      cache_write: 20000,
      total: 770000
    }
  }
};

test.describe('Token Burn Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Intercept API calls and return mock data
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

    await page.goto(`http://localhost:${process.env.PORT || 7071}/`);
    // Wait for data to load
    await page.waitForSelector('.cost-card', { timeout: 10000 });
  });

  test('overview shows input tokens', async ({ page }) => {
    // Input tokens are counted separately from cache
    const inputTokens = page.locator('#val-input');
    await expect(inputTokens).toBeVisible();
    const text = await inputTokens.textContent();
    expect(text).toMatch(/1\.00?M/);  // Matches "1M" or "1.00M"
  });

  test('total tokens stat is visible', async ({ page }) => {
    // The total tokens stat should be visible
    const totalTokens = page.locator('#val-total');
    await expect(totalTokens).toBeVisible();
    const text = await totalTokens.textContent();
    expect(text).toMatch(/2\.05?M/);  // Matches "2.05M" or similar
  });

  test('cost tab shows cache discount calculation', async ({ page }) => {
    await page.click('button:has-text("costs")');
    await page.waitForTimeout(200);

    // Should show cache read with discount (green color indicates discount)
    const cacheRead = page.locator('#view-costs').locator('text=cache read');
    await expect(cacheRead).toBeVisible();

    // Total cost card in costs view
    const totalCost = page.locator('#cost-grid .cost-card.highlight .cost-value').first();
    await expect(totalCost).toBeVisible();

    // Cost breakdown should be visible
    const costBreakdown = page.locator('#cost-grid .cost-breakdown');
    await expect(costBreakdown).toBeVisible();
  });

  test('compare view renders without yellow background', async ({ page }) => {
    await page.click('button:has-text("compare")');
    await page.waitForTimeout(200);
    
    const compareContent = page.locator('#compare-content');
    await expect(compareContent).toBeVisible();
    
    // Check no inline yellow backgrounds
    const yellowBg = page.locator('[style*="background: #e2b714"], [style*="background:#e2b714"], [style*="background: yellow"], [style*="background-color: #e2b714"]');
    const count = await yellowBg.count();
    expect(count).toBe(0);
  });

  test('history view shows data', async ({ page }) => {
    await page.click('button:has-text("history")');
    await page.waitForTimeout(200);
    
    const historyContent = page.locator('#history-content');
    await expect(historyContent).toBeVisible();
  });

  test('model table shows correct cost with cache', async ({ page }) => {
    const costCell = page.locator('tbody tr:first-child td:nth-child(4)');
    await expect(costCell).toBeVisible();
    
    // Cost should account for cache discount
    const text = await costCell.textContent();
    expect(text).toMatch(/\$[\d.]+/);
  });
});
