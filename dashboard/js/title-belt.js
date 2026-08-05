// dashboard/js/title-belt.js
import { calculateCostWithPricing } from './modelsdev-pricing.js';

export const ELIGIBILITY_FLOOR = 0.01; // 1% of the week's total tokens

const TOKEN_DIMENSIONS = [
    'total',
    'input',
    'output',
    'cache_read',
    'cache_write',
    'reasoning'
];

/** @param {*} model */
const hasFiniteTokenDimensions = (model) =>
    Boolean(model) &&
    typeof model === 'object' &&
    TOKEN_DIMENSIONS.every((dimension) => {
        const value = model[dimension];
        return Number.isFinite(value);
    });

/** @param {string} day */
const isValidIsoDay = (day) => {
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === day;
};

/**
 * @param {Record<string, any>} currModels
 * @param {Record<string, any>} baseModels
 * @returns {Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number, reasoning:number}>}
 */
export function diffModelStats(currModels, baseModels) {
    /** @type {Record<string, {total:number, input:number, output:number, cache_read:number, cache_write:number, reasoning:number}>} */
    const result = {};
    const models = Object.entries(currModels || {}).filter(([name, stats]) => {
        const base = baseModels?.[name];
        return hasFiniteTokenDimensions(stats) &&
            (base === undefined || hasFiniteTokenDimensions(base));
    });

    for (const [name, stats] of models) {
        const base = baseModels?.[name] || {
            total: 0,
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
            reasoning: 0
        };
        const total = Math.max(0, (stats.total || 0) - (base.total || 0));
        if (total <= 0) continue;
        result[name] = {
            total,
            input: Math.max(0, (stats.input || 0) - (base.input || 0)),
            output: Math.max(0, (stats.output || 0) - (base.output || 0)),
            cache_read: Math.max(0, (stats.cache_read || 0) - (base.cache_read || 0)),
            cache_write: Math.max(0, (stats.cache_write || 0) - (base.cache_write || 0)),
            reasoning: Math.max(0, (stats.reasoning || 0) - (base.reasoning || 0))
        };
    }
    return result;
}

/**
 * @param {Array<{day: string, models: Record<string, any>}>} weeklyData
 * @returns {{thisWeek: Record<string, any>, lastWeek: Record<string, any>|null, weekEndDay: string}|null}
 */
// eslint-disable-next-line max-statements
export function computeWeekWindow(weeklyData) {
    const valid = new Map();
    for (const entry of weeklyData || []) {
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(entry?.day || '') ||
            !isValidIsoDay(entry.day)
        ) {
            continue;
        }
        valid.set(entry.day, entry);
    }
    const days = [...valid.keys()].sort();
    if (!days.length) return null;

    /** @param {string} day */
    const byDay = (day) => valid.get(day);
    /** @param {string} day @param {number} amount */
    const shiftDay = (day, amount) => {
        const date = new Date(`${day}T00:00:00.000Z`);
        date.setUTCDate(date.getUTCDate() + amount);
        return date.toISOString().slice(0, 10);
    };
    const latest = days[days.length - 1];
    const thisStart = shiftDay(latest, -7);
    const currentKeys = Array.from({ length: 8 }, (_, i) => shiftDay(thisStart, i));
    if (!currentKeys.every((day) => byDay(day))) return null;

    const thisWeek = diffModelStats(byDay(latest).models, byDay(thisStart).models);
    const priorEnd = thisStart;
    const priorStart = shiftDay(latest, -14);
    const priorKeys = Array.from({ length: 8 }, (_, i) => shiftDay(priorStart, i));
    const lastWeek = priorKeys.every((day) => byDay(day))
        ? diffModelStats(byDay(priorEnd).models, byDay(priorStart).models)
        : null;

    return { thisWeek, lastWeek, weekEndDay: latest };
}

/**
 * The effective $/M convention: every nonzero token dimension must have a
 * finite rate. Explicit zero rates are valid free pricing.
 *
 * When `stats` is supplied, only an actually finite zero token count
 * (`tokens === 0`) allows a missing rate; a missing or non-finite token
 * count is a malformed dimension and makes the model unpriced. When `stats`
 * is omitted, this is a pricing-only call and every one of the five rates
 * must be finite on its own.
 * @param {any|null|undefined} pricing
 * @param {any} [stats]
 * @returns {boolean}
 */
