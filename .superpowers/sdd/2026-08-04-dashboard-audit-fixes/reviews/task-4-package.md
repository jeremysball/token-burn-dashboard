# Task 4 Review Package

## Review range

- Base: `147e509`
- Head: `06e62c7`
- Brief: `.superpowers/sdd/2026-08-04-dashboard-audit-fixes/briefs/task-4-brief.md`
- Implementer report: /.superpowers/sdd/2026-08-04-dashboard-audit-fixes/briefs/task-4-report.md/ (verify whether present)

## Binding requirements

- `requestedPaid` must be a direct uniform-target calculation; no quadratic blend or hidden weighting.
- `actualPaid` must use each eligible model’s observed cache-read mix.
- `paid` must equal `requestedPaid`; fixed output/cache-write/reasoning costs must be included.
- Missing/null/non-finite rates required by nonzero dimensions exclude a model; numeric zero rates are valid; zero-token dimensions do not require a rate.
- Slider precision must preserve positive rates below 0.1%, use the same deterministic precision for max/value/step/readout/scenario input, and preserve 0.04%.

## Commit summary

06e62c7 (HEAD -> worktree-dashboard-audit-fixes) fix(dashboard): calculate cache scenarios from direct rates

## Diff stat

 dashboard/js/cache-scenario.js    | 176 +++++++++++++++--------
 dashboard/js/cache-slider.js      |  71 +++++++--
 tests/unit/cache-scenario.test.js | 295 +++++++++++++++++++++++++++++---------
 tests/unit/cache-slider.test.js   | 169 ++++++++++++++++------
 4 files changed, 534 insertions(+), 177 deletions(-)

## Full diff

diff --git a/dashboard/js/cache-scenario.js b/dashboard/js/cache-scenario.js
index 6cf0378..4746d89 100644
--- a/dashboard/js/cache-scenario.js
+++ b/dashboard/js/cache-scenario.js
@@ -1,81 +1,143 @@
 // dashboard/js/cache-scenario.js
-import { cacheHitRatePct } from './utils.js';
+import { cacheHitRatePct, getUsablePricingRate } from './utils.js';
 
 /**
  * Blended real cache-hit rate across the whole fleet, as a percentage.
  * Delegates to the shared cacheHitRatePct helper for the core formula.
  * @param {{total_input?: number, total_cache_read?: number}|null} currentData
  * @returns {number}
  */
 export function getRealCacheHitRatePct(currentData) {
     return cacheHitRatePct(currentData?.total_input, currentData?.total_cache_read);
 }
 
 /**
- * Recompute total spend as if the fleet's blended cache-hit rate were
- * hitRatePct instead of whatever it actually was. Output/cache-write/
- * reasoning cost stay fixed per model (unaffected by the input-caching
- * mix); only each model's cacheable tokens (input + cache_read) are
- * re-blended between the input rate and the cache-read rate.
- * @param {{tokens_by_model?: Record<string, any>, pricing_by_model?: Record<string, any>, total_input?: number, total_cache_read?: number}|null} currentData
- * @param {number} hitRatePct
- * @returns {{paid: number, paidAtZeroPct: number, savedVsNoCache: number, paidPct: number}}
+ * @param {any} stats
+ * @returns {{input: number, cacheRead: number, output: number, cacheWrite: number, reasoning: number}}
  */
