# Weekly Title Belt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new widget in Analytics > Insights showing four standing "belts" (Volume Crown, Thrift King, The Sommelier, Most Improved) that change hands week to week, computed from the client-side daily snapshots already tracked in `dashboard/js/state.js`'s `weeklyData`.

**Architecture:** A pure calculation module (`dashboard/js/title-belt.js`) turns `weeklyData`'s daily cumulative snapshots into this-week/last-week per-model token+cost deltas and scores the four belts against them; a render module builds the widget markup in the Insights tab and reuses the Lucide icon sprite vendored by the foundations plan.

**Tech Stack:** Vanilla ES modules, `bun:test` + `happy-dom`.

## Global Constraints

- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 3 ("Weekly title belt") and Section 5 ("Insufficient data — weekly title belt").
- Depends on `.superpowers/plans/2026-07-28-dataviz-foundations.md` having merged (the `#icon-crown`/`#icon-thrift`/`#icon-wine`/`#icon-improved` sprite in `dashboard/index.html`).
- **Deliberate, in-scope deviation from `weeklyData`'s current retention:** `dashboard/js/api.js` currently caps `weeklyData` at the last 7 daily snapshots, which can never hold both "this week" and "prior week" data at once — `Most Improved` would be permanently unable to compute a week-over-week delta under that cap, defeating the belt's own purpose. This plan widens the cap to 15 daily snapshots (three week-boundary anchors: today, 7 days ago, 14 days ago) so a real week-over-week comparison is possible once at least two full weeks of snapshots exist. Fewer than 15 snapshots degrades gracefully per Section 5 (three belts still show, Most Improved shows a "not enough history yet" note) rather than being silently broken forever.
- `weeklyData` snapshots are populated only while a browser tab is open and observing SSE updates — a day with no visits leaves a gap in the sequence. This plan treats week boundaries by *array position* (last 7 entries = "this week"), not by exact calendar-day arithmetic, which is the existing snapshot mechanism's inherent granularity; not a defect this plan needs to fix.
- Eligibility floor: a model must account for ≥1% of the week's total tokens to qualify for *any* belt (prevents a near-zero-usage model from winning via a division-by-near-zero blowup).

---

### Task 1: Widen `weeklyData` retention and add the pure scoring module

**Files:**
- Modify: `dashboard/js/config.js`
- Modify: `dashboard/js/api.js`
- Create: `dashboard/js/title-belt.js`
- Test: `tests/unit/title-belt.test.js`
- Test: `tests/unit/api-weekly-retention.test.js`

**Interfaces:**
- Produces:
  - `WEEKLY_HISTORY_DAYS` (exported constant, `15`) from `dashboard/js/config.js`, consumed by both `dashboard/js/api.js`'s retention cap and `dashboard/js/title-belt.js`'s window math, so the two can't drift independently.
  - `computeWeekWindow(weeklyData): {thisWeek: Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number}>, lastWeek: Record<string, {...}>|null, weekEndDay: string}|null` from `dashboard/js/title-belt.js` — `null` when `weeklyData` has fewer than 8 entries (not even one full week-over-week boundary yet). `lastWeek` is `null` when there aren't 15 entries yet (not enough history for a week-over-week comparison), even if `thisWeek` is available.
  - `scoreTitleBelt(weekWindow, pricingByModel): {volumeCrown, thriftKing, sommelier, mostImproved}` — each of `volumeCrown`/`thriftKing`/`sommelier` is `{name, tokens, share, effectiveRate}|null`; `mostImproved` is `{name, tokens, growthPct}|null` (always `null` when `weekWindow.lastWeek` is `null`, or when no eligible model has nonzero prior-week tokens, or when the best week-over-week growth is non-positive).

- [ ] **Step 1: Widen the retention cap**

In `dashboard/js/config.js`, add near `MAX_HISTORY_POINTS` (`dashboard/js/config.js:10`):

```js
// Daily weeklyData snapshots to retain. 15 gives three week-boundary anchors
// (today, 7 days ago, 14 days ago) so the weekly title belt can compute both
// "this week" and "last week" per-model deltas — 7 would only ever cover one
// week and could never support a week-over-week comparison.
export const WEEKLY_HISTORY_DAYS = 15;
```

In `dashboard/js/api.js`, change the import (`dashboard/js/api.js:1`):

