// tests/unit/league-table.test.js
import { describe, expect, it, spyOn } from 'bun:test';
import { buildLeagueTable } from '../../dashboard/js/league-table.js';
import * as titleBeltModule from '../../dashboard/js/title-belt.js';

const pricingByModel = {
    'a/model-1': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    'a/model-2': { input: 0.2, output: 0.8, cacheRead: 0.02, cacheWrite: 0.25 },
    'a/model-3': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }
};

/** Build a weeklyData-shaped fixture with 15 daily cumulative snapshots. */
function fixtureWeeklyData(perDayGrowth) {
    const out = [];
    const cumulative = {};
    for (const name of Object.keys(perDayGrowth)) cumulative[name] = 0;
    for (let d = 0; d < 15; d++) {
        const models = {};
        for (const [name, growth] of Object.entries(perDayGrowth)) {
            cumulative[name] += growth;
            models[name] = { total: cumulative[name], input: cumulative[name] * 0.5, output: cumulative[name] * 0.5, cache_read: 0, cache_write: 0, reasoning: 0 };
        }
        out.push({ day: `2026-01-${String(d + 1).padStart(2, '0')}`, tokens: 0, models });
    }
    return out;
}

describe('buildLeagueTable', () => {
    // The belt-score cache lives in module scope on league-table.js so it
    // survives between calls. Each test below defines a unique pricing +
    // weeklyData shape, so the fingerprint is different on every test.

    it('returns empty top/others for no models', () => {
        expect(buildLeagueTable({}, {}, [], {})).toEqual({ top: [], others: [] });
    });

    it('splits into top 8 by descending tokens and the rest as others, ranked continuously', () => {
        /** @type {Record<string, any>} */
        const tokensByModel = {};
        for (let i = 0; i < 10; i++) {
            tokensByModel[`a/model-${i}`] = { total: (10 - i) * 100, input: (10 - i) * 50, output: (10 - i) * 50, cache_read: 0, cache_write: 0 };
        }
        const { top, others } = buildLeagueTable(tokensByModel, {}, [], {});
        expect(top).toHaveLength(8);
        expect(others).toHaveLength(2);
        expect(top[0].name).toBe('a/model-0');
        expect(top[0].rank).toBe(1);
        expect(others[0].rank).toBe(9);
        expect(others[0].name).toBe('a/model-8');
    });

    it('computes effective $/M from pricing via calculateCostWithPricing, null when pricing is missing', () => {
        const tokensByModel = { 'a/model-1': { total: 1000000, input: 500000, output: 500000, cache_read: 0, cache_write: 0, reasoning: 0 } };
        // pricing $3/M input, $15/M output -> cost = 500k/1e6*3 + 500k/1e6*15 = 1.5 + 7.5 = 9.0
        // effective $/M = 9.0 / (1e6/1e6) = 9.0
        const pricing = { 'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
        const { top } = buildLeagueTable(tokensByModel, {}, [], pricing);
        expect(top[0].effectiveRatePerMillion).toBeCloseTo(9.0, 5);

        const { top: topNoPricing } = buildLeagueTable(tokensByModel, {}, [], {});
        expect(topNoPricing[0].effectiveRatePerMillion).toBeNull();
    });

    it('computes cache % using the same formula as the Insights tab', () => {
        const tokensByModel = { 'a/model-1': { total: 100, input: 60, output: 0, cache_read: 40, cache_write: 0 } };
        const { top } = buildLeagueTable(tokensByModel, {}, [], {});
        expect(top[0].cachePct).toBeCloseTo(40, 5);
    });

    it('rejects stats with a missing reasoning dimension for effectiveRatePerMillion, matching title-belt.js', () => {
        // Regression for the inline-formula divergence: the old inline
        // implementation only checked pricing != null and stats.total > 0,
        // and would happily report a $/M for a stats record with no
        // `reasoning` field — even when reasoning tokens were nonzero. The
        // shared effectiveRatePerMillion helper enforces hasFiniteTokenDimensions
        // and rejects a missing dimension, so this case must now return null
        // (and the value must agree with title-belt.js's thriftKing/sommelier
        // effective rate for the same data, not silently differ).
        const tokensByModel = { 'a/model-1': { total: 1000000, input: 500000, output: 500000, cache_read: 0, cache_write: 0 } }; // no reasoning
        const pricing = { 'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } };
        const { top } = buildLeagueTable(tokensByModel, {}, [], pricing);
        expect(top[0].effectiveRatePerMillion).toBeNull();
    });

    it('assigns the correct, non-overlapping badge to the model holding each of three belts this week', () => {
        // model-1 has the largest weekly token growth (-> volumeCrown), model-2 is
        // the cheapest per-token in the pricing table (-> thriftKing), model-3 is
        // the priciest per-token but grows slower than model-1 (-> sommelier,
        // unmasked by volumeCrown since it doesn't also lead on volume).
        const tokensByModel = {
            'a/model-1': { total: 10500, input: 5250, output: 5250, cache_read: 0, cache_write: 0 },
            'a/model-2': { total: 3000, input: 1500, output: 1500, cache_read: 0, cache_write: 0 },
            'a/model-3': { total: 1500, input: 750, output: 750, cache_read: 0, cache_write: 0 }
        };
        const weeklyData = fixtureWeeklyData({ 'a/model-1': 700, 'a/model-2': 200, 'a/model-3': 100 });
        const { top } = buildLeagueTable(tokensByModel, {}, weeklyData, pricingByModel);
        const byName = Object.fromEntries(top.map((r) => [r.name, r]));
        expect(byName['a/model-1'].badges).toContain('volumeCrown');
        expect(byName['a/model-2'].badges).toContain('thriftKing');
        expect(byName['a/model-3'].badges).toContain('sommelier');
    });

    it('assigns no badge to a model that holds none of the four belts', () => {
        // a/negligible's share of the week's total is ~0.01%, well below the 1%
        // eligibility floor, once a/dominant's much larger growth is in the mix.
        const tokensByModel = {
            'a/dominant': { total: 700000, input: 350000, output: 350000, cache_read: 0, cache_write: 0 },
            'a/negligible': { total: 70, input: 35, output: 35, cache_read: 0, cache_write: 0 }
        };
        const weeklyData = fixtureWeeklyData({ 'a/dominant': 100000, 'a/negligible': 10 });
        const { top } = buildLeagueTable(tokensByModel, {}, weeklyData, pricingByModel);
        const byName = Object.fromEntries(top.map((r) => [r.name, r]));
        expect(byName['a/negligible'].badges).toEqual([]);
    });

    it('returns every qualifying badge for a model that simultaneously holds several belts', () => {
        // A single model with massive volume AND the cheapest effective $/M
        // must surface both volumeCrown and thriftKing — never one silently
        // dropped. Regression for the priority-pick bug that only returned
        // the first-priority belt.
        const tokensByModel = {
            'a/cheapest': { total: 50000, input: 25000, output: 25000, cache_read: 0, cache_write: 0 },
            'a/pricier':  { total: 20000, input: 10000, output: 10000, cache_read: 0, cache_write: 0 }
        };
        // a/cheapest has the largest weekly token growth AND is the cheapest
        // per-token — both volumeCrown and thriftKing belong to it.
        const weeklyData = fixtureWeeklyData({ 'a/cheapest': 3000, 'a/pricier': 1500 });
        const pricing = {
            'a/cheapest': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
            'a/pricier':  { input: 5,   output: 25,  cacheRead: 0.5,  cacheWrite: 6.25 }
        };
        const { top } = buildLeagueTable(tokensByModel, {}, weeklyData, pricing);
        const byName = Object.fromEntries(top.map((r) => [r.name, r]));
        expect(byName['a/cheapest'].badges).toContain('volumeCrown');
        expect(byName['a/cheapest'].badges).toContain('thriftKing');
        // The pricier model only wins the sommelier belt.
        expect(byName['a/pricier'].badges).toContain('sommelier');
        expect(byName['a/pricier'].badges).not.toContain('volumeCrown');
        expect(byName['a/pricier'].badges).not.toContain('thriftKing');
    });

    it('invalidates the belt cache when pricingByModel changes but weeklyData is the same reference', () => {
        // model-1 still leads on tokens (so volumeCrown is stable across calls),
        // but thriftKing and sommelier flip with the per-token price order.
        // Reusing the same weeklyData reference exercises the pricing-only
        // cache-invalidation path.
        const tokensByModel = {
            'a/model-1': { total: 10500, input: 5250, output: 5250, cache_read: 0, cache_write: 0 },
            'a/model-2': { total: 3000, input: 1500, output: 1500, cache_read: 0, cache_write: 0 },
            'a/model-3': { total: 1500, input: 750, output: 750, cache_read: 0, cache_write: 0 }
        };
        const weeklyData = fixtureWeeklyData({ 'a/model-1': 700, 'a/model-2': 200, 'a/model-3': 100 });

        const pricingA = {
            'a/model-1': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
            'a/model-2': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
            'a/model-3': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }
        };
        const pricingB = {
            'a/model-1': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
            'a/model-2': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
            'a/model-3': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }
        };

        const { top: top1 } = buildLeagueTable(tokensByModel, {}, weeklyData, pricingA);
        const { top: top2 } = buildLeagueTable(tokensByModel, {}, weeklyData, pricingB);

        const byName1 = Object.fromEntries(top1.map((r) => [r.name, r]));
        const byName2 = Object.fromEntries(top2.map((r) => [r.name, r]));
        expect(byName1['a/model-2'].badges).toContain('thriftKing');
        expect(byName1['a/model-3'].badges).toContain('sommelier');
        expect(byName2['a/model-2'].badges).toContain('sommelier');
        expect(byName2['a/model-3'].badges).toContain('thriftKing');
    });

    it('reuses the cached belt score across an SSE-shaped new-array refresh with identical content', () => {
        // Regression for the "cache never hits" bug: the SSE handler rebuilds
        // weeklyData on every tick as a brand-new array, so a reference-equality
        // guard would invalidate the cache ~every 5s. With a content fingerprint
        // the second call must reuse the same belts result. We exercise the
        // contract by counting calls to scoreTitleBelt: identical-content inputs
        // must NOT trigger a recompute, but a real-content change (bumped
        // weeklyData totals) must invalidate exactly once.
        const tokensByModel = {
            'a/model-1': { total: 10500, input: 5250, output: 5250, cache_read: 0, cache_write: 0 },
            'a/model-2': { total: 3000, input: 1500, output: 1500, cache_read: 0, cache_write: 0 }
        };
        const weeklyData = fixtureWeeklyData({ 'a/model-1': 700, 'a/model-2': 200 });

        // First call — populates the cache.
        buildLeagueTable(tokensByModel, {}, weeklyData, pricingByModel);

        // Build a fresh-reference copy with byte-equal content (the exact
        // shape produced by api.js:updateData on the next SSE tick).
        const weeklyDataClone = weeklyData.map((entry) => ({
            day: entry.day,
            tokens: entry.tokens,
            models: { ...entry.models }
        }));
        const pricingClone = Object.fromEntries(
            Object.entries(pricingByModel).map(([k, v]) => [k, { ...v }])
        );

        const spy = spyOn(titleBeltModule, 'scoreTitleBelt');
        buildLeagueTable(tokensByModel, {}, weeklyDataClone, pricingClone);
        // SSE-shaped new-reference refresh with byte-equal content must
        // reuse the cache and not invoke scoreTitleBelt at all.
        expect(spy.mock.calls).toHaveLength(0);
        spy.mockRestore();

        // A real-content change (bumped weeklyData totals) must invalidate
        // exactly once, then the next identical call hits the cache again.
        const weeklyDataBumped = fixtureWeeklyData({ 'a/model-1': 800, 'a/model-2': 200 });
        const spy2 = spyOn(titleBeltModule, 'scoreTitleBelt');
        buildLeagueTable(tokensByModel, {}, weeklyDataBumped, pricingClone);
        buildLeagueTable(tokensByModel, {}, weeklyDataBumped, pricingClone);
        expect(spy2.mock.calls).toHaveLength(1);
        spy2.mockRestore();

        // A pricing-only refresh (e.g. Models.dev catalog refreshes) must
        // also invalidate even if the data is byte-equal.
        const pricingBumped = {
            'a/model-1': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
            'a/model-2': { input: 5,   output: 25,  cacheRead: 0.5,  cacheWrite: 6.25 }
        };
        const spy3 = spyOn(titleBeltModule, 'scoreTitleBelt');
        buildLeagueTable(tokensByModel, {}, weeklyDataBumped, pricingBumped);
        expect(spy3.mock.calls).toHaveLength(1);
        spy3.mockRestore();
    });
});

