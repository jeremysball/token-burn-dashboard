// dashboard/js/cache-scenario.js
import { cacheHitRatePct } from './utils.js';

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
 * Recompute total spend as if the fleet's blended cache-hit rate were
 * hitRatePct instead of whatever it actually was. Output/cache-write/
 * reasoning cost stay fixed per model (unaffected by the input-caching
 * mix); only each model's cacheable tokens (input + cache_read) are
 * re-blended between the input rate and the cache-read rate.
 * @param {{tokens_by_model?: Record<string, any>, pricing_by_model?: Record<string, any>, total_input?: number, total_cache_read?: number}|null} currentData
 * @param {number} hitRatePct
 * @returns {{paid: number, paidAtZeroPct: number, savedVsNoCache: number, paidPct: number}}
 */
export function computeCacheScenario(currentData, hitRatePct) {
    const models = Object.entries(currentData?.tokens_by_model || {});
    const pricingByModel = currentData?.pricing_by_model || {};
    const h = Math.max(0, Math.min(100, hitRatePct)) / 100;

    const fleetInput = Number(currentData?.total_input) || 0;
    const fleetCacheRead = Number(currentData?.total_cache_read) || 0;
    const fleetTotal = fleetInput + fleetCacheRead;
    const actualRate = fleetTotal > 0 ? fleetCacheRead / fleetTotal : 0;

    let paidAtZeroPct = 0;
    let paidAtActual = 0;
    let paidAtUniform = 0;
    let coverage = false;

    for (const [name, stats] of models) {
        const pricing = pricingByModel[name];
        if (!Number.isFinite(Number(pricing?.input)) || !Number.isFinite(Number(pricing?.cacheRead))) continue;
        coverage = true;

        const inputRate = Number(pricing.input);
        const cacheReadRate = Number(pricing.cacheRead);
        const outputRate = Number(pricing?.output);
        const cacheWriteRate = Number(pricing?.cacheWrite);
        const input = Number(stats.input) || 0;
        const cacheRead = Number(stats.cache_read) || 0;
        const output = Number(stats.output) || 0;
        const cacheWrite = Number(stats.cache_write) || 0;

        const fixedCost = (output / 1e6) * (Number.isFinite(outputRate) ? outputRate : 0)
            + (cacheWrite / 1e6) * (Number.isFinite(cacheWriteRate) ? cacheWriteRate : 0);

        const cacheableTokens = input + cacheRead;
        const uncachedTokens = cacheableTokens * (1 - h);
        const cachedTokens = cacheableTokens * h;

        paidAtZeroPct += fixedCost + (cacheableTokens / 1e6) * inputRate;
        paidAtUniform += fixedCost + (uncachedTokens / 1e6) * inputRate + (cachedTokens / 1e6) * cacheReadRate;

        // C3 fix: per-model actual hit rate for self-consistency at real position
        const modelActualRate = cacheableTokens > 0 ? cacheRead / cacheableTokens : 0;
        paidAtActual += fixedCost + (cacheableTokens * (1 - modelActualRate) / 1e6) * inputRate
            + (cacheableTokens * modelActualRate / 1e6) * cacheReadRate;
    }

    if (!coverage) return { paid: 0, paidAtZeroPct: 0, savedVsNoCache: 0, paidPct: 0 };

    // C3: blend uniform-rate cost with per-model-actual cost so that
    // at the slider's real position (h == actualRate), paid == paidAtActual
    // (matching total_cost), while at h=0 paid == paidAtZeroPct.
    const w = actualRate > 0 ? Math.min(1, (h / actualRate) ** 2) : 0;
    const paid = paidAtUniform * (1 - w) + paidAtActual * w;

    const savedVsNoCache = paidAtZeroPct - paid;
    const paidPct = paidAtZeroPct > 0 ? Math.max(2, Math.min(98, (paid / paidAtZeroPct) * 100)) : 50;

    return { paid, paidAtZeroPct, savedVsNoCache, paidPct };
}