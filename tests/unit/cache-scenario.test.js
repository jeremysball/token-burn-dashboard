// tests/unit/cache-scenario.test.js
import { describe, expect, it } from 'bun:test';
import { getRealCacheHitRatePct, computeCacheScenario } from '../../dashboard/js/cache-scenario.js';

describe('getRealCacheHitRatePct', () => {
    it('computes the blended real hit rate as a percentage', () => {
        expect(getRealCacheHitRatePct({
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        })).toBeCloseTo(99, 1);
    });

    it('returns 0 when there is no cacheable volume yet', () => {
        expect(getRealCacheHitRatePct({ total_input: 0, total_cache_read: 0 })).toBe(0);
    });
});

describe('computeCacheScenario', () => {
    it('requestedPaid is a direct uniform-target calculation with no quadratic blending', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 80);
        expect(result.requestedPaid).toBeCloseTo(result.paid, 8);
        expect(result.paid).toBe(result.requestedPaid);
    });

    it('actualPaid uses each model own observed cache-read mix (heterogeneous baseline)', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'model-a/high': { input: 800_000, cache_read: 20_000_000, output: 100_000, cache_write: 50_000, reasoning: 0, total: 2_950_000 },
                'model-b/low': { input: 200_000, cache_read: 79_000_000, output: 50_000, cache_write: 10_000, reasoning: 0, total: 79_360_000 }
            },
            pricing_by_model: {
                'model-a/high': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
                'model-b/low': { input: 2, output: 10, cacheRead: 0.15, cacheWrite: 2.5 }
            }
        };
        const result = computeCacheScenario(data, 80);
        const h = 0.8;

        const aInput = 800_000, aCacheRead = 20_000_000, aCacheWrite = 50_000, aCacheable = aInput + aCacheRead;
        const aActualRate = aCacheRead / aCacheable;
        const aFixed = (100_000 / 1e6) * 15 + (aCacheWrite / 1e6) * 3.75;
        // requestedPaid rescales hitRate (calibrated against the cache-write-
        // inclusive pool, same as getRealCacheHitRatePct) onto the
        // input+cacheRead sub-pool actually being blended here.
        const aSubPoolRate = Math.min(1, h * (aCacheable + aCacheWrite) / aCacheable);
        const aRequested = aFixed + (aCacheable * (1 - aSubPoolRate) / 1e6) * 3 + (aCacheable * aSubPoolRate / 1e6) * 0.3;

        const bInput = 200_000, bCacheRead = 79_000_000, bCacheWrite = 10_000, bCacheable = bInput + bCacheRead;
        const bActualRate = bCacheRead / bCacheable;
        const bFixed = (50_000 / 1e6) * 10 + (bCacheWrite / 1e6) * 2.5;
        const bSubPoolRate = Math.min(1, h * (bCacheable + bCacheWrite) / bCacheable);
        const bRequested = bFixed + (bCacheable * (1 - bSubPoolRate) / 1e6) * 2 + (bCacheable * bSubPoolRate / 1e6) * 0.15;

        const expectedRequested = aRequested + bRequested;
        const expectedActual = aFixed + (aCacheable * (1 - aActualRate) / 1e6) * 3 + (aCacheable * aActualRate / 1e6) * 0.3
            + bFixed + (bCacheable * (1 - bActualRate) / 1e6) * 2 + (bCacheable * bActualRate / 1e6) * 0.15;

        expect(result.requestedPaid).toBeCloseTo(expectedRequested, 8);
        expect(result.actualPaid).toBeCloseTo(expectedActual, 8);
    });

    it('excludes models with cacheRead: null from eligibleModels', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'priced/model': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 },
                'unpriced/model': { input: 500_000, cache_read: 0, output: 100_000, cache_write: 10_000, reasoning: 0, total: 610_000 }
            },
            pricing_by_model: {
                'priced/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 80);
        expect(result.eligibleModels).not.toContain('unpriced/model');
        expect(result.eligibleModels).toContain('priced/model');
    });

    it('includes output, cache-write, and reasoning tokens with distinct rates', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 100_000, total: 100_800_000 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0.5 }
            }
        };
        const result = computeCacheScenario(data, 80);
        expect(result.requestedPaid).toBeGreaterThan(0);
        expect(result.actualPaid).toBeGreaterThan(0);
        expect(result.eligibleModels).toContain('anthropic/claude-sonnet-5');
    });

    it('zero-token reasoning with missing reasoning rate does not invalidate the model', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 80);
        expect(result.eligibleModels).toContain('anthropic/claude-sonnet-5');
        expect(result.requestedPaid).toBeGreaterThan(0);
    });

    it('excludes a model with null input pricing', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'null-input/model': { input: null, cache_read: 99_000_000, output: 100_000, cache_write: 10_000, reasoning: 0, total: 100_110_000 }
            },
            pricing_by_model: {
                'null-input/model': { input: null, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 50);
        expect(result.eligibleModels).not.toContain('null-input/model');
        expect(result.paid).toBe(0);
    });

    it('excludes a model with null cacheRead pricing', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'null-cacheRead/model': { input: 1_000_000, cache_read: null, output: 100_000, cache_write: 10_000, reasoning: 0, total: 1_110_000 }
            },
            pricing_by_model: {
                'null-cacheRead/model': { input: 3, output: 15, cacheRead: null, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 50);
        expect(result.eligibleModels).not.toContain('null-cacheRead/model');
        expect(result.paid).toBe(0);
    });

    it('includes a model with all-zero token dimensions and finite rates', () => {
        const data = {
            total_input: 0,
            total_cache_read: 0,
            tokens_by_model: {
                'zero/model': { input: 0, cache_read: 0, output: 0, cache_write: 0, reasoning: 0, total: 0 }
            },
            pricing_by_model: {
                'zero/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0.5 }
            }
        };
        const result = computeCacheScenario(data, 50);
        expect(result.eligibleModels).toContain('zero/model');
        expect(result.requestedPaid).toBeCloseTo(0, 8);
        expect(result.actualPaid).toBeCloseTo(0, 8);
    });

    it('excludes a model whose presence flags say input/cacheRead pricing is absent, despite nonzero numeric fields', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'flagged-absent/model': { input: 1_000_000, cache_read: 99_000_000, output: 0, cache_write: 0, reasoning: 0, total: 100_000_000 }
            },
            pricing_by_model: {
                'flagged-absent/model': { input: 0, cacheRead: 0, hasInput: false, hasCacheRead: false, output: 15, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 50);
        expect(result.eligibleModels).not.toContain('flagged-absent/model');
    });

    it('keeps a model eligible when input/cacheRead presence flags are false but the token counts are zero', () => {
        const data = {
            total_input: 0,
            total_cache_read: 0,
            tokens_by_model: {
                'flagged-absent-zero-usage/model': { input: 0, cache_read: 0, output: 0, cache_write: 0, reasoning: 0, total: 0 }
            },
            pricing_by_model: {
                'flagged-absent-zero-usage/model': { input: 0, cacheRead: 0, hasInput: false, hasCacheRead: false, output: 15, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 50);
        expect(result.eligibleModels).toContain('flagged-absent-zero-usage/model');
    });

    it('excludes a model with nonzero reasoning tokens but missing reasoning rate', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'missing-reasoning/model': { input: 1_000_000, cache_read: 99_000_000, output: 100_000, cache_write: 10_000, reasoning: 50_000, total: 100_160_000 }
            },
            pricing_by_model: {
                'missing-reasoning/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 50);
        expect(result.eligibleModels).not.toContain('missing-reasoning/model');
    });

    it('paidAtZeroPct is the cost when every cacheable token is billed at the input rate', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 0);
        const cacheableTokens = 1_000_000 + 99_000_000;
        const expectedPaid = (cacheableTokens / 1e6) * 3 + (500_000 / 1e6) * 15 + (200_000 / 1e6) * 3.75;
        expect(result.requestedPaid).toBeCloseTo(expectedPaid, 2);
        expect(result.paidAtZeroPct).toBeCloseTo(expectedPaid, 2);
        expect(result.savedVsNoCache).toBeCloseTo(0, 5);
    });

    it('clamps paidPct into [2, 98] so the bar never visually collapses', () => {
        const data = {
            total_input: 1,
            total_cache_read: 999_999_999,
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 1, cache_read: 999_999_999, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000_000 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        const result = computeCacheScenario(data, 99.99999);
        expect(result.paidPct).toBeGreaterThanOrEqual(2);
        expect(result.paidPct).toBeLessThanOrEqual(98);
    });

    it('requestedPaid at the slider max (the real fleet rate) reproduces actualPaid, not an inflated figure (#117 finding 1)', () => {
        // Anthropic-shaped single model: tiny fresh input, modest cache_read,
        // large cache_write. hitRate is calibrated against the cache-write-
        // inclusive pool (matching getRealCacheHitRatePct, which drives the
        // slider's label and max), so requestedPaid must rescale onto the
        // input+cacheRead sub-pool it actually blends over - otherwise the
        // instant a user drags the slider to its own max, the paid figure
        // jumps away from the correct actualPaid shown before any drag.
        const data = {
            total_input: 2,
            total_cache_read: 15_584,
            total_cache_write: 29_124,
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 2, cache_read: 15_584, output: 0, cache_write: 29_124, reasoning: 0, total: 44_710 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            }
        };
        const realRate = getRealCacheHitRatePct(data);
        expect(realRate).toBeCloseTo(34.85, 1);

        const untouched = computeCacheScenario(data, realRate);
        expect(untouched.requestedPaid).toBeCloseTo(untouched.actualPaid, 8);

        // True real cost: input + cacheRead + cacheWrite each at their own rate.
        const expectedRealCost = (2 / 1e6) * 3 + (15_584 / 1e6) * 0.3 + (29_124 / 1e6) * 3.75;
        expect(untouched.actualPaid).toBeCloseTo(expectedRealCost, 8);
    });

    it('returns zero cost when no model has usable pricing', () => {
        const data = {
            total_input: 1_000_000,
            total_cache_read: 99_000_000,
            tokens_by_model: {},
            pricing_by_model: {}
        };
        const result = computeCacheScenario(data, 50);
        expect(result.paid).toBe(0);
        expect(result.requestedPaid).toBe(0);
        expect(result.actualPaid).toBe(0);
        expect(result.paidAtZeroPct).toBe(0);
        expect(result.savedVsNoCache).toBe(0);
        expect(result.actualSavedVsNoCache).toBe(0);
        expect(result.eligibleModels).toEqual([]);
    });
});