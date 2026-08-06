Task 2 review package
BASE 0ecf5ecffa3d093965ccdf0afc69990842b7bfdd
HEAD 4e6a364e9d02614749fe6996ec4e5eee3b29a0ea
--- worker result evidence ---
Taskferry reported: commit 4a340c3; focused 16 pass/0 fail; full 489 pass/0 fail; tsc clean; lint baseline no new buckets; worker report absent after accept.
--- diff stat ---
 dashboard/js/equiv-ticker.js              | 126 ++++++++++++++++++++++----
 dashboard/js/main.js                      |   4 +-
 tests/unit/dashboard-equiv-ticker.test.js |  89 ++++++++++++++++++-
 tests/unit/equiv-ticker.test.js           | 141 ++++++++++++++++++++++++++----
 4 files changed, 325 insertions(+), 35 deletions(-)
--- diff check ---
--- full diff ---
diff --git a/dashboard/js/equiv-ticker.js b/dashboard/js/equiv-ticker.js
index dd5df92..d9e123b 100644
--- a/dashboard/js/equiv-ticker.js
+++ b/dashboard/js/equiv-ticker.js
@@ -1,18 +1,20 @@
 // dashboard/js/equiv-ticker.js
 import { formatFactoid } from './equiv-format.js';
 
 const CORPUS_URL = '/data/factoids-1000.json';
 const SAMPLE_SIZE = 25;
 const ROTATE_MS = 4200;
 const FADE_MS = 350;
 
+const SUPPORTED_CATEGORIES = ['tokens', 'cost', 'burnRate'];
+
 // Real-data-derived, hand-checked lines kept inline (not sourced from the
 // corpus) so the ticker never goes blank while the corpus fetch is pending,
 // and stays meaningful even if it never resolves (Section 5 of the spec).
 /** @type {Record<string, string[]>} */
 const CURATED_FALLBACK = {
     tokens: [
         'the ~497k-line codebase, regenerated from scratch, <b>~{n/4970000:.0f}×</b> over',
         '<b>War and Peace</b>, cover-to-cover, roughly <b>{n/763000:.0f} times</b>',
         '<b>~{n*4/200/60/24/365:.0f} years</b> of an engineer typing non-stop, 24/7, at 200 chars/min'
     ],
@@ -25,118 +27,208 @@ const CURATED_FALLBACK = {
         '≈ <b>{n/1000000:.2f}M</b> tokens every minute, before cache discounts'
     ]
 };
 
 /** @type {any[]|null} */
 let corpus = null;
 
 /** @type {Promise<void>|null} */
 let corpusFetchPromise = null;
 
+/** @type {Record<string, {n: number, lines: string[]}>} */
+let _buildLinesCache = {};
+
 /**
  * Partial Fisher-Yates: shuffles only the first k elements so we can
  * stop early instead of shuffling the entire filtered set.
  * @param {any[]} arr
  * @param {number} k
  * @returns {any[]}
  */
 function partialShuffle(arr, k) {
     const copy = arr.slice();
     const n = Math.min(k, copy.length);
     for (let i = 0; i < n; i++) {
         const j = i + Math.floor(Math.random() * (copy.length - i));
         [copy[i], copy[j]] = [copy[j], copy[i]];
     }
     return copy.slice(0, n);
 }
 
+/**
+ * Validate a corpus response before it becomes the active corpus. Only
+ * supported categories with nonblank string `copy` values are kept, and every
+ * supported category must end up with at least one usable entry, so a
+ * malformed, partial, or unknown-category payload never silently blanks a
+ * ticker line. The caller assigns the result atomically or keeps the curated
+ * fallback.
+ * @param {any} data
+ * @returns {any[]|null}
+ */
+function normalizeCorpus(data) {
+    if (!Array.isArray(data)) return null;
+    const usable = data.filter((factoid) => {
+        if (!factoid || typeof factoid !== 'object') return false;
+        if (!SUPPORTED_CATEGORIES.includes(factoid.category)) return false;
+        return typeof factoid.copy === 'string' && factoid.copy.trim() !== '';
+    });
+    if (usable.length === 0) return null;
+    for (const category of SUPPORTED_CATEGORIES) {
+        if (!usable.some((factoid) => factoid.category === category)) return null;
+    }
+    return usable;
+}
+
 function ensureCorpusLoaded() {
     if (corpusFetchPromise) return corpusFetchPromise;
     corpusFetchPromise = fetch(CORPUS_URL)
         .then((r) => {
             if (!r.ok) throw new Error(`corpus fetch failed: ${r.status}`);
             return r.json();
         })
-        .then((data) => { corpus = data; })
+        .then((data) => {
+            const normalized = normalizeCorpus(data);
+            if (!normalized) {
+                console.warn('equivalence corpus fetch failed, staying on curated lines only', { reason: 'malformed corpus' });
+                return;
+            }
+            corpus = normalized;
+            _buildLinesCache = {};
+            refreshMountedTickers();
+        })
         .catch((err) => {
             console.warn('equivalence corpus fetch failed, staying on curated lines only', err);
         });
     return corpusFetchPromise;
 }
 
