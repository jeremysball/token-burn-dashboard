# Live Event Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-latest-event pill on the dashboard tab — "claude-sonnet-5 just burned 214.0k tokens ($0.41, 97% cache)" — synthesized by diffing consecutive SSE `tokens_by_model` snapshots, with no new backend event tracking.

**Architecture:** A pure diff/pick module (`dashboard/js/live-event-diff.js`) turns two consecutive `tokens_by_model` snapshots into growth events and picks the one to show; a DOM module (`dashboard/js/live-event-feed.js`) owns the pill's markup and keeps the previous snapshot in module state across `renderDashboard()` calls.

**Tech Stack:** Vanilla ES modules, `bun:test` + `happy-dom`.

## Global Constraints

- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 2 ("Live event feed").
- Presentation is the single-latest-event pill (option C from the mockup review — user picked this over the market-tape and console-log alternatives). No history list.
- Granularity is capped at `SSE_UPDATE_INTERVAL` (`lib/config.js`, 5000ms): two real backend events landing inside the same poll interval merge into one synthetic line per model. This is a deliberate, documented tradeoff (spec Section 2), not a bug — real per-request event tracking was explicitly considered and rejected as out of scope.
- **Documented simplification beyond the spec's literal wording:** if *multiple different models* all grew within the same poll (not just multiple events for the same model), the pill shows only the single largest-delta model for that poll rather than fabricating a multi-pill queue — the pill can only display one event at a time, and choosing the largest-magnitude one is the honest choice rather than picking arbitrarily or inventing a queue UI the spec doesn't describe.
- No event fires on the very first poll (no previous snapshot to diff against yet) — the pill shows a neutral "waiting for activity…" placeholder until the second SSE update arrives.

---

### Task 1: `live-event-diff.js` — pure snapshot diffing

**Files:**
- Create: `dashboard/js/live-event-diff.js`
- Test: `tests/unit/live-event-diff.test.js`

**Interfaces:**
- Produces:
  - `computeGrowthEvents(prevTokensByModel, currTokensByModel): Array<{model: string, delta: number}>` — one entry per model whose `.total` grew since the previous snapshot.
  - `pickLatestEvent(events, currTokensByModel, pricingByModel): {model: string, delta: number, cachePct: number, cost: number|null}|null` — from a non-empty `events` list, picks the largest-delta one and enriches it with that model's current cache-hit percentage and an estimated cost for the delta (using the model's cache percentage to blend `input`/`cacheRead` pricing rates for just the delta tokens). Returns `null` if `events` is empty. `cost` is `null` when the model has no usable pricing, rather than a fabricated number.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/live-event-diff.test.js
import { describe, expect, it } from 'bun:test';
import { computeGrowthEvents, pickLatestEvent } from '../../dashboard/js/live-event-diff.js';

describe('computeGrowthEvents', () => {
  it('returns one event per model whose total grew', () => {
    const prev = { 'a/model-1': { total: 100 }, 'a/model-2': { total: 500 } };
    const curr = { 'a/model-1': { total: 150 }, 'a/model-2': { total: 500 } };
    expect(computeGrowthEvents(prev, curr)).toEqual([{ model: 'a/model-1', delta: 50 }]);
  });

  it('treats a brand-new model (absent from prev) as growth from 0', () => {
    const prev = { 'a/model-1': { total: 100 } };
    const curr = { 'a/model-1': { total: 100 }, 'a/model-2': { total: 40 } };
    expect(computeGrowthEvents(prev, curr)).toEqual([{ model: 'a/model-2', delta: 40 }]);
  });

  it('ignores a model whose total shrank or stayed flat', () => {
    const prev = { 'a/model-1': { total: 200 } };
    const curr = { 'a/model-1': { total: 200 } };
    expect(computeGrowthEvents(prev, curr)).toEqual([]);
  });
});

