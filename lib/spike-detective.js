/**
 * Spike Detective - Investigate cost spikes by linking to actual sessions
 */

const fs = require('fs');
const path = require('path');
const { calculateCost } = require('./pricing');
const { findAllSessionFiles } = require('./session-discovery');
const { parseLine, parseJsonlFile } = require('./session-parser');

// Bytes read from the start of a session file to cheaply estimate its
// earliest timestamp, without fully parsing the whole (potentially huge,
// continuously-appended) file. Large enough to hold several JSONL lines
// even for verbose, tool-output-heavy transcripts.
const APPROX_START_SAMPLE_BYTES = 65536;

/**
 * Get sessions within a time window with full details
 * @param {number} startTime
 * @param {number} endTime
 * @returns {Array<{id: string, file: string, path: string, mtime: number, tokens: number, cost: number, messages: number, models: string[], previews: string[], duration: number, startTime: number|null, endTime: number|null}>}
 */
function getSessionsInWindow(startTime, endTime) {
  const sessions = [];

  for (const file of findAllSessionFiles()) {
    // Two cheap (stat + small partial-read) pre-filters before the
    // expensive full parse. Content is append-only, so timestamps are
    // always <= mtime: a file untouched before the window opened cannot
    // contain anything within it. But mtime is the file's *last* write,
    // not its first — a long-running session gets appended to well past
    // any earlier spike it contains, so mtime alone badly under-matches.
    // approxSessionStartTime bounds the other side cheaply, without
    // parsing the entire multi-thousand-file corpus on every investigation.
    if (file.mtime < startTime) continue;
    const approxStart = approxSessionStartTime(file.path);
    if (approxStart !== null && approxStart > endTime) continue;

    const fileData = parseJsonlFile(file.path, 'auto');
    const timeWindow = fileData.timeWindow;
    if (!timeWindow || timeWindow.startTime > endTime || timeWindow.endTime < startTime) continue;

    const conversation = summarizeSessionData(fileData, file.path);
    if (conversation.tokens > 0) {
      sessions.push({
        id: sessionIdForFile(file),
        file: path.basename(file.path),
        path: file.path,
        mtime: file.mtime,
        ...conversation
      });
    }
  }

  // Sort by token usage (highest first)
  return sessions.sort((a, b) => b.tokens - a.tokens);
}

/**
 * Cheaply estimate a session file's earliest usage timestamp by reading
 * only its first APPROX_START_SAMPLE_BYTES rather than the whole file.
 * Returns null when no usage-carrying line is found in the sample, so
 * callers fail open (treat the file as a candidate) instead of silently
 * excluding a real match past the sampled prefix.
 * @param {string} filePath
 * @returns {number|null}
 */
function approxSessionStartTime(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(APPROX_START_SAMPLE_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, APPROX_START_SAMPLE_BYTES, 0);
    const lines = buf.toString('utf-8', 0, bytesRead).split('\n');
    lines.pop(); // last line may be truncated mid-read
    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed && parsed.timestamp) return parsed.timestamp;
    }
  } catch {
    // Unreadable file: fail open (null) rather than excluding it.
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
  return null;
}

/**
 * Derive a stable, human-readable session id from a discovered session file.
 * Pi's nested layout uses one directory per session (the directory name is
 * the id); everything else (Pi flat, Claude) uses the jsonl filename itself
 * (Claude's is already a session UUID).
 * @param {{path: string, source: string, structure?: string}} file
 * @returns {string}
 */
function sessionIdForFile(file) {
  if (file.source === 'pi' && file.structure === 'nested') {
    return path.basename(path.dirname(file.path));
  }
  return path.basename(file.path, '.jsonl');
}

/**
 * Summarize an already-parsed session file (tokens, cost, models, previews,
 * time bounds) into the shape getSessionsInWindow returns per session.
 * Takes the parsed fileData rather than a filePath+re-parsing, since the
 * caller already had to parse the file once to check time-window overlap.
 * @param {*} fileData - result of parseJsonlFile(filePath, 'auto')
 * @param {string} filePath
 * @returns {{tokens: number, cost: number, messages: number, models: string[], previews: string[], duration: number, startTime: number|null, endTime: number|null}}
 */
