import { splitModelKey, formatModelPrice as formatModelPriceFromUtils } from './utils.js';

// ===== CACHE CONFIG =====
export const CACHE_KEY = 'tokenBurnCache';
export const HISTORY_KEY = 'tokenBurnHistory';
export const WEEKLY_KEY = 'tokenBurnWeekly';
export const CACHE_VERSION = 'v2';
export const VERSION_KEY = 'tokenBurnCacheVersion';
export const CACHE_DURATION = 5 * 60 * 1000;
export const MAX_HISTORY_POINTS = 1000;

// ===== PROVIDER BADGES =====
export const emojis = {
    kimi: 'K', claude: 'C', gpt: 'O', openai: 'O',
    gemini: 'G', glm: 'Z', zai: 'Z', llama: 'L', deepseek: 'D'
};

/** @param {string} name */
export const getEmoji = name => {
    for (const [k, v] of Object.entries(emojis)) {
        if (name.toLowerCase().includes(k)) return v;
    }
    return '?';
};

// ===== COLORS =====
export const CHART_COLORS = [
    '#fbbf24', // amber
    '#38bdf8', // sky blue
    '#a78bfa', // violet
    '#34d399', // emerald
    '#fb7185', // rose
    '#22d3ee', // cyan
    '#fbbf24', // amber
    '#c084fc', // purple
];

// ===== MODEL PRICING (fetched from server) =====
// Single source of truth: lib/pricing.js on the server.
// This module caches the pricing table fetched from GET /api/pricing.

/** @type {Array<{pattern: RegExp, input: number, output: number, cacheRead: number, cacheWrite: number}>} */
let _pricing = [];

const DEFAULT_PRICING = { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 };

/**
 * Parse a regex string returned by the server (e.g. "/^gpt-4o$/i") back into a RegExp.
 * @param {string} str
 * @returns {RegExp}
 */
function _parsePattern(str) {
    const m = str.match(/^\/(.*)\/([gimsuys]*)$/);
    if (m) return new RegExp(m[1], m[2]);
    return /.*/;
}

/**
 * Fetch the pricing table from the server.
 * Safe to call multiple times; updates replace the in-memory cache.
 */
export async function loadPricing() {
    try {
        const res = await fetch('/api/pricing');
        if (!res.ok) throw new Error(`Failed to load pricing: ${res.status}`);
        const data = /** @type {Array<{pattern: string, input: number, output: number, cacheRead: number, cacheWrite: number}>} */ (await res.json());
        _pricing = data.map(p => ({
            pattern: _parsePattern(p.pattern),
            input: p.input,
            output: p.output,
            cacheRead: p.cacheRead,
            cacheWrite: p.cacheWrite
        }));
    } catch (err) {
        console.warn('Could not fetch pricing from server, using defaults:', err instanceof Error ? err.message : String(err));
        _pricing = [{ pattern: /.*/, ...DEFAULT_PRICING }];
    }
}

/**
 * Set pricing data directly (for testing).
 * @param {Array<{pattern: RegExp, input: number, output: number, cacheRead: number, cacheWrite: number}>} data
 */
export function setPricing(data) {
    _pricing = data;
}

/** @returns {Array<{pattern: RegExp, input: number, output: number, cacheRead: number, cacheWrite: number}>} */
export function getModelPricing() {
    return _pricing;
}

/** @param {string} modelName */
export const getPricing = (modelName) => {
    const arr = _pricing;
    if (arr.length === 0) return { ...DEFAULT_PRICING, source: 'local' };

    const name = String(modelName || '').toLowerCase();
    const { model } = splitModelKey(name);
    const modelOnly = model || name;

    for (const p of arr) {
        if (p.pattern.test(modelOnly)) return p;
    }
    return arr[arr.length - 1];
};

/** @param {string} name @param {Record<string, *>|undefined} pricing_by_model */
export const getPricingForModel = (name, pricing_by_model) => {
    if (pricing_by_model && pricing_by_model[name]) return pricing_by_model[name];
    return getPricing(name);
};

export const getPricingForModelWrapper = getPricingForModel;
export const formatModelPrice = formatModelPriceFromUtils;

/** @param {Record<string, number>} tokens @param {string} modelName @returns {{input: number, output: number, cache_read: number, cache_write: number, total: number}} */
export const calculateCost = (tokens, modelName) => {
    const p = getPricing(modelName);
    
    const input = tokens.input || 0;
    const output = tokens.output || 0;
    const cacheRead = tokens.cache_read || tokens.cacheRead || 0;
    const cacheWrite = tokens.cache_write || tokens.cacheWrite || 0;
    
    const inputCost = (input / 1_000_000) * p.input;
    const outputCost = (output / 1_000_000) * p.output;
    const cacheReadCost = (cacheRead / 1_000_000) * p.cacheRead;
    const cacheWriteCost = (cacheWrite / 1_000_000) * p.cacheWrite;
    
    return {
        input: inputCost,
        output: outputCost,
        cache_read: cacheReadCost,
        cache_write: cacheWriteCost,
        total: inputCost + outputCost + cacheReadCost + cacheWriteCost
    };
};