describe('pickLatestEvent', () => {
  const currMap = {
    'a/model-1': { total: 150, input: 40, cache_read: 60, output: 50 },
    'a/model-2': { total: 700, input: 800, cache_read: 200, output: 100 }
  };
  const pricingByModel = {
    'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  };

  it('returns null for an empty events list', () => {
    expect(pickLatestEvent([], currMap, pricingByModel)).toBeNull();
  });

  it('picks the largest-delta event when multiple models grew in the same poll', () => {
    const events = [{ model: 'a/model-1', delta: 50 }, { model: 'a/model-2', delta: 200 }];
    const picked = pickLatestEvent(events, currMap, pricingByModel);
    expect(picked.model).toBe('a/model-2');
    expect(picked.delta).toBe(200);
  });

  it('computes the cache percentage from the model current totals', () => {
    const events = [{ model: 'a/model-1', delta: 50 }];
    const picked = pickLatestEvent(events, currMap, pricingByModel);
    expect(picked.cachePct).toBeCloseTo(60, 0); // 60 / (40 + 60) * 100
  });

  it('returns a null cost when the model has no usable pricing', () => {
    const events = [{ model: 'a/model-2', delta: 200 }];
    const picked = pickLatestEvent(events, currMap, pricingByModel);
    expect(picked.cost).toBeNull();
  });

  it('returns a finite estimated cost when pricing is available', () => {
    const events = [{ model: 'a/model-1', delta: 50 }];
    const picked = pickLatestEvent(events, currMap, pricingByModel);
    expect(picked.cost).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/live-event-diff.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/live-event-diff.js'`

- [ ] **Step 3: Write the module**

```js
// dashboard/js/live-event-diff.js
import { cacheHitRatePct, hasUsableCacheReadPricing } from './utils.js';

/**
 * @param {Record<string, {total: number}>|null} prevTokensByModel
 * @param {Record<string, {total: number}>} currTokensByModel
 * @returns {Array<{model: string, delta: number}>}
 */
export function computeGrowthEvents(prevTokensByModel, currTokensByModel) {
    const events = [];
    for (const [model, stats] of Object.entries(currTokensByModel || {})) {
        const prevTotal = prevTokensByModel?.[model]?.total || 0;
        const delta = (stats.total || 0) - prevTotal;
        if (delta > 0) events.push({ model, delta });
    }
    return events;
}

/**
 * @param {Array<{model: string, delta: number}>} events
 * @param {Record<string, any>} currTokensByModel
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {{model: string, delta: number, cachePct: number, cost: number|null}|null}
 */
export function pickLatestEvent(events, currTokensByModel, pricingByModel) {
    if (!events.length) return null;

    const biggest = events.slice().sort((a, b) => b.delta - a.delta)[0];
    const stats = currTokensByModel[biggest.model] || {};
    const input = Number(stats.input) || 0;
    const cacheRead = Number(stats.cache_read) || 0;
    const cachePct = cacheHitRatePct(input, cacheRead);

    const pricing = pricingByModel?.[biggest.model];
    let cost = null;
    if (hasUsableCacheReadPricing(pricing)) {
        const cachedDelta = biggest.delta * (cachePct / 100);
        const uncachedDelta = biggest.delta - cachedDelta;
        cost = (uncachedDelta / 1e6) * pricing.input + (cachedDelta / 1e6) * pricing.cacheRead;
    }

    return { model: biggest.model, delta: biggest.delta, cachePct, cost };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/live-event-diff.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add dashboard/js/live-event-diff.js tests/unit/live-event-diff.test.js
git commit -m "feat(dashboard): add live-event diffing for the event pill"
```

---

### Task 2: Wire the latest-event pill into the dashboard

**Files:**
- Create: `dashboard/js/live-event-feed.js`
- Modify: `dashboard/index.html`
- Modify: `dashboard/js/views/dashboard.js`
- Modify: `dashboard/styles/design-v2.css`
- Test: `tests/unit/live-event-feed.test.js`

**Interfaces:**
- Consumes: `computeGrowthEvents`, `pickLatestEvent` from `dashboard/js/live-event-diff.js` (Task 1); `fmtNum`, `fmtCur` from `dashboard/js/utils.js`.
- Produces: `renderLiveEventFeed(container: HTMLElement, currentData): void` and `resetLiveEventFeedForTest(): void` (test-only, clears the module's remembered previous snapshot).

- [ ] **Step 1: Add the section markup**

In `dashboard/index.html`, right after the `cache-savings-section` added by the cache-slider plan (or, if that plan hasn't landed yet in this worktree, right after the hero section, before the chart section):

```html
            <!-- Live Event Feed -->
            <section class="live-feed-section" id="live-feed-section"></section>
```

- [ ] **Step 2: Add pill CSS**

In `dashboard/styles/design-v2.css`, add:

```css
.latest-pill {
  display: inline-flex; align-items: center; gap: 10px;
  background: var(--mono-surface); border: 1px solid var(--mono-border);
  border-radius: var(--radius-lg);
  padding: 8px 14px; font-size: 0.8rem; color: var(--mono-text-muted);
  margin-bottom: 24px;
}
.latest-pill-dot {
  width: 7px; height: 7px; flex: none; background: var(--mono-accent);
  border-radius: 50%;
  animation: latest-pulse 2.4s ease-in-out infinite;
}
@keyframes latest-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .latest-pill-dot { animation: none; } }
```

- [ ] **Step 3: Write the failing tests**

```js
// tests/unit/live-event-feed.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderLiveEventFeed, resetLiveEventFeedForTest } from '../../dashboard/js/live-event-feed.js';

const dataWith = (tokensByModel, pricingByModel = {}) => ({
  tokens_by_model: tokensByModel,
  pricing_by_model: pricingByModel
});

describe('renderLiveEventFeed', () => {
  let container;

  beforeEach(() => {
    resetLiveEventFeedForTest();
    document.body.innerHTML = '<section id="live-feed-section"></section>';
    container = document.getElementById('live-feed-section');
  });

  it('shows a neutral placeholder on the first render (no previous snapshot to diff)', () => {
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }));
    expect(container.querySelector('#latestPillText').textContent).toMatch(/waiting/i);
  });

  it('shows a real event on the second render once a model has grown', () => {
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }));
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }, {
      'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
    }));

    const text = container.querySelector('#latestPillText').textContent;
    expect(text).toContain('model-1');
    expect(text).toMatch(/150(\.0)?k? tokens|150,000 tokens/i);
  });

  it('leaves the previous event visible when nothing grew on a later poll', () => {
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 100, input: 50, cache_read: 50 } }));
    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }));
    const afterGrowth = container.querySelector('#latestPillText').textContent;

    renderLiveEventFeed(container, dataWith({ 'a/model-1': { total: 250, input: 100, cache_read: 150 } }));
    expect(container.querySelector('#latestPillText').textContent).toBe(afterGrowth);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test tests/unit/live-event-feed.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/live-event-feed.js'`

- [ ] **Step 5: Write the module**

```js
// dashboard/js/live-event-feed.js
import { fmtNum, fmtCur, cacheHitRatePct, hasUsableCacheReadPricing, ensureWidgetBuilt, displayModel } from './utils.js';
import { computeGrowthEvents, pickLatestEvent } from './live-event-diff.js';

/** @type {Record<string, {total: number}>|null} */
let prevTokensByModel = null;

/** @param {HTMLElement} container */
function build(container) {
    container.innerHTML = `
        <div class="latest-pill" id="latestPill">
            <span class="latest-pill-dot"></span>
            <span id="latestPillText">Waiting for activity…</span>
        </div>
    `;
}

/**
 * @param {HTMLElement} container
 * @param {{model: string, delta: number, cachePct: number, cost: number|null}} event
 */
function renderEvent(container, event) {
    const shortName = displayModel(event.model);
    const detailBits = [];
    if (event.cost !== null) detailBits.push(fmtCur(event.cost));
    detailBits.push(`${event.cachePct.toFixed(0)}% cache`);
    const text = `${shortName} just burned ${fmtNum(event.delta)} tokens (${detailBits.join(', ')})`;
    container.querySelector('#latestPillText').textContent = text;
}

/**
 * @param {HTMLElement} container
 * @param {any} currentData
 */
export function renderLiveEventFeed(container, currentData) {
    ensureWidgetBuilt(container, 'liveFeedBuilt', build);

    const currTokensByModel = currentData?.tokens_by_model || {};
    if (prevTokensByModel) {
        const events = computeGrowthEvents(prevTokensByModel, currTokensByModel);
        const event = pickLatestEvent(events, currTokensByModel, currentData?.pricing_by_model);
        if (event) renderEvent(container, event);
    }
    prevTokensByModel = currTokensByModel;
}

export function resetLiveEventFeedForTest() {
    prevTokensByModel = null;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test tests/unit/live-event-feed.test.js`
Expected: PASS (3 tests)

- [ ] **Step 7: Wire into `renderDashboard()`**

In `dashboard/js/views/dashboard.js`, add the import:

```js
import { renderLiveEventFeed } from '../live-event-feed.js';
```

Inside `renderDashboard`, right after the cache-slider call added by the cache-slider plan (or, if that plan hasn't landed yet, right after `updateBurnRateGauge();`), add:

```js
    const liveFeedSection = document.getElementById('live-feed-section');
    if (liveFeedSection) renderLiveEventFeed(liveFeedSection, cd);
```

- [ ] **Step 8: Run the full unit suite to catch regressions**

Run: `bun run test`
Expected: PASS

- [ ] **Step 9: Add a Playwright overflow check**

In `tests/playwright/overflow.spec.js`, inside `test.describe('no horizontal overflow on critical selectors', ...)`, add:

```js
  test('live event pill', async ({ page }) => {
    await expect(page.locator('.latest-pill')).toBeVisible({ timeout: 10000 });
    await expectNoOverflow(page, '.latest-pill');
  });
```

- [ ] **Step 10: Run the Playwright suite**

Run: `bun run test:e2e`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add dashboard/js/live-event-feed.js dashboard/index.html dashboard/js/views/dashboard.js dashboard/styles/design-v2.css tests/unit/live-event-feed.test.js tests/playwright/overflow.spec.js
git commit -m "feat(dashboard): add the live event feed pill"
```
