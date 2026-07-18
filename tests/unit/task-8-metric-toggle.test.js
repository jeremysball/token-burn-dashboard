/**
 * @jest-environment jsdom
 *
 * TDD for Task 8: tokens/cost metric toggle with real Models.dev pricing.
 * These tests assert the post-implementation behavior and fail before it lands.
 */

import { renderAnalytics, setHeatmapMetric, retryModelsDevPricing } from '../../dashboard/js/views/analytics.js';
import { setCatalog, clearCatalogCache, fetchModelsDevCatalog } from '../../dashboard/js/modelsdev-pricing.js';
import {
    setCurrentData,
    setFileHistoricalData,
    setHistoryData
} from '../../dashboard/js/state.js';

const fs = require('fs');
const path = require('path');
const designV2Css = fs.readFileSync(
    path.resolve(process.cwd(), 'dashboard/styles/design-v2.css'),
    'utf8'
);

const mockCatalog = {
    openrouter: {
        models: {
            'tencent/hy3:free': { cost: { input: 0, output: 0, reasoning: 0 } },
            'z-ai/glm-5': { cost: { input: 1, output: 3 } }
        }
    },
    anthropic: {
        models: { 'claude-opus-4-8': { cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 } } }
    }
};

const renderHeatmapTab = (type, history, metric = 'tokens') => {
    document.body.innerHTML = `
        <button class="subnav-btn active" data-tab="heatmaps"></button>
        <div class="heatmap-controls">
            <select id="heatmap-type"><option value="${type}" selected>${type}</option></select>
            <div class="heatmap-metric-toggle" id="heatmap-metric-toggle">
                <button type="button" data-metric="tokens" class="${metric === 'tokens' ? 'active' : ''}">Tokens</button>
                <button type="button" data-metric="cost" class="${metric === 'cost' ? 'active' : ''}">Cost</button>
            </div>
        </div>
        <div id="heatmaps-container"></div>
    `;
    setCurrentData({
        total_tokens: 1000,
        total_cost: { total: 0 },
        tokens_by_model: {},
        pricing_by_model: {},
        files_processed: 0,
        total_lines: 0
    });
    setFileHistoricalData([]);
    setHistoryData(history);
    setHeatmapMetric(metric);
    renderAnalytics();
};

const cssRules = css => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return Array.from(style.sheet.cssRules);
};

const findRule = (rules, selector) => {
    for (const rule of rules) {
        if (rule.selectorText?.split(',').map(s => s.trim()).includes(selector)) return rule;
        if (rule.cssRules) {
            const nested = findRule(Array.from(rule.cssRules), selector);
            if (nested) return nested;
        }
    }
    return null;
};

describe('Task 8: metric toggle', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        clearCatalogCache();
    });
    afterEach(() => {
        clearCatalogCache();
        setHeatmapMetric('tokens');
    });

    it('setHeatmapMetric switches active pill and re-renders cost', () => {
        renderHeatmapTab('hourly', [{ time: Date.UTC(2026, 6, 10, 5), total: 1000 }], 'tokens');
        setCatalog(mockCatalog);
        setHeatmapMetric('cost');
        const activeBtn = document.querySelector('#heatmap-metric-toggle button.active');
        expect(activeBtn.dataset.metric).toBe('cost');
        // Cost cells carry the .cost class and a currency-formatted value.
        const cell = document.querySelector('.heatmap-cell-full.cost');
        expect(cell).not.toBeNull();
        expect(cell.getAttribute('data-value')).toMatch(/^\$/);
    });

    it('token metric stays usable and is unaffected by missing catalog', () => {
        renderHeatmapTab('hourly', [{ time: Date.UTC(2026, 6, 10, 5), total: 1000 }], 'tokens');
        const cell = document.querySelector('.heatmap-cell-full');
        expect(cell).not.toBeNull();
        expect(cell.getAttribute('data-suffix')).toBe('tokens');
        const valued = Array.from(document.querySelectorAll('.heatmap-cell-full'))
            .find(c => c.getAttribute('data-value') === '1,000');
        expect(valued).not.toBeNull();
    });
});

