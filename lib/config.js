/**
 * Server configuration constants
 */

const path = require('path');

module.exports = {
  PORT: process.env.PORT || 7071,
  TOKEN_BURN_SCRIPT: path.join(__dirname, 'token-burn.js'),

  // Timeouts
  PYTHON_TIMEOUT: 30000,
  SSE_KEEPALIVE_INTERVAL: 30000,
  SSE_UPDATE_INTERVAL: 5000,
  SSE_MAX_CONNECTION_TIME: 300000,
  REQUEST_TIMEOUT: 35000,
  HISTORICAL_UPDATE_INTERVAL: 60 * 60 * 1000,
  
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