function summarizeSessionData(fileData, filePath) {
  let totalCost = 0;
  for (const [modelKey, modelData] of Object.entries(fileData.models)) {
    /** @type {*} */
    const costs = calculateCost(modelData, modelKey);
    totalCost += costs.total;
  }

  const timeWindow = fileData.timeWindow;

  return {
    tokens: fileData.total_tokens,
    cost: totalCost,
    messages: fileData.messages,
    models: Object.keys(fileData.models),
    previews: extractPreviewsFromFile(filePath),
    duration: timeWindow ? timeWindow.endTime - timeWindow.startTime : 0,
    startTime: timeWindow ? timeWindow.startTime : null,
    endTime: timeWindow ? timeWindow.endTime : null
  };
}

/**
 * Extract up to 3 user-message previews from a session file, covering both
 * Claude (type: 'user', text in message.content) and Pi (type: 'message',
 * message.role === 'user') line shapes.
 * @param {string} filePath
 * @returns {string[]}
 */
function extractPreviewsFromFile(filePath) {
  const previews = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    for (const line of lines) {
      if (previews.length >= 3) break;

      try {
        const data = JSON.parse(line);
        const isClaudeUserTurn = data.type === 'user' && data.message;
        const isPiUserTurn = data.type === 'message' && data.message?.role === 'user';

        if (isClaudeUserTurn || isPiUserTurn) {
          const preview = extractPreview(data.message.content);
          if (preview) previews.push(preview);
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Skip unreadable files
  }

  return previews;
}

/**
 * Extract a preview from message content
 * @param {*} content
 * @returns {string|null}
 */
function extractPreview(content) {
  if (!content) return null;

  // Handle array content (OpenAI format)
  if (Array.isArray(content)) {
    const textParts = content
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join(' ');
    content = textParts;
  }

  // Handle object content
  if (typeof content === 'object') {
    content = JSON.stringify(content);
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
 * Investigate a spike at a specific time
 * @param {string|number} timestamp
 * @param {number} [windowMinutes=30]
 * @returns {object}
 */
function investigateSpike(timestamp, windowMinutes = 30) {
  const centerTime = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
  const windowMs = windowMinutes * 60 * 1000;
  const startTime = centerTime - (windowMs / 2);
  const endTime = centerTime + (windowMs / 2);

  const sessions = getSessionsInWindow(startTime, endTime);

  // Calculate total for context
  const totalTokens = sessions.reduce((sum, s) => sum + s.tokens, 0);
  const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);

  // Find the biggest contributors
  const topSessions = sessions.slice(0, 5);

  return {
    timestamp: centerTime,
    window: {
      start: startTime,
      end: endTime,
      minutes: windowMinutes
    },
    summary: {
      totalSessions: sessions.length,
      totalTokens,
      totalCost,
      topModel: findTopModel(sessions)
    },
    sessions: topSessions.map(s => ({
      id: s.id,
      tokens: s.tokens,
      cost: s.cost,
      messages: s.messages,
      models: s.models,
      previews: s.previews,
      duration: s.duration
    }))
  };
}

/**
 * Find the most used model in sessions
 * @param {Array<{models: string[], tokens: number}>} sessions
 * @returns {string}
 */
function findTopModel(sessions) {
  /** @type {Record<string, number>} */
  const modelCounts = {};
  for (const session of sessions) {
    for (const model of session.models) {
      modelCounts[model] = (modelCounts[model] || 0) + session.tokens;
    }
  }

  const sorted = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]);
  return sorted.length > 0 ? sorted[0][0] : 'unknown';
}

/**
 * Find spikes automatically in historical data
 * @param {Array<{time: *, total: number}>} historicalData
 * @param {number} [threshold=2.0]
 * @returns {Array<{time: *, tokens: number, ratio: string, previousAvg: number}>}
 */
function findSpikes(historicalData, threshold = 2.0) {
  if (!historicalData || historicalData.length < 3) return [];

  const spikes = [];

  // Calculate rolling average
  for (let i = 2; i < historicalData.length; i++) {
    const current = historicalData[i];
    const prev1 = historicalData[i - 1];
    const prev2 = historicalData[i - 2];

    const avg = (prev1.total + prev2.total) / 2;
    const ratio = avg > 0 ? current.total / avg : 0;

    if (ratio >= threshold && current.total > 10000) { // At least 10k tokens
      spikes.push({
        time: current.time,
        tokens: current.total,
        ratio: ratio.toFixed(1),
        previousAvg: Math.round(avg)
      });
    }
  }

  return spikes.slice(-10); // Return last 10 spikes
}

module.exports = {
  investigateSpike,
  findSpikes,
  getSessionsInWindow
};
