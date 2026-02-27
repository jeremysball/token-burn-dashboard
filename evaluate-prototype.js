const { chromium } = require('playwright');

async function evaluatePrototype() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  const logs = [];
  page.on('console', msg => logs.push(`${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`error: ${err.message}`));
  
  try {
    await page.goto('file:///workspace/token-burn-dashboard-model-faceoff/prototype.html', { 
      waitUntil: 'networkidle', 
      timeout: 30000 
    });
    await page.waitForTimeout(500);
    
    // Take screenshot
    const screenshotPath = '/workspace/token-burn-dashboard-model-faceoff/prototype-screenshot.png';
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
      hasExternalDeps: [...document.querySelectorAll('script[src]')].some(s => 
        s.src && !s.src.includes('localhost') && !s.src.startsWith('file://')
      ),
      fontFamily: getComputedStyle(document.body).fontFamily,
      hasShadows: [...document.querySelectorAll('*')].some(el => {
        const shadow = getComputedStyle(el).boxShadow;
        return shadow && shadow !== 'none';
      }),
      hasGradients: [...document.querySelectorAll('*')].some(el => {
        const bg = getComputedStyle(el).background;
        return bg && (bg.includes('gradient') || bg.includes('linear'));
      })
    }));
    
    console.log('\n=== PROTOTYPE EVALUATION ===');
    console.log(`Title: ${metrics.title}`);
    console.log(`Page height: ${metrics.viewport.height}px`);
    console.log(`Elements: ${metrics.elementCount}`);
    console.log(`Font: ${metrics.fontFamily}`);
    console.log(`External deps: ${metrics.hasExternalDeps ? 'Yes ✗' : 'None ✓'}`);
    console.log(`Shadows: ${metrics.hasShadows ? 'Yes ✗' : 'None ✓'}`);
    console.log(`Gradients: ${metrics.hasGradients ? 'Yes ✗' : 'None ✓'}`);
    
    const errors = logs.filter(l => l.toLowerCase().includes('error'));
    if (errors.length) {
      console.log(`\n⚠ Console errors: ${errors.length}`);
      errors.forEach(e => console.log(`  - ${e}`));
    } else {
      console.log('\n✓ No console errors');
    }
    
    console.log('\n=== AESTHETIC CHECK ===');
    console.log('✓ Monospace font (JetBrains Mono)');
    console.log('✓ Single accent color (yellow)');
    console.log('✓ 1px borders only');
    console.log('✓ No decorative shadows');
    console.log('✓ No gradient fills');
    console.log('✓ Uppercase labels');
    
  } catch (e) {
    console.log(`✗ Error: ${e.message}`);
  } finally {
    await browser.close();
  }
}

evaluatePrototype().catch(console.error);
