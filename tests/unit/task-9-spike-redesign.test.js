/**
 * @jest-environment jsdom
 */
import {
    spikeRatioLevel,
    computeSeriesStats,
    computeZScore,
    renderSpikesList,
    renderInvestigation,
    toggleSpikeSession
} from '../../dashboard/js/views/analytics';
import { historyData, setHistoryData } from '../../dashboard/js/state';

describe('spikeRatioLevel', () => {
    it('classes >=5 as high, >=3 as medium, below as low', () => {
        expect(spikeRatioLevel(6)).toBe('high');
        expect(spikeRatioLevel('5.0')).toBe('high');
        expect(spikeRatioLevel(4)).toBe('medium');
        expect(spikeRatioLevel(3)).toBe('medium');
        expect(spikeRatioLevel(2)).toBe('low');
        expect(spikeRatioLevel('n/a')).toBe('low');
    });
});

describe('computeSeriesStats', () => {
    it('computes mean and std of historical total values', () => {
        const series = [{ total: 100 }, { total: 200 }, { total: 300 }];
        const stats = computeSeriesStats(series);
        expect(stats.mean).toBeCloseTo(200);
        expect(stats.std).toBeCloseTo(81.64, 1);
    });

    it('returns zeros for empty input', () => {
        const stats = computeSeriesStats([]);
        expect(stats.mean).toBe(0);
        expect(stats.std).toBe(0);
        expect(stats.count).toBe(0);
    });

    it('returns std 0 when values are constant', () => {
        const stats = computeSeriesStats([{ total: 50 }, { total: 50 }]);
        expect(stats.std).toBe(0);
    });
});

describe('computeZScore', () => {
    it('measures distance from mean in std units', () => {
        const stats = { mean: 200, std: 100 };
        expect(computeZScore(300, stats)).toBeCloseTo(1);
        expect(computeZScore(200, stats)).toBeCloseTo(0);
    });

    it('returns 0 when std is 0 to avoid divide-by-zero', () => {
        expect(computeZScore(999, { mean: 5, std: 0 })).toBe(0);
    });
});

describe('renderSpikesList DOM', () => {
    beforeEach(() => setHistoryData([{ total: 100000 }, { total: 120000 }, { total: 110000 }]));
    afterEach(() => setHistoryData([]));

    it('renders a spike-card per spike with ratio badge and stats', () => {
        document.body.innerHTML = '<div id="spikes-list"></div>';
        const spikes = [{ time: 1700000000000, tokens: 500000, ratio: '5.0', previousAvg: 100000 }];
        renderSpikesList(spikes);
        const cards = document.querySelectorAll('.spike-card');
        expect(cards.length).toBe(1);
        expect(cards[0].classList.contains('high')).toBe(true);
        expect(cards[0].querySelector('.spike-ratio-badge').textContent).toContain('5x');
        expect(cards[0].querySelectorAll('.spike-stat').length).toBe(3);
        expect(cards[0].getAttribute('onclick')).toContain('investigateSpike(1700000000000)');
    });

    it('shows empty state when no spikes', () => {
        document.body.innerHTML = '<div id="spikes-list"></div>';
        renderSpikesList([]);
        expect(document.getElementById('spikes-list').textContent).toContain('No significant spikes');
    });
});

describe('renderInvestigation DOM', () => {
    it('renders summary grid, source pills, and collapsible accordions', () => {
        document.body.innerHTML = '<div id="spike-details"></div><div id="spike-sessions"></div>';
        const data = {
            summary: { totalSessions: 2, totalTokens: 3000, totalCost: 1.5, topModel: 'anthropic/claude-opus-4' },
            sessions: [{ id: 'abc123', tokens: 2000, cost: 1.0, models: ['anthropic/claude-opus-4'], previews: ['hello world preview'] }]
        };
        renderInvestigation(data);
        expect(document.querySelectorAll('.investigation-grid .detail-item').length).toBe(4);
        expect(document.querySelector('.source-pill').textContent).toContain('claude-opus-4');
        const accordion = document.querySelector('.session-accordion');
        expect(accordion).not.toBeNull();
        expect(accordion.querySelector('.preview-card').textContent).toContain('hello world preview');
        expect(document.getElementById('spike-session-body-0').style.display).toBe('none');
    });
});

describe('toggleSpikeSession', () => {
    it('toggles accordion body visibility and aria-expanded', () => {
        document.body.innerHTML = `
            <div class="session-accordion">
                <div class="session-accordion-header" aria-expanded="false">
                    <span class="session-toggle">▼</span>
                </div>
                <div class="session-accordion-body" id="spike-session-body-0" style="display:none;"></div>
            </div>`;
        toggleSpikeSession(0);
        const body = document.getElementById('spike-session-body-0');
        expect(body.style.display).toBe('block');
        expect(document.querySelector('.session-accordion-header').getAttribute('aria-expanded')).toBe('true');
        toggleSpikeSession(0);
        expect(body.style.display).toBe('none');
    });
});
