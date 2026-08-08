import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderCalendarTab } from '../../dashboard/js/views/analytics/tabs/calendar.js';
import { setFileHistoricalData, setHistoryData } from '../../dashboard/js/state.js';

const DAY = 24 * 3600 * 1000;
const d = (isoDay) => new Date(`${isoDay}T00:00:00.000Z`).getTime();

describe('renderCalendarTab gap markers (#118 finding 10)', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="calendar-container"></div>';
        global.Plotly = { newPlot: mock(() => Promise.resolve()) };
        setFileHistoricalData([]);
        setHistoryData([]);
    });

    afterEach(() => {
        delete global.Plotly;
        setFileHistoricalData([]);
        setHistoryData([]);
    });

    function renderAndGetTrace() {
        const container = document.getElementById('calendar-container');
        renderCalendarTab(container);
        return global.Plotly.newPlot.mock.calls[0][1][0];
    }

    it('inserts a spacer row when two data days are more than 3 days apart', () => {
        // A ~100-day hole between Apr 17 and Jul 9-equivalent gap, scaled
        // down here to keep the fixture small: day 0 and day 20.
        setFileHistoricalData([
            { time: d('2026-01-01'), total: 1000 },
            { time: d('2026-01-21'), total: 2000 }
        ]);
        const trace = renderAndGetTrace();
        expect(trace.y).toHaveLength(3); // day, gap, day
        expect(trace.y[1]).toContain('gap');
        expect(trace.x[1]).toBe(0); // gap row carries no token value
    });

    it('does not insert a spacer row for consecutive or near-consecutive days', () => {
        setFileHistoricalData([
            { time: d('2026-01-01'), total: 1000 },
            { time: d('2026-01-02'), total: 2000 },
            { time: d('2026-01-04'), total: 3000 } // 2-day gap, under the 3-day threshold
        ]);
        const trace = renderAndGetTrace();
        expect(trace.y).toHaveLength(3);
        expect(trace.y.some((label) => label.includes('gap'))).toBe(false);
    });

    it('reports the correct number of missing days in the gap label', () => {
        setFileHistoricalData([
            { time: d('2026-01-01'), total: 1000 },
            { time: d('2026-01-01') + 10 * DAY, total: 2000 } // 9 days with no data in between
        ]);
        const trace = renderAndGetTrace();
        expect(trace.y[1]).toContain('9d gap');
    });
});
