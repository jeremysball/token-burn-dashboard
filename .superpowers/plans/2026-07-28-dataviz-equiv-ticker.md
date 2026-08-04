# Equivalence Ticker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the hero-section equivalence ticker — a fade-swap-fade rotating line under each of the three hero stats (`total tokens`, `lifetime cost`, `burn rate`) that expresses the live value in relatable terms, sampled from the 1000-entry factoid corpus.

**Architecture:** A new `dashboard/js/equiv-ticker.js` module owns corpus fetching, sampling, and the rotation DOM mechanic; `renderDashboard()` in `dashboard/js/views/dashboard.js` calls it once per render with the current tokens/cost/burnRate values. Markup lives in `dashboard/index.html`; new CSS lives in `dashboard/styles/design-v2.css` next to the existing `.hero-stat` rules it visually extends.

**Tech Stack:** Vanilla ES modules, `fetch`, `bun:test` + `happy-dom` for unit tests, Playwright for the overflow/visibility smoke check.

## Global Constraints

- Depends on `.superpowers/plans/2026-07-28-dataviz-foundations.md` having merged first (`dashboard/js/equiv-format.js`'s `formatFactoid()`, and `dashboard/data/factoids-1000.json` being servable at `/data/factoids-1000.json`).
- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 2 ("Equivalence ticker") and Section 5 ("Corpus fetch failure").
- Corpus fetch failure must silently fall back to curated, hand-derived lines — never a blank ticker or a thrown error (Section 5).
- Respect `prefers-reduced-motion: reduce` for the fade transition, matching every other animated widget already in `dashboard/styles/`.

---

### Task 1: `equiv-ticker.js` — sampling, formatting, and fetch-failure fallback

**Files:**
- Create: `dashboard/js/equiv-ticker.js`
- Test: `tests/unit/equiv-ticker.test.js`

**Interfaces:**
- Consumes: `formatFactoid(copyTemplate, n)` from `dashboard/js/equiv-format.js` (produced by the foundations plan).
- Produces:
  - `initEquivTickers(): void` — call once at app startup; kicks off the (memoized) corpus fetch.
  - `updateEquivTickers(values: {tokens?: number, cost?: number, burnRate?: number}): void` — call on every dashboard render; for each `.equiv-ticker[data-equiv-category]` element in the DOM whose category has a finite, positive value in `values`, (re)samples lines and starts/refreshes its rotation. Later tasks (dashboard.js wiring) call this.
  - `resetEquivTickersForTest(): void` — test-only escape hatch that clears the module's memoized corpus/fetch state between tests (exported so `tests/unit/equiv-ticker.test.js` doesn't leak fetch mocks across `it()` blocks).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/equiv-ticker.test.js
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { initEquivTickers, updateEquivTickers, resetEquivTickersForTest } from '../../dashboard/js/equiv-ticker.js';

const CORPUS = [
  { category: 'tokens', copy: '{n} tokens sampled' },
  { category: 'tokens', copy: 'another {n} tokens line' },
  { category: 'cost', copy: '${n} spent' }
];

