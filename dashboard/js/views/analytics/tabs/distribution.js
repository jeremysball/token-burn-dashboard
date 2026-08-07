import { CHART_COLORS, currentData, isCompactViewport, getPlotlyLayout } from './shared.js';

/**
 * @param {HTMLElement} [container]
 */
export function renderDistributionTab(container) {
    if (!container) container = /** @type {HTMLElement} */ (document.getElementById('distribution-chart-container'));
    if (!container || typeof (/** @type {any} */ (globalThis).Plotly) === 'undefined') return;
    if (!currentData) return;

    const { tokens_by_model } = currentData;
    const models = Object.entries(tokens_by_model)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10);

    if (models.length === 0) return;

    const mobile = isCompactViewport();
    const data = [{
        values: models.map(m => m[1].total),
        labels: models.map(m => m[0].split('/').pop()),
        type: 'pie',
        hole: 0.5,
        marker: { colors: CHART_COLORS },
        textinfo: 'label+percent',
        textposition: mobile ? 'inside' : 'outside',
        insidetextorientation: 'radial'
    }];

    /** @type {any} */ (globalThis).Plotly.newPlot('distribution-chart-container', data, {
        ...getPlotlyLayout({ showlegend: false }),
        // Outside labels for slices near the top can extend above the plot
        // area; a top margin this small clips the topmost slice's label
        // against the panel edge instead of leaving room for it.
        margin: mobile ? { t: 20, r: 16, b: 40, l: 16 } : { t: 110, r: 40, b: 80, l: 40 }
    }, {
        displayModeBar: false,
        responsive: true
    });
}
