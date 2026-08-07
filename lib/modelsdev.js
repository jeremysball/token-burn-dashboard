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
 * A provider counts as the "native" first-party host of a model when its
 * models.dev SDK adapter is its own dedicated package (e.g. anthropic's
 * `npm: "@ai-sdk/anthropic"`), as opposed to a reseller/proxy speaking
 * through a generic adapter like `@ai-sdk/openai-compatible`. Used only to
 * break ties when the same bare model id is hosted by multiple providers.
 * @param {Record<string, any>} catalog
 * @param {Record<string, any>} record
 * @returns {boolean}
 */
function isNativeAdapter(catalog, record) {
  const npm = catalog?.[record.provider]?.npm;
  return typeof npm === 'string' && npm === `@ai-sdk/${record.provider}`;
}

/**
 * @param {Record<string, any>} safeCatalog
 * @returns {Array<Record<string, any>>}
 */
function collectCatalogRecords(safeCatalog) {
  const records = [];

  for (const provider of Object.keys(safeCatalog)) {
    const models = safeCatalog[provider]?.models;
    if (!models || typeof models !== 'object') continue;

    for (const modelId of Object.keys(models)) {
      const record = buildModelsDevPricingRecord(provider, modelId, models[modelId]);
      if (record) records.push(record);
    }
  }

  return records;
}

/**
 * Every record's own fully-qualified id resolves to itself, unconditionally.
 * Models.dev sometimes nests a compound modelId that already contains a "/"
 * (e.g. modelscope's "ZhipuAI/GLM-4.5"), whose stripped "bare" alias then
 * collides with a *different* provider's real direct id (a bare-lookup for
 * "zhipuai/glm-4.5" must never resolve to modelscope's listing) -- so direct
 * ids are indexed first and are never overwritten by any other record's
 * derived alias.
 * @param {Array<Record<string, any>>} records
 * @returns {Map<string, Record<string, any>>}
 */
function indexDirectIds(records) {
  const index = new Map();
  for (const record of records) {
    index.set(normalizeKey(record.id), record);
  }
  return index;
}

/**
 * Groups every record's derived (non-direct) aliases by alias key, so the
 * caller can tell how many distinct records contend for each one.
 * @param {Array<Record<string, any>>} records
 * @returns {Map<string, Set<Record<string, any>>>}
 */
function collectAliasCandidates(records) {
  const aliasCandidates = new Map();

  for (const record of records) {
    const directId = normalizeKey(record.id);
    for (const alias of buildAliases(record)) {
      if (alias === directId) continue;
      if (!aliasCandidates.has(alias)) aliasCandidates.set(alias, new Set());
      aliasCandidates.get(alias).add(record);
    }
  }

  return aliasCandidates;
}

/**
 * The same model id is listed under every reseller that hosts it -- often a
 * dozen or more providers with wildly different (sometimes $0) rates -- so
 * picking whichever happened to be processed last (or first) would silently
 * return an arbitrary reseller's price instead of a real one. If exactly one
 * contending record is that model's native first-party adapter, prefer it;
 * otherwise there's no safe single answer.
 * @param {Set<Record<string, any>>} candidateSet
 * @param {Record<string, any>} safeCatalog
 * @returns {Record<string, any>|null}
 */
function resolveAliasCandidate(candidateSet, safeCatalog) {
  const candidates = Array.from(candidateSet);
  if (candidates.length === 1) return candidates[0];

  const nativeCandidates = candidates.filter(record => isNativeAdapter(safeCatalog, record));
  return nativeCandidates.length === 1 ? nativeCandidates[0] : null;
}

/**
 * @param {Record<string, any>|undefined} catalog
 * @returns {{ records: Array<Record<string, any>>, index: Map<string, Record<string, any>> }}
 */
function buildCatalogIndex(catalog) {
  const safeCatalog = catalog || {};
  const records = collectCatalogRecords(safeCatalog);
  const index = indexDirectIds(records);
  const aliasCandidates = collectAliasCandidates(records);

  for (const [alias, candidateSet] of aliasCandidates) {
    if (index.has(alias)) continue; // a direct id already owns this key
    const resolved = resolveAliasCandidate(candidateSet, safeCatalog);
    if (resolved) index.set(alias, resolved);
    // else: genuinely ambiguous across multiple resellers -- leave unindexed.
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

  const matches = new Set();
  for (const record of cache.models) {
    for (const alias of buildAliases(record)) {
      const normalizedAlias = normalizeAlias(alias);
      if (normalizedAlias && normalizedAlias === normalizedTarget) {
        matches.add(record);
        break;
      }
    }
  }

  if (matches.size === 0) return null;
  if (matches.size === 1) return matches.values().next().value;

  // Same ambiguity rule as buildCatalogIndex: only resolve when exactly one
  // contending record is the native first-party adapter for its provider.
  const nativeMatches = Array.from(matches).filter(record => isNativeAdapter(cache.catalog, record));
  return nativeMatches.length === 1 ? nativeMatches[0] : null;
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
    // Deep-cloned so a caller mutating the returned catalog (or a nested
    // provider/model entry within it) can never alias into the live module
    // cache -- unlike openrouter.js's flat model array, the catalog here is
    // nested (provider -> models -> entry), so a shallow copy wouldn't
    // protect the inner objects.
    catalog: structuredClone(cache.catalog)
  };
}

/**
 * @param {Record<string, any>|null} snapshot
 */
function setModelsDevPricingSnapshot(snapshot) {
  const catalog = snapshot?.catalog && typeof snapshot.catalog === 'object' ? snapshot.catalog : {};
  const { records, index } = buildCatalogIndex(catalog);

  cache = {
    // `0` is a real, meaningful "never fetched" sentinel (see isFresh()) --
    // `||` would treat it as absent and stamp the snapshot fresh, blocking
    // retries for a full refresh cycle. Only fall back to Date.now() when
    // fetchedAt is genuinely missing (undefined/null), not when it's 0.
    fetchedAt: typeof snapshot?.fetchedAt === 'number' ? snapshot.fetchedAt : Date.now(),
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
