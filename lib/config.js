/**
 * Server configuration constants
 */

const path = require('path');
const os = require('os');

module.exports = {
  PORT: process.env.PORT || 7071,
  HOST: process.env.HOST || '127.0.0.1',
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  AUTH_TOKEN: process.env.DASHBOARD_AUTH_TOKEN || null,
  PROJECT_ROOT: process.env.DASHBOARD_PROJECT_ROOT || process.env.HOME || process.cwd(),
  TOKEN_BURN_SCRIPT: path.join(__dirname, 'token-burn.js'),

  // Timeouts
  PYTHON_TIMEOUT: 30000,
  SSE_KEEPALIVE_INTERVAL: 30000,
  SSE_UPDATE_INTERVAL: 5000,
  SSE_MAX_CONNECTION_TIME: 300000,
  REQUEST_TIMEOUT: 35000,
  HISTORICAL_UPDATE_INTERVAL: 60 * 60 * 1000,

  // /api/insights/analyze dispatches an agentic taskferry worker, which
  // routinely takes longer than the default gateway timeout above. Keep
  // this comfortably above the summed inner phase timeouts below (200s) so
  // process/IPC overhead across the 3 execFile calls can't make the outer
  // gateway timeout fire while the chain is still legitimately completing.
  // The worker now reads the full dataset (all models + complete history,
  // ~150KB as NDJSON) rather than a capped snapshot, which measured ~80s
  // end-to-end in practice — TASKFERRY_WAIT_TIMEOUT_MS is sized well above
  // that observed duration, not just the old capped-data baseline.
  INSIGHTS_REQUEST_TIMEOUT: 220000,
  TASKFERRY_DISPATCH_TIMEOUT_MS: 10000,
  TASKFERRY_WAIT_TIMEOUT_MS: 180000,
  TASKFERRY_RESULT_TIMEOUT_MS: 10000,

  // Taskferry-backed AI insights analysis
  TASKFERRY_INSIGHTS_MODEL: process.env.TASKFERRY_INSIGHTS_MODEL || 'opencode/deepseek-v4-flash-free',
  TASKFERRY_SCRATCH_DIR: process.env.DASHBOARD_INSIGHTS_SCRATCH_DIR
    || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'token-burn-dashboard', 'insights-scratch'),

  // Security hardening
  MAX_REQUEST_BODY_BYTES: 1024 * 1024,
  MAX_FILE_BYTES: parseInt(process.env.MAX_SESSION_BYTES || '', 10) || 100 * 1024 * 1024,
  CLAUDE_MAX_DEPTH: 4,
  COMMIT_HASH_REGEX: /^[0-9a-f]{7,40}$/i,
  SQLITE_MAX_BUFFER: 50 * 1024 * 1024,
  SQLITE_TIMEOUT_MS: 15000,
  
  // MIME types
  MIME_TYPES: {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  }
};
