# League Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the Analytics > Compare tab's existing top-8-by-volume model list from a Plotly bar chart into a ranked table (rank, model, badge, effective $/M, cache %), with the same-week title-belt badges surfaced per model and an expandable "+N others" long-tail row for everything beyond the top 8.

**Architecture:** A pure calculation module (`dashboard/js/league-table.js`) turns `currentData`'s existing `tokens_by_model`/`costs_by_model` plus the weekly title-belt scoring (`dashboard/js/title-belt.js`, from the weekly-title-belt plan) into ranked row data; `dashboard/js/views/analytics/tabs/compare.js` is rewritten to render that data as a `.mono-table` (the same table styling already used by the Models tab) instead of its current Plotly bar chart.

**Tech Stack:** Vanilla ES modules, `bun:test` + `happy-dom`.

## Global Constraints

- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 4 ("League table") and Section 5 ("Insufficient data — league table / dead-air / cache slider").
- Depends on `.superpowers/plans/2026-07-28-dataviz-weekly-title-belt.md` having merged (`computeWeekWindow`/`scoreTitleBelt` from `dashboard/js/title-belt.js`, and the `#icon-crown`/`#icon-thrift`/`#icon-wine`/`#icon-improved` sprite from the foundations plan that the title-belt widget already reuses).
- **This intentionally removes the Compare tab's existing Plotly bar chart, not adds a table alongside it.** The spec's own wording — "reframes the Compare tab's existing top-8-by-volume model list ... into a table" — describes changing the presentation of the same underlying top-8 list, not introducing a second, separate widget. `dashboard/js/views/analytics/tabs/compare.js`'s exported `renderCompareTab(container)` keeps its name and the `#compare-chart-container` target so `dashboard/js/views/analytics.js`'s `'compare'` case needs no wiring changes, but its internal implementation is fully replaced.
- Same top-8 cutoff as today, unchanged: `Object.entries(tokens_by_model).sort(...).slice(0, 8)`, exactly as `compare.js` already computes it — no new threshold invented.
- **Badge priority when a model holds more than one belt simultaneously:** show only the highest-priority badge, in the order Volume Crown > Thrift King > Sommelier > Most Improved. This is an explicit, documented tradeoff (the spec doesn't say what to do when a model wins more than one belt in the same week) rather than stacking multiple badge icons in one cell.
- Effective $/M and cache % in this table are computed from `currentData`'s all-time cumulative `tokens_by_model`/`costs_by_model` (the same source `compare.js` and the Models tab already use), not from the weekly title-belt's week-over-week window — only the *badge* assignment reuses the weekly window. Mixing an all-time rank/rate with a weekly badge is intentional: the table's own rank/rate columns describe standing usage, while the badge specifically answers "who's winning this week."
- Cache % uses the same formula already established at `dashboard/js/views/analytics/tabs/insights.js:371` (`stats.cache_read / (stats.input + stats.cache_read || 1)`), reused here for consistency rather than inventing a new one.
- Per spec Section 5, this widget already degrades gracefully off the existing `models.length === 0` empty state (`compare.js`'s current empty-state check) — no new empty-state design work needed beyond preserving that check in the rewritten render function.
- **Two pre-existing Playwright specs assert the Plotly bar chart this plan removes and must be updated in the same task, not left to break silently.** `tests/charts.spec.js`'s `'compare chart renders horizontal bars'` test and `tests/mobile.spec.js`'s `'iPad Mini - chart tabs render on tablet'` test both assert `#compare-chart-container svg.main-svg`/`.barlayer path`. Neither runs under `bun run test:e2e` (`package.json:15` scopes that script to `tests/playwright/overflow.spec.js` only), but both run under a bare `bunx playwright test` with no path filter, and leaving them asserting a chart that no longer exists would be a real, silently-discovered regression the next time someone runs the full Playwright suite.
- **Badges show a visible short text label alongside the icon, not an icon-only cell with a hover-only `title`.** An icon-plus-`title`-attribute-only badge is invisible to keyboard/touch users who can't trigger a hover tooltip, and the weekly-title-belt widget this reuses icons from already pairs its icons with a visible `.belt-title` label (`dataviz-weekly-title-belt.md`'s `beltRow()`) — matching that precedent here instead of a hover-only affordance.
- **Mobile/narrow-viewport rendering of the 5-column table is a known risk to verify, not a design decision made blind here.** `design-v2.css`'s `.models-table-container` styling and the existing `main.css` horizontal-scroll fallback for wide tables haven't been checked against this specific column set at the narrowest tested viewport (Samsung Galaxy S8+, 360px, already covered by an existing `tests/mobile.spec.js` Models-tab test). Verify the league table doesn't clip at that width during Task 2 Step 10's Playwright run; if it does, follow the same horizontal-scroll pattern the Models tab already uses rather than inventing a new layout strategy.

---

### Task 1: Add the pure league-table calculation module

**Files:**
- Create: `dashboard/js/league-table.js`
- Test: `tests/unit/league-table.test.js`

**Interfaces:**
- Consumes: `computeWeekWindow`, `scoreTitleBelt` from `dashboard/js/title-belt.js` (weekly-title-belt plan).
- Produces: `buildLeagueTable(tokensByModel, costsByModel, weeklyData, pricingByModel): {top: LeagueRow[], others: LeagueRow[]}` from `dashboard/js/league-table.js`, where `LeagueRow = {rank: number, name: string, tokens: number, effectiveRatePerMillion: number|null, cachePct: number, badge: 'volumeCrown'|'thriftKing'|'sommelier'|'mostImproved'|null}`. `top` is the first 8 entries by descending `tokens`, `others` is everything beyond that, both 1-indexed by overall rank (i.e. `others[0].rank === 9`).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/league-table.test.js
import { describe, expect, it } from 'bun:test';
import { buildLeagueTable } from '../../dashboard/js/league-table.js';

const pricingByModel = {
    'a/model-1': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    'a/model-2': { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0.25 },
    'a/model-3': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }
};

