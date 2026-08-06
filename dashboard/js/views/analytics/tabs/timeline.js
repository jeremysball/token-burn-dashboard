import { CHART_COLORS, historyData, fileHistoricalData, isCompactViewport, getPlotlyLayout, getCutoffTime, analyticsRange, setAnalyticsRange, resolveAvailableRange } from './shared.js';
import { detectDeadAirBands } from '../../../dead-air.js';

const HOUR_MS = 3600 * 1000;

/** @param {boolean} usingFileHistory @param {Array<{time: number}>} filtered @param {number} chartEnd @returns {Array<{start: number, end: number}>} */
const getTimelineDeadAirBands = (usingFileHistory, filtered, chartEnd) => usingFileHistory
    ? detectDeadAirBands(filtered, 3, chartEnd)
    : [];

/** @param {string} range @param {number} chartEnd @param {number} finalObservedTime @returns {number} */
const getTimelineXAxisEnd = (range, chartEnd, finalObservedTime) => range === 'all'
    ? Math.max(chartEnd, finalObservedTime)
    : chartEnd;

/**
 * @param {HTMLElement|null|undefined} container
 */
export function renderTimelineTab(container) {
    if (!container) container = document.getElementById('timeline-chart-container');
    /** @type {any} */
    const Plotly = /** @type {any} */ (globalThis)['Plotly'];
    if (!container || !Plotly) return;

    const usingFileHistory = fileHistoricalData.length > 0;
    const sourceData = usingFileHistory ? fileHistoricalData : historyData;
    const resolvedRange = resolveAvailableRange(sourceData, analyticsRange);
    if (resolvedRange !== analyticsRange) {
        setAnalyticsRange(resolvedRange);
        document.querySelectorAll('.range-selector button').forEach((el) => {
            el.classList.toggle('active', el.textContent.toLowerCase() === resolvedRange.toLowerCase());
        });
    }

    const cutoff = getCutoffTime();
    const filtered = sourceData.filter(h => h.time > cutoff);

    // File history can still render a single valid point at the chart boundary.
    if (filtered.length < 1) {
        /** @type {Record<string, string>} */
        const rangeLabels = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days', 'all': 'all time' };
        const currentRange = rangeLabels[analyticsRange] || analyticsRange;
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 40px; color: var(--mono-text-muted);">
                <div style="font-size: 2rem; margin-bottom: 16px;">∅</div>
                <div style="margin-bottom: 8px;">Not enough data for the last <strong>${currentRange}</strong></div>
                <div style="font-size: 0.85rem; opacity: 0.7;">Try selecting a wider time range above</div>
            </div>`;
        return;
    }

    const mobile = isCompactViewport();
    const chartEnd = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const finalObservedTime = filtered[filtered.length - 1].time;
    const xAxisEnd = getTimelineXAxisEnd(analyticsRange, chartEnd, finalObservedTime);
    const rangeStart = { all: filtered[0].time }[analyticsRange] ?? cutoff;
    const deadAirBands = getTimelineDeadAirBands(usingFileHistory, filtered, chartEnd);
    const deadAirShapes = deadAirBands.map((band) => ({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: new Date(band.start),
        x1: new Date(band.end),
        y0: 0,
        y1: 1,
        fillcolor: 'rgba(163, 163, 163, 0.12)',
        line: { width: 0 }
    }));
    const deadAirAnnotations = deadAirBands.map((band) => ({
        x: new Date((band.start + band.end) / 2),
        y: 1,
        yref: 'paper',
        yanchor: 'top',
        text: '— operator offline —',
        showarrow: false,
        font: { size: 9, color: 'rgba(163, 163, 163, 0.9)' }
    }));
    const traces = [{
        x: filtered.map(d => new Date(d.time)),
        y: filtered.map(d => d.total || 0),
        type: 'scatter',
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: CHART_COLORS[0], width: 2 },
        fillcolor: 'rgba(251, 191, 36, 0.1)',
        name: 'Tokens/hour'
    }];

    Plotly.newPlot('timeline-chart-container', traces, {
        ...getPlotlyLayout(),
        margin: mobile ? { t: 16, r: 16, b: 40, l: 52 } : { t: 20, r: 20, b: 40, l: 60 },
        xaxis: {
            range: [
                new Date(rangeStart),
                new Date(xAxisEnd)
            ]
        },
        yaxis: { title: 'Tokens', automargin: true },
        shapes: deadAirShapes,
        annotations: deadAirAnnotations
    }, { displayModeBar: false });
}
