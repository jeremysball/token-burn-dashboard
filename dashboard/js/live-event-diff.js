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
        const inputDelta = growthDelta(s.input, p.input);
        const outputDelta = growthDelta(s.output, p.output);
        const cacheReadDelta = growthDelta(s.cache_read, p.cache_read);
        const cacheWriteDelta = growthDelta(s.cache_write, p.cache_write);
        const reasoningDelta = growthDelta(s.reasoning, p.reasoning);
        const delta = inputDelta + outputDelta + cacheReadDelta + cacheWriteDelta + reasoningDelta;
        if (delta > 0) {
            events.push({ model, delta, inputDelta, outputDelta, cacheReadDelta, cacheWriteDelta, reasoningDelta });
        }
    }
    return events;
}

/**
 * @param {number|undefined} current
 * @param {number|undefined} previous
 * @returns {number}
 */
function growthDelta(current, previous) {
    return Math.max(0, (Number(current) || 0) - (Number(previous) || 0));
}

/**
 * @param {Record<string, any>} pricing
 * @param {number[]} deltas
 * @returns {number|null}
 */
function calculateCost(pricing, deltas) {
    const dimensions = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
    const rates = dimensions.map((dimension, index) => getUsablePricingRate(pricing, dimension, deltas[index]));
    const hasMissingRate = deltas.some((delta, index) => delta > 0 && rates[index] === null);
    if (hasMissingRate) return null;

    return rates.reduce(
        /** @param {number} cost @param {number|null} rate @param {number} index */
        (cost, rate, index) => cost + (deltas[index] / 1e6) * (rate || 0),
        0,
    );
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

    const deltas = [inputDelta, outputDelta, cacheReadDelta, cacheWriteDelta, reasoningDelta];
    const cost = pricing && typeof pricing === 'object' ? calculateCost(pricing, deltas) : null;

    return { model: biggest.model, delta: biggest.delta, cachePct, cost };
}