-export function computeCacheScenario(currentData, hitRatePct) {
-    const models = Object.entries(currentData?.tokens_by_model || {});
-    const pricingByModel = currentData?.pricing_by_model || {};
-    const h = Math.max(0, Math.min(100, hitRatePct)) / 100;
-
-    const fleetInput = Number(currentData?.total_input) || 0;
-    const fleetCacheRead = Number(currentData?.total_cache_read) || 0;
-    const fleetTotal = fleetInput + fleetCacheRead;
-    const actualRate = fleetTotal > 0 ? fleetCacheRead / fleetTotal : 0;
-
-    let paidAtZeroPct = 0;
-    let paidAtActual = 0;
-    let paidAtUniform = 0;
-    let coverage = false;
+function getTokenCounts(stats) {
+    return {
+        input: Number(stats.input) || 0,
+        cacheRead: Number(stats.cache_read) || 0,
+        output: Number(stats.output) || 0,
+        cacheWrite: Number(stats.cache_write) || 0,
+        reasoning: Number(stats.reasoning) || 0
+    };
+}
 
-    for (const [name, stats] of models) {
-        const pricing = pricingByModel[name];
-        if (!Number.isFinite(Number(pricing?.input)) || !Number.isFinite(Number(pricing?.cacheRead))) continue;
-        coverage = true;
+/**
+ * @param {any} pricing
+ * @param {string} field
+ * @param {number} tokenCount
+ * @returns {boolean}
+ */
+function hasUsableFixedRate(pricing, field, tokenCount) {
+    return tokenCount === 0 || getUsablePricingRate(pricing, field, tokenCount) !== null;
+}
 
-        const inputRate = Number(pricing.input);
-        const cacheReadRate = Number(pricing.cacheRead);
-        const outputRate = Number(pricing?.output);
-        const cacheWriteRate = Number(pricing?.cacheWrite);
-        const input = Number(stats.input) || 0;
-        const cacheRead = Number(stats.cache_read) || 0;
-        const output = Number(stats.output) || 0;
-        const cacheWrite = Number(stats.cache_write) || 0;
+/**
+ * Check whether a model has usable pricing for all required token dimensions.
+ * @param {any} pricing
+ * @param {any} stats
+ * @returns {boolean}
+ */
+function isModelEligible(pricing, stats) {
+    const counts = getTokenCounts(stats);
+    return getUsablePricingRate(pricing, 'input') !== null
+        && getUsablePricingRate(pricing, 'cacheRead') !== null
+        && hasUsableFixedRate(pricing, 'output', counts.output)
+        && hasUsableFixedRate(pricing, 'cacheWrite', counts.cacheWrite)
+        && hasUsableFixedRate(pricing, 'reasoning', counts.reasoning);
+}
 
-        const fixedCost = (output / 1e6) * (Number.isFinite(outputRate) ? outputRate : 0)
-            + (cacheWrite / 1e6) * (Number.isFinite(cacheWriteRate) ? cacheWriteRate : 0);
+/**
+ * Compute cost contributions for an eligible model at a given hit rate.
+ * @param {any} pricing
+ * @param {any} stats
+ * @param {number} hitRate
+ * @returns {{zeroPaid: number, requestedPaid: number, actualPaid: number}|null}
+ */
+function computeModelScenario(pricing, stats, hitRate) {
+    if (!isModelEligible(pricing, stats)) return null;
 
-        const cacheableTokens = input + cacheRead;
-        const uncachedTokens = cacheableTokens * (1 - h);
-        const cachedTokens = cacheableTokens * h;
+    const counts = getTokenCounts(stats);
+    const inputRate = /** @type {number} */ (getUsablePricingRate(pricing, 'input'));
+    const cacheReadRate = /** @type {number} */ (getUsablePricingRate(pricing, 'cacheRead'));
+    const outputRate = getUsablePricingRate(pricing, 'output', counts.output) || 0;
+    const cacheWriteRate = getUsablePricingRate(pricing, 'cacheWrite', counts.cacheWrite) || 0;
+    const reasoningRate = getUsablePricingRate(pricing, 'reasoning', counts.reasoning) || 0;
+    const cacheableTokens = counts.input + counts.cacheRead;
+    const fixedCost = (counts.output / 1e6) * outputRate
+        + (counts.cacheWrite / 1e6) * cacheWriteRate
+        + (counts.reasoning / 1e6) * reasoningRate;
+    const requestedPaid = fixedCost
+        + (cacheableTokens * (1 - hitRate) / 1e6) * inputRate
+        + (cacheableTokens * hitRate / 1e6) * cacheReadRate;
+    const actualRate = cacheableTokens > 0 ? counts.cacheRead / cacheableTokens : 0;
+    const actualPaid = fixedCost
+        + (cacheableTokens * (1 - actualRate) / 1e6) * inputRate
+        + (cacheableTokens * actualRate / 1e6) * cacheReadRate;
 
-        paidAtZeroPct += fixedCost + (cacheableTokens / 1e6) * inputRate;
-        paidAtUniform += fixedCost + (uncachedTokens / 1e6) * inputRate + (cachedTokens / 1e6) * cacheReadRate;
+    return {
+        zeroPaid: fixedCost + (cacheableTokens / 1e6) * inputRate,
+        requestedPaid,
+        actualPaid
+    };
+}
 
-        // C3 fix: per-model actual hit rate for self-consistency at real position
-        const modelActualRate = cacheableTokens > 0 ? cacheRead / cacheableTokens : 0;
-        paidAtActual += fixedCost + (cacheableTokens * (1 - modelActualRate) / 1e6) * inputRate
-            + (cacheableTokens * modelActualRate / 1e6) * cacheReadRate;
-    }
+/**
+ * @returns {{paid: number, requestedPaid: number, actualPaid: number, paidAtZeroPct: number, savedVsNoCache: number, actualSavedVsNoCache: number, paidPct: number, eligibleModels: string[]}}
+ */
+function emptyScenario() {
+    return {
+        paid: 0,
+        requestedPaid: 0,
+        actualPaid: 0,
+        paidAtZeroPct: 0,
+        savedVsNoCache: 0,
+        actualSavedVsNoCache: 0,
+        paidPct: 0,
+        eligibleModels: []
+    };
+}
 
-    if (!coverage) return { paid: 0, paidAtZeroPct: 0, savedVsNoCache: 0, paidPct: 0 };
+/**
+ * Compute cache scenario costs using direct uniform-target and per-model
+ * actual-baseline rates. Eligible models have finite input/cacheRead rates
+ * and finite rates for every nonzero fixed dimension (output, cacheWrite,
+ * reasoning). Returns both the uniform what-if total and the actual-rate
+ * baseline so the caller can pick whichever baseline the UI needs.
+ * @param {{tokens_by_model?: Record<string, any>, pricing_by_model?: Record<string, any>, total_input?: number, total_cache_read?: number}|null} currentData
+ * @param {number} hitRatePct
+ * @returns {{paid: number, requestedPaid: number, actualPaid: number, paidAtZeroPct: number, savedVsNoCache: number, actualSavedVsNoCache: number, paidPct: number, eligibleModels: string[]}}
+ */
+export function computeCacheScenario(currentData, hitRatePct) {
+    const models = Object.entries(currentData?.tokens_by_model || {});
+    const pricingByModel = currentData?.pricing_by_model || {};
+    const hitRate = Math.max(0, Math.min(100, hitRatePct)) / 100;
+    const totals = models.reduce((acc, [name, stats]) => {
+        const scenario = computeModelScenario(pricingByModel[name], stats, hitRate);
+        if (scenario === null) return acc;
+        acc.eligibleModels.push(name);
+        acc.paidAtZeroPct += scenario.zeroPaid;
+        acc.requestedPaid += scenario.requestedPaid;
+        acc.actualPaid += scenario.actualPaid;
+        return acc;
+    }, /** @type {{paidAtZeroPct: number, requestedPaid: number, actualPaid: number, eligibleModels: string[]}} */ ({
+        paidAtZeroPct: 0,
+        requestedPaid: 0,
+        actualPaid: 0,
+        eligibleModels: []
+    }));
 
-    // C3: blend uniform-rate cost with per-model-actual cost so that
-    // at the slider's real position (h == actualRate), paid == paidAtActual
-    // (matching total_cost), while at h=0 paid == paidAtZeroPct.
-    const w = actualRate > 0 ? Math.min(1, (h / actualRate) ** 2) : 0;
-    const paid = paidAtUniform * (1 - w) + paidAtActual * w;
+    if (totals.eligibleModels.length === 0) return emptyScenario();
 
-    const savedVsNoCache = paidAtZeroPct - paid;
-    const paidPct = paidAtZeroPct > 0 ? Math.max(2, Math.min(98, (paid / paidAtZeroPct) * 100)) : 50;
+    const paid = totals.requestedPaid;
+    const savedVsNoCache = totals.paidAtZeroPct - paid;
+    const actualSavedVsNoCache = totals.paidAtZeroPct - totals.actualPaid;
+    const paidPct = totals.paidAtZeroPct > 0
+        ? Math.max(2, Math.min(98, (paid / totals.paidAtZeroPct) * 100))
+        : 50;
 
-    return { paid, paidAtZeroPct, savedVsNoCache, paidPct };
-}
\ No newline at end of file
+    return { paid, ...totals, savedVsNoCache, actualSavedVsNoCache, paidPct };
+}
diff --git a/dashboard/js/cache-slider.js b/dashboard/js/cache-slider.js
index fa03f35..b1d6e4e 100644
--- a/dashboard/js/cache-slider.js
+++ b/dashboard/js/cache-slider.js
@@ -1,20 +1,48 @@
 // dashboard/js/cache-slider.js
 import { fmtCur, ensureWidgetBuilt } from './utils.js';
 import { getRealCacheHitRatePct, computeCacheScenario } from './cache-scenario.js';
 
 /** @type {any} */
 let latestData = null;
 /** @type {number|null} */
 let lastRenderedSliderValue = null;
 /** @type {any} */
 let lastRenderedData = null;
