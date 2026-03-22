/**
 * Historical time-series data extraction - pure JavaScript
 * Searches for sessions in multiple locations:
 * - /workspace/.pi/sessions
 * - ~/.pi/sessions
 * - /workspace/openclaw-sessions/
 */

const fs = require('fs');
const path = require('path');
const { PYTHON_TIMEOUT } = require('./config');

// Session paths to search
const SESSION_PATHS = [
  '/workspace/.pi/sessions',
  path.join(process.env.HOME, '.pi/sessions'),
  '/workspace/.pi/agent/sessions',
  path.join(process.env.HOME, '.pi/agent/sessions'),
  '/workspace/openclaw-sessions/'
];

/**
 * Find all session directories across all search paths
 * Also handles flat directories (like openclaw-sessions) where files are directly in the path
 */
function findSessionDirs() {
  const sessionDirs = [];

  for (const basePath of SESSION_PATHS) {
    if (!fs.existsSync(basePath)) continue;

    try {
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      
      // Check if this is a "flat" directory with JSONL files directly in it
      const hasJsonlFiles = entries.some(e => e.isFile() && e.name.endsWith('.jsonl'));
      const hasSubdirs = entries.some(e => e.isDirectory());
      
      if (hasJsonlFiles && !hasSubdirs) {
        // Flat structure - use the base path itself as a "session directory"
        sessionDirs.push(basePath);
      } else {
        // Hierarchical structure - look in subdirectories
        for (const entry of entries) {
          if (entry.isDirectory()) {
            sessionDirs.push(path.join(basePath, entry.name));
          }
        }
      }
    } catch (err) {
      console.error(`Error reading ${basePath}:`, err.message);
    }
  }

  return sessionDirs;
}

/**
 * Find all JSONL files in a session directory
 */
function findJsonlFiles(sessionDir) {
  const files = [];

  try {
    const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(sessionDir, entry.name));
      }
    }
  } catch (err) {
    console.error(`Error reading ${sessionDir}:`, err.message);
  }

  return files;
}

/**
 * Extract historical time-series data from session files
 * @returns {Promise<Array>} Time-series data
 */
function extractHistoricalData() {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Historical data extraction timeout'));
    }, PYTHON_TIMEOUT);

    try {
      const events = [];
      const sessionDirs = findSessionDirs();

      for (const sessionDir of sessionDirs) {
        const jsonlFiles = findJsonlFiles(sessionDir);

        for (const filePath of jsonlFiles) {
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());

            for (const line of lines) {
              try {
                const data = JSON.parse(line);
                const msgType = data.type;

                if (msgType === 'message') {
                  const msg = data.message || {};
                  const usage = msg.usage || {};
                  const timestamp = msg.timestamp || data.timestamp;

                  if (usage && timestamp) {
                    const provider = msg.provider || 'unknown';
                    const model = msg.model || 'unknown';
                    const modelName = provider !== 'unknown' ? `${provider}/${model}` : model;

                    events.push({
                      time: timestamp,
                      model: modelName,
                      input: usage.input || usage.inputTokens || 0,
                      output: usage.output || usage.outputTokens || 0,
                      cache_read: usage.cacheRead || 0,
                      cache_write: usage.cacheWrite || 0,
                      total: usage.totalTokens || 0
                    });
                  }
                }
              } catch {
                // Skip malformed lines
              }
            }
          } catch (err) {
            console.error(`Error reading ${filePath}:`, err.message);
          }
        }
      }

      // Sort by time
      events.sort((a, b) => a.time - b.time);

      // Aggregate into hourly buckets
      const buckets = new Map();

      for (const event of events) {
        const hourBucket = Math.floor(event.time / (3600 * 1000)) * (3600 * 1000);

        if (!buckets.has(hourBucket)) {
          buckets.set(hourBucket, {
            time: hourBucket,
            tokens_by_model: {},
            total: 0,
            input: 0,
            output: 0,
            cache_read: 0
          });
        }

        const bucket = buckets.get(hourBucket);
        bucket.tokens_by_model[event.model] = (bucket.tokens_by_model[event.model] || 0) + event.total;
        bucket.total += event.total;
        bucket.input += event.input;
        bucket.output += event.output;
        bucket.cache_read += event.cache_read;
      }

      const result = Array.from(buckets.values()).sort((a, b) => a.time - b.time);

      clearTimeout(timeoutId);
      resolve(result);
    } catch (err) {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to extract: ${err.message}`));
    }
  });
}

module.exports = { extractHistoricalData };
