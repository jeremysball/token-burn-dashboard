import {
    fmtNum, fmtInt, fmtCur, historyData, fileHistoricalData,
    escapeHtml, splitModelKey, bindHeatmapInteractions
} from './shared.js';
import {
    lookupModelsDevPrice, calculateCostWithPricing, fetchModelsDevCatalog,
    getCatalog, isCatalogFailed, clearCatalogCache
} from '../../../modelsdev-pricing.js';
// Compute the real cost of a single historical bucket using Models.dev pricing.
// Each bucket carries tokens_by_model (per model) and aggregate input/output/
// cache/reasoning totals. We never fall back to local hardcoded pricing or a
// constant rate; if a model has no Models.dev price we mark it unpriced so the
// UI can surface an explicit "price unavailable" state.
const computeBucketCost = (d) => {
    let total = 0;
    let unpriced = false;

    // Live fallback history stores per-model data under `models`; file-derived
    // history uses `tokens_by_model`. Normalize so both sources price the same.
    const modelData = d.tokens_by_model || d.models || {};

    if (Object.keys(modelData).length > 0) {
        for (const [model, tokens] of Object.entries(modelData)) {
            const pricing = lookupModelsDevPrice(model);
            const r = calculateCostWithPricing(tokens, pricing);
            total += r.total;
            if (!pricing || !r.priced) unpriced = true;
        }
        return { total, unpriced };
    }

    // No per-model breakdown. Price the aggregate with the bucket's own
    // input/output/cache/reasoning totals if we can attribute a model.
    // Without a model key we cannot price honestly, so mark unpriced.
    if (d.model) {
        const pricing = lookupModelsDevPrice(d.model);
        const r = calculateCostWithPricing(
            {
                input: d.input || 0,
                output: d.output || 0,
                cache_read: d.cache_read || 0,
                cache_write: d.cache_write || 0,
                reasoning: d.reasoning || 0
            },
            pricing
        );
        return { total: r.total, unpriced: !pricing || !r.priced };
    }

    return { total: 0, unpriced: true };
};

const renderMetricBanner = (isCost, unpriced) => {
    if (!isCost) return '';
    if (isCatalogFailed()) {
        return `<div class="heatmap-metric-note unavailable">Models.dev pricing unavailable; cost values cannot be calculated. <button type="button" class="heatmap-retry-btn" onclick="retryModelsDevPricing()">Retry pricing</button></div>`;
    }
    if (!getCatalog()) {
        return `<div class="heatmap-metric-note">Loading real pricing from Models.dev&hellip;</div>`;
    }
    if (unpriced) {
        return `<div class="heatmap-metric-note unavailable">Some models have no Models.dev price &mdash; cost shown only where pricing is available.</div>`;
    }
    return `<div class="heatmap-metric-note">Cost priced from Models.dev (real per-model rates).</div>`;
};

// User-accessible retry after a Models.dev catalog failure: clear the failed
// cache and re-attempt the fetch, re-rendering safely when it settles. Token
// mode remains usable regardless of the outcome.
export const retryModelsDevPricing = () => {
    clearCatalogCache();
    fetchModelsDevCatalog()
        .then(() => {
            if (heatmapMetric === 'cost') renderHeatmapsTab();
        })
        .catch(() => {
            if (heatmapMetric === 'cost') renderHeatmapsTab();
        });
    if (heatmapMetric === 'cost') renderHeatmapsTab();
};

let heatmapMetric = 'tokens';

export const setHeatmapMetric = (m) => {
    if (m !== 'tokens' && m !== 'cost') return;
    heatmapMetric = m;
    document.querySelectorAll('#heatmap-metric-toggle button').forEach(b => {
        b.classList.toggle('active', b.dataset.metric === m);
    });
    if (m === 'cost' && !getCatalog()) {
        // Kick off catalog load; re-render safely when it settles.
        fetchModelsDevCatalog()
            .then(() => {
                if (heatmapMetric === 'cost') renderHeatmapsTab();
            })
            .catch(() => {
                if (heatmapMetric === 'cost') renderHeatmapsTab();
            });
    }
    renderHeatmapsTab();
};

export function renderHeatmapsTab(container) {
    if (!container) return;

    const heatmapType = document.getElementById('heatmap-type')?.value || 'hourly';
    const sourceData = fileHistoricalData.length > 0 ? fileHistoricalData : historyData;

    if (sourceData.length === 0) {
        container.innerHTML = '<div class="loading-placeholder">No data available for heatmap</div>';
        return;
    }

    switch (heatmapType) {
        case 'hourly':
            renderHourlyHeatmap(container, sourceData, heatmapMetric);
            break;
        case 'daily':
            renderDailyHeatmap(container, sourceData, heatmapMetric);
            break;
        case 'model':
            renderModelHeatmap(container, sourceData, heatmapMetric);
            break;
        case 'cost':
            renderHourlyHeatmap(container, sourceData, 'cost');
            break;
    }
}

