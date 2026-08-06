/**
 * Server-side Models.dev pricing source.
 *
 * Mirrors lib/openrouter.js's fetch/cache/refresh/snapshot machinery so
 * getPricing() can merge in real, live-fetched rates instead of relying on
 * the local hardcoded fallback table for every model that table hasn't been
 * updated to cover (e.g. a newly released model whose local pattern falls
 * through to a generic vendor-wide catch-all and gets mispriced).
 *
 * Models.dev publishes a provider-scoped catalog at https://models.dev/api.json
 * shaped like catalog[provider].models[modelId] where cost values are USD
 * per 1M tokens. dashboard/js/modelsdev-pricing.js is the browser-side
 * counterpart used by the heatmap cost metric; keep the catalog-shape
 * assumptions (provider/model nesting, cost field names) in sync with that
 * module if models.dev's schema changes.
 */

const https = require('https');
const { normalizeAlias, stripProviderPrefix } = require('./openrouter');

const MODELS_DEV_API = process.env.MODELS_DEV_API || 'https://models.dev/api.json';
const MODELS_DEV_REFRESH_MS = Number(process.env.MODELS_DEV_REFRESH_MS || 6 * 60 * 60 * 1000);
const MODELS_DEV_TIMEOUT_MS = Number(process.env.MODELS_DEV_TIMEOUT_MS || 15_000);

/** @type {{ fetchedAt: number, source: string, catalog: Record<string, any>, models: Array<Record<string, any>>, index: Map<string, Record<string, any>>, error: (string|null) }} */
let cache = {
  fetchedAt: 0,
  source: 'local',
  catalog: {},
  models: [],
  index: new Map(),
  error: null
};

/** @type {Promise<Record<string, any>>|null} */
let refreshPromise = null;

/**
 * @param {any} value
 * @returns {string}
 */
function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

/**
 * @param {any} value
 * @returns {number|undefined}
 */
