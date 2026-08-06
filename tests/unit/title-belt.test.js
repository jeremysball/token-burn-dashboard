// tests/unit/title-belt.test.js
import { describe, expect, it } from 'bun:test';
import { computeWeekWindow, diffModelStats, hasUsableFullPricing, scoreTitleBelt } from '../../dashboard/js/title-belt.js';
import { getModelPricing, getPricing, setPricing } from '../../dashboard/js/config.js';

/** Build a weeklyData-shaped fixture: n daily snapshots, each model's
 * cumulative totals growing linearly by perDayGrowth[model] tokens/day. */
function fixtureWeeklyData(days, perDayGrowth) {
  const out = [];
  const cumulative = {};
  for (const name of Object.keys(perDayGrowth)) cumulative[name] = 0;
  for (let d = 0; d < days; d++) {
    /** @type any */
    const models = {};
    for (const [name, growth] of Object.entries(perDayGrowth)) {
      cumulative[name] += growth;
      models[name] = { total: cumulative[name], input: cumulative[name] * 0.5, output: cumulative[name] * 0.5, cache_read: 0, cache_write: 0, reasoning: 0 };
    }
    const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
    out.push({ day, tokens: Object.values(cumulative).reduce((a, b) => a + b, 0), models });
  }
  return out;
}

describe('computeWeekWindow', () => {
  it('returns null with fewer than 8 daily snapshots', () => {
    expect(computeWeekWindow(fixtureWeeklyData(7, { 'a/model-1': 100 }))).toBeNull();
  });

  it('computes thisWeek as the delta over the last 7 days once 8+ snapshots exist', () => {
    const window = computeWeekWindow(fixtureWeeklyData(8, { 'a/model-1': 100 }));
    expect(window.thisWeek['a/model-1'].total).toBeCloseTo(700, 0);
    expect(window.lastWeek).toBeNull(); // only 8 snapshots, need 15 for a lastWeek
  });

  it('computes lastWeek once 15+ snapshots exist', () => {
    const window = computeWeekWindow(fixtureWeeklyData(15, { 'a/model-1': 100 }));
    expect(window.thisWeek['a/model-1'].total).toBeCloseTo(700, 0);
    expect(window.lastWeek['a/model-1'].total).toBeCloseTo(700, 0);
  });

  it('normalizes out-of-order duplicates using the latest value for each valid ISO day', () => {
    const fixture = fixtureWeeklyData(15, { 'a/model-1': 100 });
    const shuffled = [...fixture.slice(0, 7).reverse(), fixture[7], fixture[8], fixture[8], ...fixture.slice(9)];
    shuffled[shuffled.length - 1] = { ...shuffled[shuffled.length - 1], day: 'not-a-day' };
    const window = computeWeekWindow([...shuffled, { ...fixture[14], models: {
      'a/model-1': { total: 9999, input: 9999, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }
    } }]);
    expect(window.weekEndDay).toBe('2026-01-15');
    expect(window.thisWeek['a/model-1'].total).toBe(9199);
  });

  it('returns null for syntactically shaped but calendar-invalid dates', () => {
    const fixture = fixtureWeeklyData(15, { 'a/model-1': 100 });
    expect(() => computeWeekWindow([
      ...fixture,
      { ...fixture.at(-1), day: '2026-02-30' },
      { ...fixture.at(-1), day: '2026-13-01' },
      { ...fixture.at(-1), day: '2026-02-29' }
    ])).not.toThrow();
    expect(computeWeekWindow([
      { ...fixture[0], day: '2026-02-30' },
      { ...fixture[1], day: '2026-13-01' },
      { ...fixture[2], day: '2026-02-29' }
    ])).toBeNull();
  });

  it('excludes models with non-finite or missing token dimensions from deltas', () => {
    expect(diffModelStats({
      'a/bad': { total: 100, input: NaN, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 },
      'a/missing': { total: 100, input: 100, output: 0, cache_read: 0, cache_write: 0 },
      'a/null': { total: 100, input: 100, output: 0, cache_read: 0, cache_write: 0, reasoning: null },
      'a/good': { total: 100, input: 100, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }
    }, {
      'a/bad': { total: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 },
      'a/missing': { total: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 },
      'a/null': { total: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 },
      'a/good': { total: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }
    })).toEqual({
      'a/good': { total: 100, input: 100, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }
    });
  });

  it('does not score a model with incomplete token dimensions', () => {
    const scored = scoreTitleBelt({
      thisWeek: {
        'a/missing': { total: 1_000_000, input: 1_000_000, output: 0, cache_read: 0, cache_write: 0 },
        'a/valid': { total: 1, input: 1, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }
      },
      lastWeek: null,
      weekEndDay: '2026-01-08'
    }, {
      'a/missing': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0 },
      'a/valid': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0 }
    });
    expect(scored.volumeCrown?.name).toBe('a/missing');
    expect(scored.thriftKing).toBeNull();
    expect(scored.sommelier).toBeNull();
  });

  it('does not score a model whose token dimension is null at the boundary', () => {
    const scored = scoreTitleBelt({
      thisWeek: {
        'a/null': { total: 1_000_000, input: 1_000_000, output: 0, cache_read: 0, cache_write: 0, reasoning: null },
        'a/valid': { total: 1, input: 1, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }
      },
      lastWeek: null,
      weekEndDay: '2026-01-08'
    }, {
      'a/null': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0 },
      'a/valid': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0 }
    });
    expect(scored.volumeCrown?.name).toBe('a/null');
    expect(scored.thriftKing).toBeNull();
    expect(scored.sommelier).toBeNull();
  });

  it('rejects an incomplete base snapshot instead of fabricating zero deltas', () => {
    expect(diffModelStats({
      'a/model': { total: 100, input: 100, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }
    }, {
      'a/model': { total: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 }
    })).toEqual({});
  });

  it('keeps calendar-invalid dates out of a current window', () => {
    const fixture = fixtureWeeklyData(15, { 'a/model-1': 100 });
    expect(computeWeekWindow(fixture.filter((entry) => entry.day !== '2026-01-12'))).toBeNull();
  });

  it('keeps the current week when only a prior-week day is missing', () => {
    const fixture = fixtureWeeklyData(15, { 'a/model-1': 100 });
    const window = computeWeekWindow(fixture.filter((entry) => entry.day !== '2026-01-05'));
    expect(window.thisWeek['a/model-1'].total).toBe(700);
    expect(window.lastWeek).toBeNull();
  });

  it('uses calendar arithmetic across month and year rollover', () => {
    const fixture = fixtureWeeklyData(15, { 'a/model-1': 100 });
    const rollover = fixture.map((entry, index) => {
      const day = new Date(Date.UTC(2026, 0, 29 + index)).toISOString().slice(0, 10);
      return { ...entry, day };
    });
    expect(computeWeekWindow(rollover).weekEndDay).toBe('2026-02-12');
    expect(computeWeekWindow(rollover).lastWeek['a/model-1'].total).toBe(700);
  });
});

