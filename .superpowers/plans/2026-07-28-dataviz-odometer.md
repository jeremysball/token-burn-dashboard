# Literal Odometer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `#hero-tokens`' abbreviated tween-counter with a mechanical odometer digit-roll showing the literal, comma-grouped token count, rolling only the digits that actually changed on a real SSE-driven update — never on page load, never while idle.

**Architecture:** A new `dashboard/js/odometer.js` module owns the digit-column DOM building and per-digit roll animation (ported from the mockup's proven implementation, which was already corrected once during mockup review to avoid the "58 permanently-hidden rows" accessibility issue). `renderDashboard()` calls it in place of the current `animateNumber(...)` call on `#hero-tokens`, gated by a one-time "already initialized" flag so the very first render draws static digits with no roll.

**Tech Stack:** Vanilla ES modules, CSS transforms, `bun:test` + `happy-dom`.

## Global Constraints

- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 2 ("Literal odometer").
- Must never animate on page load or while the value is unchanged ("idle") — only on a real value change after the first render.
- Respect `prefers-reduced-motion: reduce` (no transition), matching every other animated widget in `dashboard/styles/`.
- This intentionally changes `#hero-tokens`' display from abbreviated (`21.63B`) to literal comma-grouped digits (`21,632,798,453`) — a deliberate reframing per the spec's "literal odometer" framing, not an oversight. `#hero-cost`'s existing `animateNumber` tween is untouched; this plan only touches `#hero-tokens`.

---

### Task 1: `odometer.js` — digit-column build and selective roll

**Files:**
- Create: `dashboard/js/odometer.js`
- Test: `tests/unit/odometer.test.js`

**Interfaces:**
- Produces:
  - `renderOdometer(el: HTMLElement, valueStr: string): void` — (re)builds `el`'s digit columns from scratch, showing `valueStr` immediately with no animation. Used for the first render and whenever the digit count changes (e.g. crossing a comma boundary).
  - `updateOdometer(el: HTMLElement, valueStr: string): void` — if `el` has no prior odometer state, or `valueStr`'s length differs from the previous render, delegates to `renderOdometer`. Otherwise rolls only the columns whose digit actually changed.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/odometer.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderOdometer, updateOdometer } from '../../dashboard/js/odometer.js';

describe('odometer', () => {
  let el;

  beforeEach(() => {
    document.body.innerHTML = '<div id="odo"></div>';
    el = document.getElementById('odo');
  });

  it('renders static digit columns with no transform on first build', () => {
    renderOdometer(el, '1,234');
    const digits = el.querySelectorAll('.odo-digit');
    expect(digits.length).toBe(4); // '1', '2', '3', '4' — comma is a static char
    const statics = el.querySelectorAll('.odo-static');
    expect(statics.length).toBe(1);
    expect(statics[0].textContent).toBe(',');
    digits.forEach((d) => {
      const strip = d.querySelector('.odo-digit-strip');
      expect(strip.style.transform).toBe('');
    });
  });

  it('delegates to a full rebuild when called without a prior render', () => {
    updateOdometer(el, '42');
    expect(el.querySelectorAll('.odo-digit').length).toBe(2);
  });

  it('rolls only the digit column(s) that actually changed', () => {
    renderOdometer(el, '1,234');
    updateOdometer(el, '1,235');

    const digitCols = el.querySelectorAll('.odo-digit');
    // last digit (4 -> 5) should have a rowNext appended (mid-roll)
    const lastStrip = digitCols[digitCols.length - 1].querySelector('.odo-digit-strip');
    expect(lastStrip.children.length).toBe(2);
    // an unchanged digit column should still have exactly one row
    const firstStrip = digitCols[0].querySelector('.odo-digit-strip');
    expect(firstStrip.children.length).toBe(1);
  });

  it('rebuilds instead of rolling when the digit count changes', () => {
    renderOdometer(el, '999');
    updateOdometer(el, '1,000');

    expect(el.querySelectorAll('.odo-digit').length).toBe(4);
    expect(el.querySelectorAll('.odo-static').length).toBe(1);
  });

  it('ignores a call with an unchanged value (no-op, no busy columns left dangling)', () => {
    renderOdometer(el, '1,234');
    updateOdometer(el, '1,234');

    el.querySelectorAll('.odo-digit-strip').forEach((strip) => {
      expect(strip.children.length).toBe(1);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/odometer.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/odometer.js'`

- [ ] **Step 3: Write the module**

```js
// dashboard/js/odometer.js
/**
 * Per-element odometer state, keyed by the container element so multiple
 * odometers can coexist on one page without global mutable state.
 * @type {WeakMap<HTMLElement, {digitCols: Array<null|{strip: HTMLElement, rowCur: HTMLElement, digit: number, busy: boolean}>, valueStr: string}>}
 */
const odometerState = new WeakMap();

/**
 * (Re)build el's digit columns from scratch, showing valueStr immediately
 * with no roll animation. Non-digit characters (commas, currency symbols)
 * render as plain static spans.
 * @param {HTMLElement} el
 * @param {string} valueStr
 */
export function renderOdometer(el, valueStr) {
    el.innerHTML = '';
    /** @type {Array<null|{strip: HTMLElement, rowCur: HTMLElement, digit: number, busy: boolean}>} */
    const digitCols = [];

    valueStr.split('').forEach((ch) => {
        if (ch < '0' || ch > '9') {
            const staticEl = document.createElement('span');
            staticEl.className = 'odo-static';
            staticEl.textContent = ch;
            el.appendChild(staticEl);
            digitCols.push(null);
            return;
        }
        const col = document.createElement('span');
        col.className = 'odo-digit';
        const strip = document.createElement('span');
        strip.className = 'odo-digit-strip';
        const rowCur = document.createElement('span');
        rowCur.textContent = ch;
        strip.appendChild(rowCur);
        col.appendChild(strip);
        el.appendChild(col);
        digitCols.push({ strip, rowCur, digit: parseInt(ch, 10), busy: false });
    });

    odometerState.set(el, { digitCols, valueStr });
}

/**
 * Roll el's digit columns to reflect valueStr, animating only the columns
 * whose digit actually changed. Falls back to a full, unanimated
 * renderOdometer() when el has no prior state or the digit count changed
 * (e.g. '999' -> '1,000').
 * @param {HTMLElement} el
 * @param {string} valueStr
 */
export function updateOdometer(el, valueStr) {
    const state = odometerState.get(el);
    const chars = valueStr.split('');
    if (!state || chars.length !== state.digitCols.length) {
        renderOdometer(el, valueStr);
        return;
    }
    if (valueStr === state.valueStr) return;

    chars.forEach((ch, idx) => {
        const col = state.digitCols[idx];
        if (!col) return; // static char
        const digit = parseInt(ch, 10);
        if (digit === col.digit || col.busy) return;

        col.busy = true;
        const rowNext = document.createElement('span');
        rowNext.textContent = String(digit);
        col.strip.appendChild(rowNext);
        col.strip.style.transform = 'translateY(-1em)';

        let done = false;
        const settle = () => {
            if (done) return;
            done = true;
            col.strip.style.transition = 'none';
            col.rowCur.textContent = String(digit);
            col.strip.removeChild(rowNext);
            col.strip.style.transform = 'translateY(0)';
            // eslint-disable-next-line no-unused-expressions -- force reflow before re-enabling transition
            col.strip.getBoundingClientRect();
            col.strip.style.transition = '';
            col.digit = digit;
            col.busy = false;
        };
        col.strip.addEventListener('transitionend', settle, { once: true });
        setTimeout(settle, 650); // fallback in case transitionend doesn't fire (e.g. reduced-motion, headless DOM)
    });

    state.valueStr = valueStr;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/odometer.test.js`
Expected: PASS (5 tests) — the `transitionend`-driven roll settles via the 650ms `setTimeout` fallback in the test environment (happy-dom doesn't fire real transition events), which the "rolls only the changed digit" test observes mid-flight before that fallback fires.

- [ ] **Step 5: Commit**

```bash
git add dashboard/js/odometer.js tests/unit/odometer.test.js
git commit -m "feat(dashboard): add odometer digit-roll module"
```

---

### Task 2: Wire the odometer into `#hero-tokens`

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/js/views/dashboard.js`
- Modify: `dashboard/styles/design-v2.css`
- Test: `tests/unit/dashboard-odometer.test.js`

**Interfaces:**
- Consumes: `renderOdometer`, `updateOdometer` from `dashboard/js/odometer.js` (Task 1); `fmtInt` from `dashboard/js/utils.js` (already exported, not yet imported by `dashboard.js`).

- [ ] **Step 1: Add the `odometer` class to `#hero-tokens`**

In `dashboard/index.html`, change:

```html
                    <div class="hero-value" id="hero-tokens">0</div>
```

to:

```html
                    <div class="hero-value odometer" id="hero-tokens">0</div>
```

- [ ] **Step 2: Add odometer CSS**

In `dashboard/styles/design-v2.css`, right after the `.equiv-ticker` block added by the equivalence-ticker plan (or, if that plan hasn't landed yet in this worktree, right after the `pulse-value` keyframes at `dashboard/styles/design-v2.css:280`), insert:

```css
.hero-value.odometer { display: flex; align-items: baseline; }
.odo-digit { display: inline-block; overflow: hidden; height: 1em; width: 0.64em; position: relative; }
.odo-digit-strip { position: absolute; left: 0; top: 0; transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); }
.odo-digit-strip span { display: block; height: 1em; line-height: 1em; }
.odo-static { display: inline-block; }
@media (prefers-reduced-motion: reduce) { .odo-digit-strip { transition: none; } }
```

- [ ] **Step 3: Write the failing integration test**

```js
// tests/unit/dashboard-odometer.test.js
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderDashboard } from '../../dashboard/js/views/dashboard.js';
import { setCurrentData, setHistoryData } from '../../dashboard/js/state.js';

const data = (total) => ({
  total_tokens: total,
  total_cost: { total: 0 },
  total_cache_read: 0,
  total_input: 0,
  tokens_by_model: { 'anthropic/claude-sonnet-5': { total } },
  files_processed: 0,
  total_lines: 0
});

describe('dashboard hero-tokens odometer', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="hero-value odometer" id="hero-tokens">0</div>
      <div class="hero-value" id="hero-cost">$0.00</div>
      <div class="hero-value burn-rate-value" id="burn-rate">0/min</div>
      <div id="last-update"></div>
      <div id="footer-stats"></div>
      <div id="top-models-grid"></div>
      <div id="insights-grid"></div>
    `;
    window.animateNumber = mock();
    globalThis.fetch = mock(() => new Promise(() => {}));
    setHistoryData([]);
  });

  it('shows the literal digit count with no roll animation on the first render', () => {
    setCurrentData(data(1234567));
    renderDashboard(true);

    const heroTokens = document.getElementById('hero-tokens');
    expect(heroTokens.querySelectorAll('.odo-digit').length).toBe(7);
    heroTokens.querySelectorAll('.odo-digit-strip').forEach((strip) => {
      expect(strip.children.length).toBe(1); // no in-flight roll on first paint
    });
  });

  it('rolls the changed digits on a subsequent real value change, not on an idle re-render', () => {
    setCurrentData(data(1234567));
    renderDashboard(true);

    // Idle re-render with the same value: nothing should start rolling.
    renderDashboard(false);
    document.getElementById('hero-tokens').querySelectorAll('.odo-digit-strip').forEach((strip) => {
      expect(strip.children.length).toBe(1);
    });

    // Real SSE-driven change:
    setCurrentData(data(1234568));
    renderDashboard(false);

    const lastStrip = document.getElementById('hero-tokens').querySelectorAll('.odo-digit-strip');
    expect(lastStrip[lastStrip.length - 1].children.length).toBe(2);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/unit/dashboard-odometer.test.js`
Expected: FAIL — `#hero-tokens` still has plain text content, no `.odo-digit` children, since `renderDashboard()` hasn't been wired up yet.

- [ ] **Step 5: Wire the odometer into `renderDashboard()`**

In `dashboard/js/views/dashboard.js`, add `fmtInt` to the existing `utils.js` import (`dashboard/js/views/dashboard.js:2`):

```js
import { fmtNum, fmtInt, fmtCur, createSparkline, splitModelKey, displayModel, escapeHtml, parseModelKey, notify } from '../utils.js';
```

Add the odometer import next to it:

```js
import { renderOdometer, updateOdometer } from '../odometer.js';
```

Replace the existing hero-tokens block (`dashboard/js/views/dashboard.js:39-46`):

```js
    // Update hero stats with animation
    const heroTokens = document.getElementById('hero-tokens');
    if (heroTokens) {
        const currentTokens = parseInt(heroTokens.dataset.value || '0');
        if (currentTokens !== total_tokens) {
            heroTokens.dataset.value = String(total_tokens);
            getGlobal('animateNumber')(heroTokens, currentTokens, total_tokens, 800, '', '');
        }
    }
```

with:

```js
    // Update hero token count via the literal odometer. The digit roll
    // fires only when total_tokens actually changed and only after the
    // first paint — never on page load, never while idle (spec-mandated;
    // an earlier mockup draft that rolled on load/idle was corrected
    // during review).
    const heroTokens = document.getElementById('hero-tokens');
    if (heroTokens) {
        const currentTokens = parseInt(heroTokens.dataset.value || '0');
        if (currentTokens !== total_tokens) {
            heroTokens.dataset.value = String(total_tokens);
            const formatted = fmtInt(total_tokens);
            if (heroTokens.dataset.odometerInitialized === 'true') {
                updateOdometer(heroTokens, formatted);
            } else {
                renderOdometer(heroTokens, formatted);
                heroTokens.dataset.odometerInitialized = 'true';
            }
        }
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/unit/dashboard-odometer.test.js`
Expected: PASS (2 tests)

- [ ] **Step 7: Run the full unit suite to catch regressions**

Run: `bun run test`
Expected: PASS. In particular, re-check `tests/unit/dashboard-view.test.js`'s existing assertions about `#hero-tokens` — none of them assert on `.textContent` of that element (confirmed by reading that file during planning), so replacing its DOM structure with digit-column spans does not break them. If a future test does add such an assertion, update it to check `.dataset.value` (still set to the raw numeric string) instead of rendered text.

- [ ] **Step 8: Commit**

```bash
git add dashboard/index.html dashboard/js/views/dashboard.js dashboard/styles/design-v2.css tests/unit/dashboard-odometer.test.js
git commit -m "feat(dashboard): roll hero-tokens as a literal digit odometer"
```
