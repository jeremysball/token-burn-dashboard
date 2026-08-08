/**
 * Spike Detective - Investigate cost spikes by linking to actual sessions
 */

const fs = require('fs');
const path = require('path');
const { calculateCost } = require('./pricing');
const { findAllSessionFiles, sessionIdForFile } = require('./session-discovery');
const { parseLine, getCachedFileData } = require('./session-parser');

// Bytes read from the start of a session file to cheaply estimate its
// earliest timestamp, without fully parsing the whole (potentially huge,
// continuously-appended) file. Large enough to hold several JSONL lines
// even for verbose, tool-output-heavy transcripts.
const APPROX_START_SAMPLE_BYTES = 65536;

/**
 * Get sessions within a time window with full details
 * @param {number} startTime
 * @param {number} endTime
 * @returns {Array<{id: string, file: string, path: string, mtime: number, tokens: number, cost: number, windowedTokens: number, windowedCost: number, messages: number, models: string[], previews: string[], duration: number, startTime: number|null, endTime: number|null}>}
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

    // collectEvents:true so summarizeSessionData can compute each session's
    // windowedTokens/windowedCost — the portion of its usage that actually
    // falls inside [startTime, endTime], as opposed to `tokens`/`cost`
    // (the session's whole-file total, kept for identification/context
    // even for a long-running session that merely overlaps the window).
    const fileData = getCachedFileData(file.path, { collectEvents: true, collectPreviews: true });
    const timeWindow = fileData.timeWindow;
    if (!timeWindow || timeWindow.startTime > endTime || timeWindow.endTime < startTime) continue;

    const conversation = summarizeSessionData(fileData, startTime, endTime);
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

  // Sort by each session's contribution to *this window* (highest first),
  // not its whole-file total — otherwise a large but mostly-unrelated
  // long-running session outranks the sessions that actually drove the spike.
  return sessions.sort((a, b) => b.windowedTokens - a.windowedTokens);
}

/**
 * Minimum timestamp across every usage-carrying line, rather than just the
 * first one found - a single-writer append-only transcript is normally in
 * order but legacy/cross-device/EXTRA_SESSION_DIRS files aren't guaranteed
 * to be. Taking the minimum can only make the estimate earlier (never
 * later), so it can only relax a caller's exclusion filter, never wrongly
 * tighten it.
 * @param {string[]} lines
 * @returns {number|null}
 */
function findEarliestTimestampInSample(lines) {
  let earliest = null;
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed && parsed.timestamp && (earliest === null || parsed.timestamp < earliest)) {
      earliest = parsed.timestamp;
    }
  }
  return earliest;
}

/**
 * Cheaply estimate a session file's earliest usage timestamp by reading
 * only its first APPROX_START_SAMPLE_BYTES rather than the whole file.
 * Returns null when no usage-carrying line is found in the sample, or when
 * the file continues past the sampled prefix, so callers fail open (treat
 * the file as a candidate) instead of trusting a head-only sample that a
 * later out-of-order line beyond the sample could contradict. Only a fully
 * sampled (i.e. fully read) file's estimate is safe to use for exclusion.
 * @param {string} filePath
 * @returns {number|null}
 */
