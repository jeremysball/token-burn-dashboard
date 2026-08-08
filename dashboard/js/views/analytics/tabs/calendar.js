import { fmtNum, historyData, fileHistoricalData, isCompactViewport, getPlotlyLayout, bindPlotlyClick, notify } from './shared.js';

// A categorical y-axis spaces every row evenly regardless of the real
// calendar distance between them, so a multi-month hole in the data (no
// files touched, dashboard not open) sits flush between two bars and reads
// as continuous daily activity instead of a gap. Any run of missing days
// at least this long gets an explicit spacer row instead.
const GAP_THRESHOLD_DAYS = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @typedef {{day: string, tokens: number, gap?: false}} DayEntry
 * @typedef {{gap: true, days: number}} GapEntry
 */

/**
 * Insert a spacer entry wherever two adjacent (sorted ascending) days are
 * more than GAP_THRESHOLD_DAYS apart.
 * @param {Array<[string, number]>} sortedDays
 * @returns {Array<DayEntry|GapEntry>}
 */
function withGapMarkers(sortedDays) {
    /** @type {Array<DayEntry|GapEntry>} */
    const out = [];
    for (let i = 0; i < sortedDays.length; i++) {
        const [day, tokens] = sortedDays[i];
        if (i > 0) {
            const prevDay = sortedDays[i - 1][0];
            const gapDays = Math.round((new Date(day).getTime() - new Date(prevDay).getTime()) / MS_PER_DAY);
            if (gapDays > GAP_THRESHOLD_DAYS) {
                out.push({ gap: true, days: gapDays - 1 });
            }
        }
        out.push({ day, tokens });
    }
    return out;
}

/**
 * @param {HTMLElement|null|undefined} container
 */
export function renderCalendarTab(container) {
    if (!container) container = document.getElementById('calendar-container');
    /** @type {any} */
    const Plotly = /** @type {any} */ (globalThis)['Plotly'];
    if (!container || !Plotly) return;

    // Use ALL available data
    const sourceData = fileHistoricalData.length > 0 ? fileHistoricalData : historyData;

    // Group by day
    /** @type {Record<string, number>} */
    const byDay = {};
    sourceData.forEach(d => {
        const day = new Date(d.time).toISOString().split('T')[0];
        if (!byDay[day]) byDay[day] = 0;
        byDay[day] += d.total || 0;
    });

    const sortedDays = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));

    if (sortedDays.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--mono-text-muted);">No data available</div>';
        return;
    }

    const rows = withGapMarkers(sortedDays);

    const labels = rows.map((row) => {
        if (row.gap) return `⋯ ${fmtNum(row.days)}d gap ⋯`;
        return new Date(row.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    });
    const values = rows.map((row) => row.gap ? 0 : row.tokens);
    const maxVal = Math.max(...values, 1);

    // Calculate bar widths based on value (normalized between 0.3 and 1.0);
    // gap rows get a hairline width regardless of value so they read as a
    // spacer, not a zero-token day.
    const widths = rows.map((row, i) => row.gap ? 0.1 : 0.3 + (values[i] / maxVal) * 0.7);

    const mobile = isCompactViewport();
    const data = [{
        type: 'bar',
        y: labels,
        x: values,
        orientation: 'h',
        text: rows.map((row, i) => row.gap ? '' : fmtNum(values[i])),
        textposition: mobile ? 'inside' : 'outside',
        insidetextanchor: 'end',
        cliponaxis: false,
        marker: {
            color: rows.map((row, i) => {
                if (row.gap) return 'rgba(115, 115, 115, 0.25)';
                const intensity = values[i] / maxVal;
                return `rgba(251, 191, 36, ${0.4 + intensity * 0.6})`;
            }),
            line: {
                color: rows.map((row) => row.gap ? 'rgba(115, 115, 115, 0.4)' : 'rgba(251, 191, 36, 0.8)'),
                width: 1
            }
        },
        // Use width to vary bar thickness
        width: widths,
        hovertemplate: rows.map((row) => row.gap
            ? `<b>%{y}</b><br>no data in this range<extra></extra>`
            : '<b>%{y}</b><br>%{x:,.0f} tokens<extra></extra>')
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
        // Plotly declutters categorical tick labels it can't fit at a fixed
        // container height, and it was silently dropping gap-marker rows
        // among dense clusters of real days - the exact rows meant to
        // catch the eye. Give each row a fixed pixel allowance instead of
        // leaving the container's default (fixed) height to force that.
        height: Math.max(400, rows.length * (mobile ? 18 : 22)),
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
    bindPlotlyClick(chartEl, /** @param {any} event */ (event) => {
        const row = rows[event.points[0].pointNumber];
        if (row.gap) {
            notify(`No data for ${fmtNum(row.days)} day${row.days === 1 ? '' : 's'}`, 'info');
            return;
        }
        const date = new Date(row.day);
        const formattedDate = date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: 'UTC'
        });

        notify(`${formattedDate}: ${fmtNum(row.tokens)} tokens`, 'info');
    });
}
