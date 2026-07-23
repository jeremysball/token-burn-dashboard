/**
 * Historical time-series data extraction - pure JavaScript
 * Uses the hardened session-discovery and session-parser modules so that
 * /api/tokens/historical honors the same discovery rules as /api/tokens.
 */

const { findAllSessionFiles } = require('./session-discovery');
const { parseJsonlFile } = require('./session-parser');
const { PYTHON_TIMEOUT } = require('./config');

/**
 * Extract historical time-series data from session files
 * @returns {Promise<any[]>} Time-series data
 */
function extractHistoricalData() {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Historical data extraction timeout'));
    }, PYTHON_TIMEOUT);

    try {
      /** @type {any[]} */
      const events = [];
      const sessionFiles = findAllSessionFiles();

      for (const file of sessionFiles) {
        const fileData = parseJsonlFile(file.path, file.source);
        for (const event of fileData.events) {
          events.push(event);
        }
      }

      // Normalize all timestamps to epoch ms before sorting/bucketing
      for (const event of events) {
        event.time = normalizeTimeMs(event.time);
      }

      // Sort by time (null-timestamped events sort to 0)
      events.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));

      // Aggregate into hourly buckets
      const buckets = new Map();

      for (const event of events) {
        const normTime = event.time;
        if (normTime === null) continue; // Reject invalid timestamps

        const hourBucket = Math.floor(normTime / (3600 * 1000)) * (3600 * 1000);

        if (!buckets.has(hourBucket)) {
          buckets.set(hourBucket, {
            time: hourBucket,
            tokens_by_model: {},
            total: 0,
            input: 0,
            output: 0,
            cache_read: 0,
            cache_write: 0,
            reasoning: 0
          });
        }

        const bucket = buckets.get(hourBucket);
        bucket.tokens_by_model[event.model] = (bucket.tokens_by_model[event.model] || 0) + event.total;
        bucket.total += event.total;
        bucket.input += event.input;
        bucket.output += event.output;
        bucket.cache_read += event.cache_read;
        bucket.cache_write += event.cache_write;
        bucket.reasoning += event.reasoning || 0;
      }

      const result = Array.from(buckets.values()).sort((a, b) => a.time - b.time);

      clearTimeout(timeoutId);
      resolve(result);
    } catch (err) {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to extract: ${/** @type {Error} */ (err).message}`));
    }
  });
}

/**
 * Normalize a timestamp to milliseconds.
 * - Non-numeric / NaN / unparseable ISO -> null
 * - ISO strings are parsed to their epoch milliseconds
 * - Values in the (1e9, 1e10) window are treated as seconds and multiplied by 1000
 * - Everything else (already ms, or below 1e9) is returned untouched
 * @param {number|string} time
 * @returns {number|null}
 */
function normalizeTimeMs(time) {
  if (typeof time === 'string') {
    const parsed = Date.parse(time);
    return isNaN(parsed) ? null : parsed;
  }
  if (typeof time !== 'number' || isNaN(time)) return null;
  if (time < 1e10 && time > 1e9) return time * 1000;
  return time;
}

module.exports = { extractHistoricalData, normalizeTimeMs };
