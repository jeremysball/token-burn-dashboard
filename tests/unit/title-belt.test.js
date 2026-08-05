// tests/unit/title-belt.test.js
import { describe, expect, it } from 'bun:test';
import { computeWeekWindow, scoreTitleBelt } from '../../dashboard/js/title-belt.js';

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
      models[name] = { total: cumulative[name], input: cumulative[name] * 0.5, output: cumulative[name] * 0.5, cache_read: 0, cache_write: 0 };
    }
    out.push({ day: `2026-01-${String(d + 1).padStart(2, '0')}`, tokens: Object.values(cumulative).reduce((a, b) => a + b, 0), models });
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
});

describe('scoreTitleBelt', () => {
  const pricingByModel = {
    'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },   // expensive
    'a/model-2': { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0.25 }, // cheap
    'a/negligible': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  };

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

  it('excludes a model with no prior-week data from Most Improved, even if it clears the volume floor this week', () => {
    // model-2 only starts accruing tokens in the second week (0 growth for the first 8 days).
    const out = [];
    let cum1 = 0;
    let cum2 = 0;
    for (let d = 0; d < 15; d++) {
      cum1 += 1000;
      if (d >= 8) cum2 += 2000; // model-2 appears only in the most recent week
      out.push({
        day: `d${d}`,
        tokens: cum1 + cum2,
        models: {
          'a/model-1': { total: cum1, input: cum1, output: 0, cache_read: 0, cache_write: 0 },
          'a/model-2': { total: cum2, input: cum2, output: 0, cache_read: 0, cache_write: 0 }
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
    // Build 15 days where tokens grow for 8 days then shrink for 7 days
    // so thisWeek < lastWeek for every model.
    const out = [];
    let cum = 0;
    for (let d = 0; d < 15; d++) {
      if (d < 8) cum += 1000;
      else cum -= 400;
      out.push({
        day: `d${d}`,
        tokens: Math.max(0, cum),
        models: { 'a/model-1': { total: Math.max(0, cum), input: Math.max(0, cum), output: 0, cache_read: 0, cache_write: 0 } }
      });
    }
    const scored = scoreTitleBelt(computeWeekWindow(out), pricingByModel);
    expect(scored.mostImproved).toBeNull();
  });
});
