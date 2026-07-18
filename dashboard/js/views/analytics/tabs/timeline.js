import { CHART_COLORS, historyData, fileHistoricalData, isCompactViewport, getPlotlyLayout, getCutoffTime, analyticsRange } from './shared.js';

export function renderTimelineTab(container) {
    if (!container || typeof Plotly === 'undefined') return;

    const cutoff = getCutoffTime();
    const sourceData = fileHistoricalData.length > 0 ? fileHistoricalData : historyData;
    const filtered = sourceData.filter(h => h.time > cutoff);

    // If 1h range has insufficient data, show message suggesting wider range
    if (filtered.length < 2) {
        const rangeLabels = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days', 'all': 'all time' };
        const currentRange = rangeLabels[analyticsRange] || analyticsRange;
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 40px; color: var(--mono-text-muted);">
                <div style="font-size: 2rem; margin-bottom: 16px;">📊</div>
                <div style="margin-bottom: 8px;">Not enough data for the last <strong>${currentRange}</strong></div>
                <div style="font-size: 0.85rem; opacity: 0.7;">Try selecting a wider time range above</div>
            </div>`;
        return;
    }

    const mobile = isCompactViewport();
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
        yaxis: { title: 'Tokens', automargin: true }
    }, { displayModeBar: false });
}
