// dashboard/js/live-event-diff.js
import { getUsablePricingRate } from './utils.js';

/**
 * @param {Record<string, {total: number, input?: number, output?: number, cache_read?: number, cache_write?: number, reasoning?: number}>|null} prevTokensByModel
 * @param {Record<string, {total: number, input?: number, output?: number, cache_read?: number, cache_write?: number, reasoning?: number}>} currTokensByModel
 * @returns {Array<{model: string, delta: number, inputDelta: number, outputDelta: number, cacheReadDelta: number, cacheWriteDelta: number, reasoningDelta: number}>}
 */
export function computeGrowthEvents(prevTokensByModel, currTokensByModel) {
    const events = [];
    for (const [model, stats] of Object.entries(currTokensByModel || {})) {
        const prev = prevTokensByModel?.[model] || {};
        const s = /** @type {any} */ (stats);
        const p = /** @type {any} */ (prev);
        const inputDelta = Math.max(0, (Number(s.input) || 0) - (Number(p.input) || 0));
        const outputDelta = Math.max(0, (Number(s.output) || 0) - (Number(p.output) || 0));
        const cacheReadDelta = Math.max(0, (Number(s.cache_read) || 0) - (Number(p.cache_read) || 0));
        const cacheWriteDelta = Math.max(0, (Number(s.cache_write) || 0) - (Number(p.cache_write) || 0));
        const reasoningDelta = Math.max(0, (Number(s.reasoning) || 0) - (Number(p.reasoning) || 0));
        const delta = inputDelta + outputDelta + cacheReadDelta + cacheWriteDelta + reasoningDelta;
        if (delta > 0) {
            events.push({ model, delta, inputDelta, outputDelta, cacheReadDelta, cacheWriteDelta, reasoningDelta });
        }
    }
    return events;
}

/**
 * @param {Array<{model: string, delta: number, inputDelta: number, outputDelta: number, cacheReadDelta: number, cacheWriteDelta: number, reasoningDelta: number}>} events
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {{model: string, delta: number, cachePct: number, cost: number|null}|null}
 */
export function pickLatestEvent(events, pricingByModel) {
    if (!events.length) return null;

    const biggest = events.slice().sort((a, b) => b.delta - a.delta)[0];
    const pricing = pricingByModel?.[biggest.model];

    const { inputDelta, outputDelta, cacheReadDelta, cacheWriteDelta, reasoningDelta } = biggest;
    const totalCacheable = inputDelta + cacheReadDelta;
    const cachePct = totalCacheable > 0 ? (cacheReadDelta / totalCacheable) * 100 : 0;

    let cost = null;
    if (pricing && typeof pricing === 'object') {
        const inputRate = getUsablePricingRate(pricing, 'input', inputDelta);
        const outputRate = getUsablePricingRate(pricing, 'output', outputDelta);
        const cacheReadRate = getUsablePricingRate(pricing, 'cacheRead', cacheReadDelta);
        const cacheWriteRate = getUsablePricingRate(pricing, 'cacheWrite', cacheWriteDelta);
        const reasoningRate = getUsablePricingRate(pricing, 'reasoning', reasoningDelta);

        const rates = [inputRate, outputRate, cacheReadRate, cacheWriteRate, reasoningRate];
        const deltas = [inputDelta, outputDelta, cacheReadDelta, cacheWriteDelta, reasoningDelta];
        const hasMissingRate = deltas.some((d, i) => d > 0 && rates[i] === null);

        if (!hasMissingRate) {
            cost =
                (inputDelta / 1e6) * (inputRate || 0) +
                (outputDelta / 1e6) * (outputRate || 0) +
                (cacheReadDelta / 1e6) * (cacheReadRate || 0) +
                (cacheWriteDelta / 1e6) * (cacheWriteRate || 0) +
                (reasoningDelta / 1e6) * (reasoningRate || 0);
        }
    }

    return { model: biggest.model, delta: biggest.delta, cachePct, cost };
}