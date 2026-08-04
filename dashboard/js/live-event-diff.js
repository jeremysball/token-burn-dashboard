// dashboard/js/live-event-diff.js
import { cacheHitRatePct, hasUsableCacheReadPricing } from './utils.js';

/**
 * @param {Record<string, {total: number}>|null} prevTokensByModel
 * @param {Record<string, {total: number}>} currTokensByModel
 * @returns {Array<{model: string, delta: number}>}
 */
export function computeGrowthEvents(prevTokensByModel, currTokensByModel) {
    const events = [];
    for (const [model, stats] of Object.entries(currTokensByModel || {})) {
        const prevTotal = prevTokensByModel?.[model]?.total || 0;
        const delta = (stats.total || 0) - prevTotal;
        if (delta > 0) events.push({ model, delta });
    }
    return events;
}

/**
 * @param {Array<{model: string, delta: number}>} events
 * @param {Record<string, any>} currTokensByModel
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {{model: string, delta: number, cachePct: number, cost: number|null}|null}
 */
export function pickLatestEvent(events, currTokensByModel, pricingByModel) {
    if (!events.length) return null;

    const biggest = events.slice().sort((a, b) => b.delta - a.delta)[0];
    const stats = currTokensByModel[biggest.model] || {};
    const input = Number(stats.input) || 0;
    const cacheRead = Number(stats.cache_read) || 0;
    const cachePct = cacheHitRatePct(input, cacheRead);

    const pricing = pricingByModel?.[biggest.model];
    let cost = null;
    if (hasUsableCacheReadPricing(pricing)) {
        const cachedDelta = biggest.delta * (cachePct / 100);
        const uncachedDelta = biggest.delta - cachedDelta;
        cost = (uncachedDelta / 1e6) * pricing.input + (cachedDelta / 1e6) * pricing.cacheRead;
    }

    return { model: biggest.model, delta: biggest.delta, cachePct, cost };
}