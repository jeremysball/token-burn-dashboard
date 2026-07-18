/**
 * Token burn calculation - pure JavaScript implementation
 * Uses the hardened session-discovery and session-parser modules so that
 * production APIs (/api/tokens and /api/tokens/historical) honor the same
 * discovery rules: EXTRA_SESSION_DIRS, Claude project traversal, realpath
 * deduplication, deleted-file filtering, symlink handling, and size limits.
 */

const { findAllSessionFiles } = require('./session-discovery');
const { parseJsonlFile } = require('./session-parser');
const { PYTHON_TIMEOUT } = require('./config');
const { calculateCost, getPricingDetails } = require('./pricing');

/**
 * Run the token burn calculation
 * @returns {Promise<object>} Token usage data
 */
function runTokenBurn() {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Token burn timeout after ${PYTHON_TIMEOUT}ms`));
    }, PYTHON_TIMEOUT);

    try {
      const sessionFiles = findAllSessionFiles();
      const result = {
        files_processed: 0,
        total_lines: 0,
        total_messages: 0,
        total_input: 0,
        total_output: 0,
        total_cache_read: 0,
        total_cache_write: 0,
        total_reasoning: 0,
        total_tokens: 0,
        tokens_by_model: {},
        costs_by_model: {},
        pricing_by_model: {},
        total_cost: {
          input: 0,
          output: 0,
          cache_read: 0,
          cache_write: 0,
          reasoning: 0,
          total: 0
        }
      };

      for (const file of sessionFiles) {
        const fileData = parseJsonlFile(file.path, file.source);

        result.files_processed += 1;
        result.total_messages += fileData.messages;
        result.total_input += fileData.total_input;
        result.total_output += fileData.total_output;
        result.total_cache_read += fileData.total_cache_read;
        result.total_cache_write += fileData.total_cache_write;
        result.total_reasoning += fileData.total_reasoning || 0;
        result.total_tokens += fileData.total_tokens;
        result.total_lines += fileData.total_lines;

        // Aggregate by model
        for (const [modelKey, modelData] of Object.entries(fileData.models)) {
          if (!result.tokens_by_model[modelKey]) {
            result.tokens_by_model[modelKey] = {
              input: 0,
              output: 0,
              cache_read: 0,
              cache_write: 0,
              reasoning: 0,
              total: 0
            };
          }

          result.tokens_by_model[modelKey].input += modelData.input;
          result.tokens_by_model[modelKey].output += modelData.output;
          result.tokens_by_model[modelKey].cache_read += modelData.cache_read;
          result.tokens_by_model[modelKey].cache_write += modelData.cache_write;
          result.tokens_by_model[modelKey].reasoning += modelData.reasoning || 0;
          result.tokens_by_model[modelKey].total += modelData.total;
        }
      }

      // Calculate costs using shared pricing module
      for (const [modelKey, modelData] of Object.entries(result.tokens_by_model)) {
        const pricing = getPricingDetails(modelKey);
        const costs = calculateCost(modelData, modelKey);

        result.pricing_by_model[modelKey] = pricing;
        result.costs_by_model[modelKey] = costs;
        result.total_cost.input += costs.input;
        result.total_cost.output += costs.output;
        result.total_cost.cache_read += costs.cache_read;
        result.total_cost.cache_write += costs.cache_write;
        result.total_cost.reasoning += costs.reasoning || 0;
        result.total_cost.total += costs.total;
      }

      clearTimeout(timeoutId);
      resolve(result);
    } catch (err) {
      clearTimeout(timeoutId);
      reject(new Error(`Token burn failed: ${err.message}`));
    }
  });
}

module.exports = { runTokenBurn, parseJsonlFile };
