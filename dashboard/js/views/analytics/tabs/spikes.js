import {
    fmtNum, historyData, escapeHtml, displayModel
} from './shared.js';

// ===== SPIKE DETECTIVE TAB =====
/** @type {any|null} */
let spikesCache = null;

export const renderSpikeDetectiveTab = () => {
    if (spikesCache) {
        renderSpikesList(spikesCache);
        return;
    }
    loadSpikes();
};

export const loadSpikes = async () => {
    const listEl = document.getElementById('spikes-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="loading-placeholder">Analyzing for spikes...</div>';
    
    try {
        const response = await fetch('/api/spikes');
        if (!response.ok) throw new Error('Failed to load');
        
        const data = await response.json();
        spikesCache = data.spikes;
        renderSpikesList(spikesCache);
    } catch (err) {
        listEl.innerHTML = `<div class="loading-placeholder">Error: ${escapeHtml(/** @type {Error} */ (err).message)}</div>`;
    }
};

const RATIO_THRESHOLDS = { high: 5, medium: 3 };

/**
 * @param {number|string} ratio
 * @returns {string}
 */
export const spikeRatioLevel = (ratio) => {
    const r = typeof ratio === 'string' ? parseFloat(ratio) : ratio;
    if (!isFinite(r)) return 'low';
    if (r >= RATIO_THRESHOLDS.high) return 'high';
    if (r >= RATIO_THRESHOLDS.medium) return 'medium';
    return 'low';
};

/**
 * @param {any[]} series
 * @returns {{mean: number, std: number, count: number}}
 */
export const computeSeriesStats = (series) => {
    const values = (series || [])
        .map(/** @param {any} p */ p => (p && typeof p.total === 'number' ? p.total : null))
        .filter(/** @param {any} v */ v => v !== null);
    const n = values.length;
    if (n === 0) return { mean: 0, std: 0, count: 0 };
    const mean = values.reduce(/** @param {number} s @param {number} v */(s, v) => s + v, 0) / n;
    const variance = values.reduce(/** @param {number} s @param {number} v */(s, v) => s + (v - mean) ** 2, 0) / n;
    return { mean, std: Math.sqrt(variance), count: n };
};

/**
 * @param {number} value
 * @param {{mean: number, std: number}} stats
 * @returns {number}
 */
export const computeZScore = (value, stats) => {
    if (!stats || stats.std === 0 || !isFinite(stats.std)) return 0;
    return (value - stats.mean) / stats.std;
};

/**
 * @param {*} time
 * @returns {boolean}
 */
const isValidSpikeTime = (time) => typeof time === 'number' && isFinite(time) && time > 0;

/**
 * @param {any[]} spikes
 */
export const renderSpikesList = (spikes) => {
    const listEl = document.getElementById('spikes-list');
    if (!listEl) return;

    if (spikes.length === 0) {
        listEl.innerHTML = '<div class="loading-placeholder">No significant spikes detected</div>';
        return;
    }

    const stats = computeSeriesStats(historyData);
    const validSpikes = spikes.filter(spike => isValidSpikeTime(spike.time));

    if (validSpikes.length === 0) {
        listEl.innerHTML = '<div class="loading-placeholder">No significant spikes detected</div>';
        return;
    }

    listEl.innerHTML = validSpikes.map(/** @param {any} spike @param {number} idx */(spike, idx) => {
        const date = new Date(spike.time);
        const timeStr = date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        const ratio = typeof spike.ratio === 'string' ? parseFloat(spike.ratio) : spike.ratio;
        const level = spikeRatioLevel(ratio);
        const zScore = computeZScore(spike.tokens, stats);

        return `
            <div class="spike-card ${level}" data-spike-index="${idx}" role="button" tabindex="0" aria-label="Investigate spike at ${timeStr}">
                <div class="spike-card-head">
                    <div class="spike-time">${timeStr}</div>
                    <span class="spike-ratio-badge ${level}">${ratio}x</span>
                </div>
                <div class="spike-card-body">
                    <div class="spike-details-small">${fmtNum(spike.previousAvg)} → ${fmtNum(spike.tokens)} tokens</div>
                    <div class="spike-stats-row">
                        <span class="spike-stat" title="Z-score vs full history">
                            <span class="spike-stat-label">z</span>
                            <span class="spike-stat-value">${zScore.toFixed(1)}</span>
                        </span>
                        <span class="spike-stat" title="Mean tokens across history">
                            <span class="spike-stat-label">mean</span>
                            <span class="spike-stat-value">${fmtNum(Math.round(stats.mean))}</span>
                        </span>
                        <span class="spike-stat" title="Standard deviation across history">
                            <span class="spike-stat-label">σ</span>
                            <span class="spike-stat-value">${fmtNum(Math.round(stats.std))}</span>
                        </span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    /** @param {any} spike */ const trigger = (spike) => { if (isValidSpikeTime(spike.time)) investigateSpike(spike.time); };
    listEl.querySelectorAll('.spike-card').forEach(card => {
        const el = /** @type {HTMLElement} */ (card);
        const spike = validSpikes[Number(el.dataset.spikeIndex)];
        card.addEventListener('click', () => trigger(spike));
        card.addEventListener('keydown', /** @param {Event} e */(e) => {
            const ke = /** @type {KeyboardEvent} */ (e);
            if (ke.key === 'Enter' || ke.key === ' ') {
                e.preventDefault();
                trigger(spike);
            }
        });
    });
};

/**
 * @param {number} timestamp
 */
export const investigateSpike = async (timestamp) => {
    const investigationEl = document.getElementById('spike-investigation');
    const detailsEl = document.getElementById('spike-details');
    const sessionsEl = document.getElementById('spike-sessions');

    if (!investigationEl || !detailsEl || !sessionsEl) return;

    investigationEl.style.display = 'block';
    detailsEl.innerHTML = '<div class="loading-placeholder">Investigating...</div>';
    sessionsEl.innerHTML = '';

    // Scroll to investigation
    investigationEl.scrollIntoView({ behavior: 'smooth' });

    try {
        const response = await fetch(`/api/spikes/investigate?timestamp=${timestamp}&window=30`);
        if (!response.ok) throw new Error('Failed to investigate');

        const data = await response.json();
        renderInvestigation(data);
    } catch (err) {
        detailsEl.innerHTML = `<div class="loading-placeholder">Error: ${escapeHtml(/** @type {Error} */ (err).message)}</div>`;
    }
};

/**
 * @param {*} data
 */
export const renderInvestigation = (data) => {
    const detailsEl = document.getElementById('spike-details');
    const sessionsEl = document.getElementById('spike-sessions');
    if (!detailsEl || !sessionsEl) return;

    const sources = (data.summary.topModel && data.summary.topModel !== 'unknown')
        ? [data.summary.topModel]
        : [];

    detailsEl.innerHTML = `
        <div class="investigation-grid">
            <div class="detail-item">
                <div class="detail-label">Total Sessions</div>
                <div class="detail-value">${data.summary.totalSessions}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Total Tokens</div>
                <div class="detail-value">${fmtNum(data.summary.totalTokens)}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Total Cost</div>
                <div class="detail-value">$${data.summary.totalCost.toFixed(2)}</div>
            </div>
            <div class="detail-item">
                <div class="detail-label">Top Model</div>
                <div class="detail-value">${escapeHtml(displayModel(data.summary.topModel))}</div>
            </div>
        </div>
        ${sources.length ? `
            <div class="source-pills">
                <span class="source-pills-label">Sources</span>
                ${sources.map(src => `<span class="source-pill">${escapeHtml(displayModel(src))}</span>`).join('')}
            </div>
        ` : ''}
    `;

    sessionsEl.innerHTML = `
        <h5>Top Contributing Sessions</h5>
        ${data.sessions.map(/** @param {any} session @param {number} idx */(session, idx) => `
            <div class="session-accordion">
                <div class="session-accordion-header" data-session-index="${idx}" role="button" tabindex="0" aria-expanded="false">
                    <div class="session-accordion-title">
                        <span class="session-id">${escapeHtml(session.id)}</span>
                        ${session.models && session.models.length ? `<span class="session-models-inline">${session.models.map(/** @param {any} m */ m => `<span class="session-model-tag">${escapeHtml(displayModel(m))}</span>`).join('')}</span>` : ''}
                    </div>
                    <div class="session-accordion-meta">
                        <span class="session-cost">$${session.cost.toFixed(2)}</span>
                        <span class="session-tokens">${fmtNum(session.tokens)} tokens</span>
                        <span class="session-toggle">▼</span>
                    </div>
                </div>
                <div class="session-accordion-body" id="spike-session-body-${idx}" style="display:none;">
                    ${session.previews && session.previews.length ? `
                        <div class="preview-cards">
                            ${session.previews.map(/** @param {any} preview @param {number} i */(preview, i) => `
                                <div class="preview-card">
                                    <div class="preview-label">Message ${i + 1}</div>
                                    <div class="preview-text">${escapeHtml(preview)}</div>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<div class="preview-empty">No message previews available</div>'}
                </div>
            </div>
        `).join('')}
    `;

    sessionsEl.querySelectorAll('.session-accordion-header').forEach(header => {
        const el = /** @type {HTMLElement} */ (header);
        header.addEventListener('click', () => toggleSpikeSession(Number(el.dataset.sessionIndex)));
        header.addEventListener('keydown', /** @param {Event} e */(e) => {
            const ke = /** @type {KeyboardEvent} */ (e);
            if (ke.key === 'Enter' || ke.key === ' ') {
                e.preventDefault();
                toggleSpikeSession(Number(el.dataset.sessionIndex));
            }
        });
    });
};

/**
 * @param {number} idx
 */
export const toggleSpikeSession = (idx) => {
    const body = document.getElementById(`spike-session-body-${idx}`);
    const header = body?.previousElementSibling;
    if (!body) return;
    const isVisible = body.style.display !== 'none';
    body.style.display = isVisible ? 'none' : 'block';
    if (header) {
        const toggle = header.querySelector('.session-toggle');
        if (toggle) toggle.textContent = isVisible ? '▼' : '▲';
        header.setAttribute('aria-expanded', String(!isVisible));
    }
};

export const closeInvestigation = () => {
    /** @type {HTMLElement|null} */ const el = document.getElementById('spike-investigation');
    if (el) el.style.display = 'none';
};

