# Task 3 Review Package

## Review range

- Base: `4e6a364`
- Head: `147e509`
- Brief: `.superpowers/sdd/2026-08-04-dashboard-audit-fixes/briefs/task-3-brief.md`
- Implementer report: /.superpowers/sdd/2026-08-04-dashboard-audit-fixes/briefs/task-3-report.md/ (worker claimed this path; verify whether it exists)

## Binding requirements

- `renderOdometer(el, valueStr)` must use a locale digit codec, preserve static separators, and track displayed plus newest pending strings.
- `updateOdometer(el, valueStr)` must keep the newest requested target while rolls are in flight and drain it after transitions settle; do not silently discard updates.
- Locale recognition and output must use the active `Intl.NumberFormat` glyphs and iterate formatted strings by code point with `Array.from`.
- Layout changes such as `999 -> 1,000` must rebuild immediately rather than attempting to animate across incompatible static columns.
- `heroTokens.dataset.value` is the newest requested numeric total, not evidence that the DOM has settled; odometer replay owns eventual settlement.
- Focused tests must cover first paint, same-value no-op, separator preservation, Arabic glyphs, digit-count rebuild, and rapid newest-target settlement.

## Commit summary

147e509 (HEAD -> worktree-dashboard-audit-fixes) fix(dashboard): queue locale-aware odometer updates

## Diff stat

 dashboard/js/odometer.js              | 225 ++++++++++++++++++++++++++--------
 dashboard/js/views/dashboard.js       |   6 +-
 tests/unit/dashboard-odometer.test.js |  57 +++++++++
 tests/unit/odometer.test.js           |  70 +++++++++++
 4 files changed, 309 insertions(+), 49 deletions(-)

## Full diff

diff --git a/dashboard/js/odometer.js b/dashboard/js/odometer.js
index 43f47ef..4b7e243 100644
--- a/dashboard/js/odometer.js
+++ b/dashboard/js/odometer.js
@@ -1,95 +1,224 @@
 // dashboard/js/odometer.js
