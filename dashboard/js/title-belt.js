// dashboard/js/title-belt.js
import { WEEKLY_HISTORY_DAYS } from './config.js';
import { calculateCostWithPricing } from './modelsdev-pricing.js';

export const ELIGIBILITY_FLOOR = 0.01; // 1% of the week's total tokens

/**
 * @param {Record<string, any>} currModels
 * @param {Record<string, any>} baseModels
 * @returns {Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number}>}
 */
function diffModelStats(currModels, baseModels) {
    /** @type {Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number}>} */
    const result = {};
    for (const [name, stats] of Object.entries(currModels || {})) {
        const base = baseModels?.[name] || {};
        const total = Math.max(0, (stats.total || 0) - (base.total || 0));
        if (total <= 0) continue;
        result[name] = {
            total,
            input: Math.max(0, (stats.input || 0) - (base.input || 0)),
            output: Math.max(0, (stats.output || 0) - (base.output || 0)),
            cache_read: Math.max(0, (stats.cache_read || 0) - (base.cache_read || 0)),
            cache_write: Math.max(0, (stats.cache_write || 0) - (base.cache_write || 0))
        };
    }
    return result;
}

/**
 * @param {Array<{day: string, models: Record<string, any>}>} weeklyData
 * @returns {{thisWeek: Record<string, any>, lastWeek: Record<string, any>|null, weekEndDay: string}|null}
 */
export function computeWeekWindow(weeklyData) {
    if (!weeklyData || weeklyData.length < 8) return null;

    const idxNow = weeklyData.length - 1;
    const idxWeekAgo = weeklyData.length - 8;
    const nowEntry = weeklyData[idxNow];
    const weekAgoEntry = weeklyData[idxWeekAgo];
    const thisWeek = diffModelStats(nowEntry.models, weekAgoEntry.models);

    let lastWeek = null;
    const idxTwoWeeksAgo = weeklyData.length - WEEKLY_HISTORY_DAYS;
    if (idxTwoWeeksAgo >= 0) {
        lastWeek = diffModelStats(weekAgoEntry.models, weeklyData[idxTwoWeeksAgo].models);
    }

    return { thisWeek, lastWeek, weekEndDay: nowEntry.day };
}

/**
 * The effective $/M convention: all four rates must be finite before
 * a model is allowed to participate in effective-rate-per-million calculations.
 * @param {any|null|undefined} pricing
 * @returns {boolean}
 */
export function hasUsableFullPricing(pricing) {
    const r = [pricing?.input, pricing?.output, pricing?.cacheRead, pricing?.cacheWrite].map(Number);
    return r.every(Number.isFinite);
}

/**
 * @param {any} stats
 * @param {any} pricing
 * @returns {number|null}
 */
function effectiveRatePerMillion(stats, pricing) {
    if (!hasUsableFullPricing(pricing)) return null;
    if (stats.total <= 0) return null;
    const { total: cost, priced } = calculateCostWithPricing(stats, pricing);
    if (!priced) return null;
    return cost / (stats.total / 1e6);
}

/**
 * @param {{thisWeek: Record<string, any>, lastWeek: Record<string, any>|null}|null} weekWindow
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {{volumeCrown: any, thriftKing: any, sommelier: any, mostImproved: any}}
 */
export function scoreTitleBelt(weekWindow, pricingByModel) {
    if (!weekWindow) return { volumeCrown: null, thriftKing: null, sommelier: null, mostImproved: null };

    const { thisWeek, lastWeek } = weekWindow;
    const totalTokens = Object.values(thisWeek).reduce((sum, s) => sum + s.total, 0);
    if (totalTokens <= 0) return { volumeCrown: null, thriftKing: null, sommelier: null, mostImproved: null };

    const eligible = Object.entries(thisWeek).filter(([, s]) => s.total / totalTokens >= ELIGIBILITY_FLOOR);

    const scored = eligible.map(([name, s]) => ({
        name,
        tokens: s.total,
        share: s.total / totalTokens,
        effectiveRate: effectiveRatePerMillion(s, pricingByModel?.[name])
    }));

    const volumeCrown = scored.slice().sort((a, b) => (b?.tokens ?? 0) - (a?.tokens ?? 0))[0] || null;
    const priced = scored.filter((m) => m.effectiveRate !== null);
    const thriftKing = priced.length ? priced.slice().sort((a, b) => (a?.effectiveRate ?? 0) - (b?.effectiveRate ?? 0))[0] : null;
    const sommelier = priced.length ? priced.slice().sort((a, b) => (b?.effectiveRate ?? 0) - (a?.effectiveRate ?? 0))[0] : null;

    let mostImproved = null;
    if (lastWeek) {
        const improved = eligible
            .map(([name, s]) => {
                const priorTokens = lastWeek[name]?.total || 0;
                if (priorTokens <= 0) return null; // no prior-week data -> ineligible for this belt specifically
                return { name, tokens: s.total, growthPct: ((s.total - priorTokens) / priorTokens) * 100 };
            })
            .filter(Boolean);
        if (improved.length) {
            const best = improved.sort((a, b) => (b?.growthPct ?? 0) - (a?.growthPct ?? 0))[0];
            if (best && best.growthPct > 0) mostImproved = best;
        }
    }

    return { volumeCrown, thriftKing, sommelier, mostImproved };
}
