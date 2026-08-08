// tests/unit/title-belt.test.js
import { describe, expect, it } from 'bun:test';
import { computeWeekWindow, diffModelStats, scoreTitleBelt } from '../../dashboard/js/title-belt.js';

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
  // The client only appends one snapshot per calendar day it happens to be
  // open, so an exact "8 consecutive days present" run essentially never
  // accrues in real usage - any single missed day used to block scoring
  // entirely. These cases cover the best-effort fallback that replaced it.

  it('falls back to the oldest available day as baseline with fewer than 8 daily snapshots, instead of returning null', () => {
    const window = computeWeekWindow(fixtureWeeklyData(7, { 'a/model-1': 100 }));
    expect(window).not.toBeNull();
    // latest = day index 6 (cumulative 700); oldest available = day index 0
    // (cumulative 100), the closest stand-in for a week-ago baseline we have.
    expect(window.thisWeek['a/model-1'].total).toBeCloseTo(600, 0);
    expect(window.lastWeek).toBeNull(); // nothing earlier than the oldest day to diff against
  });

  it('still returns null with zero valid snapshots', () => {
    expect(computeWeekWindow([])).toBeNull();
    expect(computeWeekWindow([{ day: 'not-a-day', models: {} }])).toBeNull();
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

  it('tolerates a missing day elsewhere in the history without nulling out the window', () => {
    // 2026-01-12 isn't one of the two boundary days (latest, latest-7,
    // latest-14) computeWeekWindow anchors on, so dropping it must not
    // affect the result at all.
    const fixture = fixtureWeeklyData(15, { 'a/model-1': 100 });
    const withGap = computeWeekWindow(fixture.filter((entry) => entry.day !== '2026-01-12'));
    const withoutGap = computeWeekWindow(fixture);
    expect(withGap).toEqual(withoutGap);
    expect(withGap.thisWeek['a/model-1'].total).toBe(700);
    expect(withGap.lastWeek['a/model-1'].total).toBe(700);
  });

  it('uses the closest earlier day as the this-week baseline when the exact 7-days-ago day is missing', () => {
    const fixture = fixtureWeeklyData(15, { 'a/model-1': 100 }); // days 2026-01-01..15
    // Exact baseline for latest (01-15) would be 01-08 (index 7); remove it
    // so the closest earlier day (01-07, cumulative 700) is used instead.
    const window = computeWeekWindow(fixture.filter((entry) => entry.day !== '2026-01-08'));
    // latest cumulative (1500) - 01-07 cumulative (700) = 800
    expect(window.thisWeek['a/model-1'].total).toBe(800);
  });

  it('still finds a lastWeek window when only a prior-week day is missing, using the closest available day', () => {
    const fixture = fixtureWeeklyData(15, { 'a/model-1': 100 });
    const window = computeWeekWindow(fixture.filter((entry) => entry.day !== '2026-01-01'));
    // thisWeek baseline (01-08, cumulative 800) is untouched, so thisWeek is exact.
    expect(window.thisWeek['a/model-1'].total).toBe(700);
    // lastWeek baseline falls back from 01-01 (removed) to 01-02 (cumulative 200).
    expect(window.lastWeek['a/model-1'].total).toBe(600);
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

