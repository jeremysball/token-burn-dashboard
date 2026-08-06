// tests/unit/league-table.test.js
import { describe, expect, it } from 'bun:test';
import { buildLeagueTable } from '../../dashboard/js/league-table.js';

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
        expect(top.length).toBe(8);
        expect(others.length).toBe(2);
        expect(top[0].name).toBe('a/model-0');
        expect(top[0].rank).toBe(1);
        expect(others[0].rank).toBe(9);
        expect(others[0].name).toBe('a/model-8');
    });

    it('computes effective $/M from pricing via calculateCostWithPricing, null when pricing is missing', () => {
        const tokensByModel = { 'a/model-1': { total: 1000000, input: 500000, output: 500000, cache_read: 0, cache_write: 0 } };
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
        const byName = Object.fromEntries(top.map((r) => [r.name, r.badge]));
        expect(byName['a/model-1']).toBe('volumeCrown');
        expect(byName['a/model-2']).toBe('thriftKing');
        expect(byName['a/model-3']).toBe('sommelier');
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
        const byName = Object.fromEntries(top.map((r) => [r.name, r.badge]));
        expect(byName['a/negligible']).toBeNull();
    });
});
