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
    getCatalogStatus,
    isCatalogFailed,
    clearCatalogCache,
    MODELS_DEV_API
} from '../../dashboard/js/modelsdev-pricing.js';

describe('normalizeModelsDevCost', () => {
    it('normalizes full cost object to pricing shape with reasoning/cache', () => {
        const p = normalizeModelsDevCost({ input: 5, output: 25, reasoning: 10, cache_read: 0.5, cache_write: 6.25 });
        expect(p).toEqual({
            input: 5, output: 25, reasoning: 10, cacheRead: 0.5, cacheWrite: 6.25, source: 'models.dev',
            hasInput: true, hasOutput: true, hasReasoning: true, hasCacheRead: true, hasCacheWrite: true
        });
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

    it('does not treat null or empty string fields as valid free pricing', () => {
        // Number(null) and Number('') are 0, but a missing/empty field must stay
        // absent (not present). With only absent fields the cost is unusable.
        const p = normalizeModelsDevCost({ input: null, output: '' });
        expect(p).toBeNull();
    });

    it('preserves an explicit numeric zero as a present free rate', () => {
        const p = normalizeModelsDevCost({ input: 0, output: 0 });
        expect(p.hasInput).toBe(true);
        expect(p.hasOutput).toBe(true);
        expect(p.input).toBe(0);
        expect(p.output).toBe(0);
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
    const pricing = { input: 5, output: 25, reasoning: 10, cacheRead: 0.5, cacheWrite: 6.25, source: 'models.dev', hasInput: true, hasOutput: true, hasReasoning: true, hasCacheRead: true, hasCacheWrite: true };

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

    it('keeps an explicit $0.00 Models.dev rate priced via presence flags', () => {
        // Free model: Models.dev published input:0, output:0 (valid, not missing).
        const free = normalizeModelsDevCost({ input: 0, output: 0 });
        expect(free.hasInput).toBe(true);
        expect(free.hasOutput).toBe(true);
        const r = calculateCostWithPricing(2_000_000, free);
        expect(r.priced).toBe(true);
        expect(r.total).toBe(0);
    });

    it('treats a field Models.dev never published as truly missing (unpriced)', () => {
        // Only cache_read published; no input/output/reasoning -> cannot price an
        // aggregate total token count, so it is truly unavailable.
        const partial = normalizeModelsDevCost({ cache_read: 0.5 });
        expect(partial.hasInput).toBe(false);
        expect(partial.hasOutput).toBe(false);
        expect(partial.hasReasoning).toBe(false);
        const r = calculateCostWithPricing(1_000_000, partial);
        expect(r.priced).toBe(false);
    });

    it('marks a token object unpriced when a nonzero dimension has no published rate', () => {
        // Cache-only pricing (hasInput false) but the record carries input tokens.
        // Facturing $0 here would hide real cost, so it must be unpriced.
        const cacheOnly = normalizeModelsDevCost({ cache_read: 0.5 });
        const r = calculateCostWithPricing({ input: 1_000_000, cache_read: 0 }, cacheOnly);
        expect(r.priced).toBe(false);
        expect(r.total).toBe(0);
    });

    it('prices a token object when every nonzero dimension has a published rate', () => {
        // Input + cache tokens both have published rates (cache-only model).
        const cacheOnly = normalizeModelsDevCost({ cache_read: 0.5 });
        const r = calculateCostWithPricing({ input: 0, output: 0, cache_read: 1_000_000 }, cacheOnly);
        expect(r.priced).toBe(true);
        expect(r.total).toBeCloseTo(0.5, 5);
    });

    it('keeps a dimensionless zero-token record priced at $0.00', () => {
        // No tokens in any dimension: nothing to fabricate, legitimate $0.00.
        const cacheOnly = normalizeModelsDevCost({ cache_read: 0.5 });
        const r = calculateCostWithPricing({ input: 0, output: 0, cache_read: 0 }, cacheOnly);
        expect(r.priced).toBe(true);
        expect(r.total).toBe(0);
    });

    it('requires both input and output rates for an aggregate total token count', () => {
        // Input-only pricing cannot fairly price an undimensioned total, so it is
        // unpriced rather than inferred.
        const inputOnly = normalizeModelsDevCost({ input: 5 });
        const r = calculateCostWithPricing(1_000_000, inputOnly);
        expect(r.priced).toBe(false);
    });

    it('keeps an aggregate total priced when input and output are both published (incl. explicit $0)', () => {
        // Valid free model: input:0 and output:0 are both published -> priced $0.00.
        const free = normalizeModelsDevCost({ input: 0, output: 0 });
        const r = calculateCostWithPricing(1_000_000, free);
        expect(r.priced).toBe(true);
        expect(r.total).toBe(0);
        // A non-free model priced at the (input+output)/2 average per 1M.
        const both = normalizeModelsDevCost({ input: 1, output: 3 });
        const r2 = calculateCostWithPricing(1_000_000, both);
        expect(r2.priced).toBe(true);
        expect(r2.total).toBeCloseTo(2, 5);
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

    it('rejects without throwing on a failed catalog request and allows a cleared retry', async () => {
        const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        await expect(fetchModelsDevCatalog(fetchFn)).rejects.toThrow();
        expect(getCatalog()).toBeNull();
        // A failed request rejects immediately on reuse (no silent retry).
        await expect(fetchModelsDevCatalog(fetchFn)).rejects.toThrow();
        // Clearing the cache resets status so a deliberate retry can succeed.
        clearCatalogCache();
        const ok = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ openrouter: { models: {} } }) });
        await expect(fetchModelsDevCatalog(ok)).resolves.toBeDefined();
    });

    it('records an explicit failed status (not just a cleared promise) and allows retry after clear', async () => {
        const fail = jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
        await expect(fetchModelsDevCatalog(fail)).rejects.toThrow();
        expect(getCatalogStatus()).toBe('failed');
        expect(isCatalogFailed()).toBe(true);
        // A failed request must not be silently retried on a second call.
        await expect(fetchModelsDevCatalog(fail)).rejects.toThrow();
        // Clearing the cache resets status so a deliberate retry can succeed.
        clearCatalogCache();
        expect(getCatalogStatus()).toBe('idle');
        expect(isCatalogFailed()).toBe(false);
        const ok = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ openrouter: { models: {} } }) });
        await expect(fetchModelsDevCatalog(ok)).resolves.toBeDefined();
        expect(getCatalogStatus()).toBe('ready');
    });

    it('uses an injected catalog for lookup', () => {
        const catalog = { anthropic: { models: { 'claude-opus-4-8': { cost: { input: 5, output: 25 } } } } };
        setCatalog(catalog);
        expect(lookupModelsDevPrice('anthropic/claude-opus-4-8')).not.toBeNull();
    });
});
