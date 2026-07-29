# Cache Savings Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new dashboard section, below the hero cards, showing what caching has actually saved and letting the user drag a slider from the real cache-hit rate down toward 0% to see the dollar figure shrink live — a pure client-side "what-if" recompute, no new backend endpoint.

**Architecture:** A pure calculation module (`dashboard/js/cache-scenario.js`) computes paid/saved dollars for an arbitrary hit-rate percentage from the same `currentData` already in `dashboard/js/state.js` (`tokens_by_model`, `pricing_by_model`). A separate DOM module (`dashboard/js/cache-slider.js`) builds the section once and re-renders its readout on every `renderDashboard()` call, without resetting the slider's position if the user has already dragged it.

**Tech Stack:** Vanilla ES modules, `<input type="range">`, `bun:test` + `happy-dom`.

## Global Constraints

- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 2 ("Cache savings slider").
- No new backend endpoint or route — every number this widget shows is derivable from the `/api/tokens` response already cached in `currentData`.
- Per-model pricing, not one blended rate: this mirrors the existing per-model cache-savings computation in `dashboard/js/views/analytics/tabs/insights.js`'s `calculateDeepInsights()` (`perModelCacheSavings` loop), which already established the "skip a model with unusable pricing rather than fabricate a number" convention this plan follows too.
- Dollar figures the widget shows are always self-consistent with `total_cost` at the slider's *current real* position (100% of the real hit rate), since they're computed from the same per-model pricing table.

---

### Task 1: `cache-scenario.js` — pure what-if calculation

**Files:**
- Create: `dashboard/js/cache-scenario.js`
- Test: `tests/unit/cache-scenario.test.js`

