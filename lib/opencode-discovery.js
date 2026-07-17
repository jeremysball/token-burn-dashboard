/**
 * Opencode Session Discovery via SQLite
 * Reads from ~/.local/share/opencode/opencode.db
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const OPENCODE_DB_PATH = process.env.OPENCODE_DB_PATH 
  || path.join(process.env.HOME || '', '.local/share/opencode/opencode.db');

function dbExists() {
  return fs.existsSync(OPENCODE_DB_PATH);
}

/**
 * Execute sqlite query with -json output, returns parsed array
 * Uses read-only mode and short timeout
 * Secure: uses spawnSync with input piped via stdin, no shell interpolation
 */
// queryJson removed - use queryJsonSafe instead for safety

/**
 * Safe query using spawnSync to avoid shell injection
 */
function queryJsonSafe(sql, timeoutMs = 15000) {
  if (!dbExists()) return [];

  try {
    const res = spawnSync('sqlite3', ['-readonly', '-json', OPENCODE_DB_PATH], {
      input: sql,
      encoding: 'utf-8',
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024
    });
    if (res.error) {
      console.error(`Opencode DB query failed: ${res.error.message}`);
      return [];
    }
    if (res.status !== 0 && !res.stdout?.trim()) {
      // sqlite3 returns non-zero on error but may still have stderr
      if (res.stderr) console.error(`Opencode DB stderr: ${res.stderr}`);
      return [];
    }
    if (!res.stdout?.trim()) return [];
    return JSON.parse(res.stdout);
  } catch (err) {
    console.error(`Opencode DB query failed: ${err.message}`);
    return [];
  }
}

/**
 * Get all sessions aggregated
 * Returns { modelKey, provider, model, tokens }
 */
function getOpenCodeSessions() {
  if (!dbExists()) return [];

  // Query sessions joined with project to get worktree
  // Model field is JSON string like {"id":"muse-spark-1.1","providerID":"meta",...}
  const sql = `
    SELECT 
      s.id,
      s.tokens_input as input,
      s.tokens_output as output,
      s.tokens_cache_read as cache_read,
      s.tokens_cache_write as cache_write,
      s.tokens_reasoning as reasoning,
      s.cost,
      s.model as model_json,
      s.time_created,
      s.time_updated,
      p.worktree as worktree,
      p.id as project_id
    FROM session s
    JOIN project p ON s.project_id = p.id
    WHERE s.tokens_input + s.tokens_output + s.tokens_cache_read > 0
    ORDER BY s.time_updated DESC
    LIMIT 5000;
  `;

  const rows = queryJsonSafe(sql, 15000);
  
  const sessions = rows.map(row => {
    let modelId = 'unknown';
    let providerId = 'unknown';
    try {
      if (row.model_json) {
        const m = typeof row.model_json === 'string' ? JSON.parse(row.model_json) : row.model_json;
        modelId = m.id || m.modelID || 'unknown';
        providerId = m.providerID || m.provider || 'unknown';
      }
    } catch {
      // ignore
    }

    const modelKey = providerId !== 'unknown' ? `${providerId}/${modelId}` : modelId;

    return {
      id: row.id,
      source: 'opencode',
      provider: providerId,
      model: modelId,
      modelKey,
      input: row.input || 0,
      output: row.output || 0,
      cache_read: row.cache_read || 0,
      cache_write: row.cache_write || 0,
      reasoning: row.reasoning || 0,
      total: (row.input || 0) + (row.output || 0) + (row.cache_read || 0) + (row.cache_write || 0) + (row.reasoning || 0),
      cost: row.cost || 0,
      time_created: row.time_created,
      time_updated: row.time_updated,
      worktree: row.worktree,
      project_id: row.project_id
    };
  });

  return sessions;
}

/**
 * Get historical events from message table
 * Aggregates per-message assistant usage with timestamps
 */
