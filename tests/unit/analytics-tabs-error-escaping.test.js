/**
 * @jest-environment jsdom
 *
 * Task 4 regression tests: every catch-block that renders err.message into
 * innerHTML must escape the message first. 4 sites across git.js and spikes.js.
 */
Element.prototype.scrollIntoView = jest.fn();

import {
    loadGitBlame,
    showCommitDetails,
    loadSpikes,
    investigateSpike
} from '../../dashboard/js/views/analytics';

const XSS_MSG = '<img src=x onerror=alert(1)>';

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

// ========== git.js: loadGitBlame catch ==========

describe('loadGitBlame error escaping', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <select id="git-days-selector"><option value="30">30d</option></select>
            <select id="git-directory-selector"><option value="">All</option></select>
            <div id="git-commits-list"></div>
            <div id="git-files-list"></div>
        `;
    });

    it('escapes err.message in git-commits-list so markup is not injected', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error(XSS_MSG)));

        await loadGitBlame();

        const html = document.getElementById('git-commits-list').innerHTML;
        expect(html).toContain('&lt;img src=x');
        expect(html).not.toContain('<img');
        expect(document.getElementById('git-commits-list').querySelector('img')).toBeNull();
    });
});

// ========== git.js: showCommitDetails catch ==========

describe('showCommitDetails error escaping', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <select id="git-days-selector"><option value="30">30d</option></select>
            <div id="commit-details-modal" style="display:none;"></div>
            <div id="commit-details-content"></div>
        `;
    });

    it('escapes err.message in commit-details-error so markup is not injected', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error(XSS_MSG)));

        await showCommitDetails('abc123');

        const content = document.getElementById('commit-details-content');
        const html = content.innerHTML;
        expect(html).toContain('&lt;img src=x');
        expect(html).not.toContain('<img');
        expect(content.querySelector('img')).toBeNull();
    });
});

// ========== spikes.js: loadSpikes catch ==========

describe('loadSpikes error escaping', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="spikes-list"></div>';
    });

    it('escapes err.message in spikes-list so markup is not injected', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error(XSS_MSG)));

        await loadSpikes();

        const list = document.getElementById('spikes-list');
        const html = list.innerHTML;
        expect(html).toContain('&lt;img src=x');
        expect(html).not.toContain('<img');
        expect(list.querySelector('img')).toBeNull();
    });
});

// ========== spikes.js: investigateSpike catch ==========

describe('investigateSpike error escaping', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="spike-investigation" style="display:none;"></div>
            <div id="spike-details"></div>
            <div id="spike-sessions"></div>
        `;
    });

    it('escapes err.message in spike-details so markup is not injected', async () => {
        global.fetch = jest.fn(() => Promise.reject(new Error(XSS_MSG)));

        await investigateSpike(1700000000000);

        const details = document.getElementById('spike-details');
        const html = details.innerHTML;
        expect(html).toContain('&lt;img src=x');
        expect(html).not.toContain('<img');
        expect(details.querySelector('img')).toBeNull();
    });
});
