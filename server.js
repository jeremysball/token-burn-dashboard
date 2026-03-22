#!/usr/bin/env node

/**
 * Token Burn Dashboard Server
 * Serves the dashboard and provides API endpoints for real-time token data
 */

const http = require('http');

// Configuration
const { PORT, REQUEST_TIMEOUT } = require('./lib/config');

// Components
const { startBackgroundUpdater } = require('./lib/cache');
const { handleTokensRoute, handleHistoricalRoute, handleHealthRoute, handleInsightsAnalyzeRoute, handleGitBlameRoute, handleSpikeDetectiveRoute, handleSpikesListRoute } = require('./lib/routes/api');
const { handleSseRoute } = require('./lib/routes/sse');
const { handleStaticRoutes } = require('./lib/routes/static');

let currentPort = PORT;

const server = http.createServer(async (req, res) => {
  const startTime = Date.now();
  const host = req.headers.host || `localhost:${currentPort}`;
  const url = new URL(req.url, `http://${host}`);
  
  // Log request
  console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname}`);
  
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Gateway timeout configuration (not for SSE)
  let requestTimeout;
  if (url.pathname !== '/api/tokens/stream') {
    requestTimeout = setTimeout(() => {
      if (!res.writableEnded) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gateway timeout' }));
      }
    }, REQUEST_TIMEOUT);
  }
  
  // Helper to log response
  const logResponse = (statusCode) => {
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} - ${statusCode} (${duration}ms)`);
  };

  // API Routes
  if (url.pathname === '/api/tokens') {
    const result = await handleTokensRoute(req, res, requestTimeout);
    logResponse(res.statusCode);
    return result;
  }
  
  if (url.pathname === '/api/tokens/historical') {
    const result = await handleHistoricalRoute(req, res, requestTimeout);
    logResponse(res.statusCode);
    return result;
  }

  if (url.pathname === '/api/health') {
    const result = await handleHealthRoute(req, res, requestTimeout);
    logResponse(res.statusCode);
    return result;
  }

  if (url.pathname === '/api/insights/analyze' && req.method === 'POST') {
    const result = await handleInsightsAnalyzeRoute(req, res, requestTimeout);
    logResponse(res.statusCode);
    return result;
  }

  if (url.pathname === '/api/git/blame') {
    const result = await handleGitBlameRoute(req, res, requestTimeout);
    logResponse(res.statusCode);
    return result;
  }

  if (url.pathname === '/api/spikes') {
    const result = await handleSpikesListRoute(req, res, requestTimeout);
    logResponse(res.statusCode);
    return result;
  }

  if (url.pathname === '/api/spikes/investigate') {
    const result = await handleSpikeDetectiveRoute(req, res, requestTimeout);
    logResponse(res.statusCode);
    return result;
  }

  // SSE Endpoint
  if (url.pathname === '/api/tokens/stream') {
    console.log(`[${new Date().toISOString()}] SSE connection opened`);
    const result = await handleSseRoute(req, res);
    return result;
  }
  
  // Static files handling
  const handled = handleStaticRoutes(url, res, requestTimeout, __dirname);
  if (handled) {
    logResponse(res.statusCode || 200);
    return;
  }

  // 404 Not Found
  clearTimeout(requestTimeout);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  logResponse(404);
  res.end('Not found');
});

// Start background processes
startBackgroundUpdater();

let attempt = 0;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    attempt++;
    const offset = Math.ceil(attempt / 2) * (attempt % 2 !== 0 ? 1 : -1);
    const nextPort = PORT + offset;
    console.log(`Port ${currentPort} in use, trying ${nextPort}...`);
    currentPort = nextPort;
    server.close();
    server.listen(currentPort);
  } else {
    console.error(e);
    process.exit(1);
  }
});

server.on('listening', () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🔥 Token Burn Dashboard                                  ║
║                                                            ║
║   ${`http://localhost:${currentPort}`.padEnd(57)}║
║                                                            ║
║   Endpoints:                                               ║
║   • /api/tokens           - Current totals                 ║
║   • /api/tokens/historical - Time series from files        ║
║   • /api/tokens/stream    - Real-time SSE                  ║
║   • /api/insights/analyze - AI pattern analysis            ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
});

server.listen(currentPort);

// Graceful shutdown - prevent duplicate handlers
let isShuttingDown = false;

function gracefulShutdown() {
  if (isShuttingDown) {
    console.log('\nForce exiting...');
    process.exit(1);
  }
  isShuttingDown = true;
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