```js
import { MAX_HISTORY_POINTS, WEEKLY_HISTORY_DAYS } from './config.js';
```

And change the retention cap (`dashboard/js/api.js:165-167`):

```js
        if (weeklyData.length > WEEKLY_HISTORY_DAYS) {
            setWeeklyData(weeklyData.slice(-WEEKLY_HISTORY_DAYS));
        }
```

- [ ] **Step 2: Write the failing test for the retention change**

```js
// tests/unit/api-weekly-retention.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { updateData } from '../../dashboard/js/api.js';
import { weeklyData, setWeeklyData, setCurrentData, setHistoryData } from '../../dashboard/js/state.js';
import { WEEKLY_HISTORY_DAYS } from '../../dashboard/js/config.js';

describe('weeklyData retention', () => {
  beforeEach(() => {
    setWeeklyData([]);
    setCurrentData(null);
    setHistoryData([]);
  });

  it('retains up to WEEKLY_HISTORY_DAYS distinct-day snapshots, not just 7', () => {
    const realDateNow = Date.now;
    const RealDate = Date;
    try {
      for (let i = 0; i < WEEKLY_HISTORY_DAYS + 3; i++) {
        const day = new RealDate(Date.UTC(2026, 0, 1 + i));
        Date.now = () => day.getTime();
        // Override Date constructor so `new Date().toISOString()` (used by
        // updateData's day-key derivation) also sees the mocked time.
        globalThis.Date = class extends RealDate {
          constructor() { super(day.getTime()); }
          static now() { return day.getTime(); }
        };
        updateData({
          total_tokens: 1000 * (i + 1),
          tokens_by_model: { 'a/model-1': { total: 1000 * (i + 1), input: 0, output: 0, cache_read: 0, cache_write: 0 } }
        });
      }
    } finally {
      globalThis.Date = RealDate;
      Date.now = realDateNow;
    }

    expect(weeklyData.length).toBe(WEEKLY_HISTORY_DAYS);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/api-weekly-retention.test.js`
Expected: FAIL — `weeklyData.length` is capped at 7, not `WEEKLY_HISTORY_DAYS` (15).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/api-weekly-retention.test.js`
Expected: PASS (1 test), after Step 1's edit.

- [ ] **Step 5: Write the failing tests for the scoring module**

```js
// tests/unit/title-belt.test.js
import { describe, expect, it } from 'bun:test';
import { computeWeekWindow, scoreTitleBelt } from '../../dashboard/js/title-belt.js';

/** Build a weeklyData-shaped fixture: n daily snapshots, each model's
 * cumulative totals growing linearly by perDayGrowth[model] tokens/day. */
function fixtureWeeklyData(days, perDayGrowth) {
  const out = [];
  const cumulative = {};
  for (const name of Object.keys(perDayGrowth)) cumulative[name] = 0;
  for (let d = 0; d < days; d++) {
    /** @type any */
    const models = {};
    for (const [name, growth] of Object.entries(perDayGrowth)) {
      cumulative[name] += growth;
      models[name] = { total: cumulative[name], input: cumulative[name] * 0.5, output: cumulative[name] * 0.5, cache_read: 0, cache_write: 0 };
    }
    out.push({ day: `2026-01-${String(d + 1).padStart(2, '0')}`, tokens: Object.values(cumulative).reduce((a, b) => a + b, 0), models });
  }
  return out;
}

describe('computeWeekWindow', () => {
  it('returns null with fewer than 8 daily snapshots', () => {
    expect(computeWeekWindow(fixtureWeeklyData(7, { 'a/model-1': 100 }))).toBeNull();
  });

  it('computes thisWeek as the delta over the last 7 days once 8+ snapshots exist', () => {
    const window = computeWeekWindow(fixtureWeeklyData(8, { 'a/model-1': 100 }));
    expect(window.thisWeek['a/model-1'].total).toBeCloseTo(700, 0);
    expect(window.lastWeek).toBeNull(); // only 8 snapshots, need 15 for a lastWeek
  });

  it('computes lastWeek once 15+ snapshots exist', () => {
    const window = computeWeekWindow(fixtureWeeklyData(15, { 'a/model-1': 100 }));
    expect(window.thisWeek['a/model-1'].total).toBeCloseTo(700, 0);
    expect(window.lastWeek['a/model-1'].total).toBeCloseTo(700, 0);
  });
});

