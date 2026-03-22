/**
 * Token burn calculation - pure JavaScript implementation
 * Searches for sessions in multiple locations:
 * - /workspace/.pi/sessions
 * - ~/.pi/sessions
 * - /workspace/openclaw-sessions/
 */

const fs = require('fs');
const path = require('path');
const { PYTHON_TIMEOUT } = require('./config');
const { calculateCost } = require('./pricing');

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
 * Parse a JSONL file and extract token usage
 */
function parseJsonlFile(filePath) {
  const result = {
    total_input: 0,
    total_output: 0,
    total_cache_read: 0,
    total_cache_write: 0,
    total_tokens: 0,
    total_lines: 0,
    messages: 0,
    models: {}
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    result.total_lines = lines.length;

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        if (data.type === 'message' && data.message?.usage) {
          const usage = data.message.usage;
          const model = data.message.model || 'unknown';
          const provider = data.message.provider || 'unknown';
          const modelKey = `${provider}/${model}`;

          const input = usage.input || usage.inputTokens || 0;
          const output = usage.output || usage.outputTokens || 0;
          const cacheRead = usage.cacheRead || 0;
          const cacheWrite = usage.cacheWrite || 0;
          const total = usage.totalTokens || 0;

          result.total_input += input;
          result.total_output += output;
          result.total_cache_read += cacheRead;
          result.total_cache_write += cacheWrite;
          result.total_tokens += total;
          result.messages += 1;

          if (!result.models[modelKey]) {
            result.models[modelKey] = {
              input: 0,
              output: 0,
              cache_read: 0,
              cache_write: 0,
              total: 0,
              messages: 0
            };
          }

          result.models[modelKey].input += input;
          result.models[modelKey].output += output;
          result.models[modelKey].cache_read += cacheRead;
          result.models[modelKey].cache_write += cacheWrite;
          result.models[modelKey].total += total;
          result.models[modelKey].messages += 1;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch (err) {
    console.error(`Error parsing ${filePath}:`, err.message);
  }

  return result;
}

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
      const sessionDirs = findSessionDirs();
      const result = {
        files_processed: 0,
        total_lines: 0,
        total_messages: 0,
        total_input: 0,
        total_output: 0,
        total_cache_read: 0,
        total_cache_write: 0,
        total_tokens: 0,
        tokens_by_model: {},
        costs_by_model: {},
        total_cost: {
          input: 0,
          output: 0,
          cache_read: 0,
          cache_write: 0,
          total: 0
        }
      };

      for (const sessionDir of sessionDirs) {
        const jsonlFiles = findJsonlFiles(sessionDir);

        for (const filePath of jsonlFiles) {
          const fileData = parseJsonlFile(filePath);

          result.files_processed += 1;
          result.total_messages += fileData.messages;
          result.total_input += fileData.total_input;
          result.total_output += fileData.total_output;
          result.total_cache_read += fileData.total_cache_read;
          result.total_cache_write += fileData.total_cache_write;
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
                total: 0
              };
            }

            result.tokens_by_model[modelKey].input += modelData.input;
            result.tokens_by_model[modelKey].output += modelData.output;
            result.tokens_by_model[modelKey].cache_read += modelData.cache_read;
            result.tokens_by_model[modelKey].cache_write += modelData.cache_write;
            result.tokens_by_model[modelKey].total += modelData.total;
          }
        }
      }

      // Calculate costs using shared pricing module
      for (const [modelKey, modelData] of Object.entries(result.tokens_by_model)) {
        const costs = calculateCost(modelData, modelKey);

        result.costs_by_model[modelKey] = costs;
        result.total_cost.input += costs.input;
        result.total_cost.output += costs.output;
        result.total_cost.cache_read += costs.cache_read;
        result.total_cost.cache_write += costs.cache_write;
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

module.exports = { runTokenBurn };
