/**
 * @jest-environment jsdom
 */
Element.prototype.scrollIntoView = jest.fn();

import {
    spikeRatioLevel,
    computeSeriesStats,
    computeZScore,
    renderSpikesList,
    renderInvestigation,
    toggleSpikeSession,
    investigateSpike,
    closeInvestigation
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
        expect(cards[0].getAttribute('onclick')).toBeNull();
        expect(cards[0].dataset.spikeIndex).toBe('0');
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

describe('renderInvestigation XSS safety', () => {
    it('escapes model-derived text so markup is not injected', () => {
        document.body.innerHTML = '<div id="spike-details"></div><div id="spike-sessions"></div>';
        const data = {
            summary: { totalSessions: 1, totalTokens: 100, totalCost: 0.5, topModel: '<img src=x onerror=alert(1)>' },
            sessions: []
        };
        renderInvestigation(data);
        const topModelCell = document.querySelectorAll('.investigation-grid .detail-item')[3].querySelector('.detail-value');
        const topModel = topModelCell.innerHTML;
        expect(topModel).toContain('&lt;img');
        expect(topModelCell.querySelector('img')).toBeNull();
    });
});

describe('renderSpikesList safety', () => {
    beforeEach(() => setHistoryData([{ total: 100000 }]));
    afterEach(() => setHistoryData([]));

    it('skips spikes with non-finite time and never emits inline JS', () => {
        document.body.innerHTML = '<div id="spikes-list"></div>';
        const spikes = [
            { time: 1700000000000, tokens: 500000, ratio: '5.0', previousAvg: 100000 },
            { time: 'not-a-number', tokens: 200000, ratio: '2.0', previousAvg: 100000 },
            { time: NaN, tokens: 100000, ratio: '1.0', previousAvg: 100000 }
        ];
        renderSpikesList(spikes);
        const cards = document.querySelectorAll('.spike-card');
        expect(cards.length).toBe(1);
        expect(cards[0].getAttribute('onclick')).toBeNull();
        expect(cards[0].dataset.spikeIndex).toBe('0');
    });

    it('keeps spike-ratio-badge off the card; only the inner badge carries it', () => {
        document.body.innerHTML = '<div id="spikes-list"></div>';
        renderSpikesList([{ time: 1700000000000, tokens: 500000, ratio: '5.0', previousAvg: 100000 }]);
        const card = document.querySelector('.spike-card');
        expect(card.classList.contains('spike-ratio-badge')).toBe(false);
        expect(card.classList.contains('high')).toBe(true);
        expect(card.querySelector('.spike-ratio-badge').classList.contains('high')).toBe(true);
    });

    it('renders empty state when all spikes have invalid timestamps', () => {
        document.body.innerHTML = '<div id="spikes-list"></div>';
        renderSpikesList([
            { time: 'not-a-number', tokens: 200000, ratio: '2.0', previousAvg: 100000 },
            { time: NaN, tokens: 100000, ratio: '1.0', previousAvg: 100000 }
        ]);
        expect(document.querySelectorAll('.spike-card').length).toBe(0);
        expect(document.getElementById('spikes-list').textContent).toContain('No significant spikes detected');
    });

    it('activates investigation via click and keyboard (Enter/Space) without inline handlers', () => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ summary: { totalSessions: 0, totalTokens: 0, totalCost: 0, topModel: 'unknown' }, sessions: [] })
        }));
        document.body.innerHTML = '<div id="spikes-list"></div><div id="spike-investigation" style="display:none;"></div><div id="spike-details"></div><div id="spike-sessions"></div>';
        const spikes = [{ time: 1700000000000, tokens: 500000, ratio: '5.0', previousAvg: 100000 }];
        renderSpikesList(spikes);
        const card = document.querySelector('.spike-card');
        expect(card.getAttribute('onclick')).toBeNull();
        card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const enterEvt = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        card.dispatchEvent(enterEvt);
        expect(enterEvt.defaultPrevented).toBe(true);
        const spaceEvt = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        card.dispatchEvent(spaceEvt);
        expect(spaceEvt.defaultPrevented).toBe(true);
    });
});

describe('investigateSpike fetch + close', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = jest.fn();
        document.body.innerHTML = `
            <div id="spike-investigation" style="display:none;"></div>
            <div id="spike-details"></div>
            <div id="spike-sessions"></div>`;
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                summary: { totalSessions: 1, totalTokens: 100, totalCost: 0.5, topModel: 'anthropic/claude-opus-4' },
                sessions: [{ id: 'abc', tokens: 100, cost: 0.5, models: [], previews: ['hi'] }]
            })
        }));
    });

    it('fetches investigation and renders into details/sessions', async () => {
        await investigateSpike(1700000000000);
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/spikes/investigate?timestamp=1700000000000'));
        expect(document.getElementById('spike-investigation').style.display).toBe('block');
        expect(document.querySelectorAll('.session-accordion').length).toBe(1);
    });

    it('shows error when fetch fails', async () => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));
        await investigateSpike(1700000000000);
        expect(document.getElementById('spike-details').textContent).toContain('Error');
    });

    it('closeInvestigation hides the panel', () => {
        document.getElementById('spike-investigation').style.display = 'block';
        closeInvestigation();
        expect(document.getElementById('spike-investigation').style.display).toBe('none');
    });
});

describe('accordion keyboard activation', () => {
    it('toggles on Enter and Space', () => {
        document.body.innerHTML = '<div id="spike-details"></div><div id="spike-sessions"></div>';
        renderInvestigation({
            summary: { totalSessions: 1, totalTokens: 100, totalCost: 0.5, topModel: 'unknown' },
            sessions: [{ id: 'abc', tokens: 100, cost: 0.5, models: [], previews: ['hi'] }]
        });
        const header = document.querySelector('.session-accordion-header');
        const fire = (key) => header.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        fire('Enter');
        expect(document.getElementById('spike-session-body-0').style.display).toBe('block');
        fire(' ');
        expect(document.getElementById('spike-session-body-0').style.display).toBe('none');
    });
});
