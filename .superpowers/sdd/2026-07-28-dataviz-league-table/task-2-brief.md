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
import { currentData, escapeHtml, displayModel } from './shared.js';
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
            <td>${escapeHtml(displayModel(row.name))}</td>
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
