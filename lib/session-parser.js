/**
 * Unified Session Parser
 * Handles both Pi (openclaw) and Claude Code session formats
 * 
 * Normalizes to:
 * {
 *   provider, model, modelKey (provider/model),
 *   input, output, cacheRead, cacheWrite, total,
 *   timestamp (ms since epoch),
 *   messageCount
 * }
 */

const fs = require('fs');

// Cache for file stats to avoid re-parsing for time windows
const timeWindowCache = new Map();
const TIME_WINDOW_CACHE_TTL = 5 * 60 * 1000;

/**
 * @param {*} value
 * @returns {number}
 */
function normalizeTokenCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

// Take the first candidate that's a valid non-negative number; an explicit
// but invalid total (e.g. negative) should fall back to the component sum
// rather than being clamped to 0 and silently discarding real usage.
/**
 * @param {any[]} candidates
 * @param {number} componentSum
 * @returns {number}
 */
function resolveTotal(candidates, componentSum) {
  for (const raw of candidates) {
    if (raw == null) continue;
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return componentSum;
}

/**
 * Parse Claude usage object
 * Claude format: {
 *   input_tokens, output_tokens,
 *   cache_read_input_tokens, cache_creation_input_tokens,
 *   cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }
 * }
 */
/**
 * @param {*} usage
 * @returns {{input: number, output: number, cacheRead: number, cacheWrite: number, reasoning: number, total: number}}
 */
function parseClaudeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 };
  }

  const input = normalizeTokenCount(usage.input_tokens ?? usage.input);
  const output = normalizeTokenCount(usage.output_tokens ?? usage.output);
  const cacheRead = normalizeTokenCount(usage.cache_read_input_tokens ?? usage.cacheRead);

  // cacheWrite = cache_creation_input_tokens OR sum of ephemeral cache creation
  let cacheWrite = usage.cache_creation_input_tokens ?? usage.cacheWrite;
  if (cacheWrite == null && usage.cache_creation) {
    cacheWrite = normalizeTokenCount(usage.cache_creation.ephemeral_5m_input_tokens)
               + normalizeTokenCount(usage.cache_creation.ephemeral_1h_input_tokens);
  }
  cacheWrite = normalizeTokenCount(cacheWrite);

  const reasoning = normalizeTokenCount(usage.reasoning_tokens ?? usage.reasoning);

  // total = explicit value if valid, otherwise the full sum
  const total = resolveTotal([usage.totalTokens], input + output + cacheRead + cacheWrite + reasoning);

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total
  };
}

/**
 * Parse Pi/Openclaw usage object
 * Pi format: { input, output, cacheRead, cacheWrite, totalTokens, cost }
 */
/**
 * @param {*} usage
 * @returns {{input: number, output: number, cacheRead: number, cacheWrite: number, reasoning: number, total: number}}
 */
function parsePiUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 };
  }

  const input = normalizeTokenCount(usage.input ?? usage.inputTokens);
  const output = normalizeTokenCount(usage.output ?? usage.outputTokens);
  const cacheRead = normalizeTokenCount(usage.cacheRead ?? usage.cache_read);
  const cacheWrite = normalizeTokenCount(usage.cacheWrite ?? usage.cache_write);
  const reasoning = normalizeTokenCount(usage.reasoning ?? usage.reasoning_tokens);
  // totalTokens/total may be present (including explicit 0), otherwise sum
  const total = resolveTotal(
    [usage.totalTokens, usage.total],
    input + output + cacheRead + cacheWrite + reasoning
  );

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning,
    total
  };
}

/**
 * Normalize model name and provider
 */
/**
 * @param {*} data
 * @param {string} source
 * @returns {{provider: string, model: string, modelKey: string}}
 */
