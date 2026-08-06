import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderTimelineTab } from '../../dashboard/js/views/analytics/tabs/timeline.js';
import { analyticsRange, setAnalyticsRange, setFileHistoricalData, setHistoryData } from '../../dashboard/js/state.js';

const HOUR = 3600 * 1000;
const h = (hour) => hour * HOUR;
const originalDateNow = Date.now;

describe('renderTimelineTab dead-air provenance', () => {
    let originalAnalyticsRange;

    beforeEach(() => {
        originalAnalyticsRange = analyticsRange;
        Date.now = () => h(16);
        document.body.innerHTML = '';
        global.Plotly = { newPlot: mock(() => Promise.resolve()) };
        setAnalyticsRange('all');
        setFileHistoricalData([]);
        setHistoryData([]);
    });

    afterEach(() => {
        Date.now = originalDateNow;
        setAnalyticsRange(originalAnalyticsRange);
        delete global.Plotly;
        setFileHistoricalData([]);
        setHistoryData([]);
    });

    function render(source) {
        const container = document.createElement('div');
        document.body.appendChild(container);
        source();
        renderTimelineTab(container);
        return global.Plotly.newPlot.mock.calls[0][2];
    }

    it('adds dead-air shapes and annotations only for file-backed history', () => {
        const fileLayout = render(() => setFileHistoricalData([{ time: h(9), total: 100 }, { time: h(13), total: 100 }]));
        expect(fileLayout.shapes).toHaveLength(1);
        expect(fileLayout.annotations).toHaveLength(1);

        global.Plotly.newPlot.mockClear();
        setFileHistoricalData([]);
        const sseLayout = render(() => setHistoryData([{ time: h(9), total: 100 }, { time: h(13), total: 100 }]));
        expect(sseLayout.shapes).toEqual([]);
        expect(sseLayout.annotations).toEqual([]);
    });

    it('renders one file-backed bucket through the trailing chart boundary', () => {
        const layout = render(() => setFileHistoricalData([{ time: h(9), total: 100 }]));
        expect(global.Plotly.newPlot).toHaveBeenCalledTimes(1);
        expect(layout.shapes).toHaveLength(1);
        expect(layout.shapes[0].x0).toEqual(new Date(h(10)));
        expect(layout.shapes[0].x1).toEqual(new Date(h(16)));
        expect(layout.xaxis.range[1]).toEqual(new Date(h(16)));
    });
});
