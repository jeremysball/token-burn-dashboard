// dashboard/js/league-table.js
import { computeWeekWindow, effectiveRatePerMillion, scoreTitleBelt } from './title-belt.js';
import { cacheHitRatePct } from './utils.js';

/** @typedef {'volumeCrown'|'thriftKing'|'sommelier'|'mostImproved'} BadgeKey */
/** @typedef {{rank: number, name: string, tokens: number, effectiveRatePerMillion: number|null, cachePct: number, badges: BadgeKey[]}} LeagueRow */

/** Memoization guard for weekly belt scoring. Both `weeklyData` and
 *  `pricingByModel` arrive as fresh references on every SSE tick (~5s), so
 *  a reference-equality check would never hit. Instead we digest a cheap
 *  content fingerprint: the week-window's end day + length, the cumulative
 *  totals on the latest day (the basis for the volume + mostImproved belts),
 *  and a sorted pricing fingerprint (thriftKing + sommelier flip when the
 *  catalog refreshes even if weeklyData is unchanged). The cache recomputes
 *  only when any of those change, i.e. once per calendar day for the
 *  data-shape side and once per Models.dev catalog refresh for the pricing
 *  side — not on every ~5s render. */
/** @type {string|null} */
let _cacheKey = null;
/** @type {ReturnType<typeof scoreTitleBelt>|null} */
let _cachedBelts = null;

/**
 * @param {any[]} weeklyData
 * @returns {string}
 */
function weeklyDataFingerprint(weeklyData) {
    if (!Array.isArray(weeklyData) || weeklyData.length === 0) return 'empty:0';
    const last = weeklyData[weeklyData.length - 1];
    const day = typeof last?.day === 'string' ? last.day : '?';
    const models = last?.models && typeof last.models === 'object' ? last.models : {};
    /** @param {*} v */
    const fmt = (v) => (Number.isFinite(v) ? v : '?');
    const totals = Object.keys(models).sort().map((name) => `${name}:${fmt(models[name]?.total)}`);
    return `${weeklyData.length}|${day}|${totals.join(',')}`;
}

const PRICING_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];

/** @param {Record<string, any>|undefined} pricingByModel @returns {string} */
function pricingFingerprint(pricingByModel) {
    if (!pricingByModel || typeof pricingByModel !== 'object') return 'pricing:none';
    const parts = [];
    for (const name of Object.keys(pricingByModel).sort()) {
        const p = pricingByModel[name];
        if (!p || typeof p !== 'object') continue;
        const rates = PRICING_FIELDS.map((f) => (Number.isFinite(p[f]) ? p[f] : '?')).join(',');
        parts.push(`${name}=${rates}`);
    }
    return `pricing:${parts.join('|')}`;
}

/**
 * @param {Record<string, any>|undefined} pricingByModel
 * @param {any[]} weeklyData
 * @returns {string}
 */
function beltCacheKey(pricingByModel, weeklyData) {
    return `${weeklyDataFingerprint(weeklyData)}::${pricingFingerprint(pricingByModel)}`;
}

/**
 * Return every belt a model holds. The Insights tab already does this with
 * its title-belt widget (Volume Crown, Thrift King, The Sommelier, Most
 * Improved are all awarded independently — a single model can hold several
 * at once), so the league-table rows must show every qualifying badge,
 * not just the first one in priority order.
 * @param {ReturnType<typeof scoreTitleBelt>} belts
 * @param {string} name
 * @returns {BadgeKey[]}
 */
function badgesFor(belts, name) {
    /** @type {BadgeKey[]} */
    const out = [];
    for (const belt of /** @type {BadgeKey[]} */ (['volumeCrown', 'thriftKing', 'sommelier', 'mostImproved'])) {
        if (belts[belt]?.name === name) out.push(belt);
    }
    return out;
}

/**
 * @param {Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number}>} tokensByModel
 * @param {Record<string, {total:number}>|undefined} costsByModel
 * @param {any[]} weeklyData
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {{top: LeagueRow[], others: LeagueRow[]}}
 */
export function buildLeagueTable(tokensByModel, costsByModel, weeklyData, pricingByModel) {
    const sorted = Object.entries(tokensByModel || {}).sort((a, b) => b[1].total - a[1].total);
    if (sorted.length === 0) return { top: [], others: [] };

    const cacheKey = beltCacheKey(pricingByModel, weeklyData);
    if (cacheKey !== _cacheKey) {
        _cachedBelts = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
        _cacheKey = cacheKey;
    }
    const belts = /** @type {ReturnType<typeof scoreTitleBelt>} */ (_cachedBelts);

    const rows = sorted.map(([name, stats], index) => {
        const effectiveRate = effectiveRatePerMillion(stats, pricingByModel?.[name]);
        const cachePct = cacheHitRatePct(stats.input, stats.cache_read);
        return {
            rank: index + 1,
            name,
            tokens: stats.total,
            effectiveRatePerMillion: effectiveRate,
            cachePct,
            badges: badgesFor(belts, name)
        };
    });

    return { top: rows.slice(0, 8), others: rows.slice(8) };
}
