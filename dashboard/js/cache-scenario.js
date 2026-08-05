// dashboard/js/cache-scenario.js
import { cacheHitRatePct, getUsablePricingRate } from './utils.js';

/**
 * Blended real cache-hit rate across the whole fleet, as a percentage.
 * Delegates to the shared cacheHitRatePct helper for the core formula.
 * @param {{total_input?: number, total_cache_read?: number}|null} currentData
 * @returns {number}
 */
export function getRealCacheHitRatePct(currentData) {
    return cacheHitRatePct(currentData?.total_input, currentData?.total_cache_read);
}

/**
 * @param {any} stats
 * @returns {{input: number, cacheRead: number, output: number, cacheWrite: number, reasoning: number}}
 */
function getTokenCounts(stats) {
    return {
        input: Number(stats.input) || 0,
        cacheRead: Number(stats.cache_read) || 0,
        output: Number(stats.output) || 0,
        cacheWrite: Number(stats.cache_write) || 0,
        reasoning: Number(stats.reasoning) || 0
    };
}

/**
 * @param {any} pricing
 * @param {string} field
 * @param {number} tokenCount
 * @returns {boolean}
 */
function hasUsableFixedRate(pricing, field, tokenCount) {
    return tokenCount === 0 || getUsablePricingRate(pricing, field, tokenCount) !== null;
}

/**
 * Check whether a model has usable pricing for all required token dimensions.
 * @param {any} pricing
 * @param {any} stats
 * @returns {boolean}
 */
function isModelEligible(pricing, stats) {
    const counts = getTokenCounts(stats);
    return getUsablePricingRate(pricing, 'input') !== null
        && getUsablePricingRate(pricing, 'cacheRead') !== null
        && hasUsableFixedRate(pricing, 'output', counts.output)
        && hasUsableFixedRate(pricing, 'cacheWrite', counts.cacheWrite)
        && hasUsableFixedRate(pricing, 'reasoning', counts.reasoning);
}

/**
 * Compute cost contributions for an eligible model at a given hit rate.
 * @param {any} pricing
 * @param {any} stats
 * @param {number} hitRate
 * @returns {{zeroPaid: number, requestedPaid: number, actualPaid: number}|null}
 */
function computeModelScenario(pricing, stats, hitRate) {
    if (!isModelEligible(pricing, stats)) return null;

    const counts = getTokenCounts(stats);
    const inputRate = /** @type {number} */ (getUsablePricingRate(pricing, 'input'));
    const cacheReadRate = /** @type {number} */ (getUsablePricingRate(pricing, 'cacheRead'));
    const outputRate = getUsablePricingRate(pricing, 'output', counts.output) || 0;
    const cacheWriteRate = getUsablePricingRate(pricing, 'cacheWrite', counts.cacheWrite) || 0;
    const reasoningRate = getUsablePricingRate(pricing, 'reasoning', counts.reasoning) || 0;
    const cacheableTokens = counts.input + counts.cacheRead;
    const fixedCost = (counts.output / 1e6) * outputRate
        + (counts.cacheWrite / 1e6) * cacheWriteRate
        + (counts.reasoning / 1e6) * reasoningRate;
    const requestedPaid = fixedCost
        + (cacheableTokens * (1 - hitRate) / 1e6) * inputRate
        + (cacheableTokens * hitRate / 1e6) * cacheReadRate;
    const actualRate = cacheableTokens > 0 ? counts.cacheRead / cacheableTokens : 0;
    const actualPaid = fixedCost
        + (cacheableTokens * (1 - actualRate) / 1e6) * inputRate
        + (cacheableTokens * actualRate / 1e6) * cacheReadRate;

    return {
        zeroPaid: fixedCost + (cacheableTokens / 1e6) * inputRate,
        requestedPaid,
        actualPaid
    };
}

/**
 * @returns {{paid: number, requestedPaid: number, actualPaid: number, paidAtZeroPct: number, savedVsNoCache: number, actualSavedVsNoCache: number, paidPct: number, eligibleModels: string[]}}
 */
function emptyScenario() {
    return {
        paid: 0,
        requestedPaid: 0,
        actualPaid: 0,
        paidAtZeroPct: 0,
        savedVsNoCache: 0,
        actualSavedVsNoCache: 0,
        paidPct: 0,
        eligibleModels: []
    };
}

/**
 * Compute cache scenario costs using direct uniform-target and per-model
 * actual-baseline rates. Eligible models have finite input/cacheRead rates
 * and finite rates for every nonzero fixed dimension (output, cacheWrite,
 * reasoning). Returns both the uniform what-if total and the actual-rate
 * baseline so the caller can pick whichever baseline the UI needs.
 * @param {{tokens_by_model?: Record<string, any>, pricing_by_model?: Record<string, any>, total_input?: number, total_cache_read?: number}|null} currentData
 * @param {number} hitRatePct
 * @returns {{paid: number, requestedPaid: number, actualPaid: number, paidAtZeroPct: number, savedVsNoCache: number, actualSavedVsNoCache: number, paidPct: number, eligibleModels: string[]}}
 */
export function computeCacheScenario(currentData, hitRatePct) {
    const models = Object.entries(currentData?.tokens_by_model || {});
    const pricingByModel = currentData?.pricing_by_model || {};
    const hitRate = Math.max(0, Math.min(100, hitRatePct)) / 100;
    const totals = models.reduce((acc, [name, stats]) => {
        const scenario = computeModelScenario(pricingByModel[name], stats, hitRate);
        if (scenario === null) return acc;
        acc.eligibleModels.push(name);
        acc.paidAtZeroPct += scenario.zeroPaid;
        acc.requestedPaid += scenario.requestedPaid;
        acc.actualPaid += scenario.actualPaid;
        return acc;
    }, /** @type {{paidAtZeroPct: number, requestedPaid: number, actualPaid: number, eligibleModels: string[]}} */ ({
        paidAtZeroPct: 0,
        requestedPaid: 0,
        actualPaid: 0,
        eligibleModels: []
    }));

    if (totals.eligibleModels.length === 0) return emptyScenario();

    const paid = totals.requestedPaid;
    const savedVsNoCache = totals.paidAtZeroPct - paid;
    const actualSavedVsNoCache = totals.paidAtZeroPct - totals.actualPaid;
    const paidPct = totals.paidAtZeroPct > 0
        ? Math.max(2, Math.min(98, (paid / totals.paidAtZeroPct) * 100))
        : 50;

    return { paid, ...totals, savedVsNoCache, actualSavedVsNoCache, paidPct };
}
