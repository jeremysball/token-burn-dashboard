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
 * Parse Claude usage object
 * Claude format: {
 *   input_tokens, output_tokens,
 *   cache_read_input_tokens, cache_creation_input_tokens,
 *   cache_creation: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }
 * }
 */
function parseClaudeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  }

  const input = usage.input_tokens || usage.input || 0;
  const output = usage.output_tokens || usage.output || 0;
  const cacheRead = usage.cache_read_input_tokens || usage.cacheRead || 0;

  // cacheWrite = cache_creation_input_tokens OR sum of ephemeral cache creation
  let cacheWrite = usage.cache_creation_input_tokens || usage.cacheWrite || 0;
  if (!cacheWrite && usage.cache_creation) {
    cacheWrite = (usage.cache_creation.ephemeral_5m_input_tokens || 0)
               + (usage.cache_creation.ephemeral_1h_input_tokens || 0);
  }

  const reasoning = usage.reasoning_tokens || usage.reasoning || 0;

  // total = explicit value if provided, otherwise the full sum
  const total = usage.totalTokens != null
    ? usage.totalTokens
    : (input + output + cacheRead + cacheWrite + Number(reasoning));

  return {
    input: Number(input) || 0,
    output: Number(output) || 0,
    cacheRead: Number(cacheRead) || 0,
    cacheWrite: Number(cacheWrite) || 0,
    reasoning: Number(reasoning) || 0,
    total: Number(total) || 0
  };
}

/**
 * Parse Pi/Openclaw usage object
 * Pi format: { input, output, cacheRead, cacheWrite, totalTokens, cost }
 */
function parsePiUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  }

  const input = usage.input || usage.inputTokens || 0;
  const output = usage.output || usage.outputTokens || 0;
  const cacheRead = usage.cacheRead || usage.cache_read || 0;
  const cacheWrite = usage.cacheWrite || usage.cache_write || 0;
  const reasoning = usage.reasoning || usage.reasoning_tokens || 0;
  // totalTokens may be present (including explicit 0), otherwise sum
  const total = usage.totalTokens != null ? usage.totalTokens
    : usage.total != null ? usage.total
    : (input + output + cacheRead + cacheWrite + Number(reasoning));

  return {
    input: Number(input) || 0,
    output: Number(output) || 0,
    cacheRead: Number(cacheRead) || 0,
    cacheWrite: Number(cacheWrite) || 0,
    reasoning: Number(reasoning) || 0,
    total: Number(total) || 0
  };
}

/**
 * Normalize model name and provider
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

  return ts || Date.now();
}

/**
 * Try to detect format and parse single JSONL line into normalized event
 * Returns null if not a token usage event
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
function parseJsonlFile(filePath, sourceHint = 'auto') {
  const result = {
    filePath,
    source: sourceHint,
    total_input: 0,
    total_output: 0,
    total_cache_read: 0,
    total_cache_write: 0,
    total_tokens: 0,
    total_lines: 0,
    messages: 0,
    models: {}, // modelKey -> { input, output, cache_read, cache_write, total, messages }
    events: [],  // for historical: { time, model, input, output, cache_read, cache_write, total }
    firstTimestamp: null,
    lastTimestamp: null,
    timeWindow: null // { startTime, endTime, midpoint }
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    result.total_lines = lines.length;

    const timestamps = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = parseLine(line, sourceHint);
      if (!parsed) continue;

      result.total_input += parsed.input;
      result.total_output += parsed.output;
      result.total_cache_read += parsed.cacheRead;
      result.total_cache_write += parsed.cacheWrite;
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
          total: 0,
          messages: 0,
          sources: new Set()
        };
      }
      result.models[key].input += parsed.input;
      result.models[key].output += parsed.output;
      result.models[key].cache_read += parsed.cacheRead;
      result.models[key].cache_write += parsed.cacheWrite;
      result.models[key].total += parsed.total;
      result.models[key].messages += 1;
      result.models[key].sources.add(parsed.source);

      // Event for historical
      result.events.push({
        time: parsed.timestamp,
        model: key,
        input: parsed.input,
        output: parsed.output,
        cache_read: parsed.cacheRead,
        cache_write: parsed.cacheWrite,
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
    console.error(`Error parsing ${filePath}:`, err.message);
  }

  return result;
}

/**
 * Get cached time window (with TTL) to avoid re-reading file
 * Used by git-blame and spike detective for efficiency
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
