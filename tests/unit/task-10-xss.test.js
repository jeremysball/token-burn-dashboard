/**
 * @jest-environment jsdom
 *
 * Task 10 review-fix regressions: model/commit-derived text rendered into the
 * analytics views must be HTML-escaped, and commit rows must not emit inline
 * JavaScript carrying attacker-controlled commit hashes.
 */
Element.prototype.scrollIntoView = jest.fn();

import {
    renderInsightsCards,
    renderGitBlameData,
    renderCommitDetails,
    renderModelHeatmap,
    renderModelsTab,
    calculateDeepInsights
} from '../../dashboard/js/views/analytics';
import * as state from '../../dashboard/js/state';

const XSS = '<img src=x onerror=alert(1)>';

describe('renderInsightsCards XSS safety', () => {
    it('escapes model-derived title/value/description/detail/icon', () => {
        document.body.innerHTML = '<div id="ins"></div>';
        const container = document.getElementById('ins');
        renderInsightsCards(container, [{
            icon: XSS,
            title: XSS,
            value: XSS,
            description: XSS,
            detail: XSS
        }]);
        expect(container.querySelector('img')).toBeNull();
        expect(container.innerHTML).toContain('&lt;img');
        expect(container.innerHTML).not.toContain('<img');
    });
});

describe('renderGitBlameData commit-list safety', () => {
    const baseCommit = (over = {}) => ({
        hash: 'abc1234',
        message: 'normal commit',
        files: ['/workspace/a/b.js'],
        cost: 1.23,
        tokens: 1000,
        sessions: 1,
        ...over
    });

    const mountGitBlameDom = () => {
        document.body.innerHTML = `
            <span id="git-total-commits"></span>
            <span id="git-total-cost"></span>
            <span id="git-total-sessions"></span>
            <div id="git-commits-list"></div>
            <div id="git-files-list"></div>`;
    };

    it('escapes malicious commit hash and message; no injected markup', () => {
        mountGitBlameDom();
        renderGitBlameData({
            commits: [baseCommit({ hash: XSS, message: XSS })],
            projects: []
        });
        const list = document.getElementById('git-commits-list');
        expect(list.querySelector('img')).toBeNull();
        expect(list.innerHTML).toContain('&lt;img');
    });

    it('does not emit an inline onclick handler carrying the commit hash', () => {
        mountGitBlameDom();
        const evilHash = "x'); alert(1); ('";
        renderGitBlameData({
            commits: [baseCommit({ hash: evilHash })],
            projects: []
        });
        const item = document.querySelector('.git-commit-item');
        // No inline handler at all: the hash cannot break out into executable JS.
        expect(item.getAttribute('onclick')).toBeNull();
        expect(item.dataset.commitIndex).toBe('0');
        // The hash is rendered as inert escaped text, never a live script/img/etc.
        expect(item.querySelector('script')).toBeNull();
        expect(item.querySelector('img')).toBeNull();
    });

    it('click still opens commit details for the correct hash', () => {
        mountGitBlameDom();
        document.body.innerHTML += '<div id="commit-details-modal"></div><div id="commit-details-content"></div>';
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                commit: { hash: 'deadbee', message: 'm', date: Date.now() },
                sessions: [],
                summary: { totalSessions: 0, totalTokens: 0, totalCost: 0 }
            })
        }));
        renderGitBlameData({ commits: [baseCommit({ hash: 'deadbee' })], projects: [] });
        const item = document.querySelector('.git-commit-item');
        expect(item.dataset.commitIndex).toBe('0');
        item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('commit=deadbee'));
    });

    it('activates via keyboard (Enter/Space) without inline handlers', () => {
        mountGitBlameDom();
        document.body.innerHTML += '<div id="commit-details-modal"></div><div id="commit-details-content"></div>';
        global.fetch = jest.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
                commit: { hash: 'abc1234', message: 'm', date: Date.now() },
                sessions: [],
                summary: { totalSessions: 0, totalTokens: 0, totalCost: 0 }
            })
        }));
        renderGitBlameData({ commits: [baseCommit()], projects: [] });
        const item = document.querySelector('.git-commit-item');
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        item.dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(true);
        const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
        item.dispatchEvent(space);
        expect(space.defaultPrevented).toBe(true);
    });
});