describe('equiv-ticker', () => {
  beforeEach(() => {
    resetEquivTickersForTest();
    document.body.innerHTML = `
      <div class="equiv-ticker" data-equiv-category="tokens"><span class="equiv-text"></span></div>
      <div class="equiv-ticker" data-equiv-category="cost"><span class="equiv-text"></span></div>
      <div class="equiv-ticker" data-equiv-category="burnRate"><span class="equiv-text"></span></div>
    `;
  });

  afterEach(() => {
    resetEquivTickersForTest();
  });

  it('shows a curated fallback line immediately, before the corpus fetch resolves', () => {
    globalThis.fetch = mock(() => new Promise(() => {})); // never resolves
    initEquivTickers();
    updateEquivTickers({ tokens: 21630000000, cost: 11800, burnRate: 2150000 });

    const tokensText = document.querySelector('[data-equiv-category="tokens"] .equiv-text');
    expect(tokensText.innerHTML.length).toBeGreaterThan(0);
  });

  it('mixes in corpus lines for the matching category once the fetch resolves', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(CORPUS))));
    initEquivTickers();
    await Promise.resolve(); // let the fetch microtask chain settle
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });

    const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
    expect(tokensEl._equivLines.some(l => l.includes('100 tokens sampled'))).toBe(true);
    expect(tokensEl._equivLines.some(l => l.includes('another 100 tokens line'))).toBe(true);
    expect(tokensEl._equivLines.every(l => !l.includes('War and Peace'))).toBe(true);
  });

  it('falls back to curated-only lines forever when the corpus fetch fails, without throwing', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network down')));
    initEquivTickers();
    await Promise.resolve();
    await Promise.resolve();
    expect(() => updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 })).not.toThrow();

    const tokensEl = document.querySelector('[data-equiv-category="tokens"]');
    expect(tokensEl._equivLines.length).toBeGreaterThan(0);
    expect(tokensEl._equivLines.every(l => !l.includes('tokens sampled'))).toBe(true);
  });

  it('skips a category whose value is missing, zero, or non-finite', () => {
    globalThis.fetch = mock(() => new Promise(() => {}));
    initEquivTickers();
    updateEquivTickers({ tokens: 0, cost: NaN });

    expect(document.querySelector('[data-equiv-category="tokens"]')._equivLines).toBeUndefined();
    expect(document.querySelector('[data-equiv-category="cost"]')._equivLines).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/equiv-ticker.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/equiv-ticker.js'`

- [ ] **Step 3: Write the module**

```js
// dashboard/js/equiv-ticker.js
import { formatFactoid } from './equiv-format.js';

const CORPUS_URL = '/data/factoids-1000.json';
const SAMPLE_SIZE = 25;
const ROTATE_MS = 4200;
const FADE_MS = 350;

// Real-data-derived, hand-checked lines kept inline (not sourced from the
// corpus) so the ticker never goes blank while the corpus fetch is pending,
// and stays meaningful even if it never resolves (Section 5 of the spec).
const CURATED_FALLBACK = {
    tokens: [
        'the ~497k-line codebase, regenerated from scratch, <b>~{n/4970000:.0f}×</b> over',
        '<b>War and Peace</b>, cover-to-cover, roughly <b>{n/763000:.0f} times</b>',
        '<b>~{n*4/200/60/24/365:.0f} years</b> of an engineer typing non-stop, 24/7, at 200 chars/min'
    ],
    cost: [
        '<b>{n/80:.0f} hours</b> of senior engineer time at $80/hr',
        'roughly <b>{n/28000:.1f}×</b> a well-used Miata (informal reference point)'
    ],
    burnRate: [
        'the whole codebase, rebuilt from scratch, every <b>~{4970000/n:.1f} minutes</b>',
        '≈ <b>{n/1000000:.2f}M</b> tokens every minute, before cache discounts'
    ]
};

/** @type {any[]|null} */
let corpus = null;

/** @type {Promise<void>|null} */
let corpusFetchPromise = null;

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

function ensureCorpusLoaded() {
    if (corpusFetchPromise) return corpusFetchPromise;
    corpusFetchPromise = fetch(CORPUS_URL)
        .then((r) => {
            if (!r.ok) throw new Error(`corpus fetch failed: ${r.status}`);
            return r.json();
        })
        .then((data) => { corpus = data; })
        .catch((err) => {
            console.warn('equivalence corpus fetch failed, staying on curated lines only', err);
        });
    return corpusFetchPromise;
}

/** @type {Record<string, {n: number, lines: string[]}>} */
let _buildLinesCache = {};

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

/**
 * Start (or hand fresh lines to) a ticker's rotation. Re-sampled lines are
 * applied without restarting an in-flight rotation, so a per-render call
 * never interrupts a fade transition already underway.
 * @param {any} el
 * @param {string[]} lines
 */
function ensureRunning(el, lines) {
    el._equivLines = lines;
    if (el._equivIntervalId) return;

    const textEl = el.querySelector('.equiv-text');
    if (!textEl) return;
    let i = 0;
    textEl.innerHTML = el._equivLines[0] || '';

    const next = () => {
        if (!el._equivLines.length) return;
        textEl.classList.add('fade');
        setTimeout(() => {
            i = (i + 1) % el._equivLines.length;
            textEl.innerHTML = el._equivLines[i];
            textEl.classList.remove('fade');
        }, FADE_MS);
    };
    el._equivIntervalId = setInterval(next, ROTATE_MS);
}

export function initEquivTickers() {
    ensureCorpusLoaded();
}

/**
 * @param {{tokens?: number, cost?: number, burnRate?: number}} values
 */
export function updateEquivTickers(values) {
    const tickers = document.querySelectorAll('.equiv-ticker[data-equiv-category]');
    tickers.forEach((el) => {
        const category = /** @type {HTMLElement} */ (el).dataset.equivCategory;
        const n = category ? values[/** @type {'tokens'|'cost'|'burnRate'} */ (category)] : undefined;
        if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return;
        const lines = buildLines(/** @type {string} */ (category), n);
        if (!lines.length) return;
        ensureRunning(el, lines);
    });
}

export function resetEquivTickersForTest() {
    corpus = null;
    corpusFetchPromise = null;
    _buildLinesCache = {};
    document.querySelectorAll('.equiv-ticker').forEach((el) => {
        if (/** @type {any} */ (el)._equivIntervalId) clearInterval(/** @type {any} */ (el)._equivIntervalId);
        /** @type {any} */ (el)._equivIntervalId = null;
        /** @type {any} */ (el)._equivLines = undefined;
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/equiv-ticker.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add dashboard/js/equiv-ticker.js tests/unit/equiv-ticker.test.js
git commit -m "feat(dashboard): add equivalence-ticker sampling and rotation module"
```

---

### Task 2: Wire the ticker into the hero section

**Files:**
- Modify: `dashboard/index.html`
- Modify: `dashboard/js/main.js`
- Modify: `dashboard/js/views/dashboard.js`
- Modify: `dashboard/styles/design-v2.css`
- Test: `tests/unit/dashboard-equiv-ticker.test.js`

**Interfaces:**
- Consumes: `initEquivTickers`, `updateEquivTickers` from `dashboard/js/equiv-ticker.js` (Task 1).

- [ ] **Step 1: Add ticker markup to the hero section**

In `dashboard/index.html`, inside `<section class="hero-section">` (`dashboard/index.html:42-64`), add one `.equiv-ticker` block per stat, right after each stat's existing spark/heatmap content:

```html
                <div class="hero-stat primary">
                    <div class="hero-label">total tokens</div>
                    <div class="hero-value" id="hero-tokens">0</div>
                    <div class="hero-spark" id="hero-spark-tokens"></div>
                    <div class="equiv-ticker" data-equiv-category="tokens">
                        <span class="glyph">≈</span>
                        <span class="equiv-text"></span>
                    </div>
                </div>
                <div class="hero-stat secondary">
                    <div class="hero-label">lifetime cost</div>
                    <div class="hero-value" id="hero-cost">$0.00</div>
                    <div class="hero-spark" id="hero-spark-cost"></div>
                    <div class="equiv-ticker" data-equiv-category="cost">
                        <span class="glyph">≈</span>
                        <span class="equiv-text"></span>
                    </div>
                </div>
                <div class="hero-stat burn-rate">
                    <div class="hero-label">burn rate <span class="burn-rate-badge" id="burn-rate-badge">●</span></div>
                    <div class="hero-value burn-rate-value" id="burn-rate">0/min</div>
                    <div class="burn-rate-heatmap" id="burn-rate-heatmap">
                        <div class="heatmap-empty">Collecting data...</div>
                    </div>
                    <div class="heatmap-labels">
                        <span>-1h</span>
                        <span>now</span>
                    </div>
                    <div class="equiv-ticker" data-equiv-category="burnRate" style="font-size:0.78rem;">
                        <span class="glyph">≈</span>
                        <span class="equiv-text"></span>
                    </div>
                </div>
```

- [ ] **Step 2: Add ticker CSS**

In `dashboard/styles/design-v2.css`, right after the `.hero-value.pulse` / `pulse-value` keyframes block (`dashboard/styles/design-v2.css:280`) and before the `/* Burn rate redesign */` comment, insert:

```css
.equiv-ticker {
  margin-top: 14px;
  display: flex;
  align-items: baseline;
  gap: 9px;
  background: var(--mono-bg);
  border-left: 2px solid var(--mono-accent);
  padding: 9px 12px;
  font-size: 0.8rem;
  line-height: 1.5;
}
.equiv-ticker .glyph { color: var(--mono-accent); flex: none; font-weight: 700; }
.equiv-ticker .equiv-text {
  color: var(--mono-text-muted);
  min-width: 0;
  transition: opacity 0.35s ease;
}
.equiv-ticker .equiv-text.fade { opacity: 0; }
.equiv-ticker .equiv-text b { color: var(--mono-text); font-weight: 700; }
@media (prefers-reduced-motion: reduce) {
  .equiv-ticker .equiv-text { transition: none; }
}
```

- [ ] **Step 3: Write the failing integration test**

```js
// tests/unit/dashboard-equiv-ticker.test.js
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderDashboard } from '../../dashboard/js/views/dashboard.js';
import { setCurrentData, setHistoryData } from '../../dashboard/js/state.js';
import { resetEquivTickersForTest } from '../../dashboard/js/equiv-ticker.js';

describe('dashboard hero equivalence tickers', () => {
  beforeEach(() => {
    resetEquivTickersForTest();
    document.body.innerHTML = `
      <div class="hero-stat primary">
        <div class="hero-value" id="hero-tokens">0</div>
        <div class="hero-spark" id="hero-spark-tokens"></div>
        <div class="equiv-ticker" data-equiv-category="tokens"><span class="glyph">≈</span><span class="equiv-text"></span></div>
      </div>
      <div class="hero-value" id="hero-cost">$0.00</div>
      <div class="hero-value burn-rate-value" id="burn-rate">0/min</div>
      <div class="equiv-ticker" data-equiv-category="cost"><span class="equiv-text"></span></div>
      <div class="equiv-ticker" data-equiv-category="burnRate"><span class="equiv-text"></span></div>
      <div id="last-update"></div>
      <div id="footer-stats"></div>
      <div id="top-models-grid"></div>
      <div id="insights-grid"></div>
    `;
    window.animateNumber = mock();
    globalThis.fetch = mock(() => new Promise(() => {}));
    setHistoryData([]);
  });

  it('populates the tokens ticker text after a render with real data', () => {
    setCurrentData({
      total_tokens: 21630000000,
      total_cost: { total: 11800 },
      total_cache_read: 0,
      total_input: 100,
      tokens_by_model: { 'anthropic/claude-sonnet-5': { total: 21630000000 } },
      files_processed: 10,
      total_lines: 1000
    });

    renderDashboard(true);

    const text = document.querySelector('[data-equiv-category="tokens"] .equiv-text');
    expect(text.innerHTML.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/unit/dashboard-equiv-ticker.test.js`
Expected: FAIL — ticker text stays empty, since `renderDashboard()` doesn't call `updateEquivTickers()` yet.

- [ ] **Step 5: Wire `updateEquivTickers` into `renderDashboard()`**

In `dashboard/js/views/dashboard.js`, add the import at the top (`dashboard/js/views/dashboard.js:1-3`):

```js
import { updateEquivTickers } from '../equiv-ticker.js';
```

Then, inside `renderDashboard` (`dashboard/js/views/dashboard.js:28-91`), right after the existing burn-rate gauge update call (`updateBurnRateGauge();`, line 79), add:

```js
    updateEquivTickers({
        tokens: total_tokens,
        cost: total_cost?.total || 0,
        burnRate: calculateBurnRate().rate
    });
```

`calculateBurnRate` is already declared earlier in this same module (`dashboard/js/views/dashboard.js:113`), so no new import is needed.

- [ ] **Step 6: Call `initEquivTickers()` once at startup**

In `dashboard/js/main.js`, add the import next to the existing `config.js` import (`dashboard/js/main.js:6`):

```js
import { initEquivTickers } from './equiv-ticker.js';
```

Then in `init()` (`dashboard/js/main.js:273-321`), right after the `positionNotifications()` / resize-listener block and before `loadCache()`, add:

```js
    // Kick off the equivalence-corpus fetch early so it's ready by the time
    // the first render calls updateEquivTickers().
    initEquivTickers();
```

- [ ] **Step 7: Run test to verify it passes**

Run: `bun test tests/unit/dashboard-equiv-ticker.test.js`
Expected: PASS (1 test)

- [ ] **Step 8: Run the full unit suite to catch regressions**

Run: `bun run test`
Expected: PASS — no existing dashboard-view/charts tests broken by the new markup or import.

- [ ] **Step 9: Add a Playwright overflow/visibility check**

In `tests/playwright/overflow.spec.js`, inside the existing `test.describe('no horizontal overflow on critical selectors', ...)` block (`tests/playwright/overflow.spec.js:21-52`), add a new test after the `'main dashboard'` test:

```js
  test('equivalence tickers render visible, non-overflowing text', async ({ page }) => {
    await expect(page.locator('.equiv-ticker .equiv-text').first()).not.toBeEmpty({ timeout: 10000 });
    await expectNoOverflow(page, '.equiv-ticker', 3);
  });
```

- [ ] **Step 10: Run the Playwright suite**

Run: `bun run test:e2e`
Expected: PASS (existing tests + the new one)

- [ ] **Step 11: Commit**

```bash
git add dashboard/index.html dashboard/js/main.js dashboard/js/views/dashboard.js dashboard/styles/design-v2.css tests/unit/dashboard-equiv-ticker.test.js tests/playwright/overflow.spec.js
git commit -m "feat(dashboard): wire the equivalence ticker into the hero section"
```
