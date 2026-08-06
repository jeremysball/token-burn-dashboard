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
        expect(visibleDataRows.length).toBe(10);
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
});