describe('Task 8: real per-model cost with Models.dev pricing', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        clearCatalogCache();
        setCatalog(mockCatalog);
    });
    afterEach(() => { clearCatalogCache(); setHeatmapMetric('tokens'); });

    it('prices a known model from the injected catalog (no hardcoded constant)', () => {
        // glm-5: input 1, output 3 => avg 2 per 1M; 1M tokens => $2.00
        renderHeatmapTab('model', [{
            time: Date.UTC(2026, 6, 10, 5),
            total: 1_000_000,
            tokens_by_model: { 'openrouter/z-ai/glm-5': 1_000_000 }
        }], 'cost');
        const cell = document.querySelector('.heatmap-cell-full.cost');
        expect(cell).not.toBeNull();
        expect(cell.getAttribute('data-value')).toBe('$2.00');
    });

    it('includes cache dimensions when Models.dev provides them', () => {
        // claude-opus-4-8: input 5, output 25, cache 0.5/6.25; 1M each => 5+25+0.5+6.25 = 36.75
        renderHeatmapTab('model', [{
            time: Date.UTC(2026, 6, 10, 5),
            total: 4_000_000,
            tokens_by_model: {
                'anthropic/claude-opus-4-8': {
                    input: 1_000_000, output: 1_000_000, cache_read: 1_000_000, cache_write: 1_000_000
                }
            }
        }], 'cost');
        const cell = document.querySelector('.heatmap-cell-full.cost');
        expect(cell.getAttribute('data-value')).toBe('$36.75');
    });

    it('prices live history buckets stored under `models` (not `tokens_by_model`)', () => {
        // Live fallback history stores per-model data under `models`; it must
        // price the same as `tokens_by_model` rather than showing $0.00.
        renderHeatmapTab('hourly', [{
            time: Date.UTC(2026, 6, 10, 5),
            total: 1_000_000,
            models: { 'openrouter/z-ai/glm-5': 1_000_000 }
        }], 'cost');
        const cell = Array.from(document.querySelectorAll('.heatmap-cell-full.cost'))
            .find(c => c.getAttribute('data-value') === '$2.00');
        expect(cell).not.toBeNull();
        // No unavailable banner since the model is priced.
        expect(document.querySelector('.heatmap-metric-note.unavailable')).toBeNull();
    });
});

describe('Task 8: missing-price behavior', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        clearCatalogCache();
        setCatalog(mockCatalog);
    });
    afterEach(() => { clearCatalogCache(); setHeatmapMetric('tokens'); });

    it('renders an explicit unavailable note when a model has no Models.dev price', () => {
        renderHeatmapTab('model', [{
            time: Date.UTC(2026, 6, 10, 5),
            total: 1000,
            tokens_by_model: { 'openrouter/unknown-model': 1000 }
        }], 'cost');
        const note = document.querySelector('.heatmap-metric-note.unavailable');
        expect(note).not.toBeNull();
    });

    it('renders a loading note when catalog is absent (cost metric still renders)', () => {
        clearCatalogCache();
        renderHeatmapTab('hourly', [{ time: Date.UTC(2026, 6, 10, 5), total: 1000 }], 'cost');
        const note = document.querySelector('.heatmap-metric-note');
        expect(note).not.toBeNull();
        expect(note.textContent.toLowerCase()).toMatch(/loading|models\.dev/);
        // token metric path still produces cells (no crash / no invented constant cost)
        expect(document.querySelector('.heatmap-cell-full')).not.toBeNull();
    });
});

