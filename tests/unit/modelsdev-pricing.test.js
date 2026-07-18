/**
 * @jest-environment jsdom
 */

import {
    normalizeModelsDevCost,
    lookupModelsDevPrice,
    calculateCostWithPricing,
    fetchModelsDevCatalog,
    setCatalog,
    getCatalog,
    clearCatalogCache,
    MODELS_DEV_API
} from '../../dashboard/js/modelsdev-pricing.js';

describe('normalizeModelsDevCost', () => {
    it('normalizes full cost object to pricing shape with reasoning/cache', () => {
        const p = normalizeModelsDevCost({ input: 5, output: 25, reasoning: 10, cache_read: 0.5, cache_write: 6.25 });
        expect(p).toEqual({ input: 5, output: 25, reasoning: 10, cacheRead: 0.5, cacheWrite: 6.25, source: 'models.dev' });
    });

    it('keeps source tag and zero-fills missing dimensions', () => {
        const p = normalizeModelsDevCost({ input: 0.14, output: 0.57 });
        expect(p.input).toBe(0.14);
        expect(p.output).toBe(0.57);
        expect(p.cacheRead).toBe(0);
        expect(p.reasoning).toBe(0);
        expect(p.source).toBe('models.dev');
    });

    it('returns null for missing or empty cost', () => {
        expect(normalizeModelsDevCost(null)).toBeNull();
        expect(normalizeModelsDevCost({})).toBeNull();
        expect(normalizeModelsDevCost(undefined)).toBeNull();
    });
});

describe('lookupModelsDevPrice', () => {
    const catalog = {
        openrouter: { models: { 'tencent/hy3:free': { cost: { input: 0, output: 0, reasoning: 0 } }, 'z-ai/glm-5': { cost: { input: 1, output: 3 } } } },
        anthropic: { models: { 'claude-opus-4-8': { cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 } } } },
        'kimi-coding': { models: { k2p5: { cost: { input: 1.5, output: 6 } } } }
    };

    it('resolves namespaced router key openrouter/tencent/hy3:free', () => {
        const p = lookupModelsDevPrice('openrouter/tencent/hy3:free', catalog);
        expect(p).not.toBeNull();
        expect(p.input).toBe(0);
        expect(p.output).toBe(0);
    });

    it('resolves direct provider/model key anthropic/claude-opus-4-8 with cache dims', () => {
        const p = lookupModelsDevPrice('anthropic/claude-opus-4-8', catalog);
        expect(p.cacheRead).toBe(0.5);
        expect(p.cacheWrite).toBe(6.25);
        expect(p.reasoning).toBe(0);
    });

    it('searches providers for a bare model id', () => {
        const p = lookupModelsDevPrice('k2p5', catalog);
        expect(p.input).toBe(1.5);
        expect(p.output).toBe(6);
    });

    it('returns null for unknown model', () => {
        expect(lookupModelsDevPrice('openrouter/does-not-exist', catalog)).toBeNull();
        expect(lookupModelsDevPrice('totally-unknown-model', catalog)).toBeNull();
    });

    it('returns null when catalog is missing', () => {
        expect(lookupModelsDevPrice('anthropic/claude-opus-4-8', null)).toBeNull();
    });
});

describe('calculateCostWithPricing', () => {
    const pricing = { input: 5, output: 25, reasoning: 10, cacheRead: 0.5, cacheWrite: 6.25, source: 'models.dev' };

    it('uses real per-model rates for a token object with all dims', () => {
        const r = calculateCostWithPricing({ input: 1e6, output: 1e6, cache_read: 1e6, cache_write: 1e6, reasoning: 1e6 }, pricing);
        expect(r.priced).toBe(true);
        // 5 + 25 + 0.5 + 6.25 + 10
        expect(r.total).toBeCloseTo(46.75, 5);
    });

    it('uses the model own average rate for an aggregate total token count', () => {
        // (5 + 25)/2 = 15 per 1M; 2M tokens => 30
        const r = calculateCostWithPricing(2_000_000, pricing);
        expect(r.priced).toBe(true);
        expect(r.total).toBeCloseTo(30, 5);
    });

    it('falls back to reasoning rate when only reasoning is present', () => {
        const rp = { input: 0, output: 0, reasoning: 10, cacheRead: 0, cacheWrite: 0, source: 'models.dev' };
        const r = calculateCostWithPricing(1_000_000, rp);
        expect(r.priced).toBe(true);
        expect(r.total).toBeCloseTo(10, 5);
    });

    it('reports unpriced when pricing is missing', () => {
        const r = calculateCostWithPricing(1_000_000, null);
        expect(r.priced).toBe(false);
        expect(r.total).toBe(0);
    });

    it('reports unpriced when the model has no usable rate', () => {
        const zero = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, source: 'models.dev' };
        const r = calculateCostWithPricing(1_000_000, zero);
        expect(r.priced).toBe(false);
    });
});

describe('fetchModelsDevCatalog', () => {
    afterEach(() => clearCatalogCache());

    it('fetches and caches the catalog via the public API', async () => {
        const fakeCatalog = { openrouter: { models: { 'z-ai/glm-5': { cost: { input: 1, output: 3 } } } } };
        const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => fakeCatalog });
        const catalog = await fetchModelsDevCatalog(fetchFn);
        expect(fetchFn).toHaveBeenCalledWith(MODELS_DEV_API);
        expect(catalog).toBe(fakeCatalog);
        expect(getCatalog()).toBe(fakeCatalog);
        // second call uses cache, no extra network request
        await fetchModelsDevCatalog(fetchFn);
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('rejects without throwing on a failed catalog request', async () => {
        const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        await expect(fetchModelsDevCatalog(fetchFn)).rejects.toThrow();
        // cache cleared so a later retry can succeed
        expect(getCatalog()).toBeNull();
        const ok = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ openrouter: { models: {} } }) });
        await expect(fetchModelsDevCatalog(ok)).resolves.toBeDefined();
    });

    it('uses an injected catalog for lookup', () => {
        const catalog = { anthropic: { models: { 'claude-opus-4-8': { cost: { input: 5, output: 25 } } } } };
        setCatalog(catalog);
        expect(lookupModelsDevPrice('anthropic/claude-opus-4-8')).not.toBeNull();
    });
});
