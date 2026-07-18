// ===== Models.dev pricing source =====
// Real, user-selected pricing source for the heatmap cost metric.
// Models.dev publishes a provider-scoped catalog at https://models.dev/api.json
// shaped like catalog[provider].models[modelId].cost where cost values are
// USD per 1M tokens and may include input, output, reasoning, cache_read,
// cache_write. This module normalizes that into the same pricing shape used
// elsewhere ({ input, output, cacheRead, cacheWrite, reasoning }, USD per 1M tokens)
// so the heatmap cost metric uses real rates, never local hardcoded fallbacks.

export const MODELS_DEV_API = 'https://models.dev/api.json';

// Catalog load status so callers can tell a permanent failure apart from an
// in-flight load. Values: 'idle' | 'loading' | 'ready' | 'failed'.
let catalogStatus = 'idle';
let catalogError = null;

let catalogCache = null;
let catalogPromise = null;

export const setCatalog = (catalog) => {
    catalogCache = catalog || null;
    catalogStatus = catalog ? 'ready' : 'idle';
    catalogError = null;
};

export const getCatalog = () => catalogCache;

export const getCatalogStatus = () => catalogStatus;

export const getCatalogError = () => catalogError;

export const isCatalogFailed = () => catalogStatus === 'failed';

// Reset to idle so a later fetchModelsDevCatalog call can retry after a failure.
export const clearCatalogCache = () => {
    catalogCache = null;
    catalogPromise = null;
    catalogStatus = 'idle';
    catalogError = null;
};

// Convert a Models.dev cost object (USD per 1M tokens) into our pricing shape.
// Returns null when no usable numeric rate is present so callers can surface
// an explicit "price unavailable" state instead of inventing a cost.
export const normalizeModelsDevCost = (cost) => {
    if (!cost || typeof cost !== 'object') return null;

    const input = Number(cost.input);
    const output = Number(cost.output);
    const reasoning = Number(cost.reasoning);
    const cacheRead = Number(cost.cache_read);
    const cacheWrite = Number(cost.cache_write);

    const hasInput = Number.isFinite(input);
    const hasOutput = Number.isFinite(output);
    const hasReasoning = Number.isFinite(reasoning);
    const hasCacheRead = Number.isFinite(cacheRead);
    const hasCacheWrite = Number.isFinite(cacheWrite);

    if (!hasInput && !hasOutput && !hasReasoning && !hasCacheRead && !hasCacheWrite) {
        return null;
    }

    return {
        input: hasInput ? input : 0,
        output: hasOutput ? output : 0,
        reasoning: hasReasoning ? reasoning : 0,
        cacheRead: hasCacheRead ? cacheRead : 0,
        cacheWrite: hasCacheWrite ? cacheWrite : 0,
        // Presence flags distinguish an explicit $0.00 rate (valid, free model)
        // from a field that Models.dev simply did not publish (truly missing).
        hasInput,
        hasOutput,
        hasReasoning,
        hasCacheRead,
        hasCacheWrite,
        source: 'models.dev'
    };
};

// Resolve a model key against the Models.dev catalog.
// Key forms handled:
//   - namespaced router: "openrouter/tencent/hy3:free" -> provider "openrouter", modelId "tencent/hy3:free"
//   - direct provider/model: "anthropic/claude-opus-4-8" -> provider "anthropic", modelId "claude-opus-4-8"
//   - bare model id: "claude-3.5-sonnet" -> search every provider for a matching modelId
// Returns normalized pricing or null if not found / catalog missing.
export const lookupModelsDevPrice = (key, catalog = catalogCache) => {
    if (!catalog || !key) return null;

    const str = String(key);
    const firstSlash = str.indexOf('/');

    // Namespaced router key (2+ slashes) or direct provider/model (1 slash).
    if (firstSlash !== -1) {
        const provider = str.slice(0, firstSlash);
        const modelId = str.slice(firstSlash + 1);
        const entry = catalog[provider]?.models?.[modelId];
        if (entry && entry.cost) {
            const normalized = normalizeModelsDevCost(entry.cost);
            if (normalized) return normalized;
        }
    }

    // Bare key: search every provider for a matching model id.
    if (firstSlash === -1) {
        for (const provider of Object.keys(catalog)) {
            const models = catalog[provider]?.models;
            if (models && models[str] && models[str].cost) {
                const normalized = normalizeModelsDevCost(models[str].cost);
                if (normalized) return normalized;
            }
        }
    }

    return null;
};

