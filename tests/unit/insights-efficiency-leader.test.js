import { describe, expect, it, beforeEach } from 'bun:test';
import { calculateDeepInsights } from '../../dashboard/js/views/analytics/tabs/insights.js';
import { setCurrentData, setHistoryData, setFileHistoricalData } from '../../dashboard/js/state.js';

describe('Most Efficient Model insight - free-model ranking (#118 finding 5)', () => {
    beforeEach(() => {
        setHistoryData([]);
        setFileHistoricalData([]);
    });

    it('never reports negative savings when a free model has low token volume', () => {
        // A prior "tokens / (cost || 1)" efficiency metric made a free
        // model's rank disagree with its own $/1M rate: with cost=0 that
        // metric degenerates to a raw token count, so a free model with low
        // volume (mimo-v2.5-free here) could rank "worst" by that metric
        // while its real costPer1M (0) was still cheaper than the model
        // ranked "best" — producing a negative "savings" ($-0.00) from
        // switching away from the very model that was actually cheapest.
        setCurrentData({
            tokens_by_model: {
                'mimo-v2.5-free': { total: 10_000 },
                'anthropic/claude-sonnet-5': { total: 5_000_000 }
            },
            costs_by_model: {
                'mimo-v2.5-free': { total: 0 },
                'anthropic/claude-sonnet-5': { total: 5 }
            },
            total_tokens: 5_010_000,
            total_input: 0,
            total_cache_read: 0,
            total_cache_write: 0,
            total_cost: { total: 5 },
            files_processed: 0,
            total_lines: 0
        });

        const insights = calculateDeepInsights();
        const insight = insights.find(i => i.title === 'Most Efficient Model');
        expect(insight).toBeDefined();

        // The free model has the lowest real $/1M rate, so it must win.
        expect(insight.value).toBe('mimo-v2.5-free');

        const match = insight.detail.match(/save ~\$(-?[\d.]+) per 1M tokens/);
        expect(match).not.toBeNull();
        const savings = parseFloat(match[1]);
        expect(savings).toBeGreaterThanOrEqual(0);
    });

    it('labels the rate as an effective/blended rate, not the model sticker price (#118 finding 6)', () => {
        // A heavily-cached model's blended $/1M-total-tokens rate can sit
        // far below its sticker input/output pricing shown on the Models
        // tab (e.g. $0.07 effective vs $0.300 in / $1.20 out sticker) once
        // cheap cache-read tokens dominate the actual usage mix. That's not
        // a pricing-source bug, but the description must say so, or the two
        // numbers read as contradictory pricing sources for the same model.
        setCurrentData({
            tokens_by_model: {
                'minimax/MiniMax-M3': { input: 15_693_056, output: 1_055_997, cache_read: 314_417_035, total: 331_166_088 }
            },
            costs_by_model: {
                'minimax/MiniMax-M3': { total: 24.8401353 }
            },
            total_tokens: 331_166_088,
            total_input: 15_693_056,
            total_cache_read: 314_417_035,
            total_cache_write: 0,
            total_cost: { total: 24.8401353 },
            files_processed: 0,
            total_lines: 0
        });

        const insights = calculateDeepInsights();
        const insight = insights.find(i => i.title === 'Most Efficient Model');
        expect(insight).toBeDefined();
        expect(insight.description).toContain('$0.08 per 1M tokens'); // ~$0.075 blended, matching the reported figure
        expect(insight.description.toLowerCase()).toContain('effective');
        expect(insight.description.toLowerCase()).toContain('cache');
    });
});