export function renderHourlyHeatmap(container, data, metric = 'tokens') {
    // Create 7 days x 24 hours matrix
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const matrix = Array(7).fill(null).map(() => Array(24).fill(0));
    let unpriced = false;

    data.forEach(d => {
        const date = new Date(d.time);
        // UTC accessors keep grouping independent of the viewer's timezone and
        // consistent with the historical labels elsewhere in this view.
        const day = date.getUTCDay();
        const hour = date.getUTCHours();
        let value = d.total || 0;
        if (metric === 'cost') {
            const r = computeBucketCost(d);
            value = r.total;
            if (r.unpriced) unpriced = true;
        }
        matrix[day][hour] += value;
    });

    const maxVal = Math.max(...matrix.flat(), metric === 'cost' ? 0.01 : 1);
    const isCost = metric === 'cost';

    container.innerHTML = `
        <div class="heatmap-title">${isCost ? 'Hourly Cost Patterns' : 'Hourly Usage Patterns'} (Last 7 Days)</div>
        ${renderMetricBanner(isCost, unpriced)}
        <div class="heatmap-wrapper">
            <div class="heatmap-y-labels">
                ${days.map(d => `<div class="heatmap-y-label">${d}</div>`).join('')}
            </div>
            <div class="heatmap-grid hourly">
                <div class="heatmap-x-labels">
                    ${Array(24).fill(0).map((_, i) => `<div class="heatmap-x-label">${i}</div>`).join('')}
                </div>
                <div class="heatmap-cells">
                    ${matrix.map((day, dayIdx) => `
                        <div class="heatmap-row">
                            ${day.map((val, hour) => {
                                const intensity = val / maxVal;
                                const opacity = 0.1 + (intensity * 0.9);
                                const bg = isCost ? 'rgba(239, 68, 68' : 'rgba(251, 191, 36';
                                const display = isCost ? fmtCur(val) : fmtInt(val);
                                const suffix = isCost ? '' : 'tokens';
                                return `
                                    <button type="button" class="heatmap-cell-full${isCost ? ' cost' : ''}"
                                         data-heatmap-cell="true"
                                         data-type="info"
                                         data-label="${days[dayIdx]} ${hour}:00"
                                         data-value="${display}"
                                         data-suffix="${suffix}"
                                         data-detail="${isCost ? 'hourly cost' : 'hourly usage'}"
                                         aria-label="${days[dayIdx]} ${hour}:00 - ${display}${suffix ? ' ' + suffix : ''}"
                                         style="background: ${bg}, ${opacity})"
                                         title="${days[dayIdx]} ${hour}:00 - ${display}${suffix ? ' ' + suffix : ''}">
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        <div class="heatmap-legend">
            <span>Low</span>
            <div class="heatmap-gradient${isCost ? ' cost' : ''}"></div>
            <span>High (${isCost ? fmtCur(maxVal) + '/hr' : fmtNum(maxVal) + ' tokens'})</span>
        </div>
    `;

    bindHeatmapInteractions(container);
}

export function renderDailyHeatmap(container, data, metric = 'tokens') {
    // Group by date
    const byDate = {};
    let unpriced = false;
    data.forEach(d => {
        const date = new Date(d.time).toISOString().split('T')[0];
        if (!byDate[date]) byDate[date] = 0;
        let value = d.total || 0;
        if (metric === 'cost') {
            const r = computeBucketCost(d);
            value = r.total;
            if (r.unpriced) unpriced = true;
        }
        byDate[date] += value;
    });

    const dates = Object.keys(byDate).sort();
    const maxVal = Math.max(...Object.values(byDate), metric === 'cost' ? 0.01 : 1);
    const isCost = metric === 'cost';

    // Group into weeks for display
    const weeks = [];
    for (let i = 0; i < dates.length; i += 7) {
        weeks.push(dates.slice(i, i + 7));
    }

    container.innerHTML = `
        <div class="heatmap-title">${isCost ? 'Daily Cost Over Time' : 'Daily Usage Over Time'}</div>
        ${renderMetricBanner(isCost, unpriced)}
        <div class="daily-heatmap">
            ${weeks.map(week => `
                <div class="heatmap-week">
                    ${week.map(date => {
                        const val = byDate[date];
                        const intensity = val / maxVal;
                        const dayName = new Date(date).toLocaleDateString('en', {
                            weekday: 'short',
                            timeZone: 'UTC'
                        });
                        const display = isCost ? fmtCur(val) : fmtInt(val);
                        const suffix = isCost ? '' : 'tokens';
                        const bg = isCost ? 'rgba(239, 68, 68' : 'rgba(251, 191, 36';
                        return `
                            <button type="button" class="daily-heatmap-cell${isCost ? ' cost' : ''}"
                                 data-heatmap-cell="true"
                                 data-type="info"
                                 data-label="${date}"
                                 data-value="${display}"
                                 data-suffix="${suffix}"
                                 data-detail="${isCost ? 'daily cost' : 'daily total'}"
                                 aria-label="${date} - ${display}${suffix ? ' ' + suffix : ''}"
                                 style="background: ${bg}, ${0.1 + intensity * 0.9})"
                                 title="${date} - ${display}${suffix ? ' ' + suffix : ''}">
                                <span class="daily-heatmap-day">${dayName}</span>
                                <span class="daily-heatmap-val" title="${display}">${isCost ? fmtCur(val) : fmtNum(val)}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            `).join('')}
        </div>
        <div class="heatmap-legend">
            <span>Low</span>
            <div class="heatmap-gradient${isCost ? ' cost' : ''}"></div>
            <span>High (${isCost ? fmtCur(maxVal) : fmtNum(maxVal) + ' tokens'})</span>
        </div>
    `;

    bindHeatmapInteractions(container);
}

export function renderModelHeatmap(container, data, metric = 'tokens') {
    // Get model usage over time
    const modelUsage = {};
    const timeSlots = [];
    let unpriced = false;

    data.forEach(d => {
        const timeKey = new Date(d.time).toISOString().slice(0, 13); // Hourly buckets
        if (!timeSlots.includes(timeKey)) timeSlots.push(timeKey);

        const models = d.tokens_by_model || d.models || {};
        Object.entries(models).forEach(([model, tokens]) => {
            if (!modelUsage[model]) modelUsage[model] = {};
            if (!modelUsage[model][timeKey]) modelUsage[model][timeKey] = 0;
            let value = tokens || 0;
            if (metric === 'cost') {
                const pricing = lookupModelsDevPrice(model);
                const r = calculateCostWithPricing(tokens, pricing);
                value = r.total;
                if (!pricing || !r.priced) unpriced = true;
            }
            modelUsage[model][timeKey] += value;
        });
    });

    const sortedModels = Object.entries(modelUsage)
        .sort((a, b) => Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0))
        .slice(0, 8);

    const maxVal = Math.max(...sortedModels.flatMap(m => Object.values(m[1])), metric === 'cost' ? 0.01 : 1);
    const timeLabels = timeSlots.slice(-24);
    const isCost = metric === 'cost';

    container.innerHTML = `
        <div class="heatmap-title">${isCost ? 'Model Cost Intensity' : 'Model Usage Intensity'}</div>
        ${renderMetricBanner(isCost, unpriced)}
        <div class="heatmap-wrapper">
            <div class="heatmap-y-labels">
                ${sortedModels.map(([model]) => {
                    const shortName = splitModelKey(model).model;
                    return `<div class="heatmap-y-label" title="${escapeHtml(model)}">${escapeHtml(shortName)}</div>`;
                }).join('')}
            </div>
            <div class="heatmap-grid hourly model">
                <div class="heatmap-x-labels">
                    ${timeLabels.map(t => {
                        const dt = new Date(t.length === 13 ? t + ':00Z' : t);
                        const dateLabel = dt.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            timeZone: 'UTC'
                        });
                        const label = isNaN(dt)
                            ? t.slice(11, 16)
                            : `${dateLabel} ${String(dt.getUTCHours()).padStart(2, '0')}:00`;
                        return `<div class="heatmap-x-label">${label}</div>`;
                    }).join('')}
                </div>
                <div class="heatmap-cells">
                    ${sortedModels.map(([model, usage]) => `
                        <div class="heatmap-row">
                            ${timeLabels.map(time => {
                                const val = usage[time] || 0;
                                const intensity = val / maxVal;
                                const opacity = 0.1 + (intensity * 0.9);
                                const bg = isCost ? 'rgba(239, 68, 68' : 'rgba(251, 191, 36';
                                const display = isCost ? fmtCur(val) : fmtInt(val);
                                const suffix = isCost ? '' : 'tokens';
                                return `
                                    <button type="button" class="heatmap-cell-full model${isCost ? ' cost' : ''}"
                                         data-heatmap-cell="true"
                                         data-type="info"
                                         data-label="${escapeHtml(model.split('/').pop())} @ ${escapeHtml(time)}"
                                         data-value="${escapeHtml(display)}"
                                         data-suffix="${escapeHtml(suffix)}"
                                         data-detail="${isCost ? 'model cost' : 'model usage'}"
                                         aria-label="${escapeHtml(model)} @ ${escapeHtml(time)} - ${escapeHtml(display)}${suffix ? ' ' + suffix : ''}"
                                         style="background: ${bg}, ${opacity})"
                                         title="${escapeHtml(model)} @ ${escapeHtml(time)} - ${escapeHtml(display)}${suffix ? ' ' + suffix : ''}">
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        <div class="heatmap-legend">
            <span>Low</span>
            <div class="heatmap-gradient${isCost ? ' cost' : ''}"></div>
            <span>High (${isCost ? fmtCur(maxVal) : fmtNum(maxVal) + ' tokens'})</span>
        </div>
    `;

    bindHeatmapInteractions(container);
}
