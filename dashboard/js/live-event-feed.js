// dashboard/js/live-event-feed.js
import { fmtNum, fmtCur, cacheHitRatePct, hasUsableCacheReadPricing, ensureWidgetBuilt, displayModel } from './utils.js';
import { computeGrowthEvents, pickLatestEvent } from './live-event-diff.js';

/** @type {Record<string, {total: number}>|null} */
let prevTokensByModel = null;

/** @param {HTMLElement} container */
function build(container) {
    container.innerHTML = `
        <div class="latest-pill" id="latestPill">
            <span class="latest-pill-dot"></span>
            <span id="latestPillText">Waiting for activity…</span>
        </div>
    `;
}

/**
 * @param {HTMLElement} container
 * @param {{model: string, delta: number, cachePct: number, cost: number|null}} event
 */
function renderEvent(container, event) {
    const shortName = displayModel(event.model);
    const detailBits = [];
    if (event.cost !== null) detailBits.push(fmtCur(event.cost));
    detailBits.push(`${event.cachePct.toFixed(0)}% cache`);
    const text = `${shortName} just burned ${fmtNum(event.delta)} tokens (${detailBits.join(', ')})`;
    /** @type {HTMLElement} */ (container.querySelector('#latestPillText')).textContent = text;
}

/**
 * @param {HTMLElement} container
 * @param {any} currentData
 */
export function renderLiveEventFeed(container, currentData) {
    ensureWidgetBuilt(container, 'liveFeedBuilt', build);

    const currTokensByModel = currentData?.tokens_by_model || {};
    if (prevTokensByModel) {
        const events = computeGrowthEvents(prevTokensByModel, currTokensByModel);
        const event = pickLatestEvent(events, currTokensByModel, currentData?.pricing_by_model);
        if (event) renderEvent(container, event);
    }
    prevTokensByModel = currTokensByModel;
}

export function resetLiveEventFeedForTest() {
    prevTokensByModel = null;
}