function normalizeModelInfo(data, source) {
  let provider;
  let model;
  let modelKey;

  if (source === 'claude') {
    model = data?.message?.model || data?.model || 'unknown';
    provider = 'anthropic';
    if (model.includes('/')) {
      const parts = model.split('/');
      provider = parts[0].toLowerCase();
      model = parts.slice(1).join('/');
    } else {
      if (model.toLowerCase().includes('claude')) provider = 'anthropic';
      else if (model.toLowerCase().includes('gpt')) provider = 'openai';
      else if (model.toLowerCase().includes('gemini')) provider = 'google';
    }
    modelKey = `${provider}/${model}`;
  } else {
    const msg = data.message || {};
    provider = msg.provider || data.provider || 'unknown';
    model = msg.model || data.model || 'unknown';
    modelKey = provider !== 'unknown' ? `${provider}/${model}` : model;
  }

  return { provider, model, modelKey };
}

/**
 * Parse timestamp to ms
 */
/**
 * @param {*} data
 * @returns {number|null}
 */
function parseTimestamp(data) {
  // Try various timestamp locations
  let ts = null;

  // Pi: data.message.timestamp (number ms) or data.timestamp (ISO or number)
  // Claude: data.timestamp (ISO), data.message.timestamp? 
  if (data.message && typeof data.message.timestamp === 'number') {
    ts = data.message.timestamp;
  } else if (data.timestamp) {
    if (typeof data.timestamp === 'number') {
      ts = data.timestamp;
    } else {
      // ISO string
      const parsed = Date.parse(data.timestamp);
      if (!isNaN(parsed)) ts = parsed;
    }
  } else if (data.message && data.message.timestamp) {
    const parsed = Date.parse(data.message.timestamp);
    if (!isNaN(parsed)) ts = parsed;
  }

  return ts;
}

/**
 * Try to detect format and parse single JSONL line into normalized event
 * Returns null if not a token usage event
 */
/**
 * @param {string} line
 * @returns {*|null}
 */
