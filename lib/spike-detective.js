/**
 * Spike Detective - Investigate cost spikes by linking to actual sessions
 */

const fs = require('fs');
const path = require('path');

// Session paths to search (in order of priority)
const SESSIONS_PATHS = process.env.HOME ? [
  path.join(process.env.HOME, '.pi/sessions'),
  path.join(process.env.HOME, '.pi/agent/sessions')
] : [];

/**
 * Get sessions within a time window with full details
 * @param {number} startTime
 * @param {number} endTime
 * @returns {Array<{id: string, file: string, path: string, mtime: number, tokens: number, cost: number, messages: number, models: string[], previews: string[], duration: number, startTime: number|null, endTime: number|null}>}
 */
function getSessionsInWindow(startTime, endTime) {
  const sessions = [];
  const seenIds = new Set(); // Deduplicate across paths

  for (const sessionsPath of SESSIONS_PATHS) {
    if (!fs.existsSync(sessionsPath)) continue;

    try {
      const entries = fs.readdirSync(sessionsPath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionDir = path.join(sessionsPath, entry.name);
          const files = fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl'));

          for (const file of files) {
            const filePath = path.join(sessionDir, file);
            try {
              const stats = fs.statSync(filePath);
              const mtime = stats.mtime.getTime();

              if (mtime >= startTime && mtime <= endTime) {
                // Deduplicate by session ID + filename
                const uniqueKey = `${entry.name}/${file}`;
                if (seenIds.has(uniqueKey)) continue;
                seenIds.add(uniqueKey);

                const conversation = parseSessionFile(filePath);
                if (conversation.tokens > 0) {
                  sessions.push({
                    id: entry.name,
                    file: file,
                    path: filePath,
                    mtime: mtime,
                    ...conversation
                  });
                }
              }
            } catch {
              // Skip files that can't be read
            }
          }
        }
      }
    } catch {}
  }

  // Sort by token usage (highest first)
  return sessions.sort((a, b) => b.tokens - a.tokens);
}

/**
 * Parse a session file to extract conversation summary
 * @param {string} filePath
 * @returns {{tokens: number, cost: number, messages: number, models: string[], previews: string[], duration: number, startTime: number|null, endTime: number|null}}
 */
function parseSessionFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    let totalTokens = 0;
    let totalCost = 0;
    let messageCount = 0;
    const models = new Set();
    const previews = [];
    let firstMessage = null;
    let lastMessage = null;

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        if (data.type === 'message' && data.message) {
          const msg = data.message;
          const usage = msg.usage || {};

          messageCount++;
          totalTokens += usage.totalTokens ?? ((usage.input || usage.inputTokens || 0) + (usage.output || usage.outputTokens || 0) + (usage.cacheRead || 0));
          models.add(`${msg.provider || 'unknown'}/${msg.model || 'unknown'}`);

          // Track first and last message timestamps
          const timestamp = msg.timestamp || data.timestamp;
          if (timestamp) {
            if (!firstMessage || timestamp < firstMessage) firstMessage = timestamp;
            if (!lastMessage || timestamp > lastMessage) lastMessage = timestamp;
          }

          // Extract preview from user messages
          if (data.role === 'user' || msg.role === 'user') {
            const preview = extractPreview(msg.content);
            if (preview && previews.length < 3) {
              previews.push(preview);
            }
          }

          // Calculate rough cost
          const inputTokens = usage.input || usage.inputTokens || 0;
          const outputTokens = usage.output || usage.outputTokens || 0;
          const cacheRead = usage.cacheRead || 0;

          let inputRate = 0.000002;
          let outputRate = 0.000006;
          let cacheRate = 0.0000005;

          const model = msg.model || '';
          if (model.includes('claude-opus') || model.includes('gpt-4')) {
            inputRate = 0.000015;
            outputRate = 0.000075;
            cacheRate = 0.000001875;
          } else if (model.includes('claude-sonnet') || model.includes('claude-3-5')) {
            inputRate = 0.000003;
            outputRate = 0.000015;
            cacheRate = 0.000000375;
          }

          totalCost += (inputTokens * inputRate) + (outputTokens * outputRate) + (cacheRead * cacheRate);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return {
      tokens: totalTokens,
      cost: totalCost,
      messages: messageCount,
      models: Array.from(models),
      previews: previews,
      duration: firstMessage && lastMessage ? lastMessage - firstMessage : 0,
      startTime: firstMessage,
      endTime: lastMessage
    };
  } catch {
    return { tokens: 0, cost: 0, messages: 0, models: [], previews: [], duration: 0, startTime: null, endTime: null };
  }
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