/** Build a weeklyData-shaped fixture with 15 daily cumulative snapshots. */
function fixtureWeeklyData(perDayGrowth) {
    const out = [];
    const cumulative = {};
    for (const name of Object.keys(perDayGrowth)) cumulative[name] = 0;
    for (let d = 0; d < 15; d++) {
        const models = {};
        for (const [name, growth] of Object.entries(perDayGrowth)) {
            cumulative[name] += growth;
            models[name] = { total: cumulative[name], input: cumulative[name] * 0.5, output: cumulative[name] * 0.5, cache_read: 0, cache_write: 0 };
        }
        out.push({ day: `d${d}`, tokens: 0, models });
    }
    return out;
}

describe('buildLeagueTable', () => {
    it('returns empty top/others for no models', () => {
        expect(buildLeagueTable({}, {}, [], {})).toEqual({ top: [], others: [] });
    });

    it('splits into top 8 by descending tokens and the rest as others, ranked continuously', () => {
        /** @type {Record<string, any>} */
        const tokensByModel = {};
        for (let i = 0; i < 10; i++) {
            tokensByModel[`a/model-${i}`] = { total: (10 - i) * 100, input: (10 - i) * 50, output: (10 - i) * 50, cache_read: 0, cache_write: 0 };
        }
        const { top, others } = buildLeagueTable(tokensByModel, {}, [], {});
        expect(top.length).toBe(8);
        expect(others.length).toBe(2);
        expect(top[0].name).toBe('a/model-0');
        expect(top[0].rank).toBe(1);
        expect(others[0].rank).toBe(9);
        expect(others[0].name).toBe('a/model-8');
    });

    it('computes effective $/M from costsByModel, null when cost is missing', () => {
        const tokensByModel = { 'a/model-1': { total: 1000000, input: 500000, output: 500000, cache_read: 0, cache_write: 0 } };
        const costsByModel = { 'a/model-1': { total: 4.5 } };
        const { top } = buildLeagueTable(tokensByModel, costsByModel, [], {});
        expect(top[0].effectiveRatePerMillion).toBeCloseTo(4.5, 5);

        const { top: topNoCost } = buildLeagueTable(tokensByModel, {}, [], {});
        expect(topNoCost[0].effectiveRatePerMillion).toBeNull();
    });

    it('computes cache % using the same formula as the Insights tab', () => {
        const tokensByModel = { 'a/model-1': { total: 100, input: 60, output: 0, cache_read: 40, cache_write: 0 } };
        const { top } = buildLeagueTable(tokensByModel, {}, [], {});
        expect(top[0].cachePct).toBeCloseTo(40, 5);
    });

    it('assigns the correct, non-overlapping badge to the model holding each of three belts this week', () => {
        // model-1 has the largest weekly token growth (-> volumeCrown), model-2 is
        // the cheapest per-token in the pricing table (-> thriftKing), model-3 is
        // the priciest per-token but grows slower than model-1 (-> sommelier,
        // unmasked by volumeCrown since it doesn't also lead on volume).
        const tokensByModel = {
            'a/model-1': { total: 10500, input: 5250, output: 5250, cache_read: 0, cache_write: 0 },
            'a/model-2': { total: 3000, input: 1500, output: 1500, cache_read: 0, cache_write: 0 },
            'a/model-3': { total: 1500, input: 750, output: 750, cache_read: 0, cache_write: 0 }
        };
        const weeklyData = fixtureWeeklyData({ 'a/model-1': 700, 'a/model-2': 200, 'a/model-3': 100 });
        const { top } = buildLeagueTable(tokensByModel, {}, weeklyData, pricingByModel);
        const byName = Object.fromEntries(top.map((r) => [r.name, r.badge]));
        expect(byName['a/model-1']).toBe('volumeCrown');
        expect(byName['a/model-2']).toBe('thriftKing');
        expect(byName['a/model-3']).toBe('sommelier');
    });

    it('assigns no badge to a model that holds none of the four belts', () => {
        // a/negligible's share of the week's total is ~0.01%, well below the 1%
        // eligibility floor, once a/dominant's much larger growth is in the mix.
        const tokensByModel = {
            'a/dominant': { total: 700000, input: 350000, output: 350000, cache_read: 0, cache_write: 0 },
            'a/negligible': { total: 70, input: 35, output: 35, cache_read: 0, cache_write: 0 }
        };
        const weeklyData = fixtureWeeklyData({ 'a/dominant': 100000, 'a/negligible': 10 });
        const { top } = buildLeagueTable(tokensByModel, {}, weeklyData, pricingByModel);
        const byName = Object.fromEntries(top.map((r) => [r.name, r.badge]));
        expect(byName['a/negligible']).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/league-table.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/league-table.js'`

- [ ] **Step 3: Write the module**

```js
// dashboard/js/league-table.js
import { computeWeekWindow, scoreTitleBelt } from './title-belt.js';

/** @typedef {{rank: number, name: string, tokens: number, effectiveRatePerMillion: number|null, cachePct: number, badge: 'volumeCrown'|'thriftKing'|'sommelier'|'mostImproved'|null}} LeagueRow */

const BADGE_PRIORITY = ['volumeCrown', 'thriftKing', 'sommelier', 'mostImproved'];

/**
 * @param {ReturnType<typeof scoreTitleBelt>} belts
 * @param {string} name
 * @returns {LeagueRow['badge']}
 */
function badgeFor(belts, name) {
    for (const belt of BADGE_PRIORITY) {
        if (belts[belt]?.name === name) return /** @type {LeagueRow['badge']} */ (belt);
    }
    return null;
}

/**
 * @param {Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number}>} tokensByModel
 * @param {Record<string, {total:number}>|undefined} costsByModel
 * @param {any[]} weeklyData
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {{top: LeagueRow[], others: LeagueRow[]}}
 */
export function buildLeagueTable(tokensByModel, costsByModel, weeklyData, pricingByModel) {
    const sorted = Object.entries(tokensByModel || {}).sort((a, b) => b[1].total - a[1].total);
    if (sorted.length === 0) return { top: [], others: [] };

    const belts = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);

    const rows = sorted.map(([name, stats], index) => {
        const cost = costsByModel?.[name]?.total;
        const effectiveRatePerMillion = (typeof cost === 'number' && stats.total > 0)
            ? cost / (stats.total / 1e6)
            : null;
        const cachePct = ((stats.cache_read || 0) / ((stats.input || 0) + (stats.cache_read || 0) || 1)) * 100;
        return { rank: index + 1, name, tokens: stats.total, effectiveRatePerMillion, cachePct, badge: badgeFor(belts, name) };
    });

    return { top: rows.slice(0, 8), others: rows.slice(8) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/league-table.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add dashboard/js/league-table.js tests/unit/league-table.test.js
git commit -m "feat(dashboard): add league-table ranking/badge calculation module"
```

---

### Task 2: Render the league table in the Compare tab

**Files:**
- Modify: `dashboard/js/views/analytics/tabs/compare.js`
- Modify: `dashboard/index.html`
- Modify: `dashboard/styles/design-v2.css`
- Modify: `tests/charts.spec.js` (existing test asserts the Plotly bar chart this task removes)
- Modify: `tests/mobile.spec.js` (existing tablet test asserts the same Plotly chart in the Compare tab)
- Test: `tests/unit/league-table-render.test.js`

**Interfaces:**
- Consumes: `buildLeagueTable` from `dashboard/js/league-table.js` (Task 1); `weeklyData` from `dashboard/js/state.js`; `escapeHtml` (already re-exported by `./shared.js`); the `#icon-crown`/`#icon-thrift`/`#icon-wine`/`#icon-improved` sprite (foundations plan).
- Produces: `renderCompareTab(container)` (same exported name and signature as today — internal implementation only).

- [ ] **Step 1: Replace the Compare tab's chart container with a table skeleton**

In `dashboard/index.html`, change the Compare tab block (`dashboard/index.html:134-138`) from:

```html
            <!-- Compare Tab -->
            <div id="analytics-tab-compare" class="analytics-content" style="display:none;">
                <div id="compare-chart-container" class="compare-container">
                    <div class="skeleton" style="height: 400px;"></div>
                </div>
            </div>
```

to:

```html
            <!-- Compare Tab -->
            <div id="analytics-tab-compare" class="analytics-content" style="display:none;">
                <div id="compare-chart-container" class="models-table-container">
                    <div class="skeleton" style="height: 400px;"></div>
                </div>
            </div>
```

- [ ] **Step 2: Update the two pre-existing Playwright specs that assert the removed Plotly chart**

In `tests/charts.spec.js`, replace the `'compare chart renders horizontal bars'` test (`tests/charts.spec.js:15-23`) with:

```js
  test('compare tab renders the league table', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await expect(page.locator('.subnav-btn[data-tab="compare"]')).toBeVisible({ timeout: 10000 });
    await page.click('button:has-text("Compare")');

    await expect(page.locator('#compare-chart-container table.mono-table')).toBeVisible({ timeout: 10000 });
    const rows = await page.locator('#compare-chart-container tbody tr').count();
    expect(rows).toBeGreaterThan(0);
  });
```

In `tests/mobile.spec.js`, in the `'iPad Mini - chart tabs render on tablet'` test (`tests/mobile.spec.js:36-47`), replace the Compare-tab assertion:

```js
    await page.click('button:has-text("Compare")');
    await expect(page.locator('#compare-chart-container svg.main-svg').first()).toBeVisible({ timeout: 10000 });
```

with:

```js
    await page.click('button:has-text("Compare")');
    await expect(page.locator('#compare-chart-container table.mono-table')).toBeVisible({ timeout: 10000 });
```

Leave the rest of both files (the Distribution donut-chart assertions, all other tests) untouched — only the Compare tab's chart-specific assertions are affected by this plan.

- [ ] **Step 3: Add league-table-specific CSS**

In `dashboard/styles/design-v2.css`, add (reuses the existing `.mono-table`/`.num` rules already defined for the Models tab):

```css
.league-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 8px; border: 1px solid var(--mono-border-accent); color: var(--mono-accent);
  background: var(--mono-accent-dim);
}
.league-badge svg { width: 14px; height: 14px; color: currentColor; fill: none; flex: none; }
.league-badge-label { font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
.league-others-toggle { cursor: pointer; color: var(--mono-text-muted); }
.league-others-toggle:hover { background: var(--mono-surface-hover); }
.league-others-toggle td { text-align: center; font-size: 0.78rem; letter-spacing: 0.04em; }
```

- [ ] **Step 4: Write the failing tests**
```js
// tests/unit/league-table-render.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderCompareTab } from '../../dashboard/js/views/analytics/tabs/compare.js';
import { setCurrentData, setWeeklyData } from '../../dashboard/js/state.js';

function fixtureCurrentData(count) {
    /** @type {Record<string, any>} */
    const tokens_by_model = {};
    /** @type {Record<string, any>} */
    const costs_by_model = {};
    for (let i = 0; i < count; i++) {
        tokens_by_model[`a/model-${i}`] = { total: (count - i) * 100, input: (count - i) * 50, output: (count - i) * 50, cache_read: 0, cache_write: 0 };
        costs_by_model[`a/model-${i}`] = { total: (count - i) * 0.1 };
    }
    return { tokens_by_model, costs_by_model, pricing_by_model: {} };
}

describe('renderCompareTab (league table)', () => {
    let container;

    beforeEach(() => {
        document.body.innerHTML = '<div id="compare-chart-container"></div>';
        container = document.getElementById('compare-chart-container');
        setWeeklyData([]);
    });

    it('shows the empty state when there are no models', () => {
        setCurrentData({ tokens_by_model: {}, costs_by_model: {}, pricing_by_model: {} });
        renderCompareTab(container);
        expect(container.textContent).toContain('No data available');
    });

    it('renders exactly 8 visible ranked rows plus a hidden "+N others" toggle for more than 8 models', () => {
        setCurrentData(fixtureCurrentData(10));
        renderCompareTab(container);
        const rows = container.querySelectorAll('tbody tr:not(.league-others-toggle):not(.league-other-row)');
        expect(rows.length).toBe(8);
        expect(container.textContent).toContain('+2 others');
        expect(container.querySelectorAll('.league-other-row').length).toBe(2);
    });

    it('expands the "+N others" row on click, revealing the hidden rows', () => {
        setCurrentData(fixtureCurrentData(10));
        renderCompareTab(container);
        const toggle = container.querySelector('.league-others-toggle');
        const hiddenRows = container.querySelectorAll('.league-other-row');
        expect(hiddenRows[0].style.display).toBe('none');
        toggle.dispatchEvent(new Event('click', { bubbles: true }));
        expect(hiddenRows[0].style.display).not.toBe('none');
        expect(container.textContent).toContain('Hide');
    });

    it('does not render a toggle row for 8 or fewer models', () => {
        setCurrentData(fixtureCurrentData(5));
        renderCompareTab(container);
        expect(container.querySelector('.league-others-toggle')).toBeNull();
    });

    it('escapes model names as text, never as injected HTML', () => {
        const malicious = 'a/<img src=x onerror="alert(1)">';
        setCurrentData({
            tokens_by_model: { [malicious]: { total: 100, input: 100, output: 0, cache_read: 0, cache_write: 0 } },
            costs_by_model: {},
            pricing_by_model: {}
        });
        renderCompareTab(container);
        expect(container.textContent).toContain('<img');
        expect(container.querySelector('img')).toBeNull();
    });
});
```

- [ ] **Step 5: Run tests to verify they fail**
Run: `bun test tests/unit/league-table-render.test.js`
Expected: FAIL — `renderCompareTab` still renders a Plotly chart, not a table.

- [ ] **Step 6: Rewrite `compare.js`**
```js
// dashboard/js/views/analytics/tabs/compare.js
import { currentData, escapeHtml } from './shared.js';
import { weeklyData } from '../../../state.js';
import { buildLeagueTable } from '../../../league-table.js';

const BADGE_ICON = { volumeCrown: 'icon-crown', thriftKing: 'icon-thrift', sommelier: 'icon-wine', mostImproved: 'icon-improved' };
const BADGE_LABEL = { volumeCrown: 'Volume Crown', thriftKing: 'Thrift King', sommelier: 'The Sommelier', mostImproved: 'Most Improved' };
const BADGE_SHORT_LABEL = { volumeCrown: 'Crown', thriftKing: 'Thrift', sommelier: 'Sommelier', mostImproved: 'Improved' };

/** @param {import('../../../league-table.js').LeagueRow['badge']} badge @returns {string} */
function badgeCell(badge) {
    if (!badge) return '';
    return `<span class="league-badge" title="${escapeHtml(BADGE_LABEL[badge])}"><svg aria-hidden="true"><use href="#${BADGE_ICON[badge]}"></use></svg><span class="league-badge-label">${escapeHtml(BADGE_SHORT_LABEL[badge])}</span></span>`;
}

/** @param {import('../../../league-table.js').LeagueRow} row @param {boolean} hidden @returns {string} */
function rowHtml(row, hidden) {
    return `
        <tr class="${hidden ? 'league-other-row' : ''}" ${hidden ? 'style="display:none"' : ''}>
            <td class="num">${row.rank}</td>
            <td>${escapeHtml(row.name.split('/').pop())}</td>
            <td>${badgeCell(row.badge)}</td>
            <td class="num">${row.effectiveRatePerMillion !== null ? '$' + row.effectiveRatePerMillion.toFixed(2) : '—'}</td>
            <td class="num">${row.cachePct.toFixed(0)}%</td>
        </tr>
    `;
}

/** @param {HTMLElement|null} [container] */
export function renderCompareTab(container) {
    if (!container) container = document.getElementById('compare-chart-container');
    if (!container) return;
    if (!currentData) return;

    /** @type {any} */
    const data = currentData;
    const { tokens_by_model, costs_by_model, pricing_by_model } = data;
    const hasModels = tokens_by_model && Object.keys(tokens_by_model).length > 0;

    if (!hasModels) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--mono-text-muted);">No data available</div>';
        return;
    }

    const { top, others } = buildLeagueTable(tokens_by_model, costs_by_model, weeklyData, pricing_by_model);

    const toggleRow = others.length
        ? `<tr class="league-others-toggle" tabindex="0" role="button" data-expanded="false"><td colspan="5">+${others.length} others</td></tr>`
        : '';

    container.innerHTML = `
        <table class="mono-table">
            <thead>
                <tr><th>Rank</th><th>Model</th><th>Badge</th><th class="num">Effective $/M</th><th class="num">Cache %</th></tr>
            </thead>
            <tbody>
                ${top.map((row) => rowHtml(row, false)).join('')}
                ${toggleRow}
                ${others.map((row) => rowHtml(row, true)).join('')}
            </tbody>
        </table>
    `;

    if (!others.length) return;
    const toggle = /** @type {HTMLElement} */ (container.querySelector('.league-others-toggle'));
    const hiddenRows = container.querySelectorAll('.league-other-row');
    const expand = () => {
        const expanded = toggle.dataset.expanded === 'true';
        toggle.dataset.expanded = String(!expanded);
        /** @type {HTMLElement} */ (toggle.querySelector('td')).textContent = expanded ? `+${others.length} others` : `− Hide ${others.length} others`;
        hiddenRows.forEach((row) => { /** @type {HTMLElement} */ (row).style.display = expanded ? 'none' : 'table-row'; });
    };
    toggle.addEventListener('click', expand);
    toggle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            expand();
        }
    });
}
```

Note: `./shared.js` doesn't currently re-export `escapeHtml`'s underlying function under a different name — confirm the existing re-export at `dashboard/js/views/analytics/tabs/shared.js`'s export block already includes `escapeHtml` (it does, alongside `currentData`) before relying on this import.

- [ ] **Step 7: Run tests to verify they pass**
Run: `bun test tests/unit/league-table-render.test.js`
Expected: PASS (5 tests)

- [ ] **Step 8: Run the full unit suite to catch regressions**
Run: `bun run test`
Expected: PASS

- [ ] **Step 9: Extend the shared Playwright smoke test**
In `tests/playwright/overflow.spec.js`, add:

```js
  test('league table (Analytics > Compare)', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await page.click('button:has-text("Compare")');
    await expect(page.locator('#compare-chart-container table')).toBeVisible({ timeout: 10000 });
    await expectNoOverflow(page, '#compare-chart-container');
  });
```

- [ ] **Step 10: Run the Playwright suite**
Run: `bun run test:e2e`
Expected: PASS

- [ ] **Step 11: Commit**
```bash
git add dashboard/js/views/analytics/tabs/compare.js dashboard/index.html dashboard/styles/design-v2.css tests/unit/league-table-render.test.js tests/playwright/overflow.spec.js
git commit -m "feat(dashboard): render the league table in Analytics > Compare"
```
