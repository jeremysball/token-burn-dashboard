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
        expect(rows).toHaveLength(8);
        expect(container.textContent).toContain('+2 others');
        expect(container.querySelectorAll('.league-other-row')).toHaveLength(2);
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

    it('preserves the expanded toggle state across an ambient re-render (SSE-driven rebuild)', () => {
        setCurrentData(fixtureCurrentData(10));
        renderCompareTab(container);

        // User expands the "others" section.
        const toggle = container.querySelector('.league-others-toggle');
        toggle.dispatchEvent(new Event('click', { bubbles: true }));
        expect(toggle.dataset.expanded).toBe('true');
        expect(container.textContent).toContain('Hide');
        const othersRowsAfterExpand = container.querySelectorAll('.league-other-row');
        expect(othersRowsAfterExpand[0].style.display).not.toBe('none');

        // Ambient SSE-driven refresh: renderCompareTab fires again with the
        // same data. The toggle's expanded state must survive the rebuild
        // — otherwise the user's "Hide" silently flips back to "Show".
        renderCompareTab(container);

        const toggleAfterRerender = container.querySelector('.league-others-toggle');
        expect(toggleAfterRerender).not.toBeNull();
        expect(toggleAfterRerender.dataset.expanded).toBe('true');
        expect(container.textContent).toContain('Hide');
        // After an expanded re-render, all 10 model rows (8 top + 2 others)
        // must be visible — the others rows are no longer tagged with
        // .league-other-row because they aren't hidden, so count everything
        // except the toggle row itself.
        const visibleDataRows = container.querySelectorAll('tbody tr:not(.league-others-toggle)');
        expect(visibleDataRows).toHaveLength(10);
    });

    it('a re-render on a previously-collapsed toggle stays collapsed', () => {
        setCurrentData(fixtureCurrentData(10));
        renderCompareTab(container);

        // Sanity: the toggle starts collapsed.
        const toggle = container.querySelector('.league-others-toggle');
        expect(toggle.dataset.expanded).toBe('false');

        // Ambient refresh.
        renderCompareTab(container);

        const toggleAfterRerender = container.querySelector('.league-others-toggle');
        expect(toggleAfterRerender.dataset.expanded).toBe('false');
        expect(container.textContent).toContain('+2 others');
        const othersRowsAfterRerender = container.querySelectorAll('.league-other-row');
        expect(othersRowsAfterRerender[0].style.display).toBe('none');
    });

    it('clicking "Hide" after a preserved-expanded re-render actually hides the rows (regression for round-1 bug)', () => {
        setCurrentData(fixtureCurrentData(10));
        renderCompareTab(container);

        // Expand the "others" section.
        const toggle = container.querySelector('.league-others-toggle');
        toggle.dispatchEvent(new Event('click', { bubbles: true }));
        expect(toggle.dataset.expanded).toBe('true');

        // Ambient SSE-driven refresh while still expanded.
        renderCompareTab(container);

        const toggleAfterRerender = container.querySelector('.league-others-toggle');
        expect(toggleAfterRerender.dataset.expanded).toBe('true');
        // All 10 model rows must be visible right after the re-render.
        let visibleDataRows = container.querySelectorAll('tbody tr:not(.league-others-toggle)');
        expect(visibleDataRows).toHaveLength(10);

        // Now collapse. The label must flip back to "+N others" AND the
        // others rows must actually be hidden (display:none), not just
        // relabeled. This is the exact case the round-1 fix broke: the
        // captured `hiddenRows` NodeList was empty after the re-render
        // because the `others` rows were rendered without the
        // `.league-other-row` class when wasExpanded was true, so the
        // expand() closure had nothing to toggle.
        toggleAfterRerender.dispatchEvent(new Event('click', { bubbles: true }));
        expect(toggleAfterRerender.dataset.expanded).toBe('false');
        expect(container.textContent).toContain('+2 others');
        const othersRows = container.querySelectorAll('.league-other-row');
        expect(othersRows).toHaveLength(2);
        for (const row of othersRows) {
            expect((/** @type {HTMLElement} */ (row)).style.display).toBe('none');
        }
    });

    it('renders every qualifying badge for a model that simultaneously holds several belts (regression for the priority-pick bug)', () => {
        // The Insights tab's title-belt widget already shows a model as the
        // holder of multiple belts at once (e.g. Volume Crown + Thrift King).
        // The league-table row used to silently drop every badge after the
        // first one in priority order. The fix surfaces all of them in a
        // single cell, separated by inline-flex.
        setCurrentData({
            tokens_by_model: {
                'a/cheapest': { total: 50000, input: 25000, output: 25000, cache_read: 0, cache_write: 0, reasoning: 0 },
                'a/pricier':  { total: 20000, input: 10000, output: 10000, cache_read: 0, cache_write: 0, reasoning: 0 }
            },
            costs_by_model: {},
            pricing_by_model: {
                'a/cheapest': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
                'a/pricier':  { input: 5,   output: 25,  cacheRead: 0.5,  cacheWrite: 6.25 }
            }
        });
        // 8 daily snapshots + 1 today for the model-1; thisWeek is a
        // small enough span that computeWeekWindow returns null until we
        // hit 8 valid days.
        const snapshots = [];
        let cumulative1 = 0;
        let cumulative2 = 0;
        for (let d = 0; d < 8; d++) {
            cumulative1 += 3000;
            cumulative2 += 1500;
            snapshots.push({
                day: new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10),
                tokens: cumulative1 + cumulative2,
                models: {
                    'a/cheapest': { total: cumulative1, input: cumulative1 / 2, output: cumulative1 / 2, cache_read: 0, cache_write: 0, reasoning: 0 },
                    'a/pricier':  { total: cumulative2, input: cumulative2 / 2, output: cumulative2 / 2, cache_read: 0, cache_write: 0, reasoning: 0 }
                }
            });
        }
        setWeeklyData(snapshots);
        renderCompareTab(container);

        // a/cheapest has the largest weekly token growth AND the cheapest
        // effective $/M -> must surface BOTH volumeCrown and thriftKing.
        const rows = container.querySelectorAll('tbody tr:not(.league-others-toggle)');
        const cheapestRow = Array.from(rows).find((r) => r.textContent.includes('a/cheapest'));
        expect(cheapestRow).toBeDefined();
        const cheapestBadges = cheapestRow.querySelectorAll('.league-badge');
        // Two distinct badge labels must appear, not just one.
        expect(cheapestBadges).toHaveLength(2);
        const cheapestLabels = Array.from(cheapestBadges).map((b) => b.textContent.trim());
        expect(cheapestLabels).toContain('Crown');
        expect(cheapestLabels).toContain('Thrift');
    });

    it('uses one shared row template for top + other rows (regression: templates were duplicated)', () => {
        // Render a fixed dataset and assert that the cell content of a top
        // row matches the cell content of an "other" row for the same
        // model-shaped data. The original code had two separate templates
        // (topRowHtml / otherRowHtml) with byte-identical <td> children and
        // a tiny wrapper diff; if a future change re-introduces divergence
        // between the two paths, a property-level comparison of the
        // resulting cells catches it.
        setCurrentData(fixtureCurrentData(10));
        renderCompareTab(container);

        const topRows = container.querySelectorAll('tbody tr:not(.league-others-toggle):not(.league-other-row)');
        const otherRows = container.querySelectorAll('tbody tr.league-other-row');
        expect(topRows).toHaveLength(8);
        expect(otherRows).toHaveLength(2);

        // The 5-cell structure (rank / model / badges / effective / cache)
        // must match between top and other rows. The badge cell may contain
        // zero spans for either, so just compare the cell count + class
        // names + numeric classes.
        const topCells = Array.from(topRows[0].querySelectorAll('td'));
        const otherCells = Array.from(otherRows[0].querySelectorAll('td'));
        expect(topCells).toHaveLength(otherCells.length);
        expect(topCells).toHaveLength(5);
        for (let i = 0; i < 5; i++) {
            expect(topCells[i].className).toBe(otherCells[i].className);
        }

        // The badge column header is "Badges" (plural) since rows can now
        // carry more than one — a future regression that flips it back to
        // singular would re-introduce the "one badge per row" contract.
        const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent.trim());
        expect(headers).toContain('Badges');
    });
});
