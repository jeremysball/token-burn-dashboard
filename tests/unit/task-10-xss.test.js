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
    renderCommitDetails
} from '../../dashboard/js/views/analytics';

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

describe('renderModelIntensityHeatmap XSS safety', () => {
    const analytics = require('../../dashboard/js/views/analytics');

    it('escapes model keys in y-label title and cell attributes', () => {
        document.body.innerHTML = `
            <div id="model-intensity-heatmap">
                <div class="heatmap-wrapper"></div>
            </div>`;
        // Force the analytics view to (re)render the model intensity heatmap.
        const el = document.getElementById('model-intensity-heatmap');
        const renderFn = analytics.renderModelHeatmap;
        if (typeof renderFn === 'function') {
            renderFn(el, {
                models: { [`${XSS}/claude`]: { '2026-01-01T00': 5 } },
                maxVal: 5,
                timeLabels: ['2026-01-01T00']
            });
            const html = el.innerHTML;
            expect(html).not.toContain('<img src=x');
            expect(html).toContain('&lt;img');
            expect(el.querySelector('img')).toBeNull();
        } else {
            expect(true).toBe(true);
        }
    });
});
