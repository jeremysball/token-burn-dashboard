Task 1 review package
BASE d6c0b7dbb51c5e8886b0680d9b0173d8fbfc5ea2
HEAD d6c0b7dbb51c5e8886b0680d9b0173d8fbfc5ea2
--- status ---
 M dashboard/js/utils.js
 M tests/unit/utils.test.js
--- diff stat ---
 dashboard/js/utils.js    | 40 +++++++++++++++++++++++++++++++++++++---
 tests/unit/utils.test.js | 40 ++++++++++++++++++++++++++++++++++++++++
 2 files changed, 77 insertions(+), 3 deletions(-)
--- diff check ---
--- full diff ---
diff --git a/dashboard/js/utils.js b/dashboard/js/utils.js
index addc0e5..2e60103 100644
--- a/dashboard/js/utils.js
+++ b/dashboard/js/utils.js
@@ -301,30 +301,64 @@ export const positionNotifications = () => {
  * @param {number|null|undefined} cacheRead
  * @returns {number}
  */
 export function cacheHitRatePct(input, cacheRead) {
     const inTokens = Number(input) || 0;
     const outTokens = Number(cacheRead) || 0;
     const total = inTokens + outTokens;
     return total > 0 ? (outTokens / total) * 100 : 0;
 }
 
+/**
+ * Strict numeric-rate contract shared across dataviz pricing decisions.
+ * True only for a JavaScript number that is finite; numeric `0` is a valid
+ * rate, while `null`, strings (even "0"), `NaN`, and infinities are not.
+ * @param {*} value
+ * @returns {boolean}
+ */
+export function isFiniteNumericRate(value) {
+    return typeof value === 'number' && Number.isFinite(value);
+}
+
+/**
+ * Resolve a single pricing field into a usable rate under the strict contract.
+ * Returns a finite numeric field (including an explicit zero). Returns null
+ * when the field is missing/invalid, or when an explicit `has<Field>` presence
+ * flag says the rate is absent for a nonzero token count. A zero-token
+ * dimension never requires a published rate.
+ * @param {any|null|undefined} pricing
+ * @param {string} field
+ * @param {number} [tokenCount]
+ * @returns {number|null}
+ */
+export function getUsablePricingRate(pricing, field, tokenCount = 0) {
+    if (!pricing || typeof pricing !== 'object') return null;
+
+    const value = pricing[field];
+    if (!isFiniteNumericRate(value)) return null;
+
+    const flagField = `has${field.charAt(0).toUpperCase()}${field.slice(1)}`;
+    const presence = pricing[flagField];
+    if (presence === false && tokenCount !== 0) return null;
+
+    return value;
+}
+
 /**
  * "Skip a model with unusable pricing rather than fabricate a number" —
  * the cache-savings convention shared by cache-slider and live-event-feed.
  * @param {any|null|undefined} pricing
  * @returns {boolean}
  */
 export function hasUsableCacheReadPricing(pricing) {
-    const inputRate = Number(pricing?.input);
-    const cacheReadRate = Number(pricing?.cacheRead);
-    return Number.isFinite(inputRate) && Number.isFinite(cacheReadRate);
+    return getUsablePricingRate(pricing, 'input') !== null
+        && getUsablePricingRate(pricing, 'cacheRead') !== null;
 }
 
 /**
  * Build-once gate for panels that render on every renderDashboard()/
  * tab-switch but should only construct their DOM the first time. Stores
  * the built flag on container.dataset[flagKey]. Returns true if the
  * build was performed this call.
  * @param {HTMLElement} container
  * @param {string} flagKey
  * @param {(container: HTMLElement) => void} build
diff --git a/tests/unit/utils.test.js b/tests/unit/utils.test.js
index d7ab1b7..919fcec 100644
--- a/tests/unit/utils.test.js
+++ b/tests/unit/utils.test.js
@@ -4,20 +4,22 @@ import {
   fmtCur,
   fmtDate,
   fmtMultiple,
   createSparkline,
   notify,
   setText,
   hide,
   show,
   getPlotlyLayout,
   cacheHitRatePct,
+  isFiniteNumericRate,
+  getUsablePricingRate,
   hasUsableCacheReadPricing,
   ensureWidgetBuilt,
   splitModelKey,
   displayModel,
   parseModelKey,
   getPricingForModel,
   formatModelPrice,
   escapeHtml,
   resizeVisiblePlots,
   positionNotifications
@@ -414,34 +416,72 @@ describe('cacheHitRatePct', () => {
   it('returns 0 when both inputs are zero or missing', () => {
     expect(cacheHitRatePct(0, 0)).toBe(0);
     expect(cacheHitRatePct(null, null)).toBe(0);
   });
 
   it('returns 100 when only cacheRead has volume', () => {
     expect(cacheHitRatePct(0, 1000)).toBe(100);
   });
 });
 
+describe('isFiniteNumericRate', () => {
+  it('rejects null, strings, NaN, and infinity but accepts numeric zero', () => {
+    expect(isFiniteNumericRate(0)).toBe(true);
+    expect(isFiniteNumericRate(null)).toBe(false);
+    expect(isFiniteNumericRate('0')).toBe(false);
+    expect(isFiniteNumericRate(Number.NaN)).toBe(false);
+    expect(isFiniteNumericRate(Number.POSITIVE_INFINITY)).toBe(false);
+  });
+});
+
+describe('getUsablePricingRate', () => {
+  it('requires a published rate only for a nonzero token dimension', () => {
+    const pricing = { input: 3, reasoning: 0, hasReasoning: true };
+    expect(getUsablePricingRate(pricing, 'reasoning', 1_000_000)).toBe(0);
+    expect(getUsablePricingRate({ input: 3, reasoning: null }, 'reasoning', 1)).toBeNull();
+    expect(getUsablePricingRate({}, 'reasoning', 0)).toBeNull();
+  });
+
+  it('returns a finite field value, including explicit zero', () => {
+    expect(getUsablePricingRate({ input: 2.5 }, 'input')).toBe(2.5);
+    expect(getUsablePricingRate({ cacheRead: 0 }, 'cacheRead')).toBe(0);
+  });
+
+  it('returns null when a presence flag says the rate is absent for nonzero tokens', () => {
+    expect(getUsablePricingRate({ reasoning: 0, hasReasoning: false }, 'reasoning', 1_000_000)).toBeNull();
+    expect(getUsablePricingRate({ input: 3, cacheRead: 0, hasCacheRead: false }, 'cacheRead', 10)).toBeNull();
+  });
+
+  it('does not gate a zero-token dimension on a presence flag', () => {
+    expect(getUsablePricingRate({ reasoning: 0, hasReasoning: false }, 'reasoning', 0)).toBe(0);
+  });
+});
+
 describe('hasUsableCacheReadPricing', () => {
   it('returns true when both input and cacheRead are finite numbers', () => {
     expect(hasUsableCacheReadPricing({ input: 3, cacheRead: 0.3 })).toBe(true);
   });
 
   it('returns false when cacheRead is missing or non-finite', () => {
     expect(hasUsableCacheReadPricing({ input: 3 })).toBe(false);
     expect(hasUsableCacheReadPricing({ input: 3, cacheRead: NaN })).toBe(false);
   });
 
   it('returns false for null/undefined pricing', () => {
     expect(hasUsableCacheReadPricing(null)).toBe(false);
     expect(hasUsableCacheReadPricing(undefined)).toBe(false);
   });
+
+  it('does not treat null cache pricing as free', () => {
+    expect(hasUsableCacheReadPricing({ input: 3, cacheRead: null })).toBe(false);
+    expect(hasUsableCacheReadPricing({ input: 0, cacheRead: 0 })).toBe(true);
+  });
 });
 
 describe('ensureWidgetBuilt', () => {
   it('builds on first call and returns true', () => {
     const container = { dataset: {} };
     let built = 0;
     const result = ensureWidgetBuilt(container, 'xBuilt', () => { built++; });
     expect(built).toBe(1);
     expect(result).toBe(true);
     expect(container.dataset.xBuilt).toBe('true');