-/** @type {Record<string, {n: number, lines: string[]}>} */
-let _buildLinesCache = {};
-
 /**
  * @param {string} category
  * @param {number} n
  * @returns {string[]}
  */
 function buildLines(category, n) {
     if (_buildLinesCache[category] && _buildLinesCache[category].n === n) {
         return _buildLinesCache[category].lines;
     }
     const curated = (CURATED_FALLBACK[category] || []).map((t) => formatFactoid(t, n));
     if (!corpus) return curated;
     const sample = partialShuffle(corpus.filter((f) => f.category === category), SAMPLE_SIZE);
     const lines = sample.map((f) => formatFactoid(f.copy, n));
     _buildLinesCache[category] = { n, lines };
     return lines;
 }
 
+/**
+ * Rebuild lines for every mounted ticker from its stored last value, so a
+ * corpus that resolves after the first render swaps fallback text for corpus
+ * text without forcing another dashboard render.
+ */
+function refreshMountedTickers() {
+    const tickers = document.querySelectorAll('.equiv-ticker[data-equiv-category]');
+    tickers.forEach((el) => {
+        const mounted = /** @type {any} */ (el);
+        const n = mounted._equivLastValue;
+        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return;
+        const lines = buildLines(mounted.dataset.equivCategory, n);
+        if (!lines.length) return;
+        ensureRunning(mounted, lines);
+    });
+}
+
 /**
  * Start (or hand fresh lines to) a ticker's rotation. Re-sampled lines are
- * applied without restarting an in-flight rotation, so a per-render call
- * never interrupts a fade transition already underway.
+ * applied without restarting an in-flight rotation, so a per-render call or an
+ * async corpus refresh never interrupts a fade transition already underway.
+ * The rotation index and fade timeout live on the element, letting an async
+ * refresh replace `_equivLines` while the running interval keeps its identity.
  * @param {any} el
  * @param {string[]} lines
  */
 function ensureRunning(el, lines) {
     el._equivLines = lines;
     if (el._equivIntervalId) return;
 
     const textEl = el.querySelector('.equiv-text');
     if (!textEl) return;
-    let i = 0;
-    textEl.innerHTML = el._equivLines[0] || '';
+    if (typeof el._equivRotationIndex !== 'number' || el._equivRotationIndex >= lines.length) {
+        el._equivRotationIndex = 0;
+    }
+    if (el._equivFadeTimeout === undefined) el._equivFadeTimeout = null;
+    textEl.innerHTML = el._equivLines[el._equivRotationIndex] || '';
 
     const next = () => {
         if (!el._equivLines.length) return;
         textEl.classList.add('fade');
-        setTimeout(() => {
-            i = (i + 1) % el._equivLines.length;
-            textEl.innerHTML = el._equivLines[i];
+        const fadeTimeout = setTimeout(() => {
+            if (el._equivFadeTimeout !== fadeTimeout) return;
+            el._equivFadeTimeout = null;
+            el._equivRotationIndex = (el._equivRotationIndex + 1) % el._equivLines.length;
+            textEl.innerHTML = el._equivLines[el._equivRotationIndex];
             textEl.classList.remove('fade');
         }, FADE_MS);
+        el._equivFadeTimeout = fadeTimeout;
     };
     el._equivIntervalId = setInterval(next, ROTATE_MS);
 }
 
+/**
+ * Fully reset a mounted ticker so an invalid value never leaves a stale
+ * interval, pending fade, leftover lines, or visible text behind.
+ * @param {any} el
+ */
+function clearTicker(el) {
+    el._equivLastValue = undefined;
+    if (el._equivIntervalId) clearInterval(el._equivIntervalId);
+    el._equivIntervalId = null;
+    if (el._equivFadeTimeout) clearTimeout(el._equivFadeTimeout);
+    el._equivFadeTimeout = null;
+    el._equivLines = [];
+    el._equivRotationIndex = 0;
+    const textEl = el.querySelector('.equiv-text');
+    if (textEl) textEl.textContent = '';
+}
+
+/**
+ * Start the one corpus request (or reuse the in-flight one) and resolve after
+ * either a valid corpus is installed or the curated fallback stays active
+ * after a fetch/parse failure.
+ * @returns {Promise<void>}
+ */
 export function initEquivTickers() {
-    ensureCorpusLoaded();
+    return ensureCorpusLoaded();
 }
 
 /**
  * @param {{tokens?: number, cost?: number, burnRate?: number}} values
  */
 export function updateEquivTickers(values) {
     const tickers = document.querySelectorAll('.equiv-ticker[data-equiv-category]');
     tickers.forEach((el) => {
-        const category = /** @type {HTMLElement} */ (el).dataset.equivCategory;
+        const mounted = /** @type {any} */ (el);
+        const category = mounted.dataset.equivCategory;
         const n = category ? values[/** @type {'tokens'|'cost'|'burnRate'} */ (category)] : undefined;
-        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return;
-        const lines = buildLines(/** @type {string} */ (category), n);
-        if (!lines.length) return;
-        ensureRunning(el, lines);
+        if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
+            mounted._equivLastValue = n;
+            const lines = buildLines(/** @type {string} */ (category), n);
+            if (!lines.length) return;
+            ensureRunning(mounted, lines);
+        } else {
+            clearTicker(mounted);
+        }
     });
 }
 
 export function resetEquivTickersForTest() {
     corpus = null;
     corpusFetchPromise = null;
     _buildLinesCache = {};
     document.querySelectorAll('.equiv-ticker').forEach((el) => {
         if (/** @type {any} */ (el)._equivIntervalId) clearInterval(/** @type {any} */ (el)._equivIntervalId);
+        if (/** @type {any} */ (el)._equivFadeTimeout) clearTimeout(/** @type {any} */ (el)._equivFadeTimeout);
         /** @type {any} */ (el)._equivIntervalId = null;
+        /** @type {any} */ (el)._equivFadeTimeout = null;
         /** @type {any} */ (el)._equivLines = undefined;
+        /** @type {any} */ (el)._equivLastValue = undefined;
+        /** @type {any} */ (el)._equivRotationIndex = undefined;
     });
 }
\ No newline at end of file
diff --git a/dashboard/js/main.js b/dashboard/js/main.js
index 5dcbf6f..ce4550d 100644
--- a/dashboard/js/main.js
+++ b/dashboard/js/main.js
@@ -278,21 +278,23 @@ const init = async () => {
     updateThemeToggleGlyph(savedTheme);
 
     // Initialize ambient particles
     initParticles();
 
     // Position notifications below the header
     positionNotifications();
     window.addEventListener('resize', positionNotifications);
 
     // Kick off the equivalence-corpus fetch early so it's ready by the time
-    // the first render calls updateEquivTickers().
+    // the first render calls updateEquivTickers(). The returned promise
+    // resolves after a valid corpus is installed or the fetch/parse has
+    // failed, and mounted fallback tickers refresh in place once it succeeds.
     initEquivTickers();
 
     // Load cache
     const cached = loadCache();
     loadHistoryFromCache();
     if (cached) updateData(cached);
 
     // Setup nav
     document.querySelectorAll('.nav-btn').forEach(el => {
         el.addEventListener('click', () => setView(/** @type {HTMLElement} */ (el).dataset.view ?? 'dashboard'));
diff --git a/tests/unit/dashboard-equiv-ticker.test.js b/tests/unit/dashboard-equiv-ticker.test.js
index 60d91a6..00c4a9e 100644
--- a/tests/unit/dashboard-equiv-ticker.test.js
+++ b/tests/unit/dashboard-equiv-ticker.test.js
@@ -1,15 +1,42 @@
 // tests/unit/dashboard-equiv-ticker.test.js
 import { beforeEach, describe, expect, it, mock } from 'bun:test';
 import { renderDashboard } from '../../dashboard/js/views/dashboard.js';
 import { setCurrentData, setHistoryData } from '../../dashboard/js/state.js';
-import { resetEquivTickersForTest } from '../../dashboard/js/equiv-ticker.js';
+import { resetEquivTickersForTest, updateEquivTickers } from '../../dashboard/js/equiv-ticker.js';
+
+function captureTimers() {
+  const real = {
+    setInterval: globalThis.setInterval,
+    clearInterval: globalThis.clearInterval,
+    setTimeout: globalThis.setTimeout,
+    clearTimeout: globalThis.clearTimeout
+  };
+  let intervalCallbacks = [];
+  let nextId = 100;
+  /** @type {Map<number, Function>} */
+  const scheduled = new Map();
+  globalThis.setInterval = (cb) => { intervalCallbacks.push(cb); return intervalCallbacks.length; };
+  globalThis.clearInterval = () => { intervalCallbacks = []; };
+  globalThis.setTimeout = (cb) => { const id = ++nextId; scheduled.set(id, cb); return id; };
+  globalThis.clearTimeout = (id) => { scheduled.delete(id); };
+  return {
+    fireRotation() { intervalCallbacks.forEach(cb => cb()); },
+    runFade(id) { const cb = scheduled.get(id); if (cb) cb(); },
+    restore() {
+      globalThis.setInterval = real.setInterval;
+      globalThis.clearInterval = real.clearInterval;
+      globalThis.setTimeout = real.setTimeout;
+      globalThis.clearTimeout = real.clearTimeout;
+    }
+  };
+}
 
 describe('dashboard hero equivalence tickers', () => {
   beforeEach(() => {
     resetEquivTickersForTest();
     document.body.innerHTML = `
       <div class="hero-stat primary">
         <div class="hero-value" id="hero-tokens">0</div>
         <div class="hero-spark" id="hero-spark-tokens"></div>
         <div class="equiv-ticker" data-equiv-category="tokens"><span class="glyph">≈</span><span class="equiv-text"></span></div>
       </div>
@@ -36,11 +63,69 @@ describe('dashboard hero equivalence tickers', () => {
       tokens_by_model: { 'anthropic/claude-sonnet-5': { total: 21630000000 } },
       files_processed: 10,
       total_lines: 1000
     });
 
     renderDashboard(true);
 
     const text = document.querySelector('[data-equiv-category="tokens"] .equiv-text');
     expect(text.innerHTML.length).toBeGreaterThan(0);
   });
-});
\ No newline at end of file
+
+  it('clears interval, fade timeout, lines, and visible text when the value goes invalid', () => {
+    setCurrentData({
+      total_tokens: 100,
+      total_cost: { total: 5 },
+      total_cache_read: 0,
+      total_input: 0,
+      tokens_by_model: { 'm': { total: 100 } },
+      files_processed: 1,
+      total_lines: 10
+    });
+
+    const timers = captureTimers();
+    try {
+      renderDashboard(true);
+
+      const ticker = document.querySelector('[data-equiv-category="tokens"]');
+      expect(ticker._equivIntervalId).not.toBeNull();
+      expect(ticker.querySelector('.equiv-text').textContent).not.toBe('');
+
+      timers.fireRotation();
+      expect(ticker._equivFadeTimeout).not.toBeNull();
+
+      updateEquivTickers({ tokens: 0, cost: 0, burnRate: 0 });
+
+      expect(ticker._equivIntervalId).toBeNull();
+      expect(ticker._equivFadeTimeout).toBeNull();
+      expect(ticker._equivLines).toEqual([]);
+      expect(ticker.querySelector('.equiv-text').textContent).toBe('');
+    } finally {
+      timers.restore();
+    }
+  });
+
+  it('restarts a cleared ticker once a valid value returns', () => {
+    setCurrentData({
+      total_tokens: 100,
+      total_cost: { total: 5 },
+      total_cache_read: 0,
+      total_input: 0,
+      tokens_by_model: { 'm': { total: 100 } },
+      files_processed: 1,
+      total_lines: 10
+    });
+
+    renderDashboard(true);
+
+    const ticker = document.querySelector('[data-equiv-category="tokens"]');
+    expect(ticker._equivIntervalId).not.toBeNull();
+
+    updateEquivTickers({ tokens: 0, cost: 0, burnRate: 0 });
+    expect(ticker._equivIntervalId).toBeNull();
+    expect(ticker.querySelector('.equiv-text').textContent).toBe('');
+
+    updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });
+    expect(ticker._equivIntervalId).not.toBeNull();
+    expect(ticker.querySelector('.equiv-text').textContent).not.toBe('');
+  });
+});
diff --git a/tests/unit/equiv-ticker.test.js b/tests/unit/equiv-ticker.test.js
index f94074d..2424371 100644
--- a/tests/unit/equiv-ticker.test.js
+++ b/tests/unit/equiv-ticker.test.js
@@ -1,20 +1,74 @@
 // tests/unit/equiv-ticker.test.js
 import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
 import { initEquivTickers, updateEquivTickers, resetEquivTickersForTest } from '../../dashboard/js/equiv-ticker.js';
 
-const CORPUS = [
+const VALID_CORPUS = [
   { category: 'tokens', copy: '{n} tokens sampled' },
   { category: 'tokens', copy: 'another {n} tokens line' },
+  { category: 'cost', copy: '${n} spent' },
+  { category: 'burnRate', copy: '{n} per minute' }
+];
+
+const PARTIAL_CORPUS = [
+  { category: 'tokens', copy: '{n} tokens sampled' }
+];
+
+const MISSING_CATEGORY_CORPUS = [
+  { category: 'tokens', copy: '{n} tokens sampled' },
   { category: 'cost', copy: '${n} spent' }
 ];
 
+const BLANK_COPY_CORPUS = [
+  { category: 'tokens', copy: '' },
+  { category: 'tokens', copy: '   ' },
+  { category: 'cost', copy: '${n} spent' },
+  { category: 'burnRate', copy: '{n} per minute' }
+];
+
+const MALFORMED_BODIES = [
+  ['null payload', null],
+  ['non-array object', {}],
+  ['empty array', []],
+  ['unknown categories only', [{ category: 'mystery', copy: '{n} mystery factoid' }]],
+  ['missing burnRate category', MISSING_CATEGORY_CORPUS],
+  ['blank copy values', BLANK_COPY_CORPUS],
+  ['partial tokens-only', PARTIAL_CORPUS]
+];
+
+function captureTimers() {
+  const real = {
+    setInterval: globalThis.setInterval,
+    clearInterval: globalThis.clearInterval,
+    setTimeout: globalThis.setTimeout,
+    clearTimeout: globalThis.clearTimeout
+  };
+  let intervalCallbacks = [];
+  let nextId = 100;
+  /** @type {Map<number, Function>} */
+  const scheduled = new Map();
+  globalThis.setInterval = (cb) => { intervalCallbacks.push(cb); return intervalCallbacks.length; };
+  globalThis.clearInterval = () => { intervalCallbacks = []; };
+  globalThis.setTimeout = (cb) => { const id = ++nextId; scheduled.set(id, cb); return id; };
+  globalThis.clearTimeout = (id) => { scheduled.delete(id); };
+  return {
+    fireRotation() { intervalCallbacks.forEach(cb => cb()); },
+    runFade(id) { const cb = scheduled.get(id); if (cb) cb(); },
+    restore() {
+      globalThis.setInterval = real.setInterval;
+      globalThis.clearInterval = real.clearInterval;
+      globalThis.setTimeout = real.setTimeout;
+      globalThis.clearTimeout = real.clearTimeout;
+    }
+  };
+}
+
 describe('equiv-ticker', () => {
   beforeEach(() => {
     resetEquivTickersForTest();
     document.body.innerHTML = `
       <div class="equiv-ticker" data-equiv-category="tokens"><span class="equiv-text"></span></div>
       <div class="equiv-ticker" data-equiv-category="cost"><span class="equiv-text"></span></div>
       <div class="equiv-ticker" data-equiv-category="burnRate"><span class="equiv-text"></span></div>
     `;
   });
 
@@ -24,46 +78,103 @@ describe('equiv-ticker', () => {
 
   it('shows a curated fallback line immediately, before the corpus fetch resolves', () => {
     globalThis.fetch = mock(() => new Promise(() => {})); // never resolves
     initEquivTickers();
     updateEquivTickers({ tokens: 21630000000, cost: 11800, burnRate: 2150000 });
 
     const tokensText = document.querySelector('[data-equiv-category="tokens"] .equiv-text');
     expect(tokensText.innerHTML.length).toBeGreaterThan(0);
   });
 
-  it('mixes in corpus lines for the matching category once the fetch resolves', async () => {
-    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(CORPUS))));
-    initEquivTickers();
-    await Promise.resolve(); // let the fetch microtask chain settle
-    await Promise.resolve();
-    await Promise.resolve();
-    await Promise.resolve();
+  it('mixes in corpus lines for the matching category once a valid corpus resolves', async () => {
+    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(VALID_CORPUS))));
+    await initEquivTickers();
     updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });
 
     const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
     expect(tokensEl._equivLines.some(l => l.includes('100 tokens sampled'))).toBe(true);
     expect(tokensEl._equivLines.some(l => l.includes('another 100 tokens line'))).toBe(true);
     expect(tokensEl._equivLines.every(l => !l.includes('War and Peace'))).toBe(true);
   });
 
   it('falls back to curated-only lines forever when the corpus fetch fails, without throwing', async () => {
     globalThis.fetch = mock(() => Promise.reject(new Error('network down')));
-    initEquivTickers();
-    await Promise.resolve();
-    await Promise.resolve();
+    await initEquivTickers();
     expect(() => updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 })).not.toThrow();
 
     const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
     expect(tokensEl._equivLines.length).toBeGreaterThan(0);
     expect(tokensEl._equivLines.every(l => !l.includes('tokens sampled'))).toBe(true);
   });
 
-  it('skips a category whose value is missing, zero, or non-finite', () => {
+  MALFORMED_BODIES.forEach(([label, body]) => {
+    it(`keeps curated fallback lines for a ${label} corpus, without throwing or going blank`, async () => {
+      globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(body))));
+      await initEquivTickers();
+      expect(() => updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 })).not.toThrow();
+
+      const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
+      expect(tokensEl._equivLines.length).toBeGreaterThan(0);
+      expect(tokensEl._equivLines.every(l => !l.includes('tokens sampled'))).toBe(true);
+      expect(tokensEl.querySelector('.equiv-text').textContent).not.toBe('');
+    });
+  });
+
+  it('clears a category whose value is missing, zero, or non-finite', () => {
     globalThis.fetch = mock(() => new Promise(() => {}));
     initEquivTickers();
     updateEquivTickers({ tokens: 0, cost: NaN });
 
-    expect(document.querySelector('[data-equiv-category="tokens"]')._equivLines).toBeUndefined();
-    expect(document.querySelector('[data-equiv-category="cost"]')._equivLines).toBeUndefined();
+    const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
+    expect(tokensEl._equivLines).toEqual([]);
+    expect(tokensEl._equivIntervalId).toBeNull();
+    expect(tokensEl.querySelector('.equiv-text').textContent).toBe('');
+    const costEl = document.querySelector('[data-equiv-category="cost"]');
+    expect(costEl._equivLines).toEqual([]);
+    expect(costEl._equivIntervalId).toBeNull();
+  });
+
+  it('advances the rotation index and swaps text after a fade completes', () => {
+    globalThis.fetch = mock(() => new Promise(() => {}));
+    const timers = captureTimers();
+    try {
+      initEquivTickers();
+      updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });
+
+      const ticker = document.querySelector('[data-equiv-category="tokens"]');
+      const textEl = ticker.querySelector('.equiv-text');
+      const firstLine = textEl.innerHTML;
+      expect(ticker._equivRotationIndex).toBe(0);
+
+      timers.fireRotation();
+      const fadeId = ticker._equivFadeTimeout;
+      expect(fadeId).not.toBeNull();
+      timers.runFade(fadeId);
+      expect(ticker._equivRotationIndex).toBe(1);
+      expect(textEl.innerHTML).not.toBe(firstLine);
+    } finally {
+      timers.restore();
+    }
+  });
+
+  it('refreshes mounted fallback lines with corpus text when a delayed corpus resolves, without replacing the interval', async () => {
+    let resolveFetch;
+    globalThis.fetch = mock(() => new Promise((resolve) => {
+      resolveFetch = () => resolve(new Response(JSON.stringify(VALID_CORPUS)));
+    }));
+
+    const initPromise = initEquivTickers();
+    updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });
+
+    const ticker = document.querySelector('[data-equiv-category="tokens"]');
+    const originalIntervalId = ticker._equivIntervalId;
+    expect(originalIntervalId).not.toBeNull();
+    expect(ticker._equivLines.some(l => l.includes('War and Peace'))).toBe(true);
+
+    resolveFetch();
+    await initPromise;
+
+    expect(ticker._equivLines.some(l => l.includes('100 tokens sampled'))).toBe(true);
+    expect(ticker._equivLines.every(l => !l.includes('War and Peace'))).toBe(true);
+    expect(ticker._equivIntervalId).toBe(originalIntervalId);
   });
-});
\ No newline at end of file
+});