function readCostField(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * @param {string} provider
 * @param {string} modelId
 * @param {Record<string, any>} entry
 * @returns {Record<string, any>|null}
 */
function buildModelsDevPricingRecord(provider, modelId, entry) {
  if (!entry || typeof entry !== 'object') return null;

  const cost = entry.cost || {};
  const fields = {
    input: readCostField(cost.input),
    output: readCostField(cost.output),
    cacheRead: readCostField(cost.cache_read),
    cacheWrite: readCostField(cost.cache_write),
    reasoning: readCostField(cost.reasoning)
  };

  const hasAnyRate = Object.values(fields).some(value => value !== undefined);
  if (!hasAnyRate) return null;

  const id = `${provider}/${modelId}`;

  return {
    id,
    canonicalSlug: id,
    name: entry.name || modelId,
    provider,
    contextLength: entry.limit?.context ?? null,
    ...fields,
    source: 'models.dev'
  };
}

/**
 * @param {Record<string, any>} record
 * @returns {Set<string>}
 */
function buildAliases(record) {
  const aliases = new Set();
  const directId = normalizeKey(record.id);
  const bare = stripProviderPrefix(directId);

  [directId, bare].forEach(value => {
    if (!value) return;
    aliases.add(value);
    const aliased = normalizeAlias(value);
    if (aliased && aliased !== value) aliases.add(aliased);
    // models.dev sometimes uses a dotted version segment (e.g. "4.5") where
    // our local session data uses a hyphen (e.g. "4-5"); index both.
    if (value.includes('.')) aliases.add(value.replace(/\./g, '-'));
  });

  return aliases;
}

/**
 * @param {Record<string, any>|undefined} catalog
 * @returns {{ records: Array<Record<string, any>>, index: Map<string, Record<string, any>> }}
 */
function buildCatalogIndex(catalog) {
  const index = new Map();
  const records = [];
  const safeCatalog = catalog || {};

  for (const provider of Object.keys(safeCatalog)) {
    const models = safeCatalog[provider]?.models;
    if (!models || typeof models !== 'object') continue;

    for (const modelId of Object.keys(models)) {
      const record = buildModelsDevPricingRecord(provider, modelId, models[modelId]);
      if (!record) continue;

      records.push(record);
      for (const alias of buildAliases(record)) {
        index.set(alias, record);
      }
    }
  }

  return { records, index };
}

function isFresh() {
  return cache.fetchedAt > 0 && Date.now() - cache.fetchedAt < MODELS_DEV_REFRESH_MS;
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 * @returns {Promise<Record<string, any>>}
 */
function fetchJson(url, timeoutMs = MODELS_DEV_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'User-Agent': 'token-burn-dashboard/0.1.0',
        'Accept': 'application/json'
      }
    }, (response) => {
      let body = '';

      response.on('data', (chunk) => {
        body += chunk;
      });

      response.on('end', () => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`Models.dev request failed with status ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (err) {
          const e = /** @type {Error} */ (err);
          reject(new Error(`Failed to parse Models.dev response: ${e.message}`));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Models.dev request timeout'));
    });
  });
}

async function refreshModelsDevPricing(force = false) {
  if (!force && isFresh()) {
    return cache;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const catalog = await fetchJson(MODELS_DEV_API);
      const { records, index } = buildCatalogIndex(catalog);

      cache = {
        fetchedAt: Date.now(),
        source: 'models.dev',
        catalog,
        models: records,
        index,
        error: null
      };
    } catch (error) {
      const e = /** @type {Error} */ (error);
      cache = {
        ...cache,
        source: cache.models.length > 0 ? 'models.dev-cache' : 'local',
        error: e.message
      };
    } finally {
      refreshPromise = null;
    }

    return cache;
  })();

  return refreshPromise;
}

/**
 * @param {string} modelName
 * @returns {Record<string, any>|null}
 */
/**
 * Fuzzy fallback: exact normalized-alias equality only, never a substring
 * match — a substring match would let e.g. "gpt-4o" silently resolve to
 * "gpt-4o-mini"'s pricing whenever one id happens to prefix/suffix another.
 * @param {string} normalizedTarget
 * @returns {Record<string, any>|null}
 */
function findByAliasEquality(normalizedTarget) {
  if (!normalizedTarget) return null;

  for (const record of cache.models) {
    for (const alias of buildAliases(record)) {
      const normalizedAlias = normalizeAlias(alias);
      if (normalizedAlias && normalizedAlias === normalizedTarget) return record;
    }
  }
  return null;
}

/**
 * @param {string} modelName
 * @returns {Record<string, any>|null}
 */
function getModelsDevPricingRecord(modelName) {
  const key = normalizeKey(modelName);
  if (!key) return null;

  const modelOnly = stripProviderPrefix(key);
  const candidates = [key, modelOnly, normalizeAlias(key), normalizeAlias(modelOnly)];

  for (const candidate of candidates) {
    if (cache.index.has(candidate)) {
      return cache.index.get(candidate) || null;
    }
  }

  return findByAliasEquality(normalizeAlias(modelOnly || key));
}

/**
 * Returns the RAW Models.dev catalog (not the built pricing records/index),
 * so a round-trip through setModelsDevPricingSnapshot rebuilds identical
 * records via buildCatalogIndex instead of re-parsing already-transformed
 * records as if they were the raw catalog shape.
 * @returns {{ fetchedAt: number, source: string, error: (string|null), catalog: Record<string, any> }}
 */
function getModelsDevPricingSnapshot() {
  return {
    fetchedAt: cache.fetchedAt,
    source: cache.source,
    error: cache.error,
    catalog: cache.catalog
  };
}

/**
 * @param {Record<string, any>|null} snapshot
 */
function setModelsDevPricingSnapshot(snapshot) {
  const catalog = snapshot?.catalog && typeof snapshot.catalog === 'object' ? snapshot.catalog : {};
  const { records, index } = buildCatalogIndex(catalog);

  cache = {
    fetchedAt: snapshot?.fetchedAt || Date.now(),
    source: snapshot?.source || 'models.dev',
    catalog,
    models: records,
    index,
    error: snapshot?.error || null
  };
}

// Warm the cache in the background without blocking startup.
if (process.env.NODE_ENV !== 'test' && process.env.MODELS_DEV_DISABLE_AUTOFETCH !== '1') {
  refreshModelsDevPricing().catch(() => {});
}

module.exports = {
  MODELS_DEV_API,
  buildModelsDevPricingRecord,
  buildCatalogIndex,
  getModelsDevPricingRecord,
  getModelsDevPricingSnapshot,
  refreshModelsDevPricing,
  setModelsDevPricingSnapshot
};
