// dashboard/js/views/analytics/tabs/compare.js
import { currentData, escapeHtml, displayModel } from './shared.js';
import { weeklyData } from '../../../state.js';
import { buildLeagueTable } from '../../../league-table.js';

const BADGE_ICON = { volumeCrown: 'icon-crown', thriftKing: 'icon-thrift', sommelier: 'icon-wine', mostImproved: 'icon-improved' };
const BADGE_LABEL = { volumeCrown: 'Volume Crown', thriftKing: 'Thrift King', sommelier: 'The Sommelier', mostImproved: 'Most Improved' };
const BADGE_SHORT_LABEL = { volumeCrown: 'Crown', thriftKing: 'Thrift', sommelier: 'Sommelier', mostImproved: 'Improved' };

/** @param {import('../../../league-table.js').LeagueRow['badge']} badge @returns {string} */
function badgeCell(badge) {
    if (!badge) return '';
    return `<span class="league-badge" title="${escapeHtml(BADGE_LABEL[badge])}"><svg aria-hidden="true"><use href="#${BADGE_ICON[badge]}"></use></svg><span class="league-badge-label">${escapeHtml(BADGE_SHORT_LABEL[badge])}</span></span>`;
}

/** @param {import('../../../league-table.js').LeagueRow} row @param {boolean} hidden @returns {string} */
function otherRowHtml(row, hidden) {
    return `
        <tr class="league-other-row" style="display:${hidden ? 'none' : 'table-row'}">
            <td class="num">${row.rank}</td>
            <td>${escapeHtml(displayModel(row.name))}</td>
            <td>${badgeCell(row.badge)}</td>
            <td class="num">${row.effectiveRatePerMillion !== null ? '$' + row.effectiveRatePerMillion.toFixed(2) : '—'}</td>
            <td class="num">${row.cachePct.toFixed(0)}%</td>
        </tr>
    `;
}

/** @param {import('../../../league-table.js').LeagueRow} row @returns {string} */
function topRowHtml(row) {
    return `
        <tr>
            <td class="num">${row.rank}</td>
            <td>${escapeHtml(displayModel(row.name))}</td>
            <td>${badgeCell(row.badge)}</td>
            <td class="num">${row.effectiveRatePerMillion !== null ? '$' + row.effectiveRatePerMillion.toFixed(2) : '—'}</td>
            <td class="num">${row.cachePct.toFixed(0)}%</td>
        </tr>
    `;
}

/** @param {HTMLElement|null} [container] */
export function renderCompareTab(container) {
    if (!container) container = document.getElementById('compare-chart-container');
    if (!container) return;
    if (!currentData) return;

    // Ambient (SSE-driven) refreshes re-render this container on every
    // tick, so preserve the user's expanded/collapsed state across
    // re-renders — otherwise the "Hide N others" label silently flips
    // back to "+N others" every few seconds.
    const previousToggle = /** @type {HTMLElement|null} */ (container.querySelector?.('.league-others-toggle'));
    const wasExpanded = previousToggle?.dataset.expanded === 'true';

    /** @type {any} */
    const data = currentData;
    const { tokens_by_model, costs_by_model, pricing_by_model } = data;
    const hasModels = tokens_by_model && Object.keys(tokens_by_model).length > 0;

    if (!hasModels) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--mono-text-muted);">No data available</div>';
        return;
    }

    const { top, others } = buildLeagueTable(tokens_by_model, costs_by_model, weeklyData, pricing_by_model);

    const toggleRow = others.length
        ? `<tr class="league-others-toggle" tabindex="0" role="button" data-expanded="${wasExpanded ? 'true' : 'false'}"><td colspan="5">${wasExpanded ? `− Hide ${others.length} others` : `+${others.length} others`}</td></tr>`
        : '';

    container.innerHTML = `
        <table class="mono-table">
            <thead>
                <tr><th>Rank</th><th>Model</th><th>Badge</th><th class="num">Effective $/M</th><th class="num">Cache %</th></tr>
            </thead>
            <tbody>
                ${top.map(topRowHtml).join('')}
                ${toggleRow}
                ${others.map((row) => otherRowHtml(row, !wasExpanded)).join('')}
            </tbody>
        </table>
    `;

    if (!others.length) return;
    const toggle = /** @type {HTMLElement} */ (container.querySelector('.league-others-toggle'));
    const hiddenRows = container.querySelectorAll('.league-other-row');
    const expand = () => {
        const expanded = toggle.dataset.expanded === 'true';
        toggle.dataset.expanded = String(!expanded);
        /** @type {HTMLElement} */ (toggle.querySelector('td')).textContent = expanded ? `+${others.length} others` : `− Hide ${others.length} others`;
        hiddenRows.forEach((row) => { /** @type {HTMLElement} */ (row).style.display = expanded ? 'none' : 'table-row'; });
    };
    toggle.addEventListener('click', expand);
    toggle.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            expand();
        }
    });
}
