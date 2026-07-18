const { test, expect } = require('@playwright/test');
test('no horizontal overflow critical selectors', async ({ page }) => {
  await page.goto('http://localhost:7071/');
  await page.waitForSelector('#hero-tokens');
  const critical = ['.scale-number','.daily-heatmap-val','.heatmap-y-label','.top-model-name','.mono-dashboard'];
  for (const sel of critical) {
    const overflows = await page.$$eval(sel, els => els.map(el=>({cls:el.className, scroll:el.scrollWidth, client:el.clientWidth, text:el.textContent?.slice(0,50)})));
    for (const o of overflows) {
      expect(o.scroll, `overflow ${o.cls} ${o.text}`).toBeLessThanOrEqual(o.client+2);
    }
  }
});
test('screenshots desktop+mobile', async ({ page }) => {
  await page.goto('http://localhost:7071/');
  await page.screenshot({path:'test-results/dashboard.png', fullPage:true});
  await page.setViewportSize({width:375, height:800});
  await page.screenshot({path:'test-results/mobile.png', fullPage:true});
});