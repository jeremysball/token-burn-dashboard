// ===== CONFIG =====
export const CACHE_KEY = 'tokenBurnCache';
export const HISTORY_KEY = 'tokenBurnHistory';
export const WEEKLY_KEY = 'tokenBurnWeekly';
export const CACHE_VERSION = 'v2';
export const VERSION_KEY = 'tokenBurnCacheVersion';
export const CACHE_DURATION = 5 * 60 * 1000;
export const MAX_HISTORY_POINTS = 1000;

// ===== EMOJIS =====
export const emojis = {
    kimi: '🌙', claude: '🧠', gpt: '🤖', openai: '🤖',
    gemini: '💎', glm: '⚡', zai: '⚡', llama: '🦙', deepseek: '🔮'
};

export const getEmoji = name => {
    for (const [k, v] of Object.entries(emojis)) {
        if (name.toLowerCase().includes(k)) return v;
    }
    return '🤖';
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
export const MODEL_PRICING = [
    // OpenAI
    { pattern: /gpt-4o$/i, input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
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
    // Default
    { pattern: /.*/, input: 2, output: 8, cacheRead: 0, cacheWrite: 0 },
];

export const getPricing = (modelName) => {
    const name = modelName.toLowerCase();
    for (const p of MODEL_PRICING) {
        if (p.pattern.test(name)) return p;
    }
    return MODEL_PRICING[MODEL_PRICING.length - 1];
};

export const calculateCost = (t, modelName) => {
    const p = getPricing(modelName);
    const inputCost = (t.input / 1_000_000) * p.input;
    const outputCost = (t.output / 1_000_000) * p.output;
    const cacheReadCost = (t.cache_read / 1_000_000) * p.cacheRead;
    const cacheWriteCost = ((t.cache_write || 0) / 1_000_000) * p.cacheWrite;
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
};
