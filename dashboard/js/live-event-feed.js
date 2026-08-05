// dashboard/js/live-event-feed.js
import { fmtNum, fmtCur, ensureWidgetBuilt, displayModel } from './utils.js';
import { computeGrowthEvents, pickLatestEvent } from './live-event-diff.js';

/** @type {Record<string, {total: number, input?: number, output?: number, cache_read?: number, cache_write?: number, reasoning?: number}>|null} */
let prevTokensByModel = null;

/** @type {number|null} */
let lastProcessedRevision = null;

/** @type {boolean} */
let baselineReady = false;

/** @type {string|null} */
let lastEventText = null;

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
 * @param {{model: string, delta: number, cachePct: number, cost: number|null}|null} event
 */
function renderEvent(container, event) {
    if (!event) return;
    const shortName = displayModel(event.model);
    const detailBits = [];
    if (event.cost !== null) detailBits.push(fmtCur(event.cost));
    detailBits.push(`${event.cachePct.toFixed(0)}% cache`);
    const text = `${shortName} just burned ${fmtNum(event.delta)} tokens (${detailBits.join(', ')})`;
    lastEventText = text;
    /** @type {HTMLElement} */ (container.querySelector('#latestPillText')).textContent = text;
}

/** @param {HTMLElement} container */
function restoreLastEvent(container) {
    if (lastEventText) {
        /** @type {HTMLElement} */ (container.querySelector('#latestPillText')).textContent = lastEventText;
    }
}

/**
 * @param {HTMLElement} container
 * @param {Record<string, {total: number, input?: number, output?: number, cache_read?: number, cache_write?: number, reasoning?: number}>|null} prevTokens
 * @param {Record<string, {total: number, input?: number, output?: number, cache_read?: number, cache_write?: number, reasoning?: number}>} currTokens
 * @param {Record<string, any>|undefined} pricingByModel
 */
function renderGrowth(container, prevTokens, currTokens, pricingByModel) {
    if (!prevTokens) return;
    const events = computeGrowthEvents(prevTokens, currTokens);
    const event = pickLatestEvent(events, pricingByModel);
    if (event) renderEvent(container, event);
}

/** @param {number|undefined} revision */
function isRepeatedRevision(revision) {
    return revision !== undefined && revision === lastProcessedRevision;
}

/**
 * @param {Record<string, {total: number, input?: number, output?: number, cache_read?: number, cache_write?: number, reasoning?: number}>} tokensByModel
 * @param {number|undefined} revision
 */
function seedBaseline(tokensByModel, revision) {
    prevTokensByModel = tokensByModel;
    lastProcessedRevision = revision ?? null;
    baselineReady = true;
}

/**
 * @param {HTMLElement} container
 * @param {any} currentData
 * @param {{source?: string, revision?: number}|undefined} opts
 */
export function renderLiveEventFeed(container, currentData, opts = {}) {
    const { source, revision } = opts;
    ensureWidgetBuilt(container, 'liveFeedBuilt', build);

    const currTokensByModel = currentData?.tokens_by_model || {};

    if (source === 'cache') {
        restoreLastEvent(container);
        return;
    }

    if (isRepeatedRevision(revision)) {
        return;
    }

    if (!baselineReady) {
        seedBaseline(currTokensByModel, revision);
        return;
    }

    renderGrowth(container, prevTokensByModel, currTokensByModel, currentData?.pricing_by_model);

    prevTokensByModel = currTokensByModel;
    lastProcessedRevision = revision ?? null;
}

export function resetLiveEventFeedForTest() {
    prevTokensByModel = null;
    lastProcessedRevision = null;
    baselineReady = false;
    lastEventText = null;
}