function approxSessionStartTime(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(APPROX_START_SAMPLE_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, APPROX_START_SAMPLE_BYTES, 0);
    if (bytesRead >= APPROX_START_SAMPLE_BYTES) {
      // File may continue past the sample; an out-of-order earlier line
      // could exist beyond it, so the sample can't be trusted to exclude.
      return null;
    }
    const lines = buf.toString('utf-8', 0, bytesRead).split('\n');
    lines.pop(); // last line may be truncated mid-read
    return findEarliestTimestampInSample(lines);
  } catch {
    // Unreadable file: fail open (null) rather than excluding it.
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/**
 * Accumulate one event's token components into a per-model running total.
 * @param {{input: number, output: number, cache_read: number, cache_write: number, reasoning: number}} m
 * @param {{input: number, output: number, cache_read: number, cache_write: number, reasoning: number}} event
 */
function addEventToModel(m, event) {
  m.input += event.input;
  m.output += event.output;
  m.cache_read += event.cache_read;
  m.cache_write += event.cache_write;
  m.reasoning += event.reasoning || 0;
}

/**
 * Sum only the usage events that actually fall within [startTime, endTime],
 * grouped by model so calculateCost gets real per-model token breakdowns
 * rather than an approximated blend. A session merely overlapping the
 * window can have most of its usage well outside it (see summarizeSessionData
 * doc), so this — not the session's whole-file total — is what should drive
 * a spike investigation's headline totals and contributor ranking.
 * @param {Array<{time: number, model: string, input: number, output: number, cache_read: number, cache_write: number, reasoning: number, total: number}>} events
 * @param {number} startTime
 * @param {number} endTime
 * @returns {{tokens: number, cost: number}}
 */
function sumEventsInWindow(events, startTime, endTime) {
  /** @type {Record<string, {input: number, output: number, cache_read: number, cache_write: number, reasoning: number}>} */
  const byModel = {};
  let tokens = 0;
  for (const event of events || []) {
    if (event.time == null || event.time < startTime || event.time > endTime) continue;
    tokens += event.total;
    const m = byModel[event.model] || (byModel[event.model] = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 });
    addEventToModel(m, event);
  }
  let cost = 0;
  for (const [modelKey, modelData] of Object.entries(byModel)) {
    /** @type {*} */
    const costs = calculateCost(modelData, modelKey);
    cost += costs.total;
  }
  return { tokens, cost };
}

/**
 * Summarize an already-parsed session file (tokens, cost, models, previews,
 * time bounds, plus the windowed subset of tokens/cost) into the shape
 * getSessionsInWindow returns per session. Takes the parsed fileData (from
 * getCachedFileData with collectEvents/collectPreviews: true) rather than a
 * filePath+re-parsing, since the caller already had to parse the file once
 * to check time-window overlap, and previews/events are collected inline
 * during that same parse pass.
 *
 * `tokens`/`cost` are the session's whole-file totals — kept even for a
 * long-running session whose mtime sits well outside the window, so it's
 * still identifiable and its full context is shown. `windowedTokens`/
 * `windowedCost` are the portion of that usage which actually falls inside
 * [startTime, endTime]; investigateSpike's headline totals must use these,
 * not the whole-file ones, or a spike investigation can report far more
 * tokens than the spike itself.
 * @param {*} fileData - result of getCachedFileData(filePath, {collectEvents: true, collectPreviews: true})
 * @param {number} startTime
 * @param {number} endTime
 * @returns {{tokens: number, cost: number, windowedTokens: number, windowedCost: number, messages: number, models: string[], previews: string[], duration: number, startTime: number|null, endTime: number|null}}
 */
function summarizeSessionData(fileData, startTime, endTime) {
  let totalCost = 0;
  for (const [modelKey, modelData] of Object.entries(fileData.models)) {
    /** @type {*} */
    const costs = calculateCost(modelData, modelKey);
    totalCost += costs.total;
  }

  const windowed = sumEventsInWindow(fileData.events, startTime, endTime);
  const timeWindow = fileData.timeWindow;

  return {
    tokens: fileData.total_tokens,
    cost: totalCost,
    windowedTokens: windowed.tokens,
    windowedCost: windowed.cost,
    messages: fileData.messages,
    models: Object.keys(fileData.models),
    previews: fileData.previews || [],
    duration: timeWindow ? timeWindow.endTime - timeWindow.startTime : 0,
    startTime: timeWindow ? timeWindow.startTime : null,
    endTime: timeWindow ? timeWindow.endTime : null
  };
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

  // Headline totals for this specific window — use each session's windowed
  // contribution, not its whole-file total, or a long-running session that
  // merely overlaps the window inflates this far past the spike itself.
  const totalTokens = sessions.reduce((sum, s) => sum + s.windowedTokens, 0);
  const totalCost = sessions.reduce((sum, s) => sum + s.windowedCost, 0);

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
 * @param {Array<{models: string[], windowedTokens: number}>} sessions
 * @returns {string}
 */
function findTopModel(sessions) {
  /** @type {Record<string, number>} */
  const modelCounts = {};
  for (const session of sessions) {
    for (const model of session.models) {
      modelCounts[model] = (modelCounts[model] || 0) + session.windowedTokens;
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
