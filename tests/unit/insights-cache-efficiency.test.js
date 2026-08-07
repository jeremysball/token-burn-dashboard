import { describe, expect, it, beforeEach } from 'bun:test';
import { calculateDeepInsights } from '../../dashboard/js/views/analytics/tabs/insights.js';
import { setCurrentData, setHistoryData, setFileHistoricalData } from '../../dashboard/js/state.js';

describe('Cache Efficiency insight - low hit rate missing-savings estimate', () => {
    beforeEach(() => {
        setHistoryData([]);
        setFileHistoricalData([]);
    });

    it('includes cache_write volume so the missing-savings estimate is not near-zero when input is tiny relative to cache_write', () => {
        // Anthropic-shaped workload: tiny fresh input, modest cache_read, huge
        // cache_write. cacheRate must land <=50% to hit the "Low cache hit
        // rate" branch (cache_write counts against the hit-rate denominator
        // per the fix in cacheHitRatePct), but the missing-savings dollar
        // estimate historically used totalInput alone as its base volume,
        // which rounds to ~$0 here even though $2+ of cache_write spend
        // isn't earning the cache-read discount.
        setCurrentData({
            total_tokens: 1_005_000,
            total_input: 5_000,
            total_cache_read: 200_000,
            total_cache_write: 800_000,
            total_cost: { total: 100 },
            tokens_by_model: {
                'anthropic/claude-sonnet-5': { input: 5_000, cache_read: 200_000, cache_write: 800_000, total: 1_005_000 }
            },
            costs_by_model: {
                'anthropic/claude-sonnet-5': { total: 100 }
            },
            pricing_by_model: {
                'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
            },
            files_processed: 0,
            total_lines: 0
        });

        const insights = calculateDeepInsights();
        const cacheInsight = insights.find(i => i.title === 'Cache Efficiency');
        expect(cacheInsight).toBeDefined();

        // Confirm we're actually exercising the "Low cache hit rate" branch.
        expect(parseFloat(cacheInsight.value)).toBeLessThanOrEqual(50);
        expect(cacheInsight.description).toContain('Low cache hit rate');

        const match = cacheInsight.description.match(/missing \$([\d.]+) potential savings/);
        expect(match).not.toBeNull();
        const missingSavings = parseFloat(match[1]);

        // cache-write is priced at its own $/1M rate (3.75), not blended into
        // the input rate: cacheWriteMissingSavings = 800_000 * (0.00000375 -
        // 0.0000003) = 2.76; inputMissingSavings = 5_000 * 0.9 * 0.000003 =
        // 0.0135. Total ≈ 2.7735. A tight band here catches two regressions
        // a bare `toBeGreaterThan(1)` let through: reverting to the old
        // blended-at-input-rate formula (≈2.17, below the lower bound) and a
        // $/1M-vs-$/token units bug treating pricing.cacheWrite as a raw
        // per-token rate (≈$3,000,000, far above the upper bound).
        expect(missingSavings).toBeGreaterThan(2.5);
        expect(missingSavings).toBeLessThan(50);
    });
});
