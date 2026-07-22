/**
 * Server configuration constants
 */

const path = require('path');

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

  // Security hardening
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
