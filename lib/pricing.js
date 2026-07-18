/**
 * Shared pricing configuration for token cost calculations
 * Used by both server-side (Node.js) and client-side (browser) code
 *
 * IMPORTANT: Local fallback pricing remains here for resilience.
 * OpenRouter model pricing is fetched dynamically at runtime when available.
 */

const { getOpenRouterPricingRecord } = require('./openrouter');

// Model pricing rates in $ per 1M tokens
const MODEL_PRICING = [
  // OpenAI
  { pattern: /^gpt-4o$/i, input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
  { pattern: /gpt-4o-mini/i, input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  { pattern: /\bo1-mini\b/i, input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
  { pattern: /\bo3-mini\b/i, input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
  { pattern: /\bo1\b/i, input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 },
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
  { pattern: /(?:^|\/)(?:kimi-k2\.6|k2\.6)(?:$|[-:.])/i, input: 1.8, output: 7, cacheRead: 0.4, cacheWrite: 2 },
  { pattern: /(?:^|\/)(?:kimi-k2\.5|k2p5|k2\.5)(?:$|[-:.])/i, input: 1.5, output: 6, cacheRead: 0.375, cacheWrite: 1.875 },
  { pattern: /(?:^|\/)(?:kimi-k2|k2)(?:$|[-:.])/i, input: 1.5, output: 6, cacheRead: 0.375, cacheWrite: 1.875 },
  // GLM
  { pattern: /glm/i, input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
  // Minimax
  { pattern: /(?:^|\/)minimax-m3(?:$|[-:])/i, input: 0.5, output: 2, cacheRead: 0.1, cacheWrite: 0 },
  // Default fallback
  { pattern: /.*/, input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
];

function normalizeModelName(modelName) {
  return String(modelName || '').toLowerCase();
}

function stripProviderPrefix(modelName) {
  const name = normalizeModelName(modelName);
  const idx = name.indexOf('/');
  return idx === -1 ? name : name.slice(idx + 1);
}

function findLocalPricing(modelName) {
  const modelOnly = stripProviderPrefix(modelName);

  for (const p of MODEL_PRICING) {
    if (p.pattern.test(modelOnly)) {
      return {
        input: p.input,
        output: p.output,
        cacheRead: p.cacheRead,
        cacheWrite: p.cacheWrite,
        reasoning: p.output,
        source: 'local'
      };
    }
  }

  const fallback = MODEL_PRICING[MODEL_PRICING.length - 1];
  return {
    input: fallback.input,
    output: fallback.output,
    cacheRead: fallback.cacheRead,
    cacheWrite: fallback.cacheWrite,
    reasoning: fallback.output,
    source: 'local'
  };
}

function mergePricing(localPricing, openRouterPricing) {
  if (!openRouterPricing) return localPricing;

  return {
    input: openRouterPricing.input ?? localPricing.input,
    output: openRouterPricing.output ?? localPricing.output,
    cacheRead: openRouterPricing.cacheRead ?? localPricing.cacheRead,
    cacheWrite: openRouterPricing.cacheWrite ?? localPricing.cacheWrite,
    reasoning: openRouterPricing.reasoning ?? localPricing.reasoning,
    source: 'openrouter',
    openrouterId: openRouterPricing.id,
    canonicalSlug: openRouterPricing.canonicalSlug,
    name: openRouterPricing.name,
    contextLength: openRouterPricing.contextLength
  };
}

/**
 * Get pricing for a specific model
 * @param {string} modelName - The model name (can include provider prefix like "openai/gpt-4o")
 * @returns {Object} Pricing object with input, output, cacheRead, cacheWrite rates
 */
function getPricing(modelName) {
  const localPricing = findLocalPricing(modelName);
  const openRouterPricing = getOpenRouterPricingRecord(modelName);
  return mergePricing(localPricing, openRouterPricing);
}

/**
 * Get detailed pricing metadata for a model
 * @param {string} modelName - The model name
 * @returns {Object} Pricing object with source and OpenRouter metadata when available
 */
function getPricingDetails(modelName) {
  return getPricing(modelName);
}

/**
 * Calculate cost for a given token usage
 * @param {Object} tokens - Token usage object
 * @param {number} tokens.input - Input tokens
 * @param {number} tokens.output - Output tokens  
 * @param {number} tokens.cache_read - Cache read tokens
 * @param {number} tokens.cache_write - Cache write tokens
 * @param {string} modelName - Model name for pricing lookup
 * @returns {Object} Cost breakdown with input, output, cache_read, cache_write, and total
 */
function calculateCost(tokens, modelName) {
  const p = getPricing(modelName);
  
  const input = tokens.input || 0;
  const output = tokens.output || 0;
  const cacheRead = tokens.cache_read || tokens.cacheRead || 0;
  const cacheWrite = tokens.cache_write || tokens.cacheWrite || 0;
  const reasoning = tokens.reasoning || 0;
  
  const inputCost = (input / 1_000_000) * p.input;
  const outputCost = (output / 1_000_000) * p.output;
  const cacheReadCost = (cacheRead / 1_000_000) * p.cacheRead;
  const cacheWriteCost = (cacheWrite / 1_000_000) * p.cacheWrite;
  const reasoningCost = (reasoning / 1_000_000) * (p.reasoning ?? p.output ?? 0);
  
  return {
    input: inputCost,
    output: outputCost,
    cache_read: cacheReadCost,
    cache_write: cacheWriteCost,
    reasoning: reasoningCost,
    total: inputCost + outputCost + cacheReadCost + cacheWriteCost + reasoningCost
  };
}

/**
 * Get all pricing configurations (for debugging/admin)
 * @returns {Array} Array of pricing configurations
 */
function getAllPricing() {
  return MODEL_PRICING.map(p => ({
    pattern: p.pattern.toString(),
    input: p.input,
    output: p.output,
    cacheRead: p.cacheRead,
    cacheWrite: p.cacheWrite,
    source: 'local'
  }));
}

module.exports = {
  getPricing,
  getPricingDetails,
  calculateCost,
  getAllPricing,
  MODEL_PRICING,
  findLocalPricing,
  stripProviderPrefix
};
