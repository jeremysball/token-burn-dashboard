// tests/unit/cache-slider.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { renderCacheSlider, getCacheSliderPrecision, formatCacheRatePct } from '../../dashboard/js/cache-slider.js';
import { computeCacheScenario, getRealCacheHitRatePct } from '../../dashboard/js/cache-scenario.js';
import { fmtCur } from '../../dashboard/js/utils.js';

const dataAt = (hitRatePct) => {
    const cacheRead = hitRatePct * 1_000_000;
    const input = (100 - hitRatePct) * 1_000_000;
    return {
        total_input: input,
        total_cache_read: cacheRead,
        tokens_by_model: {
            'anthropic/claude-sonnet-5': { input, cache_read: cacheRead, output: 0, cache_write: 0, reasoning: 0, total: input + cacheRead }
        },
        pricing_by_model: {
            'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
        }
    };
};

describe('getCacheSliderPrecision', () => {
    it('produces enough decimals for a very small positive rate', () => {
        const p = getCacheSliderPrecision(0.04);
        expect(p.decimals).toBeGreaterThanOrEqual(2);
        expect(p.step).toBeGreaterThan(0);
    });

    it('never rounds a positive rate to zero', () => {
        const p = getCacheSliderPrecision(0.04);
        expect(p.step).toBeLessThan(0.04);
    });

    it('returns a sensible step for a normal rate', () => {
        const p = getCacheSliderPrecision(50);
        expect(p.step).toBeGreaterThan(0);
        expect(p.decimals).toBeGreaterThanOrEqual(1);
    });

    it('returns a stable result between renders', () => {
        const p1 = getCacheSliderPrecision(0.04);
        const p2 = getCacheSliderPrecision(0.04);
        expect(p1.step).toBe(p2.step);
        expect(p1.decimals).toBe(p2.decimals);
    });
});

describe('formatCacheRatePct', () => {
    it('formats with the given decimal count', () => {
        expect(formatCacheRatePct(0.04, 3)).toBe('0.040');
        expect(formatCacheRatePct(50, 1)).toBe('50.0');
    });

    it('preserves a nonzero value for small rates', () => {
        expect(Number(formatCacheRatePct(0.04, 3))).toBeGreaterThan(0);
    });
});

describe('renderCacheSlider', () => {
    let container;

    beforeEach(() => {
        document.body.innerHTML = '<section id="cache-savings-section"></section>';
        container = document.getElementById('cache-savings-section');
    });

    it('builds the section once and defaults the slider to the real hit rate', () => {
        renderCacheSlider(container, dataAt(90));
        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
        expect(slider).not.toBeNull();
        expect(Number(slider.value)).toBeCloseTo(90, 0);
        expect(Number(slider.max)).toBeCloseTo(90, 0);
    });

    it('updates the dollar readout when the slider is dragged', () => {
        renderCacheSlider(container, dataAt(90));
        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
        const before = container.querySelector('#cacheSavedValue').textContent;

        slider.value = '10';
        slider.dispatchEvent(new Event('input'));

        const after = container.querySelector('#cacheSavedValue').textContent;
        expect(after).not.toBe(before);
    });

    it('does not snap the slider back to the real rate on a subsequent render after the user dragged it', () => {
        renderCacheSlider(container, dataAt(90));
        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));

        slider.value = '10';
        slider.dispatchEvent(new Event('input'));

        renderCacheSlider(container, dataAt(91));

        expect(Number(slider.value)).toBeCloseTo(10, 0);
    });

    it('preserves a nonzero max and value for a 0.04% hit rate', () => {
        const data = {
            total_input: 99_960,
            total_cache_read: 40,
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 99_960, cache_read: 40, output: 0, cache_write: 0, reasoning: 0, total: 100_000 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        renderCacheSlider(container, data);
        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
        const readout = /** @type {HTMLElement} */ (container.querySelector('#cacheReadout'));

        expect(slider.max).not.toBe('0.0');
        expect(Number(slider.max)).toBeCloseTo(0.04, 8);
        expect(Number(slider.value)).toBeGreaterThan(0);
        expect(Number(slider.step)).toBeGreaterThan(0);
        expect(readout.textContent).toContain('0.04');
    });

    it('uses enough decimal places for a smaller nonzero rate', () => {
        const data = {
            total_input: 999_960,
            total_cache_read: 40,
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 999_960, cache_read: 40, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        renderCacheSlider(container, data);
        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
        expect(Number(slider.max)).toBeGreaterThan(0);
        expect(Number(slider.step)).toBeGreaterThan(0);
        expect(Number(slider.value)).toBeGreaterThan(0);
    });

    it('uses appropriate precision for a normal hit rate', () => {
        renderCacheSlider(container, dataAt(50));
        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
        expect(Number(slider.max)).toBeCloseTo(50, 0);
        expect(Number(slider.value)).toBeCloseTo(50, 0);
        expect(Number(slider.step)).toBeGreaterThan(0);
    });

    const heterogeneousData = () => ({
        total_input: 500_000,
        total_cache_read: 500_000,
        tokens_by_model: {
            'high-cache/model': { input: 100_000, cache_read: 900_000, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000 },
            'low-cache/model': { input: 800_000, cache_read: 200_000, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000 }
        },
        pricing_by_model: {
            'high-cache/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
            'low-cache/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
        }
    });

    it('renders the actual-rate baseline on an untouched initial render', () => {
        renderCacheSlider(container, heterogeneousData());
        const paidEl = container.querySelector('#cachePaidValue');
        // Actual per-model mix differs from the uniform blended-rate what-if,
        // so actualPaid and requestedPaid render different numbers here.
        const scenario = computeCacheScenario(heterogeneousData(), 50);
        expect(scenario.actualPaid).not.toBeCloseTo(scenario.requestedPaid, 2);
        expect(paidEl.textContent).toBe(fmtCur(scenario.actualPaid));
    });

    it('renders the requested (what-if) baseline after the user drags the slider', () => {
        renderCacheSlider(container, heterogeneousData());
        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
        const paidEl = container.querySelector('#cachePaidValue');

        slider.value = '50';
        slider.dispatchEvent(new Event('input'));

        const scenario = computeCacheScenario(heterogeneousData(), 50);
        expect(paidEl.textContent).toBe(fmtCur(scenario.requestedPaid));
    });

    it('keeps rendering the requested baseline if the user drags back to the real rate', () => {
        renderCacheSlider(container, heterogeneousData());
        const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
        const realRate = getRealCacheHitRatePct(heterogeneousData());
        const paidEl = container.querySelector('#cachePaidValue');

        slider.value = '10';
        slider.dispatchEvent(new Event('input'));
        slider.value = String(realRate);
        slider.dispatchEvent(new Event('input'));

        const scenario = computeCacheScenario(heterogeneousData(), realRate);
        expect(paidEl.textContent).toBe(fmtCur(scenario.requestedPaid));
    });
});