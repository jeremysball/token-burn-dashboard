const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function evaluateDashboards() {
  const dashboards = {
    'prototype': 'file:///workspace/token-burn-dashboard-model-faceoff/prototype.html'
  };
  
  const results = {};
  
  const browser = await chromium.launch();
  
  for (const [name, url] of Object.entries(dashboards)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Evaluating: ${name}`);
    console.log('='.repeat(60));
    
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    
    // Capture console logs
    const logs = [];
    page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => logs.push(`error: ${err.message}`));
    
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000); // Let animations settle
      
      // Take screenshot
      const screenshotPath = `/workspace/token-burn-dashboard-model-faceoff/${name}-screenshot.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`✓ Screenshot saved: ${screenshotPath}`);
      
      // Evaluate metrics
      const metrics = await page.evaluate(() => ({
        title: document.title,
        viewport: {
          width: window.innerWidth,
          height: document.body.scrollHeight
        },
        elementCount: document.querySelectorAll('*').length,
        hasCharts: !!document.querySelector('canvas') || !!document.querySelector('svg'),
        hasInteractiveElements: document.querySelectorAll('button, select, input').length,
        hasHoverEffects: !!document.querySelector('[class*="hover"], [style*="hover"]'),
        hasAnimations: !!document.querySelector('[class*="animation"], [class*="animate"], [class*="pulse"], [class*="float"]'),
        externalDeps: [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => !s.includes('localhost') && !s.startsWith('file://')),
        cssVars: [...document.styleSheets].flatMap(s => {
          try {
            return [...s.cssRules].filter(r => r.type === 1).map(r => r.selectorText);
          } catch { return []; }
        }).length
      }));
      
      results[name] = { metrics, logs, screenshot: screenshotPath };
      
      console.log(`  Title: ${metrics.title}`);
      console.log(`  Page height: ${metrics.viewport.height}px`);
      console.log(`  Elements: ${metrics.elementCount}`);
      console.log(`  Charts: ${metrics.hasCharts}`);
      console.log(`  Interactive elements: ${metrics.hasInteractiveElements}`);
      console.log(`  Hover effects: ${metrics.hasHoverEffects}`);
      console.log(`  Animations: ${metrics.hasAnimations}`);
      console.log(`  CSS rules: ${metrics.cssVars}`);
      console.log(`  External deps: ${metrics.externalDeps.length ? metrics.externalDeps.join(', ') : 'None'}`);
      
      const errors = logs.filter(l => l.toLowerCase().includes('error'));
      if (errors.length) {
        console.log(`  ⚠ Console errors: ${errors.length}`);
        errors.slice(0, 3).forEach(e => console.log(`    - ${e}`));
      }
      
    } catch (e) {
      console.log(`✗ Error: ${e.message}`);
      results[name] = { error: e.message };
    } finally {
      await page.close();
    }
  }
  
  await browser.close();
  
  // Summary comparison
  console.log(`\n${'='.repeat(60)}`);
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(60));
  
  for (const [name, data] of Object.entries(results)) {
    if (data.metrics) {
      const m = data.metrics;
      console.log(`\n${name.toUpperCase()}:`);
      console.log(`  ✓ Visual complexity: ${m.elementCount} elements, ${m.cssVars} CSS rules`);
      console.log(`  ✓ Visual polish: ${m.hasAnimations ? 'Animations ✓' : ''} ${m.hasHoverEffects ? 'Hover effects ✓' : ''}`);
      console.log(`  ✓ Data viz: ${m.hasCharts ? 'Charts ✓' : 'No charts'}`);
      console.log(`  ✓ Interactivity: ${m.hasInteractiveElements} interactive elements`);
      console.log(`  ✓ Dependencies: ${m.externalDeps.length ? 'External deps ✗' : 'Self-contained ✓'}`);
    }
  }
  
  console.log('\n\n📸 Screenshots captured for visual review!');
  
  return results;
}

evaluateDashboards().catch(console.error);