describe('scoreTitleBelt', () => {
  const pricingByModel = {
    'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },   // expensive
    'a/model-2': { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0.25 }, // cheap
    'a/negligible': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  };

  it('excludes a model below the 1% eligibility floor from every belt', () => {
    const weeklyData = fixtureWeeklyData(15, { 'a/model-1': 10000, 'a/model-2': 5000, 'a/negligible': 10 });
    const window = computeWeekWindow(weeklyData);
    const scored = scoreTitleBelt(window, pricingByModel);
    const beltWinners = [scored.volumeCrown?.name, scored.thriftKing?.name, scored.sommelier?.name, scored.mostImproved?.name];
    expect(beltWinners).not.toContain('a/negligible');
  });

  it('awards Volume Crown to the highest-token-share eligible model', () => {
    const weeklyData = fixtureWeeklyData(15, { 'a/model-1': 10000, 'a/model-2': 3000 });
    const scored = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
    expect(scored.volumeCrown.name).toBe('a/model-1');
  });

  it('awards Thrift King to the lowest effective $/M and Sommelier to the highest', () => {
    const weeklyData = fixtureWeeklyData(15, { 'a/model-1': 5000, 'a/model-2': 5000 });
    const scored = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
    expect(scored.thriftKing.name).toBe('a/model-2');
    expect(scored.sommelier.name).toBe('a/model-1');
  });

  it('excludes a model with no prior-week data from Most Improved, even if it clears the volume floor this week', () => {
    // model-2 only starts accruing tokens in the second week (0 growth for the first 8 days).
    const out = [];
    let cum1 = 0;
    let cum2 = 0;
    for (let d = 0; d < 15; d++) {
      cum1 += 1000;
      if (d >= 8) cum2 += 2000; // model-2 appears only in the most recent week
      out.push({
        day: `d${d}`,
        tokens: cum1 + cum2,
        models: {
          'a/model-1': { total: cum1, input: cum1, output: 0, cache_read: 0, cache_write: 0 },
          'a/model-2': { total: cum2, input: cum2, output: 0, cache_read: 0, cache_write: 0 }
        }
      });
    }
    const scored = scoreTitleBelt(computeWeekWindow(out), pricingByModel);
    const beltWinners = [scored.volumeCrown?.name, scored.thriftKing?.name, scored.sommelier?.name, scored.mostImproved?.name];
    expect(beltWinners).toContain('a/model-2'); // clears the volume floor this week — wins at least one belt
    expect(scored.mostImproved?.name).not.toBe('a/model-2'); // but has 0 prior-week tokens -> ineligible for Most Improved
  });

  it('returns a null mostImproved when there is no lastWeek window at all', () => {
    const weeklyData = fixtureWeeklyData(8, { 'a/model-1': 1000 }); // only 8 snapshots, no lastWeek
    const scored = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
    expect(scored.mostImproved).toBeNull();
  });

  it('returns a null mostImproved when all eligible models shrank week-over-week', () => {
    // Build 15 days where tokens grow for 8 days then shrink for 7 days
    // so thisWeek < lastWeek for every model.
    const out = [];
    let cum = 0;
    for (let d = 0; d < 15; d++) {
      if (d < 8) cum += 1000;
      else cum -= 400;
      out.push({
        day: `d${d}`,
        tokens: Math.max(0, cum),
        models: { 'a/model-1': { total: Math.max(0, cum), input: Math.max(0, cum), output: 0, cache_read: 0, cache_write: 0 } }
      });
    }
    const scored = scoreTitleBelt(computeWeekWindow(out), pricingByModel);
    expect(scored.mostImproved).toBeNull();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `bun test tests/unit/title-belt.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/title-belt.js'`

- [ ] **Step 7: Write the module**

```js
// dashboard/js/title-belt.js
import { WEEKLY_HISTORY_DAYS } from './config.js';
import { calculateCostWithPricing } from './modelsdev-pricing.js';

export const ELIGIBILITY_FLOOR = 0.01; // 1% of the week's total tokens

/**
 * @param {Record<string, any>} currModels
 * @param {Record<string, any>} baseModels
 * @returns {Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number}>}
 */
function diffModelStats(currModels, baseModels) {
    /** @type {Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number}>} */
    const result = {};
    for (const [name, stats] of Object.entries(currModels || {})) {
        const base = baseModels?.[name] || {};
        const total = Math.max(0, (stats.total || 0) - (base.total || 0));
        if (total <= 0) continue;
        result[name] = {
            total,
            input: Math.max(0, (stats.input || 0) - (base.input || 0)),
            output: Math.max(0, (stats.output || 0) - (base.output || 0)),
            cache_read: Math.max(0, (stats.cache_read || 0) - (base.cache_read || 0)),
            cache_write: Math.max(0, (stats.cache_write || 0) - (base.cache_write || 0))
        };
    }
    return result;
}

/**
 * @param {Array<{day: string, models: Record<string, any>}>} weeklyData
 * @returns {{thisWeek: Record<string, any>, lastWeek: Record<string, any>|null, weekEndDay: string}|null}
 */
export function computeWeekWindow(weeklyData) {
    if (!weeklyData || weeklyData.length < 8) return null;

    const idxNow = weeklyData.length - 1;
    const idxWeekAgo = weeklyData.length - 8;
    const nowEntry = weeklyData[idxNow];
    const weekAgoEntry = weeklyData[idxWeekAgo];
    const thisWeek = diffModelStats(nowEntry.models, weekAgoEntry.models);

    let lastWeek = null;
    const idxTwoWeeksAgo = weeklyData.length - WEEKLY_HISTORY_DAYS;
    if (idxTwoWeeksAgo >= 0) {
        lastWeek = diffModelStats(weekAgoEntry.models, weeklyData[idxTwoWeeksAgo].models);
    }

    return { thisWeek, lastWeek, weekEndDay: nowEntry.day };
}

/**
 * The effective $/M convention: all four rates must be finite before
 * a model is allowed to participate in effective-rate-per-million calculations.
 * @param {any|null|undefined} pricing
 * @returns {boolean}
 */
export function hasUsableFullPricing(pricing) {
    const r = [pricing?.input, pricing?.output, pricing?.cacheRead, pricing?.cacheWrite].map(Number);
    return r.every(Number.isFinite);
}

/**
 * @param {any} stats
 * @param {any} pricing
 * @returns {number|null}
 */
function effectiveRatePerMillion(stats, pricing) {
    if (!hasUsableFullPricing(pricing)) return null;
    if (stats.total <= 0) return null;
    const { total: cost, priced } = calculateCostWithPricing(stats, pricing);
    if (!priced) return null;
    return cost / (stats.total / 1e6);
}

/**
 * @param {{thisWeek: Record<string, any>, lastWeek: Record<string, any>|null}|null} weekWindow
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {{volumeCrown: any, thriftKing: any, sommelier: any, mostImproved: any}}
 */
export function scoreTitleBelt(weekWindow, pricingByModel) {
    if (!weekWindow) return { volumeCrown: null, thriftKing: null, sommelier: null, mostImproved: null };

    const { thisWeek, lastWeek } = weekWindow;
    const totalTokens = Object.values(thisWeek).reduce((sum, s) => sum + s.total, 0);
    if (totalTokens <= 0) return { volumeCrown: null, thriftKing: null, sommelier: null, mostImproved: null };

    const eligible = Object.entries(thisWeek).filter(([, s]) => s.total / totalTokens >= ELIGIBILITY_FLOOR);

    const scored = eligible.map(([name, s]) => ({
        name,
        tokens: s.total,
        share: s.total / totalTokens,
        effectiveRate: effectiveRatePerMillion(s, pricingByModel?.[name])
    }));

    const volumeCrown = scored.slice().sort((a, b) => b.tokens - a.tokens)[0] || null;
    const priced = scored.filter((m) => m.effectiveRate !== null);
    const thriftKing = priced.length ? priced.slice().sort((a, b) => a.effectiveRate - b.effectiveRate)[0] : null;
    const sommelier = priced.length ? priced.slice().sort((a, b) => b.effectiveRate - a.effectiveRate)[0] : null;

    let mostImproved = null;
    if (lastWeek) {
        const improved = eligible
            .map(([name, s]) => {
                const priorTokens = lastWeek[name]?.total || 0;
                if (priorTokens <= 0) return null; // no prior-week data -> ineligible for this belt specifically
                return { name, tokens: s.total, growthPct: ((s.total - priorTokens) / priorTokens) * 100 };
            })
            .filter(Boolean);
        if (improved.length) {
            const best = improved.sort((a, b) => b.growthPct - a.growthPct)[0];
            if (best.growthPct > 0) mostImproved = best;
        }
    }

    return { volumeCrown, thriftKing, sommelier, mostImproved };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test tests/unit/title-belt.test.js`
Expected: PASS (9 tests)

- [ ] **Step 8b: Add unit test for `hasUsableFullPricing`**

In `tests/unit/utils.test.js`, add:

```js
import { hasUsableFullPricing } from '../../dashboard/js/title-belt.js';

describe('hasUsableFullPricing', () => {
  it('returns true when all four rates are finite', () => {
    expect(hasUsableFullPricing({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 })).toBe(true);
  });
  it('returns false when a rate is NaN', () => {
    expect(hasUsableFullPricing({ input: NaN, output: 15, cacheRead: 0.3, cacheWrite: 3.75 })).toBe(false);
  });
  it('returns false when input is missing', () => {
    expect(hasUsableFullPricing({ output: 15, cacheRead: 0.3, cacheWrite: 3.75 })).toBe(false);
  });
  it('returns false when cacheRead is missing', () => {
    expect(hasUsableFullPricing({ input: 3, output: 15, cacheWrite: 3.75 })).toBe(false);
  });
  it('returns false for null pricing', () => {
    expect(hasUsableFullPricing(null)).toBe(false);
  });
});
```

Run: `bun test tests/unit/utils.test.js`
Expected: PASS

- [ ] **Step 9: Run the full unit suite to catch regressions**

Run: `bun run test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add dashboard/js/config.js dashboard/js/api.js dashboard/js/title-belt.js tests/unit/title-belt.test.js tests/unit/api-weekly-retention.test.js
git commit -m "feat(dashboard): widen weekly snapshot retention and add title-belt scoring"
```

---

### Task 2: Render the title belt in Analytics > Insights

**Files:**
- Create: `dashboard/js/title-belt-render.js`
- Modify: `dashboard/index.html`
- Modify: `dashboard/js/views/analytics.js`
- Modify: `dashboard/styles/design-v2.css`
- Test: `tests/unit/title-belt-render.test.js`

**Interfaces:**
- Consumes: `computeWeekWindow`, `scoreTitleBelt` from `dashboard/js/title-belt.js` (Task 1); `weeklyData`, `currentData` from `dashboard/js/state.js`; the `#icon-crown`/`#icon-thrift`/`#icon-wine`/`#icon-improved` sprite (foundations plan).
- Produces: `renderTitleBelt(container: HTMLElement, weeklyData, pricingByModel): void`.

- [ ] **Step 1: Add the section markup**

In `dashboard/index.html`, inside `#analytics-tab-insights` (`dashboard/index.html:164-189`), add a new container right after the closing `</div>` of `.insights-header` (`dashboard/index.html:166-169`) and before `#deep-insights-container`:

```html
                <div id="weekly-title-belt-container"></div>
```

- [ ] **Step 2: Add title-belt CSS**

In `dashboard/styles/design-v2.css`, add (reuses the existing `--fieldbook-rule` custom property already defined for the print-fieldbook theme):

```css
.title-belt {
  background: var(--mono-surface);
  border: 1px solid var(--mono-border);
  border-radius: var(--radius-lg);
  border-top: 3px solid var(--mono-border-accent);
  padding: 22px 24px;
  margin-bottom: 24px;
}
.title-belt .fr-date { color: var(--mono-text-muted); font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 16px; }
.belt-row { display: flex; align-items: baseline; gap: 12px; padding: 10px 0; border-top: 1px dashed var(--fieldbook-rule); flex-wrap: wrap; }
.belt-row:first-of-type { border-top: 0; padding-top: 0; }
.belt-badge {
  flex: none; display: flex; align-items: center; justify-content: center;
  padding: 7px; border: 1px solid var(--mono-border-accent); color: var(--mono-accent);
  background: var(--mono-accent-dim); min-width: 34px; min-height: 34px;
}
.belt-badge svg { width: 18px; height: 18px; color: currentColor; fill: none; }
.belt-title { flex: none; color: var(--mono-text-muted); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; min-width: 130px; }
.belt-model { color: var(--mono-accent); font-weight: 700; font-size: 0.92rem; }
.belt-detail { color: var(--mono-text-muted); font-size: 0.82rem; }
```

- [ ] **Step 3: Write the failing tests**

```js
// tests/unit/title-belt-render.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderTitleBelt } from '../../dashboard/js/title-belt-render.js';

function fixtureWeeklyData(days, perDayGrowth) {
  const out = [];
  const cumulative = {};
  for (const name of Object.keys(perDayGrowth)) cumulative[name] = 0;
  for (let d = 0; d < days; d++) {
    const models = {};
    for (const [name, growth] of Object.entries(perDayGrowth)) {
      cumulative[name] += growth;
      models[name] = { total: cumulative[name], input: cumulative[name], output: 0, cache_read: 0, cache_write: 0 };
    }
    out.push({ day: `d${d}`, tokens: 0, models });
  }
  return out;
}

const pricingByModel = {
  'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'a/model-2': { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0.25 }
};

describe('renderTitleBelt', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '<div id="weekly-title-belt-container"></div>';
    container = document.getElementById('weekly-title-belt-container');
  });

  it('shows all 4 belt rows once there is 2+ weeks of history', () => {
    renderTitleBelt(container, fixtureWeeklyData(15, { 'a/model-1': 1000, 'a/model-2': 500 }), pricingByModel);
    expect(container.querySelectorAll('.belt-row').length).toBe(4);
    expect(container.textContent).toContain('Volume Crown');
    expect(container.textContent).toContain('Thrift King');
    expect(container.textContent).toContain('The Sommelier');
    expect(container.textContent).toContain('Most Improved');
  });

  it('shows only 3 belts plus a "not enough history" note with 8-14 daily snapshots', () => {
    renderTitleBelt(container, fixtureWeeklyData(8, { 'a/model-1': 1000 }), pricingByModel);
    expect(container.querySelectorAll('.belt-row').length).toBe(4); // 3 real rows + 1 placeholder row
    expect(container.textContent.toLowerCase()).toContain('not enough history');
  });

  it('shows an empty-state message instead of a broken widget with fewer than 8 snapshots', () => {
    renderTitleBelt(container, fixtureWeeklyData(3, { 'a/model-1': 1000 }), pricingByModel);
    expect(container.querySelectorAll('.belt-row').length).toBe(0);
    expect(container.textContent.toLowerCase()).toContain('not enough history');
  });

  it('escapes model names as text, never as injected HTML', () => {
    const malicious = 'a/<img src=x onerror="alert(1)">';
    const data = fixtureWeeklyData(15, { [malicious]: 1000, 'a/model-2': 10 });
    renderTitleBelt(container, data, pricingByModel);
    expect(container.querySelector('.belt-model').textContent).toContain('<img');
    expect(container.querySelector('img')).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bun test tests/unit/title-belt-render.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/title-belt-render.js'`

- [ ] **Step 5: Write the module**

```js
// dashboard/js/title-belt-render.js
import { computeWeekWindow, scoreTitleBelt } from './title-belt.js';
import { escapeHtml, fmtNum, displayModel } from './utils.js';

/**
 * @param {string} iconId
 * @param {string} title
 * @param {{name: string}|null} entry
 * @param {string} detail
 * @returns {string}
 */
function beltRow(iconId, title, entry, detail) {
    return `
        <div class="belt-row">
            <span class="belt-badge"><svg aria-hidden="true"><use href="#${iconId}"></use></svg></span>
            <span class="belt-title">${escapeHtml(title)}</span>
            <span class="belt-model">${entry ? escapeHtml(displayModel(entry.name)) : '—'}</span>
            <span class="belt-detail">${escapeHtml(detail)}</span>
        </div>
    `;
}

/**
 * @param {HTMLElement} container
 * @param {any[]} weeklyData
 * @param {Record<string, any>|undefined} pricingByModel
 */
export function renderTitleBelt(container, weeklyData, pricingByModel) {
    const window = computeWeekWindow(weeklyData);
    if (!window) {
        container.innerHTML = `
            <div class="title-belt">
                <div class="fr-date">TITLE BELT</div>
                <div class="belt-detail">Not enough history yet — check back after a full week of usage.</div>
            </div>
        `;
        return;
    }

    const scored = scoreTitleBelt(window, pricingByModel);
    const rows = [
        beltRow('icon-crown', 'Volume Crown', scored.volumeCrown, scored.volumeCrown ? `${(scored.volumeCrown.share * 100).toFixed(0)}% share this week` : ''),
        beltRow('icon-thrift', 'Thrift King', scored.thriftKing, scored.thriftKing ? `${scored.thriftKing.effectiveRate.toFixed(2)} effective $/M — cheapest in the fleet` : 'no priced eligible model'),
        beltRow('icon-wine', 'The Sommelier', scored.sommelier, scored.sommelier ? `priciest taste, ${scored.sommelier.effectiveRate.toFixed(2)} effective $/M` : 'no priced eligible model')
    ];

    if (scored.mostImproved) {
        rows.push(beltRow('icon-improved', 'Most Improved', scored.mostImproved, `${scored.mostImproved.growthPct >= 0 ? '+' : ''}${scored.mostImproved.growthPct.toFixed(0)}% tokens week over week (${fmtNum(scored.mostImproved.tokens)} total)`));
    } else {
        rows.push(`
            <div class="belt-row">
                <span class="belt-badge"><svg aria-hidden="true"><use href="#icon-improved"></use></svg></span>
                <span class="belt-title">Most Improved</span>
                <span class="belt-detail">Not enough history yet for a week-over-week comparison.</span>
            </div>
        `);
    }

    container.innerHTML = `
        <div class="title-belt">
            <div class="fr-date">TITLE BELT // WEEK ENDING ${escapeHtml(window.weekEndDay)}</div>
            ${rows.join('')}
        </div>
    `;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/unit/title-belt-render.test.js`
Expected: PASS (4 tests)

- [ ] **Step 7: Wire into the Insights tab**

In `dashboard/js/views/analytics.js`, add the import next to the other tab imports (`dashboard/js/views/analytics.js:1`):

```js
import { weeklyData } from '../state.js';
import { renderTitleBelt } from '../title-belt-render.js';
```

Change the `'insights'` case (`dashboard/js/views/analytics.js:72-74`):

```js
        case 'insights':
            renderDeepInsightsTab();
            renderTitleBelt(document.getElementById('weekly-title-belt-container'), weeklyData, currentData?.pricing_by_model);
            break;
```

- [ ] **Step 8: Run the full unit suite to catch regressions**

Run: `bun run test`
Expected: PASS

- [ ] **Step 9: Extend the shared Playwright smoke test to cover the ticker + title belt together**

This is the spec's Testing-section requirement ("Playwright smoke test confirming the ticker and title belt render without layout overflow or clipped content"). The existing `expectNoOverflow` helper only checks horizontal overflow (`scrollWidth` vs `clientWidth`). To also catch vertical/`overflow:hidden` clipping, extend the helper (or add a companion `expectNoVerticalOverflow` helper) that compares `scrollHeight` vs `clientHeight`. In `tests/playwright/overflow.spec.js`, add:

```js
  test('weekly title belt (Analytics > Insights)', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await page.click('button:has-text("Insights")');
    await expect(page.locator('#weekly-title-belt-container')).toBeVisible({ timeout: 10000 });
    await expectNoOverflow(page, '#weekly-title-belt-container');
    // Also check vertical overflow / clipped content (spec requirement).
    // Extend expectNoOverflow to also assert scrollHeight <= clientHeight + 2,
    // or add a standalone check here:
    const overflows = await page.$$eval('#weekly-title-belt-container', els =>
      els.map(el => ({ scroll: el.scrollHeight, client: el.clientHeight, text: el.textContent?.slice(0, 50) }))
    );
    for (const o of overflows) {
      expect(o.scroll, `vertical overflow #weekly-title-belt-container ${o.text}`).toBeLessThanOrEqual(o.client + 2);
    }
  });
```

Note: with a fresh `mockData` fixture (single snapshot, no accumulated `weeklyData` history), this widget renders its "not enough history yet" empty state — the test above still exercises real layout/overflow behavior for that state, which is the state most first-time users will actually see. Verifying the fully-populated 4-belt layout is already covered at the unit level by Task 2 Step 3's tests above.

- [ ] **Step 10: Run the Playwright suite**

Run: `bun run test:e2e`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add dashboard/js/title-belt-render.js dashboard/index.html dashboard/js/views/analytics.js dashboard/styles/design-v2.css tests/unit/title-belt-render.test.js tests/playwright/overflow.spec.js
git commit -m "feat(dashboard): render the weekly title belt in Analytics > Insights"
```
