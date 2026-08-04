// tests/unit/cache-scenario.test.js
import { describe, expect, it } from 'bun:test';
import { getRealCacheHitRatePct, computeCacheScenario } from '../../dashboard/js/cache-scenario.js';

const onModelData = (overrides = {}) => ({
  total_input: 1_000_000,
  total_cache_read: 99_000_000,
  tokens_by_model: {
    'anthropic/claude-sonnet-5': {
      input: 1_000_000, cache_read: 99_000_000, output: 500_000, cache_write: 200_000, reasoning: 0, total: 100_700_000
    }
  },
  pricing_by_model: {
    'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  },
  ...overrides
});

describe('getRealCacheHitRatePct', () => {
  it('computes the blended real hit rate as a percentage', () => {
    expect(getRealCacheHitRatePct(onModelData())).toBeCloseTo(99, 1);
  });

  it('returns 0 when there is no cacheable volume yet', () => {
    expect(getRealCacheHitRatePct({ total_input: 0, total_cache_read: 0 })).toBe(0);
  });
});

describe('computeCacheScenario', () => {
  it('at the real hit rate, "paid" matches what the fleet actually spent on cacheable tokens', () => {
    const data = onModelData();
    const realRate = getRealCacheHitRatePct(data);
    const scenario = computeCacheScenario(data, realRate);

    // input(1M)@$3 + cacheRead(99M)@$0.3 + output(0.5M)@$15 + cacheWrite(0.2M)@$3.75
    const expectedPaid = (1_000_000 / 1e6) * 3 + (99_000_000 / 1e6) * 0.3 + (500_000 / 1e6) * 15 + (200_000 / 1e6) * 3.75;
    expect(scenario.paid).toBeCloseTo(expectedPaid, 2);
  });

  it('at 0% hit rate, every cacheable token is billed at the full input rate', () => {
    const data = onModelData();
    const scenario = computeCacheScenario(data, 0);

    const cacheableTokens = 1_000_000 + 99_000_000;
    const expectedPaid = (cacheableTokens / 1e6) * 3 + (500_000 / 1e6) * 15 + (200_000 / 1e6) * 3.75;
    expect(scenario.paid).toBeCloseTo(expectedPaid, 2);
    expect(scenario.savedVsNoCache).toBeCloseTo(0, 5);
  });

  it('reports positive savings at a hit rate above 0%', () => {
    const data = onModelData();
    const scenario = computeCacheScenario(data, 80);
    expect(scenario.savedVsNoCache).toBeGreaterThan(0);
  });

  it('skips a model with unusable pricing rather than fabricating a number', () => {
    const data = onModelData({
      pricing_by_model: {
        'anthropic/claude-sonnet-5': { input: 3, output: 15, cacheWrite: 3.75 } // cacheRead missing
      }
    });
    const scenario = computeCacheScenario(data, 50);
    expect(scenario.paid).toBe(0);
    expect(scenario.savedVsNoCache).toBe(0);
  });

  it('clamps paidPct into [2, 98] so the bar never visually collapses', () => {
    const data = onModelData({
      total_input: 1,
      total_cache_read: 999_999_999,
      tokens_by_model: {
        'anthropic/claude-sonnet-5': { input: 1, cache_read: 999_999_999, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000_000 }
      }
    });
    const scenario = computeCacheScenario(data, 99.99999);
    expect(scenario.paidPct).toBeGreaterThanOrEqual(2);
    expect(scenario.paidPct).toBeLessThanOrEqual(98);
  });
});