+/**
+ * @typedef {Object} OdoColumn
+ * @property {HTMLElement} strip
+ * @property {HTMLElement} rowCur
+ * @property {number} digit
+ * @property {boolean} busy
+ * @property {number|null} pendingDigit
+ */
+
+/**
+ * @typedef {Object} DigitCodec
+ * @property {string} probe
+ * @property {string[]} digitToGlyph
+ * @property {Map<string, number>} glyphToDigit
+ */
+
+/**
+ * @typedef {Object} OdoState
+ * @property {Array<OdoColumn|string>} digitCols
+ * @property {string} valueStr
+ * @property {string|null} pendingValueStr
+ */
+
+/**
+ * Locale digit codec: maps each decimal digit to the glyph emitted by the
+ * active Intl.NumberFormat locale (e.g. '1' in en-US, '١' in ar-EG) and maps
+ * those glyphs back to digit values. Built lazily and rebuilt whenever the
+ * active locale stops matching the cached glyphs, so a test that temporarily
+ * swaps Intl.NumberFormat takes effect regardless of test ordering.
+ * @type {DigitCodec|null}
+ */
+let digitCodec = null;
+const getDigitCodec = () => {
+    const formatter = new Intl.NumberFormat(undefined, { useGrouping: false });
+    const probe = formatter.format(1);
+    if (digitCodec && digitCodec.probe === probe) return digitCodec;
+    const digitToGlyph = [];
+    const glyphToDigit = new Map();
+    for (let d = 0; d <= 9; d++) {
+        const glyph = formatter.format(d);
+        digitToGlyph.push(glyph);
+        glyphToDigit.set(glyph, d);
+    }
+    digitCodec = { probe, digitToGlyph, glyphToDigit };
+    return digitCodec;
+};
+
+/** @param {string} codePoint @returns {number|null} the digit a code point represents, or null for static text */
+const codecValue = (codePoint) => getDigitCodec().glyphToDigit.get(codePoint) ?? null;
+
+/** Transition fallback in case 'transitionend' never fires (reduced-motion, headless DOM). */
+const SETTLE_FALLBACK_MS = 650;
+
 /**
  * Per-element odometer state, keyed by the container element so multiple
  * odometers can coexist on one page without global mutable state.
- * @type {WeakMap<HTMLElement, {digitCols: Array<null|{strip: HTMLElement, rowCur: HTMLElement, digit: number, busy: boolean}>, valueStr: string}>}
+ * Each digitCols slot is either a column object or the static separator text.
+ * @type {WeakMap<HTMLElement, OdoState>}
  */
 const odometerState = new WeakMap();
 
 /**
  * (Re)build el's digit columns from scratch, showing valueStr immediately
- * with no roll animation. Non-digit characters (commas, currency symbols)
- * render as plain static spans.
+ * with no roll animation. Digit glyphs come from the locale codec; non-digit
+ * code points (commas, group separators, currency symbols) render as plain
+ * static spans. Stores the currently displayed string plus a null newest
+ * pending target.
  * @param {HTMLElement} el
  * @param {string} valueStr
  */
 export function renderOdometer(el, valueStr) {
+    const { digitToGlyph } = getDigitCodec();
     el.innerHTML = '';
-    /** @type {Array<null|{strip: HTMLElement, rowCur: HTMLElement, digit: number, busy: boolean}>} */
+    /** @type {OdoState['digitCols']} */
     const digitCols = [];
 
-    valueStr.split('').forEach((ch) => {
-        if (ch < '0' || ch > '9') {
+    Array.from(valueStr).forEach((codePoint) => {
+        const digit = codecValue(codePoint);
+        if (digit == null) {
             const staticEl = document.createElement('span');
             staticEl.className = 'odo-static';
-            staticEl.textContent = ch;
+            staticEl.textContent = codePoint;
             el.appendChild(staticEl);
-            digitCols.push(null);
+            digitCols.push(codePoint);
             return;
         }
         const col = document.createElement('span');
         col.className = 'odo-digit';
         const strip = document.createElement('span');
         strip.className = 'odo-digit-strip';
         const rowCur = document.createElement('span');
-        rowCur.textContent = ch;
+        rowCur.textContent = digitToGlyph[digit];
         strip.appendChild(rowCur);
         col.appendChild(strip);
         el.appendChild(col);
-        digitCols.push({ strip, rowCur, digit: parseInt(ch, 10), busy: false });
+        digitCols.push({ strip, rowCur, digit, busy: false, pendingDigit: null });
     });
 
-    odometerState.set(el, { digitCols, valueStr });
+    odometerState.set(el, { digitCols, valueStr, pendingValueStr: null });
 }
 
+/**
+ * Roll one digit column to `digit`. On settle, atomically set the displayed
+ * row, clear the busy flag, re-roll to any newer pending digit recorded for
+ * the column, and then drain the odometer toward its newest pending target.
+ * @param {HTMLElement} el
+ * @param {OdoState} state
+ * @param {OdoColumn} col
+ * @param {number} digit
+ */
+const startRoll = (el, state, col, digit) => {
+    const glyph = getDigitCodec().digitToGlyph[digit];
+    if (col.digit === digit) return;
+    col.busy = true;
+    col.pendingDigit = null;
+    const rowNext = document.createElement('span');
+    rowNext.textContent = glyph;
+    col.strip.appendChild(rowNext);
+    col.strip.style.transform = 'translateY(-1em)';
+
+    let done = false;
+    const settle = () => {
+        if (done) return;
+        done = true;
+        if (!col.strip.isConnected) return; // element was rebuilt; drop the stale roll
+        col.strip.style.transition = 'none';
+        col.rowCur.textContent = glyph;
+        col.strip.removeChild(rowNext);
+        col.strip.style.transform = 'translateY(0)';
+        // force reflow before re-enabling transition
+        col.strip.getBoundingClientRect();
+        col.strip.style.transition = '';
+        col.digit = digit;
+        col.busy = false;
+        const next = col.pendingDigit;
+        col.pendingDigit = null;
+        if (next != null && next !== col.digit) {
+            startRoll(el, state, col, next);
+            return;
+        }
+        drain(el, state);
+    };
+    col.strip.addEventListener('transitionend', settle, { once: true });
+    setTimeout(settle, SETTLE_FALLBACK_MS);
+};
+
+/** @param {OdoState} state @returns {string} the string currently committed to the DOM */
+const displayedString = (state) => state.digitCols
+    .map((slot) => typeof slot === 'string' ? slot : getDigitCodec().digitToGlyph[slot.digit])
+    .join('');
+
+/**
+ * After a transition settles, compare the displayed string against the newest
+ * pending target and roll any eligible column toward it. A later update
+ * replaces an older pending target rather than queuing an unbounded sequence;
+ * pendingValueStr clears only once the display matches it.
+ * @param {HTMLElement} el
+ * @param {OdoState} state
+ */
+const drain = (el, state) => {
+    const pending = state.pendingValueStr;
+    if (pending == null) return;
+    if (displayedString(state) === pending) {
+        state.valueStr = pending;
+        state.pendingValueStr = null;
+        return;
+    }
+    Array.from(pending).forEach((codePoint, idx) => {
+        const slot = state.digitCols[idx];
+        if (typeof slot === 'string') return;
+        const digit = codecValue(codePoint);
+        if (digit == null || digit === slot.digit) return;
+        if (slot.busy) {
+            slot.pendingDigit = digit;
+            return;
+        }
+        startRoll(el, state, slot, digit);
+    });
+};
+
 /**
  * Roll el's digit columns to reflect valueStr, animating only the columns
- * whose digit actually changed. Falls back to a full, unanimated
- * renderOdometer() when el has no prior state or the digit count changed
- * (e.g. '999' -> '1,000').
+ * whose digit actually changed. Records the newest requested string even when
+ * one or more columns are busy and drains it once each transition settles.
+ * Rebuilds immediately for a layout change (digit count or static separator
+ * layout), and falls back to a full renderOdometer() when el has no prior
+ * state.
  * @param {HTMLElement} el
  * @param {string} valueStr
  */
 export function updateOdometer(el, valueStr) {
     const state = odometerState.get(el);
-    const chars = valueStr.split('');
-    if (!state || chars.length !== state.digitCols.length) {
+    if (!state) {
         renderOdometer(el, valueStr);
         return;
     }
     if (valueStr === state.valueStr) return;
 
-    let anySkipped = false;
-    chars.forEach((ch, idx) => {
-        const col = state.digitCols[idx];
-        if (!col) return; // static char
-        const digit = parseInt(ch, 10);
-        if (digit === col.digit) return;
-        if (col.busy) { anySkipped = true; return; }
-
-        col.busy = true;
-        const rowNext = document.createElement('span');
-        rowNext.textContent = String(digit);
-        col.strip.appendChild(rowNext);
-        col.strip.style.transform = 'translateY(-1em)';
-
-        let done = false;
-        const settle = () => {
-            if (done) return;
-            done = true;
-            col.strip.style.transition = 'none';
-            col.rowCur.textContent = String(digit);
-            col.strip.removeChild(rowNext);
-            col.strip.style.transform = 'translateY(0)';
-            // force reflow before re-enabling transition
-            col.strip.getBoundingClientRect();
-            col.strip.style.transition = '';
-            col.digit = digit;
-            col.busy = false;
-        };
-        col.strip.addEventListener('transitionend', settle, { once: true });
-        setTimeout(settle, 650); // fallback in case transitionend doesn't fire (e.g. reduced-motion, headless DOM)
+    const codePoints = Array.from(valueStr);
+    const layoutChanged = codePoints.length !== state.digitCols.length || codePoints.some((codePoint, i) => {
+        const digit = codecValue(codePoint);
+        const slot = state.digitCols[i];
+        if (digit != null) return typeof slot === 'string';
+        return typeof slot !== 'string' || slot !== codePoint;
     });
+    if (layoutChanged) {
+        renderOdometer(el, valueStr);
+        return;
+    }
 
-    if (!anySkipped) state.valueStr = valueStr;
-}
\ No newline at end of file
+    state.pendingValueStr = valueStr;
+    codePoints.forEach((codePoint, idx) => {
+        const slot = state.digitCols[idx];
+        if (typeof slot === 'string') return;
+        const digit = codecValue(codePoint);
+        if (digit == null || digit === slot.digit) return;
+        if (slot.busy) {
+            slot.pendingDigit = digit;
+            return;
+        }
+        startRoll(el, state, slot, digit);
+    });
+}
diff --git a/dashboard/js/views/dashboard.js b/dashboard/js/views/dashboard.js
index b75ad87..b4013bb 100644
--- a/dashboard/js/views/dashboard.js
+++ b/dashboard/js/views/dashboard.js
@@ -36,21 +36,25 @@ export const renderDashboard = (fullRender = true) => {
     const chartData = historyData.length >= 2 ? historyData.slice(-30) : [];
     const shouldInitChart = chartData.length >= 2 && !liveChart;
 
     const cd = /** @type {DashboardData} */ (currentData);
     const { total_tokens, total_cost, tokens_by_model, files_processed, total_lines } = cd;
 
     // Update hero token count via the literal odometer. The digit roll
     // fires only when total_tokens actually changed and only after the
     // first paint — never on page load, never while idle (spec-mandated;
     // an earlier mockup draft that rolled on load/idle was corrected
-    // during review).
+    // during review). The gate is request-based: dataset.value records the
+    // newest *requested* total before updateOdometer is called, so a repeat
+    // of the same requested total is skipped, but the dataset is never used
+    // as proof the DOM has settled. The odometer's own replay state drains
+    // any newest pending target after each transition settles.
     const heroTokens = document.getElementById('hero-tokens');
     if (heroTokens) {
         const currentTokens = parseInt(heroTokens.dataset.value || '0');
         if (currentTokens !== total_tokens) {
             heroTokens.dataset.value = String(total_tokens);
             const formatted = fmtInt(total_tokens);
             updateOdometer(heroTokens, formatted);
         }
     }
 
diff --git a/tests/unit/dashboard-odometer.test.js b/tests/unit/dashboard-odometer.test.js
index b16814c..9ec661d 100644
--- a/tests/unit/dashboard-odometer.test.js
+++ b/tests/unit/dashboard-odometer.test.js
@@ -1,15 +1,43 @@
 // tests/unit/dashboard-odometer.test.js
 import { beforeEach, describe, expect, it, mock } from 'bun:test';
 import { renderDashboard } from '../../dashboard/js/views/dashboard.js';
 import { setCurrentData, setHistoryData } from '../../dashboard/js/state.js';
 
+/**
+ * Capture globalThis.setTimeout so odometer transition fallbacks (650 ms)
+ * can be driven synchronously via runAll() instead of waiting in real time.
+ */
+function captureTimers() {
+  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
+  let nextId = 1;
+  /** @type {Map<number, Function>} */
+  const scheduled = new Map();
+  globalThis.setTimeout = (cb) => { const id = nextId++; scheduled.set(id, cb); return id; };
+  globalThis.clearTimeout = (id) => { scheduled.delete(id); };
+  return {
+    /** Fire every scheduled callback, including any scheduled during firing. */
+    runAll() {
+      let guard = 0;
+      while (scheduled.size > 0 && guard++ < 100) {
+        const pending = [...scheduled.values()];
+        scheduled.clear();
+        pending.forEach((cb) => cb());
+      }
+    },
+    restore() {
+      globalThis.setTimeout = real.setTimeout;
+      globalThis.clearTimeout = real.clearTimeout;
+    }
+  };
+}
+
 const data = (total) => ({
   total_tokens: total,
   total_cost: { total: 0 },
   total_cache_read: 0,
   total_input: 0,
   tokens_by_model: { 'anthropic/claude-sonnet-5': { total } },
   files_processed: 0,
   total_lines: 0
 });
 
@@ -50,11 +78,40 @@ describe('dashboard hero-tokens odometer', () => {
       expect(strip.children.length).toBe(1);
     });
 
     // Real SSE-driven change:
     setCurrentData(data(1234568));
     renderDashboard(false);
 
     const lastStrip = document.getElementById('hero-tokens').querySelectorAll('.odo-digit-strip');
     expect(lastStrip[lastStrip.length - 1].children.length).toBe(2);
   });
+
+  it('drains the newest of three rapid totals after the transition fallback settles, without restarting on a repeat', () => {
+    const timers = captureTimers();
+    try {
+      setCurrentData(data(1001));
+      renderDashboard(true);
+
+      setCurrentData(data(1002));
+      renderDashboard(false);
+
+      setCurrentData(data(1003));
+      renderDashboard(false);
+
+      timers.runAll();
+
+      const heroTokens = document.getElementById('hero-tokens');
+      expect(heroTokens.textContent).toContain('1,003');
+      expect(heroTokens.dataset.value).toBe('1003');
+
+      // A repeated render of the same requested total must not start another roll.
+      setCurrentData(data(1003));
+      renderDashboard(false);
+      heroTokens.querySelectorAll('.odo-digit-strip').forEach((strip) => {
+        expect(strip.children).toHaveLength(1);
+      });
+    } finally {
+      timers.restore();
+    }
+  });
 });
\ No newline at end of file
diff --git a/tests/unit/odometer.test.js b/tests/unit/odometer.test.js
index 75d2445..68d9ccd 100644
--- a/tests/unit/odometer.test.js
+++ b/tests/unit/odometer.test.js
@@ -1,14 +1,42 @@
 // tests/unit/odometer.test.js
 import { beforeEach, describe, expect, it } from 'bun:test';
 import { renderOdometer, updateOdometer } from '../../dashboard/js/odometer.js';
 
+/**
+ * Capture globalThis.setTimeout so odometer transition fallbacks (650 ms)
+ * can be driven synchronously via runAll() instead of waiting in real time.
+ */
+function captureTimers() {
+  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
+  let nextId = 1;
+  /** @type {Map<number, Function>} */
+  const scheduled = new Map();
+  globalThis.setTimeout = (cb) => { const id = nextId++; scheduled.set(id, cb); return id; };
+  globalThis.clearTimeout = (id) => { scheduled.delete(id); };
+  return {
+    /** Fire every scheduled callback, including any scheduled during firing. */
+    runAll() {
+      let guard = 0;
+      while (scheduled.size > 0 && guard++ < 100) {
+        const pending = [...scheduled.values()];
+        scheduled.clear();
+        pending.forEach((cb) => cb());
+      }
+    },
+    restore() {
+      globalThis.setTimeout = real.setTimeout;
+      globalThis.clearTimeout = real.clearTimeout;
+    }
+  };
+}
+
 describe('odometer', () => {
   let el;
 
   beforeEach(() => {
     document.body.innerHTML = '<div id="odo"></div>';
     el = document.getElementById('odo');
   });
 
   it('renders static digit columns with no transform on first build', () => {
     renderOdometer(el, '1,234');
@@ -50,11 +78,53 @@ describe('odometer', () => {
   });
 
   it('ignores a call with an unchanged value (no-op, no busy columns left dangling)', () => {
     renderOdometer(el, '1,234');
     updateOdometer(el, '1,234');
 
     el.querySelectorAll('.odo-digit-strip').forEach((strip) => {
       expect(strip.children.length).toBe(1);
     });
   });
+
+  it('treats Arabic-Indic glyphs as digits and ٬ as a static separator via the locale codec', () => {
+    const RealNF = Intl.NumberFormat;
+    const timers = captureTimers();
+    try {
+      Intl.NumberFormat = class extends RealNF {
+        constructor(locale, opts) { super(locale || 'ar-EG', opts); }
+      };
+
+      renderOdometer(el, '١٬٢٣٤');
+      const digits = el.querySelectorAll('.odo-digit');
+      expect(digits).toHaveLength(4);
+      const statics = el.querySelectorAll('.odo-static');
+      expect(statics).toHaveLength(1);
+      expect(statics[0].textContent).toBe('٬');
+
+      updateOdometer(el, '١٬٢٣٥');
+      const strips = el.querySelectorAll('.odo-digit-strip');
+      const lastStrip = strips[strips.length - 1];
+      expect(lastStrip.children).toHaveLength(2); // mid-roll
+      expect(lastStrip.lastChild.textContent).toBe('٥'); // target glyph, not '5'
+
+      timers.runAll();
+      expect(el.textContent).toContain('١٬٢٣٥');
+    } finally {
+      timers.restore();
+      Intl.NumberFormat = RealNF;
+    }
+  });
+
+  it('settles the newest of rapid updates while a column is busy (newest-target replay)', () => {
+    const timers = captureTimers();
+    try {
+      renderOdometer(el, '1,001');
+      updateOdometer(el, '1,002');
+      updateOdometer(el, '1,003');
+      timers.runAll();
+      expect(el.textContent).toContain('1,003');
+    } finally {
+      timers.restore();
+    }
+  });
 });
\ No newline at end of file
