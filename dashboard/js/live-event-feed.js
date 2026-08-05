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
        if (lastEventText) {
            /** @type {HTMLElement} */ (container.querySelector('#latestPillText')).textContent = lastEventText;
        }
        return;
    }

    if (revision !== undefined && revision === lastProcessedRevision) {
        return;
    }

    if (!baselineReady) {
        prevTokensByModel = currTokensByModel;
        lastProcessedRevision = revision ?? null;
        baselineReady = true;
        return;
    }

    if (prevTokensByModel) {
        const events = computeGrowthEvents(prevTokensByModel, currTokensByModel);
        const event = pickLatestEvent(events, currentData?.pricing_by_model);
        if (event) {
            renderEvent(container, event);
        } else if (events.length === 0 && lastEventText) {
            // No growth: leave the last event visible
        }
    }

    prevTokensByModel = currTokensByModel;
    lastProcessedRevision = revision ?? null;
}

export function resetLiveEventFeedForTest() {
    prevTokensByModel = null;
    lastProcessedRevision = null;
    baselineReady = false;
    lastEventText = null;
}