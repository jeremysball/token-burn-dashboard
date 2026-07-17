const https = require('https');

const OPENROUTER_MODELS_URL = process.env.OPENROUTER_MODELS_URL || 'https://openrouter.ai/api/v1/models';
const OPENROUTER_REFRESH_MS = Number(process.env.OPENROUTER_REFRESH_MS || 6 * 60 * 60 * 1000);
const OPENROUTER_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS || 15_000);

let cache = {
  fetchedAt: 0,
  source: 'local',
  models: [],
  index: new Map(),
  error: null
};

let refreshPromise = null;

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeAlias(value) {
  return normalizeKey(value)
    .replace(/[^a-z0-9/.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function stripProviderPrefix(value) {
  const key = normalizeKey(value);
  return key.includes('/') ? key.split('/').pop() : key;
}

function priceToPerMillion(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num === 0) return 0;
  return Math.round(num * 1_000_000 * 1_000_000) / 1_000_000;
}

function normalizePrice(value) {
  return priceToPerMillion(value) ?? undefined;
}

function buildOpenRouterPricingRecord(model) {
  if (!model || typeof model !== 'object') return null;

  const pricing = model.pricing || {};
  const id = normalizeKey(model.id);
  const canonicalSlug = normalizeKey(model.canonical_slug || model.id);
  const modelSlug = stripProviderPrefix(id || canonicalSlug);

  return {
    id: model.id || canonicalSlug,
    canonicalSlug: model.canonical_slug || model.id || id,
    name: model.name || model.id || modelSlug,
    provider: id.includes('/') ? id.split('/')[0] : null,
    contextLength: model.context_length || null,
    input: normalizePrice(pricing.prompt ?? pricing.input),
    output: normalizePrice(pricing.completion ?? pricing.output),
    cacheRead: normalizePrice(pricing.input_cache_read ?? pricing.cache_read ?? pricing.cacheRead),
    cacheWrite: normalizePrice(pricing.input_cache_write ?? pricing.cache_write ?? pricing.cacheWrite),
    source: 'openrouter'
  };
}

function buildModelAliases(record) {
  const aliases = new Set();

  if (!record) return aliases;

  const directId = normalizeKey(record.id);
  const canonicalSlug = normalizeKey(record.canonicalSlug);
  const slug = stripProviderPrefix(record.id || record.canonicalSlug);

  [directId, canonicalSlug, slug].forEach(value => {
    if (value) aliases.add(value);
  });

  if (record.name) {
    aliases.add(normalizeAlias(record.name));
  }

  // Add provider-stripped aliases for namespaced ids like openai/gpt-4o
  if (directId.includes('/')) {
    const parts = directId.split('/');
    aliases.add(parts[parts.length - 1]);
  }

  return aliases;
}

function buildPricingIndex(models) {
  const index = new Map();
  const records = [];

  for (const model of models || []) {
    const record = buildOpenRouterPricingRecord(model);
    if (!record) continue;

    records.push(record);
    for (const alias of buildModelAliases(record)) {
      index.set(alias, record);
    }
  }

  return { records, index };
}

function isFresh() {
  return cache.fetchedAt > 0 && Date.now() - cache.fetchedAt < OPENROUTER_REFRESH_MS;
}

function fetchJson(url, timeoutMs = OPENROUTER_TIMEOUT_MS) {
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
          reject(new Error(`OpenRouter request failed with status ${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Failed to parse OpenRouter response: ${err.message}`));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('OpenRouter request timeout'));
    });
  });
}

async function refreshOpenRouterPricing(force = false) {
  if (!force && isFresh()) {
    return cache;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetchJson(OPENROUTER_MODELS_URL);
      const models = Array.isArray(response?.data) ? response.data : [];
      const { records, index } = buildPricingIndex(models);

      cache = {
        fetchedAt: Date.now(),
        source: 'openrouter',
        models: records,
        index,
        error: null
      };
    } catch (error) {
      cache = {
        ...cache,
        source: cache.models.length > 0 ? 'openrouter-cache' : 'local',
        error: error.message
      };
    } finally {
      refreshPromise = null;
    }

    return cache;
  })();

  return refreshPromise;
}

function getOpenRouterPricingRecord(modelName) {
  const key = normalizeKey(modelName);
  if (!key) return null;

  const modelOnly = stripProviderPrefix(key);
  const candidates = [key, modelOnly, normalizeAlias(key), normalizeAlias(modelOnly)];

  for (const candidate of candidates) {
    if (cache.index.has(candidate)) {
      return cache.index.get(candidate);
    }
  }

  // Fuzzy fallback: match by normalized aliases
  const normalizedTarget = normalizeAlias(modelOnly || key);
  for (const record of cache.models) {
    const aliases = buildModelAliases(record);
    for (const alias of aliases) {
      const normalizedAlias = normalizeAlias(alias);
      if (!normalizedAlias) continue;
      if (
        normalizedAlias === normalizedTarget ||
        normalizedAlias.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedAlias)
      ) {
        return record;
      }
    }
  }

  return null;
}

function getOpenRouterPricingSnapshot() {
  return {
    fetchedAt: cache.fetchedAt,
    source: cache.source,
    error: cache.error,
    count: cache.models.length,
    models: cache.models.map(model => ({ ...model }))
  };
}

function setOpenRouterPricingSnapshot(snapshot) {
  const models = Array.isArray(snapshot?.models) ? snapshot.models : [];
  const { records, index } = buildPricingIndex(models);

  cache = {
    fetchedAt: snapshot?.fetchedAt || Date.now(),
    source: snapshot?.source || 'openrouter',
    models: records,
    index,
    error: snapshot?.error || null
  };
}

// Warm the cache in the background without blocking startup.
if (process.env.NODE_ENV !== 'test' && process.env.OPENROUTER_DISABLE_AUTOFETCH !== '1') {
  refreshOpenRouterPricing().catch(() => {});
}

module.exports = {
  OPENROUTER_MODELS_URL,
  buildOpenRouterPricingRecord,
  buildPricingIndex,
  getOpenRouterPricingRecord,
  getOpenRouterPricingSnapshot,
  refreshOpenRouterPricing,
  setOpenRouterPricingSnapshot,
  stripProviderPrefix,
  normalizeAlias,
  priceToPerMillion
};