// Cost of a token record using real Models.dev pricing. tokens may be a number
// (total tokens) or an object with input/output/cache_read/cache_write/reasoning.
// Returns { total, priced } where priced is false when the rate could not be
// determined so callers can mark the cell as price-unavailable.
export const calculateCostWithPricing = (tokens, pricing) => {
    if (!pricing) return { total: 0, priced: false };

    const toNum = (v) => (typeof v === 'number' ? v : 0);

    if (typeof tokens === 'object' && tokens !== null) {
        const input = toNum(tokens.input);
        const output = toNum(tokens.output);
        const cacheRead = toNum(tokens.cache_read ?? tokens.cacheRead);
        const cacheWrite = toNum(tokens.cache_write ?? tokens.cacheWrite);
        const reasoning = toNum(tokens.reasoning);

        const total =
            (input / 1e6) * pricing.input +
            (output / 1e6) * pricing.output +
            (cacheRead / 1e6) * pricing.cacheRead +
            (cacheWrite / 1e6) * pricing.cacheWrite +
            (reasoning / 1e6) * (pricing.reasoning || 0);

        return { total, priced: true };
    }

    const total = toNum(tokens);
    // Only input + output are known for an aggregate total token count.
    // Prefer explicit presence flags (set by normalizeModelsDevCost) so an
    // explicit $0.00 Models.dev rate stays priced, while a flagless caller falls
    // back to the numeric value to preserve prior behavior.
    const flagOf = (flag, value) => (flag !== undefined ? !!flag : value > 0);
    const hasInput = flagOf(pricing.hasInput, pricing.input);
    const hasOutput = flagOf(pricing.hasOutput, pricing.output);
    const hasReasoning = flagOf(pricing.hasReasoning, pricing.reasoning);

    if (!hasInput && !hasOutput && !hasReasoning) {
        return { total: 0, priced: false };
    }

    // Use the model's own real per-1M rates, never a global constant.
    const rate = hasInput && hasOutput
        ? (pricing.input + pricing.output) / 2
        : hasInput
            ? pricing.input
            : hasReasoning
                ? pricing.reasoning
                : pricing.output;

    return { total: (total / 1e6) * rate, priced: true };
};

// Fetch and cache the Models.dev catalog. Safe to call repeatedly; only the
// first in-flight request hits the network. On failure it records a 'failed'
// status (not just a cleared promise) so callers can surface an explicit
// unavailable message instead of confusing it with a still-loading state, while
// still rejecting so the token metric stays usable. A prior failure can be
// retried by clearing the cache (clearCatalogCache) first.
export const fetchModelsDevCatalog = async (fetchFn = fetch) => {
    if (catalogCache) return catalogCache;
    if (catalogStatus === 'loading' && catalogPromise) return catalogPromise;
    if (catalogStatus === 'failed') {
        // Allow a deliberate retry: a failed request is re-attempted only when
        // the caller explicitly clears the cache first, avoiding silent loops.
        throw new Error('Models.dev catalog previously failed; clear cache to retry');
    }

    catalogStatus = 'loading';
    catalogPromise = (async () => {
        try {
            const res = await fetchFn(MODELS_DEV_API);
            if (!res.ok) throw new Error(`Models.dev catalog request failed: ${res.status}`);
            const json = await res.json();
            catalogCache = json;
            catalogStatus = 'ready';
            catalogError = null;
            return json;
        } catch (err) {
            catalogStatus = 'failed';
            catalogError = err?.message || String(err);
            catalogPromise = null;
            throw err;
        }
    })();

    return catalogPromise;
};