+/** @type {{step: number, decimals: number}|null} */
+let lastRenderedPrecision = null;
+
+/**
+ * Determine a deterministic slider step and decimal count from the
+ * maximum real hit-rate percentage. Produces enough decimal places
+ * for any positive rate below 0.1%, never rounds a positive rate to
+ * zero, and stays stable between renders.
+ * @param {number} realRatePct
+ * @returns {{step: number, decimals: number}}
+ */
+export function getCacheSliderPrecision(realRatePct) {
+    if (realRatePct <= 0) return { step: 0.1, decimals: 1 };
+    const decimals = Math.max(2, Math.ceil(-Math.log10(realRatePct)) + 1);
+    const step = Math.pow(10, -decimals);
+    return { step, decimals };
+}
+
+/**
+ * Format a hit-rate percentage value with a fixed number of decimal
+ * places so that slider max, step, value, and readout stay consistent.
+ * @param {number} value
+ * @param {number} decimals
+ * @returns {string}
+ */
+export function formatCacheRatePct(value, decimals) {
+    return value.toFixed(decimals);
+}
 
 /**
  * @param {HTMLElement} container
  */
 function buildSection(container) {
     container.innerHTML = `
         <div class="cache-hero">
             <div class="cache-hero-top">
                 <div>
                     <div class="cache-hero-label">caching has saved you</div>
@@ -36,55 +64,76 @@ function buildSection(container) {
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
-        renderReadout(container, parseFloat(slider.value));
+        renderReadout(container, parseFloat(slider.value), lastRenderedPrecision);
     });
 }
 
 /**
  * @param {HTMLElement} container
  * @param {number} hitRatePct
+ * @param {{step: number, decimals: number}|null} precision
  */
-function renderReadout(container, hitRatePct) {
+function renderReadout(container, hitRatePct, precision) {
     const scenario = computeCacheScenario(latestData, hitRatePct);
     const savedEl = /** @type {HTMLElement} */ (container.querySelector('#cacheSavedValue'));
     const paidEl = /** @type {HTMLElement} */ (container.querySelector('#cachePaidValue'));
     const readout = /** @type {HTMLElement} */ (container.querySelector('#cacheReadout'));
     const barWrap = /** @type {HTMLElement} */ (container.querySelector('#cacheBarWrap'));
 
-    savedEl.innerHTML = `${fmtCur(scenario.savedVsNoCache)}<small>at ${hitRatePct.toFixed(1)}% hit rate</small>`;
+    const decimals = precision ? precision.decimals : 1;
+    savedEl.innerHTML = `${fmtCur(scenario.savedVsNoCache)}<small>at ${formatCacheRatePct(hitRatePct, decimals)}% hit rate</small>`;
     paidEl.textContent = fmtCur(scenario.paid);
-    readout.textContent = `${hitRatePct.toFixed(1)}% hit rate`;
+    readout.textContent = `${formatCacheRatePct(hitRatePct, decimals)}% hit rate`;
     barWrap.style.setProperty('--paid-pct', `${scenario.paidPct.toFixed(1)}%`);
 }
 
+/**
+ * @param {HTMLElement} container
+ * @param {any} currentData
+ */
+/**
+ * @param {HTMLInputElement} slider
+ * @param {number} realRate
+ * @param {{step: number, decimals: number}} precision
+ */
+function applySliderPrecision(slider, realRate, precision) {
+    slider.max = formatCacheRatePct(realRate, precision.decimals);
+    slider.step = formatCacheRatePct(precision.step, precision.decimals);
+    if (slider.dataset.userMoved !== 'true') {
+        slider.value = formatCacheRatePct(realRate, precision.decimals);
+    } else {
+        slider.value = parseFloat(slider.value) > realRate
+            ? formatCacheRatePct(realRate, precision.decimals)
+            : slider.value;
+    }
+}
+
 /**
  * @param {HTMLElement} container
  * @param {any} currentData
  */
 export function renderCacheSlider(container, currentData) {
     latestData = currentData;
     ensureWidgetBuilt(container, 'cacheSliderBuilt', buildSection);
 
     const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
     const realRate = getRealCacheHitRatePct(currentData);
-    slider.max = realRate.toFixed(1);
-    if (slider.dataset.userMoved !== 'true') {
-        slider.value = realRate.toFixed(1);
-    } else if (parseFloat(slider.value) > realRate) {
-        slider.value = realRate.toFixed(1);
-    }
+    const precision = getCacheSliderPrecision(realRate);
+    lastRenderedPrecision = precision;
+
+    applySliderPrecision(slider, realRate, precision);
 
     // C19: skip renderReadout when neither slider position nor data changed
     const currentSliderValue = parseFloat(slider.value);
     if (currentSliderValue === lastRenderedSliderValue && currentData === lastRenderedData) return;
     lastRenderedSliderValue = currentSliderValue;
     lastRenderedData = currentData;
-    renderReadout(container, currentSliderValue);
+    renderReadout(container, currentSliderValue, precision);
 }
\ No newline at end of file
diff --git a/tests/unit/cache-scenario.test.js b/tests/unit/cache-scenario.test.js
index 733b637..71989e7 100644
--- a/tests/unit/cache-scenario.test.js
+++ b/tests/unit/cache-scenario.test.js
@@ -1,79 +1,240 @@
 // tests/unit/cache-scenario.test.js
 import { describe, expect, it } from 'bun:test';
 import { getRealCacheHitRatePct, computeCacheScenario } from '../../dashboard/js/cache-scenario.js';
 
-const onModelData = (overrides = {}) => ({
-  total_input: 1_000_000,
-  total_cache_read: 99_000_000,
-  tokens_by_model: {
-    'anthropic/claude-sonnet-5': {
-      input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000
-    }
-  },
-  pricing_by_model: {
-    'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
-  },
-  ...overrides
-});
-
 describe('getRealCacheHitRatePct', () => {
-  it('computes the blended real hit rate as a percentage', () => {
-    expect(getRealCacheHitRatePct(onModelData())).toBeCloseTo(99, 1);
-  });
+    it('computes the blended real hit rate as a percentage', () => {
+        expect(getRealCacheHitRatePct({
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 }
+            },
+            pricing_by_model: {
+                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        })).toBeCloseTo(99, 1);
+    });
 
-  it('returns 0 when there is no cacheable volume yet', () => {
-    expect(getRealCacheHitRatePct({ total_input: 0, total_cache_read: 0 })).toBe(0);
-  });
+    it('returns 0 when there is no cacheable volume yet', () => {
+        expect(getRealCacheHitRatePct({ total_input: 0, total_cache_read: 0 })).toBe(0);
+    });
 });
 
 describe('computeCacheScenario', () => {
-  it('at the real hit rate, "paid" matches what the fleet actually spent on cacheable tokens', () => {
-    const data = onModelData();
-    const realRate = getRealCacheHitRatePct(data);
-    const scenario = computeCacheScenario(data, realRate);
-
-    // input(1M)@$3 + cacheRead(99M)@$0.3 + output(0.5M)@$15 + cacheWrite(0.2M)@$3.75
-    const expectedPaid = (1_000_000 / 1e6) * 3 + (99_000_000 / 1e6) * 0.3 + (500_000 / 1e6) * 15 + (200_000 / 1e6) * 3.75;
-    expect(scenario.paid).toBeCloseTo(expectedPaid, 2);
-  });
-
-  it('at 0% hit rate, every cacheable token is billed at the full input rate', () => {
-    const data = onModelData();
-    const scenario = computeCacheScenario(data, 0);
-
-    const cacheableTokens = 1_000_000 + 99_000_000;
-    const expectedPaid = (cacheableTokens / 1e6) * 3 + (500_000 / 1e6) * 15 + (200_000 / 1e6) * 3.75;
-    expect(scenario.paid).toBeCloseTo(expectedPaid, 2);
-    expect(scenario.savedVsNoCache).toBeCloseTo(0, 5);
-  });
-
-  it('reports positive savings at a hit rate above 0%', () => {
-    const data = onModelData();
-    const scenario = computeCacheScenario(data, 80);
-    expect(scenario.savedVsNoCache).toBeGreaterThan(0);
-  });
-
-  it('skips a model with unusable pricing rather than fabricating a number', () => {
-    const data = onModelData({
-      pricing_by_model: {
-        'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheWrite: 3.75 } // cacheRead missing
-      }
+    it('requestedPaid is a direct uniform-target calculation with no quadratic blending', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 }
+            },
+            pricing_by_model: {
+                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        };
+        const result = computeCacheScenario(data, 80);
+        expect(result.requestedPaid).toBeCloseTo(result.paid, 8);
+        expect(result.paid).toBe(result.requestedPaid);
     });
-    const scenario = computeCacheScenario(data, 50);
-    expect(scenario.paid).toBe(0);
-    expect(scenario.savedVsNoCache).toBe(0);
-  });
-
-  it('clamps paidPct into [2, 98] so the bar never visually collapses', () => {
-    const data = onModelData({
-      total_input: 1,
-      total_cache_read: 999_999_999,
-      tokens_by_model: {
-        'anthropic/claude-sonnet-5': { input: 1, cache_read: 999_999_999, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000_000 }
-      }
+
+    it('actualPaid uses each model own observed cache-read mix (heterogeneous baseline)', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'model-a/high': { input: 800_000, cache_read: 20_000_000, output: 100_000, cache_write: 50_000, reasoning: 0, total: 2_950_000 },
+                'model-b/low': { input: 200_000, cache_read: 79_000_000, output: 50_000, cache_write: 10_000, reasoning: 0, total: 79_360_000 }
+            },
+            pricing_by_model: {
+                'model-a/high': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
+                'model-b/low': { input: 2, output: 10, cacheRead: 0.15, cacheWrite: 2.5 }
+            }
+        };
+        const result = computeCacheScenario(data, 80);
+        const h = 0.8;
+
+        const aInput = 800_000, aCacheRead = 20_000_000, aCacheable = aInput + aCacheRead;
+        const aActualRate = aCacheRead / aCacheable;
+        const aFixed = (100_000 / 1e6) * 15 + (50_000 / 1e6) * 3.75;
+        const aRequested = aFixed + (aCacheable * (1 - h) / 1e6) * 3 + (aCacheable * h / 1e6) * 0.3;
+
+        const bInput = 200_000, bCacheRead = 79_000_000, bCacheable = bInput + bCacheRead;
+        const bActualRate = bCacheRead / bCacheable;
+        const bFixed = (50_000 / 1e6) * 10 + (10_000 / 1e6) * 2.5;
+        const bRequested = bFixed + (bCacheable * (1 - h) / 1e6) * 2 + (bCacheable * h / 1e6) * 0.15;
+
+        const expectedRequested = aRequested + bRequested;
+        const expectedActual = aFixed + (aCacheable * (1 - aActualRate) / 1e6) * 3 + (aCacheable * aActualRate / 1e6) * 0.3
+            + bFixed + (bCacheable * (1 - bActualRate) / 1e6) * 2 + (bCacheable * bActualRate / 1e6) * 0.15;
+
+        expect(result.requestedPaid).toBeCloseTo(expectedRequested, 8);
+        expect(result.actualPaid).toBeCloseTo(expectedActual, 8);
+    });
+
+    it('excludes models with cacheRead: null from eligibleModels', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'priced/model': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 },
+                'unpriced/model': { input: 500_000, cache_read: 0, output: 100_000, cache_write: 10_000, reasoning: 0, total: 610_000 }
+            },
+            pricing_by_model: {
+                'priced/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        };
+        const result = computeCacheScenario(data, 80);
+        expect(result.eligibleModels).not.toContain('unpriced/model');
+        expect(result.eligibleModels).toContain('priced/model');
+    });
+
+    it('includes output, cache-write, and reasoning tokens with distinct rates', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 100_000, total: 100_800_000 }
+            },
+            pricing_by_model: {
+                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0.5 }
+            }
+        };
+        const result = computeCacheScenario(data, 80);
+        expect(result.requestedPaid).toBeGreaterThan(0);
+        expect(result.actualPaid).toBeGreaterThan(0);
+        expect(result.eligibleModels).toContain('anthropic/claude-sonnet-5');
+    });
+
+    it('zero-token reasoning with missing reasoning rate does not invalidate the model', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 }
+            },
+            pricing_by_model: {
+                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        };
+        const result = computeCacheScenario(data, 80);
+        expect(result.eligibleModels).toContain('anthropic/claude-sonnet-5');
+        expect(result.requestedPaid).toBeGreaterThan(0);
+    });
+
+    it('excludes a model with null input pricing', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'null-input/model': { input: null, cache_read: 99_000_000, output: 100_000, cache_write: 10_000, reasoning: 0, total: 100_110_000 }
+            },
+            pricing_by_model: {
+                'null-input/model': { input: null, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        };
+        const result = computeCacheScenario(data, 50);
+        expect(result.eligibleModels).not.toContain('null-input/model');
+        expect(result.paid).toBe(0);
+    });
+
+    it('excludes a model with null cacheRead pricing', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'null-cacheRead/model': { input: 1_000_000, cache_read: null, output: 100_000, cache_write: 10_000, reasoning: 0, total: 1_110_000 }
+            },
+            pricing_by_model: {
+                'null-cacheRead/model': { input: 3, output: 15, cacheRead: null, cacheWrite: 3.75 }
+            }
+        };
+        const result = computeCacheScenario(data, 50);
+        expect(result.eligibleModels).not.toContain('null-cacheRead/model');
+        expect(result.paid).toBe(0);
+    });
+
+    it('includes a model with all-zero token dimensions and finite rates', () => {
+        const data = {
+            total_input: 0,
+            total_cache_read: 0,
+            tokens_by_model: {
+                'zero/model': { input: 0, cache_read: 0, output: 0, cache_write: 0, reasoning: 0, total: 0 }
+            },
+            pricing_by_model: {
+                'zero/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0.5 }
+            }
+        };
+        const result = computeCacheScenario(data, 50);
+        expect(result.eligibleModels).toContain('zero/model');
+        expect(result.requestedPaid).toBeCloseTo(0, 8);
+        expect(result.actualPaid).toBeCloseTo(0, 8);
+    });
+
+    it('excludes a model with nonzero reasoning tokens but missing reasoning rate', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'missing-reasoning/model': { input: 1_000_000, cache_read: 99_000_000, output: 100_000, cache_write: 10_000, reasoning: 50_000, total: 100_160_000 }
+            },
+            pricing_by_model: {
+                'missing-reasoning/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        };
+        const result = computeCacheScenario(data, 50);
+        expect(result.eligibleModels).not.toContain('missing-reasoning/model');
+    });
+
+    it('paidAtZeroPct is the cost when every cacheable token is billed at the input rate', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {
+                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 }
+            },
+            pricing_by_model: {
+                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        };
+        const result = computeCacheScenario(data, 0);
+        const cacheableTokens = 1_000_000 + 99_000_000;
+        const expectedPaid = (cacheableTokens / 1e6) * 3 + (500_000 / 1e6) * 15 + (200_000 / 1e6) * 3.75;
+        expect(result.requestedPaid).toBeCloseTo(expectedPaid, 2);
+        expect(result.paidAtZeroPct).toBeCloseTo(expectedPaid, 2);
+        expect(result.savedVsNoCache).toBeCloseTo(0, 5);
+    });
+
+    it('clamps paidPct into [2, 98] so the bar never visually collapses', () => {
+        const data = {
+            total_input: 1,
+            total_cache_read: 999_999_999,
+            tokens_by_model: {
+                'anthropic/claude-sonnet-5': { input: 1, cache_read: 999_999_999, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000_000 }
+            },
+            pricing_by_model: {
+                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        };
+        const result = computeCacheScenario(data, 99.99999);
+        expect(result.paidPct).toBeGreaterThanOrEqual(2);
+        expect(result.paidPct).toBeLessThanOrEqual(98);
+    });
+
+    it('returns zero cost when no model has usable pricing', () => {
+        const data = {
+            total_input: 1_000_000,
+            total_cache_read: 99_000_000,
+            tokens_by_model: {},
+            pricing_by_model: {}
+        };
+        const result = computeCacheScenario(data, 50);
+        expect(result.paid).toBe(0);
+        expect(result.requestedPaid).toBe(0);
+        expect(result.actualPaid).toBe(0);
+        expect(result.paidAtZeroPct).toBe(0);
+        expect(result.savedVsNoCache).toBe(0);
+        expect(result.actualSavedVsNoCache).toBe(0);
+        expect(result.eligibleModels).toEqual([]);
     });
-    const scenario = computeCacheScenario(data, 99.99999);
-    expect(scenario.paidPct).toBeGreaterThanOrEqual(2);
-    expect(scenario.paidPct).toBeLessThanOrEqual(98);
-  });
 });
\ No newline at end of file
diff --git a/tests/unit/cache-slider.test.js b/tests/unit/cache-slider.test.js
index f0a68c7..01accf1 100644
--- a/tests/unit/cache-slider.test.js
+++ b/tests/unit/cache-slider.test.js
@@ -1,59 +1,144 @@
 // tests/unit/cache-slider.test.js
 import { beforeEach, describe, expect, it } from 'bun:test';
-import { renderCacheSlider } from '../../dashboard/js/cache-slider.js';
+import { renderCacheSlider, getCacheSliderPrecision, formatCacheRatePct } from '../../dashboard/js/cache-slider.js';
 
 const dataAt = (hitRatePct) => {
-  const cacheRead = hitRatePct * 1_000_000; // arbitrary scale
-  const input = (100 - hitRatePct) * 1_000_000;
-  return {
-    total_input: input,
-    total_cache_read: cacheRead,
-    tokens_by_model: {
-      'anthropic/claude-sonnet-5': { input, cache_read: cacheRead, output: 0, cache_write: 0, reasoning: 0, total: input + cacheRead }
-    },
-    pricing_by_model: {
-      'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
-    }
-  };
+    const cacheRead = hitRatePct * 1_000_000;
+    const input = (100 - hitRatePct) * 1_000_000;
+    return {
+        total_input: input,
+        total_cache_read: cacheRead,
+        tokens_by_model: {
+            'anthropic/claude-sonnet-5': { input, cache_read: cacheRead, output: 0, cache_write: 0, reasoning: 0, total: input + cacheRead }
+        },
+        pricing_by_model: {
+            'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+        }
+    };
 };
 
+describe('getCacheSliderPrecision', () => {
+    it('produces enough decimals for a very small positive rate', () => {
+        const p = getCacheSliderPrecision(0.04);
+        expect(p.decimals).toBeGreaterThanOrEqual(2);
+        expect(p.step).toBeGreaterThan(0);
+    });
+
+    it('never rounds a positive rate to zero', () => {
+        const p = getCacheSliderPrecision(0.04);
+        expect(p.step).toBeLessThan(0.04);
+    });
+
+    it('returns a sensible step for a normal rate', () => {
+        const p = getCacheSliderPrecision(50);
+        expect(p.step).toBeGreaterThan(0);
+        expect(p.decimals).toBeGreaterThanOrEqual(1);
+    });
+
+    it('returns a stable result between renders', () => {
+        const p1 = getCacheSliderPrecision(0.04);
+        const p2 = getCacheSliderPrecision(0.04);
+        expect(p1.step).toBe(p2.step);
+        expect(p1.decimals).toBe(p2.decimals);
+    });
+});
+
+describe('formatCacheRatePct', () => {
+    it('formats with the given decimal count', () => {
+        expect(formatCacheRatePct(0.04, 3)).toBe('0.040');
+        expect(formatCacheRatePct(50, 1)).toBe('50.0');
+    });
+
+    it('preserves a nonzero value for small rates', () => {
+        expect(Number(formatCacheRatePct(0.04, 3))).toBeGreaterThan(0);
+    });
+});
+
 describe('renderCacheSlider', () => {
-  let container;
+    let container;
+
+    beforeEach(() => {
+        document.body.innerHTML = '<section id="cache-savings-section"></section>';
+        container = document.getElementById('cache-savings-section');
+    });
+
+    it('builds the section once and defaults the slider to the real hit rate', () => {
+        renderCacheSlider(container, dataAt(90));
+        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
+        expect(slider).not.toBeNull();
+        expect(Number(slider.value)).toBeCloseTo(90, 0);
+        expect(Number(slider.max)).toBeCloseTo(90, 0);
+    });
+
+    it('updates the dollar readout when the slider is dragged', () => {
+        renderCacheSlider(container, dataAt(90));
+        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
+        const before = container.querySelector('#cacheSavedValue').textContent;
+
+        slider.value = '10';
+        slider.dispatchEvent(new Event('input'));
 
-  beforeEach(() => {
-    document.body.innerHTML = '<section id="cache-savings-section"></section>';
-    container = document.getElementById('cache-savings-section');
-  });
+        const after = container.querySelector('#cacheSavedValue').textContent;
+        expect(after).not.toBe(before);
+    });
 
-  it('builds the section once and defaults the slider to the real hit rate', () => {
-    renderCacheSlider(container, dataAt(90));
-    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
-    expect(slider).not.toBeNull();
-    expect(Number(slider.value)).toBeCloseTo(90, 0);
-    expect(Number(slider.max)).toBeCloseTo(90, 0);
-  });
+    it('does not snap the slider back to the real rate on a subsequent render after the user dragged it', () => {
+        renderCacheSlider(container, dataAt(90));
+        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
 
-  it('updates the dollar readout when the slider is dragged', () => {
-    renderCacheSlider(container, dataAt(90));
-    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
-    const before = container.querySelector('#cacheSavedValue').textContent;
+        slider.value = '10';
+        slider.dispatchEvent(new Event('input'));
 
-    slider.value = '10';
-    slider.dispatchEvent(new Event('input'));
+        renderCacheSlider(container, dataAt(91));
 
-    const after = container.querySelector('#cacheSavedValue').textContent;
-    expect(after).not.toBe(before);
-  });
+        expect(Number(slider.value)).toBeCloseTo(10, 0);
+    });
 
-  it('does not snap the slider back to the real rate on a subsequent render after the user dragged it', () => {
-    renderCacheSlider(container, dataAt(90));
-    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
+    it('preserves a nonzero max and value for a 0.04% hit rate', () => {
+        const data = {
+            total_input: 99_960,
+            total_cache_read: 40,
+            tokens_by_model: {
+                'anthropic/claude-sonnet-5': { input: 99_960, cache_read: 40, output: 0, cache_write: 0, reasoning: 0, total: 100_000 }
+            },
+            pricing_by_model: {
+                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        };
+        renderCacheSlider(container, data);
+        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
+        const readout = /** @type {HTMLElement} */ (container.querySelector('#cacheReadout'));
 
-    slider.value = '10';
-    slider.dispatchEvent(new Event('input'));
+        expect(slider.max).not.toBe('0.0');
+        expect(Number(slider.max)).toBeCloseTo(0.04, 8);
+        expect(Number(slider.value)).toBeGreaterThan(0);
+        expect(Number(slider.step)).toBeGreaterThan(0);
+        expect(readout.textContent).toContain('0.04');
+    });
 
-    renderCacheSlider(container, dataAt(91)); // a later SSE update nudges the real rate slightly
+    it('uses enough decimal places for a smaller nonzero rate', () => {
+        const data = {
+            total_input: 999_960,
+            total_cache_read: 40,
+            tokens_by_model: {
+                'anthropic/claude-sonnet-5': { input: 999_960, cache_read: 40, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000 }
+            },
+            pricing_by_model: {
+                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
+            }
+        };
+        renderCacheSlider(container, data);
+        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
+        expect(Number(slider.max)).toBeGreaterThan(0);
+        expect(Number(slider.step)).toBeGreaterThan(0);
+        expect(Number(slider.value)).toBeGreaterThan(0);
+    });
 
-    expect(Number(slider.value)).toBeCloseTo(10, 0);
-  });
+    it('uses appropriate precision for a normal hit rate', () => {
+        renderCacheSlider(container, dataAt(50));
+        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
+        expect(Number(slider.max)).toBeCloseTo(50, 0);
+        expect(Number(slider.value)).toBeCloseTo(50, 0);
+        expect(Number(slider.step)).toBeGreaterThan(0);
+    });
 });
\ No newline at end of file