describe('renderCommitDetails XSS safety', () => {
    it('escapes malicious commit hash and model names', () => {
        document.body.innerHTML = '<div id="content"></div>';
        const container = document.getElementById('content');
        renderCommitDetails(container, {
            commit: { hash: XSS, message: 'msg', date: Date.now() },
            sessions: [{
                id: XSS,
                cost: 1,
                tokens: 100,
                models: { [`${XSS}/model`]: { tokens: 10, calls: 1, cost: 0.5 } },
                messages: [{ model: `${XSS}/m`, cost: 0.1, tokens: 5, preview: 'hi' }]
            }],
            summary: { totalSessions: 1, totalTokens: 100, totalCost: 1 }
        });
        // No live injected elements: the payload survives only as inert text.
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('script')).toBeNull();
        // The malicious commit hash is rendered as escaped text, not markup.
        const hashEl = container.querySelector('.commit-details-hash');
        expect(hashEl.querySelector('img')).toBeNull();
        expect(hashEl.textContent).toContain('<img');
    });

    it('wires session toggle via data attribute + listener, no inline onclick', () => {
        document.body.innerHTML = '<div id="content"></div>';
        const container = document.getElementById('content');
        renderCommitDetails(container, {
            commit: { hash: 'h', message: 'm', date: Date.now() },
            sessions: [{
                id: 's1',
                cost: 1,
                tokens: 100,
                models: {},
                messages: []
            }],
            summary: { totalSessions: 1, totalTokens: 100, totalCost: 1 }
        });
        const header = container.querySelector('.session-header[data-session-toggle]');
        expect(header).not.toBeNull();
        expect(header.getAttribute('onclick')).toBeNull();
        expect(header.dataset.sessionToggle).toBe('0');
        // Clicking must not throw (toggles the linked messages panel).
        expect(() => header.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    });
});

describe('renderModelHeatmap XSS safety', () => {
    it('escapes model keys in y-label title and cell attributes', () => {
        document.body.innerHTML = `
            <div id="model-intensity-heatmap">
                <div class="heatmap-wrapper"></div>
            </div>`;
        const el = document.getElementById('model-intensity-heatmap');
        // renderModelHeatmap is exported, so this assertion actually executes
        // (it previously fell into a no-op skip branch).
        expect(typeof renderModelHeatmap).toBe('function');
        renderModelHeatmap(el, [{
            time: '2026-01-01T00:00:00Z',
            models: { [`${XSS}/claude`]: 5 }
        }], 'tokens');
        // The malicious model key must not become a live <img> element.
        expect(el.querySelector('img')).toBeNull();
        expect(el.querySelector('script')).toBeNull();
        // The y-label's title attribute carries the escaped model key, which
        // must not be parsed into a live element (verified above). The raw
        // payload's tag is never created as DOM.
        const yLabel = el.querySelector('.heatmap-y-label');
        expect(yLabel.querySelector('img')).toBeNull();
        expect(yLabel.querySelector('script')).toBeNull();
    });
});

describe('renderModelsTab XSS safety', () => {
    it('escapes model-derived name, pricing title, badge and price summary', () => {
        document.body.innerHTML = '<table><tbody id="models-tbody"></tbody></table>';
        // currentData / historyData are injected via the real state setters
        // (ES module bindings are read-only from outside the module).
        state.setCurrentData({
            tokens_by_model: { [`${XSS}/claude`]: { total: 10, cache_read: 1 } },
            costs_by_model: { [`${XSS}/claude`]: { total: 0.5 } },
            total_tokens: 10
        });
        state.setHistoryData([]);

        renderModelsTab();

        const tbody = document.getElementById('models-tbody');
        // No live injected markup from the model key.
        expect(tbody.querySelector('img')).toBeNull();
        expect(tbody.querySelector('script')).toBeNull();
        // The malicious model key's payload segment never renders as a tag; the
        // displayed name (segment after the last '/') appears as inert text.
        expect(tbody.innerHTML).toContain('claude');
        expect(tbody.innerHTML).not.toContain('<img src=x');
        // Pricing title/badge/price values are escaped attributes, not raw markup.
        const badge = tbody.querySelector('.pricing-source-badge');
        expect(badge.getAttribute('title')).not.toContain('<');
        const price = tbody.querySelector('.model-price');
        expect(price.getAttribute('title')).not.toContain('<');
    });
});

describe('calculateDeepInsights finite-value guards', () => {
    const containsBadNumber = (str) =>
        typeof str === 'string' && (str.includes('Infinity') || str.includes('NaN'));

    it('renders finite I/O ratio when output tokens are zero', () => {
        state.setCurrentData({
            tokens_by_model: { 'anthropic/claude': { total: 100, cache_read: 0 } },
            costs_by_model: { 'anthropic/claude': { total: 1 } },
            total_tokens: 100,
            total_input: 100,
            total_output: 0
        });
        state.setHistoryData([]);

        const insights = calculateDeepInsights();
        const io = insights.find(i => i.title === 'I/O Pattern');
        expect(io).toBeDefined();
        expect(io.value).toBe('0.0:1');
        expect(containsBadNumber(io.value)).toBe(false);
        expect(containsBadNumber(io.description)).toBe(false);
    });

    it('renders finite peak share when history is all-zero', () => {
        state.setCurrentData({
            tokens_by_model: { 'anthropic/claude': { total: 0, cache_read: 0 } },
            costs_by_model: { 'anthropic/claude': { total: 0 } },
            total_tokens: 0,
            total_input: 0,
            total_output: 0
        });
        // All-zero history: every hour bucket is 0, totalBucketed = 0.
        state.setHistoryData([{ time: '2026-01-01T00:00:00Z', total: 0 }]);

        const insights = calculateDeepInsights();
        const peak = insights.find(i => i.title === 'Peak Hour');
        if (peak) {
            expect(peak.description).not.toMatch(/NaN%?/);
            expect(containsBadNumber(peak.description)).toBe(false);
        }
    });
});