function getOpenCodeHistoricalEvents(limit = 10000) {
  if (!dbExists()) return [];

  // Query assistant messages with tokens
  const sql = `
    SELECT 
      json_extract(data, '$.modelID') as model,
      json_extract(data, '$.providerID') as provider,
      json_extract(data, '$.tokens.input') as input,
      json_extract(data, '$.tokens.output') as output,
      json_extract(data, '$.tokens.cache.read') as cache_read,
      json_extract(data, '$.tokens.cache.write') as cache_write,
      json_extract(data, '$.tokens.total') as total,
      json_extract(data, '$.tokens.reasoning') as reasoning,
      time_created
    FROM message
    WHERE json_extract(data, '$.role') = 'assistant'
      AND json_extract(data, '$.tokens.total') > 0
    ORDER BY time_created ASC
    LIMIT ${Math.min(limit, 50000)};
  `;

  const rows = queryJsonSafe(sql, 20000);

  return rows.map(row => {
    const modelId = row.model || 'unknown';
    const providerId = row.provider || 'unknown';
    const modelKey = providerId !== 'unknown' ? `${providerId}/${modelId}` : modelId;

    return {
      source: 'opencode',
      provider: providerId,
      model: modelId,
      modelKey,
      input: row.input || 0,
      output: row.output || 0,
      cache_read: row.cache_read || 0,
      cache_write: row.cache_write || 0,
      reasoning: row.reasoning || 0,
      total: row.total != null ? row.total : ((row.input||0)+(row.output||0)+(row.cache_read||0)+(row.reasoning||0)),
      time: row.time_created, // ms timestamp
      modelKeyForBucket: modelKey
    };
  });
}

/**
 * Get aggregated totals by model for opencode
 */
function getOpenCodeTotalsByModel() {
  const sessions = getOpenCodeSessions();
  const byModel = {};

  for (const s of sessions) {
    const key = s.modelKey;
    if (!byModel[key]) {
      byModel[key] = {
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        reasoning: 0,
        total: 0,
        cost: 0,
        sessions: 0,
        source: 'opencode',
        provider: s.provider,
        model: s.model
      };
    }
    byModel[key].input += s.input;
    byModel[key].output += s.output;
    byModel[key].cache_read += s.cache_read;
    byModel[key].cache_write += s.cache_write;
    byModel[key].reasoning += s.reasoning;
    byModel[key].total += s.total;
    byModel[key].cost += s.cost;
    byModel[key].sessions += 1;
  }

  return byModel;
}

/**
 * Quick stats for health check
 */
function getOpenCodeStats() {
  if (!dbExists()) return { exists: false };

  const sqlCount = `SELECT COUNT(*) as session_count FROM session;`;
  const countRows = queryJsonSafe(sqlCount, 5000);
  const sessionCount = countRows[0]?.session_count || 0;

  const sqlTokens = `
    SELECT 
      SUM(tokens_input) as input,
      SUM(tokens_output) as output,
      SUM(tokens_cache_read) as cache_read,
      SUM(tokens_cache_write) as cache_write,
      SUM(tokens_reasoning) as reasoning,
      SUM(cost) as cost
    FROM session;
  `;
  const tokenRows = queryJsonSafe(sqlTokens, 5000);
  const totals = tokenRows[0] || {};

  return {
    exists: true,
    dbPath: OPENCODE_DB_PATH,
    sessionCount,
    total_input: totals.input || 0,
    total_output: totals.output || 0,
    total_cache_read: totals.cache_read || 0,
    total_cache_write: totals.cache_write || 0,
    total_reasoning: totals.reasoning || 0,
    total_cost: totals.cost || 0
  };
}

module.exports = {
  OPENCODE_DB_PATH,
  dbExists,
  getOpenCodeSessions,
  getOpenCodeHistoricalEvents,
  getOpenCodeTotalsByModel,
  getOpenCodeStats,
  queryJsonSafe
};
