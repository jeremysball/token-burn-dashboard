import { fmtNum, historyData, fileHistoricalData, isCompactViewport, getPlotlyLayout, bindPlotlyClick, notify } from './shared.js';

export function renderCalendarTab(container) {
    if (!container) container = document.getElementById('calendar-container');
    if (!container || typeof Plotly === 'undefined') return;

    // Use ALL available data
    const sourceData = fileHistoricalData.length > 0 ? fileHistoricalData : historyData;

    // Group by day
    const byDay = {};
    sourceData.forEach(d => {
        const day = new Date(d.time).toISOString().split('T')[0];
        if (!byDay[day]) byDay[day] = 0;
        byDay[day] += d.total || 0;
    });

    const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));

    if (days.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--mono-text-muted);">No data available</div>';
        return;
    }

    const labels = days.map(([day]) => {
        const d = new Date(day);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const values = days.map(([, tokens]) => tokens);
    const maxVal = Math.max(...values);

    // Calculate bar widths based on value (normalized between 0.3 and 1.0)
    const widths = values.map(v => 0.3 + (v / maxVal) * 0.7);

    const mobile = isCompactViewport();
    const data = [{
        type: 'bar',
        y: labels,
        x: values,
        orientation: 'h',
        text: values.map(v => fmtNum(v)),
        textposition: mobile ? 'inside' : 'outside',
        insidetextanchor: 'end',
        cliponaxis: false,
        marker: {
            color: values.map((v) => {
                const intensity = v / maxVal;
                return `rgba(251, 191, 36, ${0.4 + intensity * 0.6})`;
            }),
            line: {
                color: 'rgba(251, 191, 36, 0.8)',
                width: 1
            }
        },
        // Use width to vary bar thickness
        width: widths,
        hovertemplate: '<b>%{y}</b><br>%{x:,.0f} tokens<extra></extra>'
    }];

    const layout = {
        ...getPlotlyLayout(),
        margin: mobile ? { t: 16, r: 24, b: 40, l: 56 } : { t: 20, r: 96, b: 40, l: 70 },
        xaxis: {
            title: 'Tokens',
            showgrid: true,
            gridcolor: 'rgba(115,115,115,0.2)',
            fixedrange: true,
            automargin: true
        },
        yaxis: {
            automargin: true,
            tickfont: { size: mobile ? 10 : 11 },
            fixedrange: true
        },
        bargap: 0.15,
        dragmode: false
    };

    Plotly.newPlot('calendar-container', data, layout, {
        displayModeBar: false,
        responsive: true,
        staticPlot: false  // Keep clicks enabled for the click handler
    });

    // Bind one click handler so repeated renders don't stack notifications.
    const chartEl = document.getElementById('calendar-container');
    bindPlotlyClick(chartEl, (event) => {
        const dayIndex = event.points[0].pointNumber;
        const [fullDate, tokens] = days[dayIndex];
        const date = new Date(fullDate);
        const formattedDate = date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });

        notify(`${formattedDate}: ${fmtNum(tokens)} tokens`, 'info');
    });
}
