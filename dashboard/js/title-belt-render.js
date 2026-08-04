// dashboard/js/title-belt-render.js
import { computeWeekWindow, scoreTitleBelt } from './title-belt.js';
import { escapeHtml, fmtNum, displayModel } from './utils.js';

/**
 * @param {string} iconId
 * @param {string} title
 * @param {{name: string}|null} entry
 * @param {string} detail
 * @returns {string}
 */
function beltRow(iconId, title, entry, detail) {
    return `
        <div class="belt-row">
            <span class="belt-badge"><svg aria-hidden="true"><use href="#${iconId}"></use></svg></span>
            <span class="belt-title">${escapeHtml(title)}</span>
            <span class="belt-model">${entry ? escapeHtml(displayModel(entry.name)) : '—'}</span>
            <span class="belt-detail">${escapeHtml(detail)}</span>
        </div>
    `;
}

/**
 * @param {HTMLElement} container
 * @param {any[]} weeklyData
 * @param {Record<string, any>|undefined} pricingByModel
 */
export function renderTitleBelt(container, weeklyData, pricingByModel) {
    const window = computeWeekWindow(weeklyData);
    if (!window) {
        container.innerHTML = `
            <div class="title-belt">
                <div class="fr-date">TITLE BELT</div>
                <div class="belt-detail">Not enough history yet — check back after a full week of usage.</div>
            </div>
        `;
        return;
    }

    const scored = scoreTitleBelt(window, pricingByModel);
    const rows = [
        beltRow('icon-crown', 'Volume Crown', scored.volumeCrown, scored.volumeCrown ? `${(scored.volumeCrown.share * 100).toFixed(0)}% share this week` : ''),
        beltRow('icon-thrift', 'Thrift King', scored.thriftKing, scored.thriftKing ? `${scored.thriftKing.effectiveRate.toFixed(2)} effective $/M — cheapest in the fleet` : 'no priced eligible model'),
        beltRow('icon-wine', 'The Sommelier', scored.sommelier, scored.sommelier ? `priciest taste, ${scored.sommelier.effectiveRate.toFixed(2)} effective $/M` : 'no priced eligible model')
    ];

    if (scored.mostImproved) {
        rows.push(beltRow('icon-improved', 'Most Improved', scored.mostImproved, `${scored.mostImproved.growthPct >= 0 ? '+' : ''}${scored.mostImproved.growthPct.toFixed(0)}% tokens week over week (${fmtNum(scored.mostImproved.tokens)} total)`));
    } else {
        rows.push(`
            <div class="belt-row">
                <span class="belt-badge"><svg aria-hidden="true"><use href="#icon-improved"></use></svg></span>
                <span class="belt-title">Most Improved</span>
                <span class="belt-detail">Not enough history yet for a week-over-week comparison.</span>
            </div>
        `);
    }

    container.innerHTML = `
        <div class="title-belt">
            <div class="fr-date">TITLE BELT // WEEK ENDING ${escapeHtml(window.weekEndDay)}</div>
            ${rows.join('')}
        </div>
    `;
}
