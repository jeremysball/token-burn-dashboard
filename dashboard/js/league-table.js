// dashboard/js/league-table.js
import { computeWeekWindow, scoreTitleBelt } from './title-belt.js';
import { calculateCostWithPricing } from './modelsdev-pricing.js';
import { cacheHitRatePct } from './utils.js';

/** @typedef {{rank: number, name: string, tokens: number, effectiveRatePerMillion: number|null, cachePct: number, badge: 'volumeCrown'|'thriftKing'|'sommelier'|'mostImproved'|null}} LeagueRow */

/** @type {ReadonlyArray<keyof ReturnType<typeof scoreTitleBelt>>} */
const BADGE_PRIORITY = ['volumeCrown', 'thriftKing', 'sommelier', 'mostImproved'];

/** Memoization guard for weekly belt scoring — weeklyData changes at most once per calendar day. */
/** @type {any[]|null} */
let _lastWeeklyRef = null;
/** @type {ReturnType<typeof scoreTitleBelt>|null} */
let _cachedBelts = null;

/**
 * @param {ReturnType<typeof scoreTitleBelt>} belts
 * @param {string} name
 * @returns {LeagueRow['badge']}
 */
function badgeFor(belts, name) {
    for (const belt of BADGE_PRIORITY) {
        if (belts[belt]?.name === name) return /** @type {LeagueRow['badge']} */ (belt);
    }
    return null;
}

/**
 * @param {Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number}>} tokensByModel
 * @param {Record<string, {total:number}>|undefined} costsByModel
 * @param {any[]} weeklyData
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {{top: LeagueRow[], others: LeagueRow[]}}
 */
export function buildLeagueTable(tokensByModel, costsByModel, weeklyData, pricingByModel) {
    const sorted = Object.entries(tokensByModel || {}).sort((a, b) => b[1].total - a[1].total);
    if (sorted.length === 0) return { top: [], others: [] };

    // C19: Only recompute weekly belt scoring when weeklyData has actually changed.
    // weeklyData changes at most once per calendar day; SSE triggers this every 5s.
    if (weeklyData !== _lastWeeklyRef) {
        _cachedBelts = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
        _lastWeeklyRef = weeklyData;
    }
    const belts = /** @type {ReturnType<typeof scoreTitleBelt>} */ (_cachedBelts);

    const rows = sorted.map(([name, stats], index) => {
        // C7: Use calculateCostWithPricing (reasoning-inclusive) instead of
        // costsByModel[name].total, so this surface agrees with the title-belt's
        // effective-$/M definition. calculateCostWithPricing returns
        // {total, priced} — priced is false when a nonzero token dimension
        // has no published rate, in which case we must not fabricate a number.
        const costResult = pricingByModel ? calculateCostWithPricing(stats, pricingByModel[name]) : null;
        const effectiveRatePerMillion = (costResult?.priced && stats.total > 0)
            ? costResult.total / (stats.total / 1e6)
            : null;
        // C18: Reuse the shared helper instead of re-implementing the formula inline.
        const cachePct = cacheHitRatePct(stats.input, stats.cache_read);
        return { rank: index + 1, name, tokens: stats.total, effectiveRatePerMillion, cachePct, badge: badgeFor(belts, name) };
    });

    return { top: rows.slice(0, 8), others: rows.slice(8) };
}