**Interfaces:**
- Produces:
  - `getRealCacheHitRatePct(currentData): number` — `total_cache_read / (total_input + total_cache_read) * 100`, or `0` if there's no cacheable volume yet.
  - `computeCacheScenario(currentData, hitRatePct): {paid: number, paidAtZeroPct: number, savedVsNoCache: number, paidPct: number}` — recomputes total spend as if the fleet's blended cache-hit rate were `hitRatePct` instead of whatever it actually was, holding output/cache-write/reasoning cost fixed (those aren't affected by the input-caching mix) and only re-blending the input-vs-cache-read split for each model's cacheable tokens (`input + cache_read`). Models with unusable pricing (`pricing_by_model[name]` missing `input`/`cacheRead` as finite numbers) are skipped, same convention as `calculateDeepInsights()`'s `perModelCacheSavings` loop. `paidPct` is clamped to `[2, 98]` so the "paid" bar segment never visually collapses to nothing (matches the mockup's bar-rendering clamp).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/cache-scenario.test.js
import { describe, expect, it } from 'bun:test';
import { getRealCacheHitRatePct, computeCacheScenario } from '../../dashboard/js/cache-scenario.js';

const onModelData = (overrides = {}) => ({
  total_input: 1_000_000,
  total_cache_read: 99_000_000,
  tokens_by_model: {
    'anthropic/claude-sonnet-5': {
      input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000
    }
  },
  pricing_by_model: {
    'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  },
  ...overrides
});

describe('getRealCacheHitRatePct', () => {
  it('computes the blended real hit rate as a percentage', () => {
    expect(getRealCacheHitRatePct(onModelData())).toBeCloseTo(99, 1);
  });

  it('returns 0 when there is no cacheable volume yet', () => {
    expect(getRealCacheHitRatePct({ total_input: 0, total_cache_read: 0 })).toBe(0);
  });
});

describe('computeCacheScenario', () => {
  it('at the real hit rate, "paid" matches what the fleet actually spent on cacheable tokens', () => {
    const data = onModelData();
    const realRate = getRealCacheHitRatePct(data);
    const scenario = computeCacheScenario(data, realRate);

    // input(1M)@$3 + cacheRead(99M)@$0.3 + output(0.5M)@$15 + cacheWrite(0.2M)@$3.75
    const expectedPaid = (1_000_000 / 1e6) * 3 + (99_000_000 / 1e6) * 0.3 + (500_000 / 1e6) * 15 + (200_000 / 1e6) * 3.75;
    expect(scenario.paid).toBeCloseTo(expectedPaid, 2);
  });

  it('at 0% hit rate, every cacheable token is billed at the full input rate', () => {
    const data = onModelData();
    const scenario = computeCacheScenario(data, 0);

    const cacheableTokens = 1_000_000 + 99_000_000;
    const expectedPaid = (cacheableTokens / 1e6) * 3 + (500_000 / 1e6) * 15 + (200_000 / 1e6) * 3.75;
    expect(scenario.paid).toBeCloseTo(expectedPaid, 2);
    expect(scenario.savedVsNoCache).toBeCloseTo(0, 5);
  });

  it('reports positive savings at a hit rate above 0%', () => {
    const data = onModelData();
    const scenario = computeCacheScenario(data, 80);
    expect(scenario.savedVsNoCache).toBeGreaterThan(0);
  });

  it('skips a model with unusable pricing rather than fabricating a number', () => {
    const data = onModelData({
      pricing_by_model: {
        'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheWrite: 3.75 } // cacheRead missing
      }
    });
    const scenario = computeCacheScenario(data, 50);
    expect(scenario.paid).toBe(0);
    expect(scenario.savedVsNoCache).toBe(0);
  });

  it('clamps paidPct into [2, 98] so the bar never visually collapses', () => {
    const data = onModelData({
      total_input: 1,
      total_cache_read: 999_999_999,
      tokens_by_model: {
        'anthropic/claude-sonnet-5': { input: 1, cache_read: 999_999_999, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000_000 }
      }
    });
    const scenario = computeCacheScenario(data, 99.99999);
    expect(scenario.paidPct).toBeGreaterThanOrEqual(2);
    expect(scenario.paidPct).toBeLessThanOrEqual(98);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/cache-scenario.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/cache-scenario.js'`

- [ ] **Step 3: Write the module**

```js
// dashboard/js/cache-scenario.js
/**
 * Blended real cache-hit rate across the whole fleet, as a percentage.
 * @param {{total_input?: number, total_cache_read?: number}|null} currentData
 * @returns {number}
 */
export function getRealCacheHitRatePct(currentData) {
    const input = currentData?.total_input || 0;
    const cacheRead = currentData?.total_cache_read || 0;
    const total = input + cacheRead;
    return total > 0 ? (cacheRead / total) * 100 : 0;
}

/**
 * Recompute total spend as if the fleet's blended cache-hit rate were
 * hitRatePct instead of whatever it actually was. Output/cache-write/
 * reasoning cost stay fixed per model (unaffected by the input-caching
 * mix); only each model's cacheable tokens (input + cache_read) are
 * re-blended between the input rate and the cache-read rate.
 * @param {{tokens_by_model?: Record<string, any>, pricing_by_model?: Record<string, any>}|null} currentData
 * @param {number} hitRatePct
 * @returns {{paid: number, paidAtZeroPct: number, savedVsNoCache: number, paidPct: number}}
 */
export function computeCacheScenario(currentData, hitRatePct) {
    const models = Object.entries(currentData?.tokens_by_model || {});
    const pricingByModel = currentData?.pricing_by_model || {};
    const h = Math.max(0, Math.min(100, hitRatePct)) / 100;

    let paid = 0;
    let paidAtZeroPct = 0;
    let coverage = false;

    for (const [name, stats] of models) {
        const pricing = pricingByModel[name];
        const inputRate = Number(pricing?.input);
        const cacheReadRate = Number(pricing?.cacheRead);
        if (!Number.isFinite(inputRate) || !Number.isFinite(cacheReadRate)) continue;
        coverage = true;

        const outputRate = Number(pricing?.output);
        const cacheWriteRate = Number(pricing?.cacheWrite);
        const input = Number(stats.input) || 0;
        const cacheRead = Number(stats.cache_read) || 0;
        const output = Number(stats.output) || 0;
        const cacheWrite = Number(stats.cache_write) || 0;

        const fixedCost = (output / 1e6) * (Number.isFinite(outputRate) ? outputRate : 0)
            + (cacheWrite / 1e6) * (Number.isFinite(cacheWriteRate) ? cacheWriteRate : 0);

        const cacheableTokens = input + cacheRead;
        const cachedTokens = cacheableTokens * h;
        const uncachedTokens = cacheableTokens - cachedTokens;

        paid += fixedCost + (uncachedTokens / 1e6) * inputRate + (cachedTokens / 1e6) * cacheReadRate;
        paidAtZeroPct += fixedCost + (cacheableTokens / 1e6) * inputRate;
    }

    if (!coverage) return { paid: 0, paidAtZeroPct: 0, savedVsNoCache: 0, paidPct: 0 };

    const savedVsNoCache = paidAtZeroPct - paid;
    const paidPct = paidAtZeroPct > 0 ? Math.max(2, Math.min(98, (paid / paidAtZeroPct) * 100)) : 50;

    return { paid, paidAtZeroPct, savedVsNoCache, paidPct };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/cache-scenario.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add dashboard/js/cache-scenario.js tests/unit/cache-scenario.test.js
git commit -m "feat(dashboard): add cache what-if scenario calculation"
```

---

### Task 2: Cache savings section — markup, styling, and slider wiring

**Files:**
- Create: `dashboard/js/cache-slider.js`
- Modify: `dashboard/index.html`
- Modify: `dashboard/js/views/dashboard.js`
- Modify: `dashboard/styles/design-v2.css`
- Test: `tests/unit/cache-slider.test.js`

**Interfaces:**
- Consumes: `getRealCacheHitRatePct`, `computeCacheScenario` from `dashboard/js/cache-scenario.js` (Task 1); `fmtCur` from `dashboard/js/utils.js`.
- Produces: `renderCacheSlider(container: HTMLElement, currentData): void` — called on every `renderDashboard()`. Builds the section's DOM once (guarded by `container.dataset.cacheSliderBuilt`), then on every call: updates the slider's `max` to the current real hit rate, snaps the slider's value to the real rate only if the user hasn't manually dragged it yet (`container.dataset.userMoved !== 'true'`), and re-renders the dollar readout at whatever hit-rate percentage the slider is currently at — so a user's in-progress drag survives the next SSE-driven re-render instead of snapping back.

- [ ] **Step 1: Add the section markup**

In `dashboard/index.html`, insert a new section between the hero section (`dashboard/index.html:42-64`) and the chart section (`dashboard/index.html:66-73`):

```html
            <!-- Cache Savings -->
            <section class="cache-savings-section" id="cache-savings-section"></section>
```

- [ ] **Step 2: Add cache-hero CSS**

In `dashboard/styles/design-v2.css`, add after the odometer CSS block introduced by the literal-odometer plan (or after the `.equiv-ticker` block if the odometer plan hasn't landed yet in this worktree):

```css
.cache-hero {
  background: var(--mono-surface);
  border: 1px solid var(--mono-border-accent);
  border-radius: var(--radius-lg);
  padding: 22px 24px;
  margin-bottom: 24px;
}
.cache-hero-top { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
.cache-hero-label { font-size: 0.61rem; letter-spacing: 0.14em; color: var(--mono-text-muted); text-transform: uppercase; }
.cache-hero-value { font-size: clamp(1.8rem, 3.4vw, 2.6rem); font-weight: 700; letter-spacing: -0.05em; color: var(--mono-accent); font-variant-numeric: tabular-nums; }
.cache-hero-value small { font-size: 0.5em; color: var(--mono-text-muted); font-weight: 500; letter-spacing: 0; margin-left: 6px; }
.cache-bar-wrap { position: relative; height: 34px; background: var(--mono-bg); border: 1px solid var(--mono-border); margin-bottom: 14px; }
.cache-bar-paid { position: absolute; inset: 0; background: var(--mono-text-dim); opacity: 0.35; width: var(--paid-pct, 28%); }
.cache-bar-avoided { position: absolute; top: 0; bottom: 0; left: var(--paid-pct, 28%); right: 0; background: repeating-linear-gradient(45deg, var(--mono-accent-dim) 0 6px, transparent 6px 12px); border-left: 2px dashed var(--mono-accent); }
.cache-bar-labels { display: flex; justify-content: space-between; font-size: 0.68rem; color: var(--mono-text-muted); margin-bottom: 20px; }
.cache-bar-labels b { color: var(--mono-text); }
.cache-slider-row { display: flex; align-items: center; gap: 14px; font-size: 0.72rem; color: var(--mono-text-muted); }
.cache-slider-row input[type="range"] { flex: 1; appearance: none; height: 3px; background: var(--mono-border); outline: none; }
.cache-slider-row input[type="range"]::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; background: var(--mono-accent); cursor: pointer; }
.cache-slider-readout { font-family: inherit; color: var(--mono-text); font-weight: 700; min-width: 4.5em; text-align: right; }
```

- [ ] **Step 3: Write the failing tests**

```js
// tests/unit/cache-slider.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderCacheSlider } from '../../dashboard/js/cache-slider.js';

const dataAt = (hitRatePct) => {
  const cacheRead = hitRatePct * 1_000_000; // arbitrary scale
  const input = (100 - hitRatePct) * 1_000_000;
  return {
    total_input: input,
    total_cache_read: cacheRead,
    tokens_by_model: {
      'anthropic/claude-sonnet-5': { input, cache_read: cacheRead, output: 0, cache_write: 0, reasoning: 0, total: input + cacheRead }
    },
    pricing_by_model: {
      'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
    }
  };
};

describe('renderCacheSlider', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '<section id="cache-savings-section"></section>';
    container = document.getElementById('cache-savings-section');
  });

  it('builds the section once and defaults the slider to the real hit rate', () => {
    renderCacheSlider(container, dataAt(90));
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    expect(slider).not.toBeNull();
    expect(Number(slider.value)).toBeCloseTo(90, 0);
    expect(Number(slider.max)).toBeCloseTo(90, 0);
  });

  it('updates the dollar readout when the slider is dragged', () => {
    renderCacheSlider(container, dataAt(90));
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    const before = container.querySelector('#cacheSavedValue').textContent;

    slider.value = '10';
    slider.dispatchEvent(new Event('input'));

    const after = container.querySelector('#cacheSavedValue').textContent;
    expect(after).not.toBe(before);
  });

  it('does not snap the slider back to the real rate on a subsequent render after the user dragged it', () => {
    renderCacheSlider(container, dataAt(90));
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));

    slider.value = '10';
    slider.dispatchEvent(new Event('input'));

    renderCacheSlider(container, dataAt(91)); // a later SSE update nudges the real rate slightly

    expect(Number(slider.value)).toBeCloseTo(10, 0);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun test tests/unit/cache-slider.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/cache-slider.js'`

- [ ] **Step 5: Write the module**

```js
// dashboard/js/cache-slider.js
import { fmtCur } from './utils.js';
import { getRealCacheHitRatePct, computeCacheScenario } from './cache-scenario.js';

/** @type {any} */
let latestData = null;

/**
 * @param {HTMLElement} container
 */
function buildSection(container) {
    container.innerHTML = `
        <div class="cache-hero">
            <div class="cache-hero-top">
                <div>
                    <div class="cache-hero-label">caching has saved you</div>
                    <div class="cache-hero-value" id="cacheSavedValue">$0<small></small></div>
                </div>
                <div style="text-align:right;">
                    <div class="cache-hero-label">what you paid</div>
                    <div style="font-size:1.1rem; font-weight:700; color:var(--mono-text);" id="cachePaidValue">$0</div>
                </div>
            </div>
            <div class="cache-bar-wrap" id="cacheBarWrap">
                <div class="cache-bar-paid"></div>
                <div class="cache-bar-avoided"></div>
            </div>
            <div class="cache-bar-labels">
                <span><b>solid</b> = paid</span>
                <span><b>hatched</b> = avoided by caching</span>
            </div>
            <div class="cache-slider-row">
                <span>DRAG →</span>
                <input type="range" min="0" max="0" step="0.1" value="0" id="cacheSlider">
                <span class="cache-slider-readout" id="cacheReadout">0% hit rate</span>
            </div>
        </div>
    `;
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    slider.addEventListener('input', () => {
        slider.dataset.userMoved = 'true';
        renderReadout(container, parseFloat(slider.value));
    });
    container.dataset.cacheSliderBuilt = 'true';
}

/**
 * @param {HTMLElement} container
 * @param {number} hitRatePct
 */
function renderReadout(container, hitRatePct) {
    const scenario = computeCacheScenario(latestData, hitRatePct);
    const savedEl = container.querySelector('#cacheSavedValue');
    const paidEl = container.querySelector('#cachePaidValue');
    const readout = container.querySelector('#cacheReadout');
    const barWrap = /** @type {HTMLElement} */ (container.querySelector('#cacheBarWrap'));

    savedEl.innerHTML = `${fmtCur(scenario.savedVsNoCache)}<small>at ${hitRatePct.toFixed(1)}% hit rate</small>`;
    paidEl.textContent = fmtCur(scenario.paid);
    readout.textContent = `${hitRatePct.toFixed(1)}% hit rate`;
    barWrap.style.setProperty('--paid-pct', `${scenario.paidPct.toFixed(1)}%`);
}

/**
 * @param {HTMLElement} container
 * @param {any} currentData
 */
export function renderCacheSlider(container, currentData) {
    latestData = currentData;
    if (container.dataset.cacheSliderBuilt !== 'true') buildSection(container);

    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    const realRate = getRealCacheHitRatePct(currentData);
    slider.max = realRate.toFixed(1);
    if (slider.dataset.userMoved !== 'true') {
        slider.value = realRate.toFixed(1);
    } else if (parseFloat(slider.value) > realRate) {
        // The real rate itself dipped below where the user had dragged to —
        // clamp so the slider never reads a hit rate higher than reality allows.
        slider.value = realRate.toFixed(1);
    }
    renderReadout(container, parseFloat(slider.value));
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/unit/cache-slider.test.js`
Expected: PASS (3 tests)

- [ ] **Step 7: Call `renderCacheSlider` from `renderDashboard()`**

In `dashboard/js/views/dashboard.js`, add the import:

```js
import { renderCacheSlider } from '../cache-slider.js';
```

Inside `renderDashboard` (`dashboard/js/views/dashboard.js:28-91`), right after the `updateEquivTickers(...)` call added by the equivalence-ticker plan (or, if that plan hasn't landed yet, right after `updateBurnRateGauge();`), add:

```js
    const cacheSection = document.getElementById('cache-savings-section');
    if (cacheSection) renderCacheSlider(cacheSection, cd);
```

- [ ] **Step 8: Run the full unit suite to catch regressions**

Run: `bun run test`
Expected: PASS

- [ ] **Step 9: Add a Playwright overflow check**

In `tests/playwright/overflow.spec.js`, inside `test.describe('no horizontal overflow on critical selectors', ...)`, add:

```js
  test('cache savings slider', async ({ page }) => {
    await expect(page.locator('#cacheSlider')).toBeVisible({ timeout: 10000 });
    await expectNoOverflow(page, '.cache-hero');
  });
```

- [ ] **Step 10: Run the Playwright suite**

Run: `bun run test:e2e`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add dashboard/js/cache-slider.js dashboard/index.html dashboard/js/views/dashboard.js dashboard/styles/design-v2.css tests/unit/cache-slider.test.js tests/playwright/overflow.spec.js
git commit -m "feat(dashboard): add the cache savings what-if slider"
```
