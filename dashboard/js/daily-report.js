// dashboard/js/daily-report.js (Part 1 of 2 — pure summary builder; the
// render/fetch half is added in Step 5 below)

import { calculateCostWithPricing } from './modelsdev-pricing.js';
import { meanStddev } from './utils.js';
import { createTaskferryReportWidget } from './report-widget.js';

/** @param {number} ms @returns {string} */
function toUtcDateKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Adapt a raw pricing_by_model entry to the shape calculateCostWithPricing
 * expects. The server's pricing_by_model carries `{input, output, cacheRead,
 * cacheWrite, reasoning?, source?}` without explicit `hasInput`/`hasOutput`
 * presence flags; calculateCostWithPricing's contract (see
 * modelsdev-pricing.js) requires those flags and returns `priced: false`
 * (total: 0) when they're missing. Filling them in here for the
 * non-models.dev (server fallback) shape is the only adjustment — models.dev
 * catalog pricing already carries the flags, so the spread is a no-op for
 * that path.
 * @param {any} pricing
 */
function withPricingPresenceFlags(pricing) {
    if (!pricing) return null;
    if (pricing.hasInput !== undefined && pricing.hasOutput !== undefined) return pricing;
    return { ...pricing, hasInput: true, hasOutput: true };
}

/**
 * @param {Record<string, number>} tokensByModel
 * @param {Record<string, any>} pricingByModel
 * @returns {{tokenShareByModel: Record<string, number>, costShareByModel: Record<string, number>}}
 */
function computeShares(tokensByModel, pricingByModel) {
    const totalTokens = Object.values(tokensByModel).reduce((a, b) => a + b, 0) || 1;
    /** @type {Record<string, number>} */
    const tokenShareByModel = {};
    /** @type {Record<string, number>} */
    const costByModel = {};
    let totalCost = 0;

    for (const [model, tokens] of Object.entries(tokensByModel)) {
        tokenShareByModel[model] = tokens / totalTokens;
        // Hourly buckets carry total tokens per model without a per-type
        // (input/output/cache/reasoning) split, so we approximate cost via
        // calculateCostWithPricing's blended rate (input+output when only a
        // total is available) — more accurate than input-only pricing.
        const cost = calculateCostWithPricing(tokens, withPricingPresenceFlags(pricingByModel?.[model] || null)).total;
        costByModel[model] = cost;
        totalCost += cost;
    }

    /** @type {Record<string, number>} */
    const costShareByModel = {};
    for (const [model, cost] of Object.entries(costByModel)) {
        costShareByModel[model] = totalCost > 0 ? cost / totalCost : tokenShareByModel[model];
    }

    return { tokenShareByModel, costShareByModel };
}

/**
 * @param {any} currentData
 * @param {Array<{time: number, total: number, tokens_by_model?: Record<string, number>}>} fileHistoricalData
 * @returns {object|null}
 */
export function buildDailyReportSummary(currentData, fileHistoricalData, now = Date.now()) {
    if (!fileHistoricalData || fileHistoricalData.length === 0) return null;

    const todayKey = toUtcDateKey(now);
    // Cache date-key lookups per unique timestamp to avoid repeated
    // Date+toISOString allocations on every bucket every 5s render.
    /** @type {Map<number, string>} */
    const dateKeyCache = new Map();
    /** @param {number} ms */
    const cachedDateKey = (ms) => {
        let k = dateKeyCache.get(ms);
        if (k === undefined) { k = toUtcDateKey(ms); dateKeyCache.set(ms, k); }
        return k;
    };
    const todaysBuckets = fileHistoricalData.filter((b) => cachedDateKey(b.time) === todayKey);
    if (todaysBuckets.length === 0) return null;

    const pricingByModel = currentData?.pricing_by_model || {};

    const hourlyBuckets = todaysBuckets
        .slice()
        .sort((a, b) => a.time - b.time)
        .map((b) => ({ hour: new Date(b.time).getUTCHours(), totalTokens: b.total || 0 }));

    const peakBucket = todaysBuckets.slice().sort((a, b) => (b.total || 0) - (a.total || 0))[0];
    const { tokenShareByModel, costShareByModel } = computeShares(peakBucket.tokens_by_model || {}, pricingByModel);

    const totalTokensToday = todaysBuckets.reduce((sum, b) => sum + (b.total || 0), 0);
    /** @type {Record<string, number>} */
    const tokensByModelToday = {};
    for (const bucket of todaysBuckets) {
        for (const [model, tokens] of Object.entries(bucket.tokens_by_model || {})) {
            tokensByModelToday[model] = (tokensByModelToday[model] || 0) + tokens;
        }
    }
    const topModelToday = Object.entries(tokensByModelToday).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    let totalCostToday = 0;
    for (const [model, tokens] of Object.entries(tokensByModelToday)) {
        totalCostToday += calculateCostWithPricing(tokens, withPricingPresenceFlags(pricingByModel?.[model] || null)).total;
    }

    const { mean: meanHourlyTokens, stddev: stddevHourlyTokens } = meanStddev(fileHistoricalData.map((b) => b.total || 0));

    return {
        date: todayKey,
        totalTokensToday,
        totalCostToday,
        topModelToday,
        peakHour: {
            hour: new Date(peakBucket.time).getUTCHours(),
            totalTokens: peakBucket.total || 0,
            tokenShareByModel,
            costShareByModel
        },
        baseline: { meanHourlyTokens, stddevHourlyTokens },
        hourlyBuckets
    };
}

// dashboard/js/daily-report.js (Part 2 of 2 — widget wiring, appended below Part 1)

const dailyReport = createTaskferryReportWidget({
    endpoint: '/api/insights/daily-report',
    cacheKeyField: 'date',
    bodyId: 'dailyFieldReportBody',
    dateLabelId: 'dailyFieldReportDate',
    retryId: 'dailyFieldReportRetry',
    containerId: 'daily-field-report-container',
    loadingText: "Loading today's field report…",
    headingFor: (d) => `FIELD REPORT // ${d}`,
    notEnoughText: () => null,
    buildFlag: 'dailyReportBuilt'
});

/** @type {string|null} */
let lastBuiltDateKey = null;

/**
 * @param {HTMLElement} container
 * @param {any} currentData
 * @param {any[]} fileHistoricalData
 */
export function renderDailyFieldReport(container, currentData, fileHistoricalData) {
    // C19-2: compute today's UTC date key in O(1) instead of building the
    // full summary just to check the cache — the summary is only built when
    // we know we need a new report.
    const todayKey = new Date().toISOString().slice(0, 10);
    if (lastBuiltDateKey === todayKey) return;

    const summary = buildDailyReportSummary(currentData, fileHistoricalData);
    if (!summary) {
        // C19-1: do NOT set the `dailyReportBuilt` flag here — that flag
        // is owned by dailyReport.render / its build() function, and the
        // inline element ids below don't match build()'s template (no
        // `#dailyFieldReportDate` child). If the flag is set here, the
        // next call that finds data will skip build() inside
        // dailyReport.render and try to populate a date label that doesn't
        // exist, throwing "Cannot set properties of null (setting
        // 'textContent')" and showing a fabricated-looking error state.
        // Instead, write the placeholder directly; build() will replace it
        // wholesale on the next successful render.
        container.innerHTML = '<div class="field-report" id="dailyFieldReport">'
            + '<div id="dailyFieldReportBody">Not enough data yet for a report today.</div></div>';
        return;
    }

    lastBuiltDateKey = todayKey;
    dailyReport.render(container, summary);
}

export const resetDailyFieldReportForTest = () => {
    lastBuiltDateKey = null;
    dailyReport.resetForTest();
};
