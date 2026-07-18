import { fmtNum, CHART_COLORS, currentData, isCompactViewport, getPlotlyLayout } from './shared.js';

export function renderCompareTab(container) {
    if (!container || typeof Plotly === 'undefined') return;

    const { tokens_by_model } = currentData;
    const models = Object.entries(tokens_by_model)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 8);

    // Clear any skeleton/loading content
    container.innerHTML = '';

    if (models.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--mono-text-muted);">No data available</div>';
        return;
    }

    const mobile = isCompactViewport();
    const maxTokens = Math.max(...models.map(m => m[1].total));
    const yLabels = models.map(m => m[0].split('/').pop());
    const data = [{
        type: 'bar',
        y: yLabels,
        x: models.map(m => m[1].total),
        orientation: 'h',
        marker: {
            color: models.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
            line: { color: 'rgba(255,255,255,0.1)', width: 1 }
        },
        text: models.map(m => fmtNum(m[1].total)),
        textposition: mobile ? 'inside' : 'outside',
        insidetextanchor: 'end',
        cliponaxis: false,
        textfont: { color: mobile ? '#ffffff' : undefined, size: mobile ? 10 : 11 }
    }];

    Plotly.newPlot('compare-chart-container', data, {
        ...getPlotlyLayout(),
        margin: mobile ? { t: 12, r: 28, b: 40, l: 112 } : { t: 20, r: 96, b: 40, l: 220 },
        xaxis: {
            title: 'Tokens',
            range: [0, maxTokens * (mobile ? 1.28 : 1.15)],
            fixedrange: true,
            automargin: true
        },
        yaxis: {
            autorange: 'reversed',
            fixedrange: true,
            tickfont: { size: mobile ? 10 : 11 },
            automargin: true
        },
        bargap: 0.3,
        dragmode: false
    }, {
        displayModeBar: false,
        staticPlot: true
    });
}