function parseLine(line) {
  if (!line || !line.trim()) return null;

  try {
    const data = JSON.parse(line);

    // ---- Claude format detection ----
    // type: "assistant" with message.usage, OR type: "assistant" is message wrapper
    if (data.type === 'assistant' && data.message && data.message.usage) {
      const usage = parseClaudeUsage(data.message.usage);
      // Only count if has tokens
      if (usage.total === 0 && usage.input === 0 && usage.output === 0) return null;
      
      const { provider, model, modelKey } = normalizeModelInfo(data, 'claude');
      const timestamp = parseTimestamp(data);

      return {
        source: 'claude',
        provider,
        model,
        modelKey,
        ...usage,
        timestamp,
        raw: data
      };
    }

    // ---- Pi / OpenClaw format ----
    if (data.type === 'message' && data.message?.usage) {
      const usage = parsePiUsage(data.message.usage);
      if (usage.total === 0 && usage.input === 0 && usage.output === 0) {
        // Still allow if message exists but tokens zero? Skip to save processing
        // But count as message? For now skip zero-token events for efficiency
        // We still return null for zero events to avoid noise, but historical may need?
        // Return even if zero? Let's return only if total>0 OR we want messages count
        // For token purposes, skip zero
        if (usage.input === 0 && usage.output === 0 && usage.cacheRead === 0 && usage.cacheWrite === 0) {
          return null;
        }
      }

      const { provider, model, modelKey } = normalizeModelInfo(data, 'pi');
      const timestamp = parseTimestamp(data);

      return {
        source: 'pi',
        provider,
        model: modelKey.includes('/') ? modelKey : model,
        modelKey,
        ...usage,
        timestamp,
        raw: data
      };
    }

    // Other types (session, model_change, etc) ignored
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse an entire JSONL file, returning aggregated stats and events
 * Optimized: reads file once, extracts everything needed
 */
/**
 * @param {string} filePath
 * @param {string} [sourceHint]
 * @returns {*}
 */
function parseJsonlFile(filePath, sourceHint = 'auto') {
  const result = {
    filePath,
    source: sourceHint,
    total_input: 0,
    total_output: 0,
    total_cache_read: 0,
    total_cache_write: 0,
    total_reasoning: 0,
    total_tokens: 0,
    total_lines: 0,
    messages: 0,
    /** @type {Record<string, {input: number, output: number, cache_read: number, cache_write: number, reasoning: number, total: number, messages: number, sources?: Set<string>, _sources?: string[]}>} */
    models: {},
    /** @type {any[]} */
    events: [],
    firstTimestamp: null,
    lastTimestamp: null,
    /** @type {{startTime: number, endTime: number, midpoint: number}|null} */
    timeWindow: null
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    result.total_lines = lines.filter(line => line.trim()).length;

    const timestamps = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseLine(line);
      if (!parsed) continue;

      result.total_input += parsed.input;
      result.total_output += parsed.output;
      result.total_cache_read += parsed.cacheRead;
      result.total_cache_write += parsed.cacheWrite;
      result.total_reasoning += parsed.reasoning || 0;
      result.total_tokens += parsed.total;
      result.messages += 1;

      if (parsed.timestamp) {
        timestamps.push(parsed.timestamp);
        if (!result.firstTimestamp || parsed.timestamp < result.firstTimestamp) {
          result.firstTimestamp = parsed.timestamp;
        }
        if (!result.lastTimestamp || parsed.timestamp > result.lastTimestamp) {
          result.lastTimestamp = parsed.timestamp;
        }
      }

      // Per-model aggregation
      const key = parsed.modelKey || 'unknown/unknown';
      if (!result.models[key]) {
        result.models[key] = {
          input: 0,
          output: 0,
          cache_read: 0,
          cache_write: 0,
          reasoning: 0,
          total: 0,
          messages: 0,
          sources: new Set()
        };
      }
      const modelEntry = result.models[key];
      if (modelEntry) {
        modelEntry.input += parsed.input;
        modelEntry.output += parsed.output;
        modelEntry.cache_read += parsed.cacheRead;
        modelEntry.cache_write += parsed.cacheWrite;
        modelEntry.reasoning += parsed.reasoning || 0;
        modelEntry.total += parsed.total;
        modelEntry.messages += 1;
        if (modelEntry.sources) modelEntry.sources.add(parsed.source);
      }

      // Event for historical
      result.events.push({
        time: parsed.timestamp,
        model: key,
        input: parsed.input,
        output: parsed.output,
        cache_read: parsed.cacheRead,
        cache_write: parsed.cacheWrite,
        reasoning: parsed.reasoning || 0,
        total: parsed.total,
        source: parsed.source
      });
    }

    // Build time window
    if (timestamps.length > 0) {
      timestamps.sort((a, b) => a - b);
      const start = timestamps[0];
      const end = timestamps[timestamps.length - 1];
      result.timeWindow = {
        startTime: start,
        endTime: end,
        midpoint: start + (end - start) / 2
      };
    } else {
      // Fallback to file mtime
      try {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtime.getTime();
        result.timeWindow = {
          startTime: mtime,
          endTime: mtime,
          midpoint: mtime
        };
      } catch {
        // ignore
      }
    }

    // Convert Sets to arrays for serialization (models.sources)
    for (const m of Object.values(result.models)) {
      if (m.sources instanceof Set) {
        m._sources = Array.from(m.sources);
        delete m.sources;
      }
    }

  } catch (err) {
    console.error(`Error parsing ${filePath}:`, /** @type {Error} */ (err).message);
  }

  return result;
}

/**
 * Get cached time window (with TTL) to avoid re-reading file
 * Used by git-blame and spike detective for efficiency
 */
/**
 * @param {string} filePath
 * @param {boolean} [forceRefresh]
 * @returns {*|null}
 */
function getCachedTimeWindow(filePath, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && timeWindowCache.has(filePath)) {
    const entry = timeWindowCache.get(filePath);
    if (now - entry.cachedAt < TIME_WINDOW_CACHE_TTL) {
      return entry.window;
    }
  }

  const data = parseJsonlFile(filePath, 'auto');
  const window = data.timeWindow;
  if (window) {
    timeWindowCache.set(filePath, { window, cachedAt: now });
  }
  return window;
}

/**
 * Clear time window cache (for testing or memory management)
 */
function clearTimeWindowCache() {
  timeWindowCache.clear();
}

module.exports = {
  parseClaudeUsage,
  parsePiUsage,
  parseLine,
  parseJsonlFile,
  normalizeModelInfo,
  getCachedTimeWindow,
  clearTimeWindowCache
};
