/**
 * @jest-environment jsdom
 */
process.env.TZ = 'America/Los_Angeles';

import { renderCalendarTab } from '../../dashboard/js/views/analytics/tabs/calendar.js';
import { calculateDeepInsights } from '../../dashboard/js/views/analytics/tabs/insights.js';
import { setCurrentData, setHistoryData, setFileHistoricalData } from '../../dashboard/js/state.js';

describe('UTC presentation', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        global.Plotly = {
            newPlot: jest.fn(() => Promise.resolve()),
            react: jest.fn(() => Promise.resolve())
        };
        setCurrentData({
            total_tokens: 0,
            total_cost: { total: 0 },
            tokens_by_model: {},
            costs_by_model: {},
            files_processed: 0,
            total_lines: 0
        });
        setHistoryData([]);
        setFileHistoricalData([]);
    });

    afterEach(() => {
        delete global.Plotly;
    });

    it('calendar labels use UTC day, not viewer-local day', () => {
        // 2026-07-10T05:00:00Z is Jul 9 22:00 in Los Angeles.
        setFileHistoricalData([{ time: Date.UTC(2026, 6, 10, 5), total: 1000 }]);

        const container = document.createElement('div');
        container.id = 'calendar-container';
        document.body.appendChild(container);

        renderCalendarTab(container);

        // The function uses Plotly to render; the labels are passed in the trace data.
        expect(global.Plotly.newPlot).toHaveBeenCalledTimes(1);
        const [, data] = global.Plotly.newPlot.mock.calls[0];
        const labels = data[0].y;
        const text = labels.join(' ');
        // UTC day: Jul 10. Local (LA): Jul 9.
        expect(text).toContain('Jul 10');
        expect(text).not.toContain('Jul 9');
    });

    it('peak hour insight uses UTC hour, not viewer-local hour', () => {
        // 2026-07-10T07:00:00Z is midnight (00:00) in Los Angeles.
        setCurrentData({
            total_tokens: 1000,
            total_input: 1000,
            total_output: 0,
            total_cache_read: 0,
            total_cost: { input: 3, output: 0, total: 3 },
            tokens_by_model: { 'anthropic/claude': { total: 1000, input: 1000 } },
            costs_by_model: { 'anthropic/claude': { total: 3 } },
            files_processed: 1,
            total_lines: 10
        });
        setHistoryData([
            { time: Date.UTC(2026, 6, 10, 7), total: 1000 }
        ]);

        const insights = calculateDeepInsights();
        const peak = insights.find(i => i.title === 'Peak Hour');
        expect(peak).toBeDefined();
        // UTC hour: 7. Local (LA): 0.
        expect(peak.value).toBe('7:00');
    });
});
