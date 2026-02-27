#!/usr/bin/env node

/**
 * Token Burn Dashboard Server
 * Serves the dashboard and provides API endpoints for real-time token data
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 7070;
const TOKEN_BURN_SCRIPT = '/workspace/.pi/skills/token-burn/src/token_burn.py';

// MIME types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// Cache for static files
const staticCache = new Map();

// Read file with caching
function readFileCached(filePath) {
  if (staticCache.has(filePath)) {
    return staticCache.get(filePath);
  }
  
  try {
    const content = fs.readFileSync(filePath);
    staticCache.set(filePath, content);
    return content;
  } catch (err) {
    return null;
  }
}

// Run token-burn Python script
function runTokenBurn() {
  return new Promise((resolve, reject) => {
    const sessionsPath = path.join(process.env.HOME, '.pi/agent/sessions');
    const python = spawn('python3', [TOKEN_BURN_SCRIPT, sessionsPath, '--recursive', '--json']);
    let output = '';
    let error = '';
    
    python.stdout.on('data', (data) => output += data);
    python.stderr.on('data', (data) => error += data);
    
    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Token burn failed: ${error || 'Unknown error'}`));
      } else {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      }
    });
  });
}

// Static file handler
function serveStatic(res, filePath, contentType) {
  const content = readFileCached(filePath);
  if (content) {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(content);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// Create server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // API Routes
  if (url.pathname === '/api/tokens') {
    try {
      const data = await runTokenBurn();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return;
  }
  
  // SSE endpoint for real-time updates
  if (url.pathname === '/api/tokens/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    
    const sendUpdate = async () => {
      try {
        const data = await runTokenBurn();
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      }
    };
    
    // Send immediately
    sendUpdate();
    
    // Then every 5 seconds
    const interval = setInterval(sendUpdate, 5000);
    
    req.on('close', () => {
      clearInterval(interval);
    });
    return;
  }
  
  // Static files
  const staticMap = {
    '/': path.join(__dirname, 'dashboard/index.html'),
    '/mono-dashboard.css': path.join(__dirname, 'src/mono-dashboard.css')
  };
  
  const staticFile = staticMap[url.pathname];
  if (staticFile) {
    const ext = path.extname(staticFile);
    serveStatic(res, staticFile, MIME_TYPES[ext] || 'text/plain');
    return;
  }
  
  // Dashboard files
  if (url.pathname.startsWith('/dashboard/')) {
    const filePath = path.join(__dirname, url.pathname);
    const ext = path.extname(filePath);
    serveStatic(res, filePath, MIME_TYPES[ext] || 'text/plain');
    return;
  }
  
  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🔥 Token Burn Dashboard                                  ║
║                                                            ║
║   http://localhost:${PORT}                                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Press Ctrl+C to stop
`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});
