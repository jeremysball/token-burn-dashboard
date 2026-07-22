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

// ===== MODEL PRICING =====
// Keep in sync with lib/pricing.js on server
export const MODEL_PRICING = [
    // OpenAI
    { pattern: /^gpt-4o$/i, input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
    { pattern: /gpt-4o-mini/i, input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
    { pattern: /o1$/i, input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 },
    { pattern: /o3-mini/i, input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
    // Claude
    { pattern: /claude-3-5-sonnet/i, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    { pattern: /claude-3-opus/i, input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
    { pattern: /claude-3-haiku/i, input: 0.25, output: 1.25, cacheRead: 0.03, cacheWrite: 0.3 },
    { pattern: /claude/i, input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    // DeepSeek
    { pattern: /deepseek-chat/i, input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
    { pattern: /deepseek-reasoner/i, input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0 },
    // Gemini
    { pattern: /gemini-1\.5-pro/i, input: 1.25, output: 5, cacheRead: 0, cacheWrite: 0 },
    { pattern: /gemini-1\.5-flash/i, input: 0.075, output: 0.3, cacheRead: 0, cacheWrite: 0 },
    { pattern: /gemini/i, input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
    // Kimi
    { pattern: /k2p5|kimi-k2/i, input: 1.5, output: 6, cacheRead: 0.375, cacheWrite: 1.875 },
    // GLM
    { pattern: /glm/i, input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
    // Default fallback
    { pattern: /.*/, input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
];

/** @param {string} modelName */
export const getPricing = (modelName) => {
    const name = String(modelName || '').toLowerCase();
    const { model } = splitModelKey(name);
    const modelOnly = model || name;

    for (const p of MODEL_PRICING) {
        if (p.pattern.test(modelOnly)) return p;
    }
    return MODEL_PRICING[MODEL_PRICING.length - 1];
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