export function hasUsableFullPricing(pricing, stats) {
    const hasStats = stats !== undefined;
    const usage = stats || {};
    const dimensions = [
        ['input', pricing?.input, usage.input],
        ['output', pricing?.output, usage.output],
        ['cacheRead', pricing?.cacheRead, usage.cache_read],
        ['cacheWrite', pricing?.cacheWrite, usage.cache_write],
        ['reasoning', pricing?.reasoning, usage.reasoning]
    ];
    return dimensions.every(([, rate, tokens]) => hasStats
        ? Number.isFinite(tokens) && (tokens === 0 || Number.isFinite(rate))
        : Number.isFinite(rate));
}

/** @param {any} pricing */
function pricingWithPresence(pricing) {
    /** @param {*} rate */
    const finite = (rate) => Number.isFinite(rate) ? rate : 0;
    return pricing && {
        input: finite(pricing.input),
        output: finite(pricing.output),
        cacheRead: finite(pricing.cacheRead),
        cacheWrite: finite(pricing.cacheWrite),
        reasoning: finite(pricing.reasoning),
        hasInput: pricing.hasInput ?? Number.isFinite(pricing.input),
        hasOutput: pricing.hasOutput ?? Number.isFinite(pricing.output),
        hasCacheRead: pricing.hasCacheRead ?? Number.isFinite(pricing.cacheRead),
        hasCacheWrite: pricing.hasCacheWrite ?? Number.isFinite(pricing.cacheWrite),
        hasReasoning: pricing.hasReasoning ?? Number.isFinite(pricing.reasoning)
    };
}

/**
 * @param {any} stats
 * @param {any} pricing
 * @returns {number|null}
 */
function effectiveRatePerMillion(stats, pricing) {
    if (!hasFiniteTokenDimensions(stats)) return null;
    if (!hasUsableFullPricing(pricing, stats)) return null;
    if (!Number.isFinite(stats.total) || stats.total <= 0) return null;
    const { total: cost, priced } = calculateCostWithPricing(stats, pricingWithPresence(pricing));
    if (!priced) return null;
    const rate = (cost * 1e6) / stats.total;
    return Number.isFinite(rate) ? rate : null;
}

/**
 * @param {{thisWeek: Record<string, any>, lastWeek: Record<string, any>|null}|null} weekWindow
 * @param {Record<string, any>|undefined} pricingByModel
 * @returns {{volumeCrown: any, thriftKing: any, sommelier: any, mostImproved: any}}
 */
export function scoreTitleBelt(weekWindow, pricingByModel) {
    if (!weekWindow) return { volumeCrown: null, thriftKing: null, sommelier: null, mostImproved: null };

    const { thisWeek, lastWeek } = weekWindow;
    const totalTokens = Object.values(thisWeek).reduce(
        (sum, s) => sum + (Number.isFinite(s?.total) ? s.total : 0),
        0
    );
    if (totalTokens <= 0) return { volumeCrown: null, thriftKing: null, sommelier: null, mostImproved: null };

    const eligible = Object.entries(thisWeek).filter(
        ([, s]) => Number.isFinite(s?.total) && s.total / totalTokens >= ELIGIBILITY_FLOOR
    );

    const scored = eligible.map(([name, s]) => ({
        name,
        tokens: s.total,
        share: s.total / totalTokens,
        effectiveRate: effectiveRatePerMillion(s, pricingByModel?.[name])
    }));

    const volumeCrown = scored.slice().sort((a, b) => (b?.tokens ?? 0) - (a?.tokens ?? 0))[0] || null;
    const priced = scored.filter((m) => m.effectiveRate !== null);
    const thriftKing = priced.length ? priced.slice().sort((a, b) => (a?.effectiveRate ?? 0) - (b?.effectiveRate ?? 0))[0] : null;
    const sommelier = priced.length ? priced.slice().sort((a, b) => (b?.effectiveRate ?? 0) - (a?.effectiveRate ?? 0))[0] : null;

    let mostImproved = null;
    if (lastWeek) {
        const improved = eligible
            .map(([name, s]) => {
                const priorTokens = lastWeek[name]?.total || 0;
                if (priorTokens <= 0) return null; // no prior-week data -> ineligible for this belt specifically
                return { name, tokens: s.total, growthPct: ((s.total - priorTokens) / priorTokens) * 100 };
            })
            .filter(Boolean);
        if (improved.length) {
            const best = improved.sort((a, b) => (b?.growthPct ?? 0) - (a?.growthPct ?? 0))[0];
            if (best && best.growthPct > 0) mostImproved = best;
        }
    }

    return { volumeCrown, thriftKing, sommelier, mostImproved };
}
