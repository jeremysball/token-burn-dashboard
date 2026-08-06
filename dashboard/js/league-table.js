// dashboard/js/league-table.js
import {
    computeWeekWindow,
    effectiveRatePerMillion,
    scoreTitleBelt,
    TOKEN_DIMENSIONS,
    PRICING_RATE_FIELDS,
    PRICING_PRESENCE_FLAGS
} from './title-belt.js';
import { cacheHitRatePct } from './utils.js';

/** @typedef {'volumeCrown'|'thriftKing'|'sommelier'|'mostImproved'} BadgeKey */
/** @typedef {{rank: number, name: string, tokens: number, effectiveRatePerMillion: number|null, cachePct: number, badges: BadgeKey[]}} LeagueRow */

/** Memoization guard for weekly belt scoring. Both `weeklyData` and
 *  `pricingByModel` arrive as fresh references on every SSE tick (~5s), so
 *  a reference-equality check would never hit. Instead we digest a canonical
 *  JSON fingerprint that covers every field the belt-scoring pipeline
 *  actually consumes:
 *    - `weeklyData`: per-day, per-model values on ALL six TOKEN_DIMENSIONS
 *      (`total`, `input`, `output`, `cache_read`, `cache_write`,
 *      `reasoning`), deduped last-write-wins per day (matching the dedup
 *      done inside `computeWeekWindow`).
 *    - `pricingByModel`: each model's numeric rates (PRICING_RATE_FIELDS)
 *      AND its explicit presence flags (PRICING_PRESENCE_FLAGS) — the
 *      `hasInput`/`hasOutput`/... flags flip effective $ / M even when the
 *      underlying rates are byte-identical (see `pricingWithPresence` and
 *      `calculateCostWithPricing`).
 *  Keys in both fingerprints are sorted, so two inputs that produce
 *  identical scoring results always fingerprint to the same string. The
 *  cache therefore recomputes only on a genuine content change — not on
 *  every ~5s SSE-shaped new-reference refresh. */
/** @type {string|null} */
let _cacheKey = null;
/** @type {ReturnType<typeof scoreTitleBelt>|null} */
let _cachedBelts = null;

/**
 * Canonical JSON of every daily snapshot, deduped last-write-wins per day
 * (the same dedup `computeWeekWindow` performs), with each model's six
 * token dimensions sorted by dimension name and each day's model map
 * sorted by model name. Two inputs that produce identical
 * `computeWeekWindow(weeklyData)` results fingerprint identically;
 * differing inputs (including earlier-week days that disagree) get
 * different fingerprints.
 * @param {any[]} weeklyData
 * @returns {string}
 */
function weeklyDataFingerprint(weeklyData) {
    if (!Array.isArray(weeklyData) || weeklyData.length === 0) return '[]';
    /** @type {Map<string, any>} */
    const byDay = new Map();
    for (const entry of weeklyData) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.day !== 'string') continue;
        byDay.set(entry.day, entry);
    }
    const days = [...byDay.keys()].sort();
    const canonical = days.map((day) => {
        const entry = byDay.get(day);
        const models = entry.models && typeof entry.models === 'object' ? entry.models : {};
        /** @type {Record<string, any>} */
        const orderedModels = {};
        for (const name of Object.keys(models).sort()) {
            const m = models[name];
            /** @type {Record<string, number|null>} */
            const dims = {};
            for (const dim of TOKEN_DIMENSIONS) {
                dims[dim] = m && Number.isFinite(m[dim]) ? m[dim] : null;
            }
            orderedModels[name] = dims;
        }
        return [day, orderedModels];
    });
    return JSON.stringify(canonical);
}

/**
 * Canonical JSON of every model's pricing record: numeric rate fields
 * followed by explicit presence-flag values (with `undefined` serialized
 * as `null` to distinguish "absent" from "explicit false"). Two pricing
 * records that produce identical `effectiveRatePerMillion` results always
 * fingerprint identically.
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {string}
 */
function pricingFingerprint(pricingByModel) {
    if (!pricingByModel || typeof pricingByModel !== 'object') return '{}';
    /** @type {Record<string, Record<string, number|null|boolean>|null>} */
    const canonical = {};
    for (const name of Object.keys(pricingByModel).sort()) {
        const p = pricingByModel[name];
        if (!p || typeof p !== 'object') {
            canonical[name] = null;
            continue;
        }
        /** @type {Record<string, number|null|boolean>} */
        const entry = {};
        for (const f of PRICING_RATE_FIELDS) entry[f] = Number.isFinite(p[f]) ? p[f] : null;
        for (const f of PRICING_PRESENCE_FLAGS) entry[f] = p[f] === undefined ? null : !!p[f];
        canonical[name] = entry;
    }
    return JSON.stringify(canonical);
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