describe('Task 8: catalog failure state visibility', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        clearCatalogCache();
    });
    afterEach(() => { clearCatalogCache(); setHeatmapMetric('tokens'); });

    it('renders an explicit unavailable message (not loading) when the catalog request fails', async () => {
        const rejectingFetch = jest.fn().mockResolvedValue({
            ok: false, status: 503, json: async () => ({})
        });
        await expect(fetchModelsDevCatalog(rejectingFetch)).rejects.toThrow();

        renderHeatmapTab('hourly', [{ time: Date.UTC(2026, 6, 10, 5), total: 1000 }], 'cost');
        const note = document.querySelector('.heatmap-metric-note');
        expect(note).not.toBeNull();
        expect(note.classList.contains('unavailable')).toBe(true);
        expect(note.textContent).toMatch(/cannot be calculated/i);
        expect(note.textContent.toLowerCase()).not.toMatch(/loading/);
        // token metric stays fully usable despite the failure
        setHeatmapMetric('tokens');
        const tokenCell = Array.from(document.querySelectorAll('.heatmap-cell-full'))
            .find(c => c.getAttribute('data-value') === '1,000');
        expect(tokenCell).not.toBeNull();
        expect(tokenCell.getAttribute('data-suffix')).toBe('tokens');
    });

    it('exposes a Retry pricing button and clears the failure on retry', async () => {
        const failFetch = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        global.fetch = failFetch;
        await expect(fetchModelsDevCatalog()).rejects.toThrow();

        renderHeatmapTab('hourly', [{ time: Date.UTC(2026, 6, 10, 5), total: 1000 }], 'cost');
        const retryBtn = document.querySelector('.heatmap-retry-btn');
        expect(retryBtn).not.toBeNull();
        expect(retryBtn.textContent).toMatch(/retry/i);

        // Flip the network to success and invoke the visible retry handler.
        const okFetch = jest.fn().mockResolvedValue({
            ok: true, status: 200, json: async () => ({ openrouter: { models: { 'z-ai/glm-5': { cost: { input: 1, output: 3 } } } } })
        });
        global.fetch = okFetch;
        retryModelsDevPricing();
        // allow the async fetch + re-render to settle
        await new Promise(r => setTimeout(r, 0));
        await new Promise(r => setTimeout(r, 0));

        // The failure state is cleared: the "cannot be calculated" message is gone.
        expect(document.body.textContent).not.toMatch(/cannot be calculated/i);
        const note = document.querySelector('.heatmap-metric-note');
        expect(note).not.toBeNull();
        expect(note.textContent.toLowerCase()).toMatch(/models\.dev/);
    });
});

describe('Task 8: hourly UTC grouping', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        clearCatalogCache();
        setHeatmapMetric('tokens');
    });
    afterEach(() => { clearCatalogCache(); setHeatmapMetric('tokens'); });

    it('groups a bucket by UTC day/hour, independent of viewer timezone', () => {
        // 2026-07-10T05:00:00Z is Thursday 05:00 UTC.
        renderHeatmapTab('hourly', [{ time: Date.UTC(2026, 6, 10, 5), total: 1000 }], 'tokens');
        const cell = Array.from(document.querySelectorAll('.heatmap-cell-full'))
            .find(c => c.getAttribute('title') === 'Thu 5:00 - 1,000 tokens');
        expect(cell).not.toBeNull();
    });

    it('places a different UTC hour in the matching column', () => {
        // 2026-07-10T23:00:00Z is Thursday 23:00 UTC.
        renderHeatmapTab('hourly', [{ time: Date.UTC(2026, 6, 10, 23), total: 500 }], 'tokens');
        const cell = Array.from(document.querySelectorAll('.heatmap-cell-full'))
            .find(c => c.getAttribute('title') === 'Thu 23:00 - 500 tokens');
        expect(cell).not.toBeNull();
    });
});

describe('Task 8: pill toggle CSS', () => {
    beforeEach(() => { document.head.innerHTML = ''; });

    it('defines the pill container and active pill styling', () => {
        const rules = cssRules(designV2Css);
        const container = findRule(rules, '.heatmap-metric-toggle');
        const active = findRule(rules, '.heatmap-metric-toggle button.active');
        expect(container).not.toBeNull();
        expect(container.style.getPropertyValue('border-radius')).toBe('9999px');
        expect(active).not.toBeNull();
        expect(active.style.getPropertyValue('background')).toBe('var(--mono-accent)');
    });
});
