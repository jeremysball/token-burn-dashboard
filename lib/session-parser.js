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

// Cache of full parsed file data (tokens/models/messages/timeWindow/
// previews) to avoid re-reading and re-parsing the same session file.
const fileDataCache = new Map();
const FILE_DATA_CACHE_TTL = 5 * 60 * 1000;

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
 * Detect format and normalize an already-JSON.parsed JSONL line into a
 * token-usage event. Split out from parseLine so a caller that needs to
 * inspect the same parsed line for other purposes (e.g. previews) doesn't
 * have to JSON.parse the line a second time.
 * Returns null if not a token usage event.
 * @param {*} data
 * @returns {*|null}
 */
function parseParsedLine(data) {
  try {
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
 * Try to detect format and parse single JSONL line into normalized event
 * Returns null if not a token usage event
 */
/**
 * @param {string} line
 * @returns {*|null}
 */
function parseLine(line) {
  if (!line || !line.trim()) return null;

  let data;
  try {
    data = JSON.parse(line);
  } catch {
    return null;
  }

  return parseParsedLine(data);
}

/**
 * Extract a preview from message content (handles OpenAI-style array
 * content and stringifies plain objects), truncated to ~100 chars.
 * @param {*} content
 * @returns {string|null}
 */
function extractPreview(content) {
  if (!content) return null;

  // Handle array content (OpenAI format)
  if (Array.isArray(content)) {
    content = content
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join(' ');
  }

  // Handle object content
  if (typeof content === 'object') {
    content = JSON.stringify(content);
  }

  // Handle scalar non-string content (numbers, booleans, etc.)
  if (typeof content !== 'string') {
    content = String(content);
  }

  // Clean up and truncate
  let preview = content
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 120);

  if (preview.length > 100) {
    preview = preview.substring(0, 100) + '...';
  }

  return preview || null;
}

/**
 * Extract a preview from an already-JSON.parsed JSONL line, covering both
 * Claude (type: 'user', text in message.content) and Pi (type: 'message',
 * message.role === 'user') line shapes.
 * @param {*} data
 * @returns {string|null}
 */
function extractPreviewFromParsedLine(data) {
  const isClaudeUserTurn = data.type === 'user' && data.message;
  const isPiUserTurn = data.type === 'message' && data.message?.role === 'user';
  if (!isClaudeUserTurn && !isPiUserTurn) return null;
  return extractPreview(data.message.content);
}

/**
 * Parse an entire JSONL file, returning aggregated stats and events
 * Optimized: reads file once, extracts everything needed
 */
/**
 * @param {string} filePath
 * @param {string} [sourceHint]
 * @param {{collectEvents?: boolean, collectPreviews?: boolean, collectEventPreviews?: boolean}} [options]
 * @returns {*}
 */
function parseJsonlFile(filePath, sourceHint = 'auto', options = {}) {
  const collectEvents = options.collectEvents !== false;
  const collectPreviews = options.collectPreviews === true;
  const collectEventPreviews = options.collectEventPreviews === true;
  const MAX_PREVIEWS = 3;

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
    /** @type {string[]} */
    previews: [],
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

      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }

      if (collectPreviews && result.previews.length < MAX_PREVIEWS) {
        const preview = extractPreviewFromParsedLine(data);
        if (preview) result.previews.push(preview);
      }

      const parsed = parseParsedLine(data);
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
      if (collectEvents) {
        result.events.push({
          time: parsed.timestamp,
          model: key,
          input: parsed.input,
          output: parsed.output,
          cache_read: parsed.cacheRead,
          cache_write: parsed.cacheWrite,
          reasoning: parsed.reasoning || 0,
          total: parsed.total,
          source: parsed.source,
          preview: collectEventPreviews ? (extractPreview(data.message?.content) || 'No content') : null
        });
      }
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
 * @param {string} filePath
 * @param {{collectEvents?: boolean, collectPreviews?: boolean, collectEventPreviews?: boolean}} options
 * @returns {string}
 */
function fileDataCacheKey(filePath, options) {
  // Mirror parseJsonlFile's own option defaulting exactly (collectEvents
  // defaults true, the others default false) so a call that omits an
  // option can never collide with one that explicitly passes its opposite.
  const collectEvents = options.collectEvents !== false;
  const collectPreviews = options.collectPreviews === true;
  const collectEventPreviews = options.collectEventPreviews === true;
  return `${filePath}::${collectEvents ? 1 : 0}${collectPreviews ? 1 : 0}${collectEventPreviews ? 1 : 0}`;
}

/**
 * @param {string} filePath
 * @returns {number|null}
 */
function safeMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * @param {*} entry
 * @param {number} now
 * @param {number|null} mtimeMs
 * @returns {boolean}
 */
function isCacheEntryFresh(entry, now, mtimeMs) {
  const stillFresh = now - entry.cachedAt < FILE_DATA_CACHE_TTL;
  const unchanged = mtimeMs === null || mtimeMs === entry.mtimeMs;
  return stillFresh && unchanged;
}

/**
 * Get a cached full parseJsonlFile result (tokens/models/messages/timeWindow/
 * previews, per the passed options), avoiding a re-read+re-parse of a file
 * that was already scanned recently. Used by spike detective so
 * investigating multiple overlapping spike windows doesn't re-parse the same
 * session files from scratch every time.
 * @param {string} filePath
 * @param {{collectEvents?: boolean, collectPreviews?: boolean, collectEventPreviews?: boolean}} [options]
 * @param {boolean} [forceRefresh]
 * @returns {*}
 */
function getCachedFileData(filePath, options = {}, forceRefresh = false) {
  const cacheKey = fileDataCacheKey(filePath, options);
  const now = Date.now();
  const mtimeMs = safeMtimeMs(filePath);

  if (!forceRefresh && fileDataCache.has(cacheKey)) {
    const entry = fileDataCache.get(cacheKey);
    if (isCacheEntryFresh(entry, now, mtimeMs)) {
      return entry.data;
    }
  }

  const data = parseJsonlFile(filePath, 'auto', options);
  fileDataCache.set(cacheKey, { data, cachedAt: now, mtimeMs });
  return data;
}

/**
 * Clear the cached file-data cache (for testing or memory management)
 */
function clearFileDataCache() {
  fileDataCache.clear();
}

module.exports = {
  parseClaudeUsage,
  parsePiUsage,
  parseLine,
  parseJsonlFile,
  normalizeModelInfo,
  getCachedFileData,
  clearFileDataCache
};