describe('scoreTitleBelt', () => {
  const pricingByModel = {
    'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },   // expensive
    'a/model-2': { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0.25 }, // cheap
    'a/negligible': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  };

  it('preserves omitted reasoning pricing separately from an explicit zero rate', () => {
    const originalPricing = getModelPricing().map((pricing) => ({ ...pricing }));
    try {
      setPricing([
        { pattern: /^missing$/, input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        { pattern: /^free$/, input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
      ]);
      expect(getPricing('missing').reasoning).toBeUndefined();
      expect(getPricing('free').reasoning).toBe(0);
    } finally {
      setPricing(originalPricing);
    }
  });

  it('excludes a model below the 1% eligibility floor from every belt', () => {
    const weeklyData = fixtureWeeklyData(15, { 'a/model-1': 10000, 'a/model-2': 5000, 'a/negligible': 10 });
    const window = computeWeekWindow(weeklyData);
    const scored = scoreTitleBelt(window, pricingByModel);
    const beltWinners = [scored.volumeCrown?.name, scored.thriftKing?.name, scored.sommelier?.name, scored.mostImproved?.name];
    expect(beltWinners).not.toContain('a/negligible');
  });

  it('awards Volume Crown to the highest-token-share eligible model', () => {
    const weeklyData = fixtureWeeklyData(15, { 'a/model-1': 10000, 'a/model-2': 3000 });
    const scored = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
    expect(scored.volumeCrown.name).toBe('a/model-1');
  });

  it('awards Thrift King to the lowest effective $/M and Sommelier to the highest', () => {
    const weeklyData = fixtureWeeklyData(15, { 'a/model-1': 5000, 'a/model-2': 5000 });
    const scored = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
    expect(scored.thriftKing.name).toBe('a/model-2');
    expect(scored.sommelier.name).toBe('a/model-1');
  });

  it('includes reasoning tokens at their distinct rate in effective cost', () => {
    const stats = { total: 1_000_000, input: 500_000, output: 0, cache_read: 0, cache_write: 0, reasoning: 500_000 };
    const scored = scoreTitleBelt({ thisWeek: { 'a/reasoning': stats }, lastWeek: null, weekEndDay: '2026-01-08' }, {
      'a/reasoning': { input: 2, output: 0, reasoning: 20, cacheRead: 0, cacheWrite: 0 }
    });
    expect(scored.thriftKing.effectiveRate).toBe(11);
  });

  it('accepts an explicit zero reasoning rate', () => {
    const scored = scoreTitleBelt({ thisWeek: { 'a/free': { total: 1, input: 1, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 } }, lastWeek: null, weekEndDay: '2026-01-08' }, {
      'a/free': { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    });
    expect(scored.thriftKing.name).toBe('a/free');
  });

  it('excludes nonzero reasoning with missing reasoning pricing', () => {
    const scored = scoreTitleBelt({ thisWeek: { 'a/missing': { total: 1, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 1 } }, lastWeek: null, weekEndDay: '2026-01-08' }, {
      'a/missing': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    });
    expect(scored.thriftKing).toBeNull();
    expect(scored.sommelier).toBeNull();
  });

  it('does not expose NaN effectiveRate when a token dimension is NaN', () => {
    // Malformed (NaN) reasoning tokens must not be silently coerced to zero and
    // produce a NaN $/M. The model is excluded instead.
    const stats = { total: 1_000_000, input: 500_000, output: 0, cache_read: 0, cache_write: 0, reasoning: NaN };
    const scored = scoreTitleBelt({ thisWeek: { 'a/bad': stats }, lastWeek: null, weekEndDay: '2026-01-08' }, {
      'a/bad': { input: 2, output: 0, reasoning: 20, cacheRead: 0, cacheWrite: 0 }
    });
    expect(scored.thriftKing).toBeNull();
    expect(scored.sommelier).toBeNull();
    expect(scored.volumeCrown.tokens).toBe(1_000_000);
  });

  it('does not expose Infinity effectiveRate when a token dimension is Infinity', () => {
    const stats = { total: 1_000_000, input: Infinity, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };
    const scored = scoreTitleBelt({ thisWeek: { 'a/bad': stats }, lastWeek: null, weekEndDay: '2026-01-08' }, {
      'a/bad': { input: 2, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    });
    expect(scored.thriftKing).toBeNull();
    expect(scored.sommelier).toBeNull();
  });

  it('returns null effectiveRate when stats.total is NaN, not a NaN number', () => {
    const stats = { total: NaN, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };
    const scored = scoreTitleBelt({ thisWeek: { 'a/bad': stats }, lastWeek: null, weekEndDay: '2026-01-08' }, {
      'a/bad': { input: 2, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
    });
    expect(scored.thriftKing).toBeNull();
    expect(scored.sommelier).toBeNull();
  });

  it('prices a model with genuinely-zero usage and a missing reasoning rate (free for reasoning)', () => {
    // Reasoning usage is exactly 0 and the published pricing omits reasoning,
    // which is the documented "missing rate allowed for genuinely zero usage" path.
    const stats = { total: 1000, input: 1000, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 };
    const scored = scoreTitleBelt({ thisWeek: { 'a/free': stats }, lastWeek: null, weekEndDay: '2026-01-08' }, {
      'a/free': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } // no reasoning
    });
    expect(scored.thriftKing?.name).toBe('a/free');
    expect(scored.thriftKing.effectiveRate).toBeCloseTo(3, 9);
  });

  it('excludes a model with no prior-week data from Most Improved, even if it clears the volume floor this week', () => {
    // model-2 only starts accruing tokens in the second week (0 growth for the first 8 days).
    const out = [];
    let cum1 = 0;
    let cum2 = 0;
    for (let d = 0; d < 15; d++) {
      cum1 += 1000;
      if (d >= 8) cum2 += 2000; // model-2 appears only in the most recent week
      out.push({
        day: new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10),
        tokens: cum1 + cum2,
        models: {
          'a/model-1': { total: cum1, input: cum1, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 },
          'a/model-2': { total: cum2, input: cum2, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }
        }
      });
    }
    const scored = scoreTitleBelt(computeWeekWindow(out), pricingByModel);
    const beltWinners = [scored.volumeCrown?.name, scored.thriftKing?.name, scored.sommelier?.name, scored.mostImproved?.name];
    expect(beltWinners).toContain('a/model-2'); // clears the volume floor this week — wins at least one belt
    expect(scored.mostImproved?.name).not.toBe('a/model-2'); // but has 0 prior-week tokens -> ineligible for Most Improved
  });

  it('returns a null mostImproved when there is no lastWeek window at all', () => {
    const weeklyData = fixtureWeeklyData(8, { 'a/model-1': 1000 }); // only 8 snapshots, no lastWeek
    const scored = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
    expect(scored.mostImproved).toBeNull();
  });

  it('returns a null mostImproved when all eligible models shrank week-over-week', () => {
    // Build 15 days where the daily rate slows after the first week, so
    // thisWeek < lastWeek while cumulative totals remain valid.
    const out = [];
    let cum = 0;
    for (let d = 0; d < 15; d++) {
      if (d < 8) cum += 1000;
      else cum += 400;
      out.push({
        day: new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10),
        tokens: cum,
        models: { 'a/model-1': { total: cum, input: cum, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 } }
      });
    }
    const window = computeWeekWindow(out);
    const scored = scoreTitleBelt(window, pricingByModel);
    expect(window.thisWeek['a/model-1'].total).toBe(2800);
    expect(window.lastWeek['a/model-1'].total).toBe(7000);
    expect(scored.mostImproved).toBeNull();
  });
});

describe('hasUsableFullPricing contract', () => {
  const fullPricing = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 5 };
  it('rejects supplied stats with a missing (undefined) token dimension', () => {
    expect(hasUsableFullPricing(fullPricing, { total: 1, input: 1, output: 0, cache_read: 0, cache_write: 0 })).toBe(false);
  });
  it('rejects supplied stats with a null token dimension', () => {
    expect(hasUsableFullPricing(fullPricing, { total: 1, input: 1, output: 0, cache_read: 0, cache_write: 0, reasoning: null })).toBe(false);
  });
  it('rejects supplied stats with a non-finite token dimension', () => {
    expect(hasUsableFullPricing(fullPricing, { total: 1, input: 1, output: 0, cache_read: NaN, cache_write: 0, reasoning: 0 })).toBe(false);
  });
  it('accepts an actually finite zero token dimension that omits its rate', () => {
    const pricingNoReasoning = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
    expect(hasUsableFullPricing(pricingNoReasoning, { total: 1000, input: 1000, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 })).toBe(true);
  });
  it('still requires all five finite rates for a pricing-only call (no stats supplied)', () => {
    const complete = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 5 };
    const missingReasoning = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
    expect(hasUsableFullPricing(complete)).toBe(true);
    expect(hasUsableFullPricing(missingReasoning)).toBe(false);
  });
});

describe('scoreTitleBelt non-finite total handling', () => {
  const pricing = { 'a/bad': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0 }, 'a/good': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0 } };
  it('does not let a NaN-total model poison a valid sibling in the same week', () => {
    const thisWeek = { 'a/bad': { total: NaN, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 }, 'a/good': { total: 1_000_000, input: 1_000_000, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 } };
    const scored = scoreTitleBelt({ thisWeek, lastWeek: null, weekEndDay: '2026-01-08' }, pricing);
    expect(scored.volumeCrown?.name).toBe('a/good');
    expect(scored.volumeCrown?.tokens).toBe(1_000_000);
    expect(scored.thriftKing?.name).toBe('a/good');
    expect(scored.sommelier?.name).toBe('a/good');
  });
});
