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

// Timeouts
const PYTHON_TIMEOUT = 30000;
const SSE_KEEPALIVE_INTERVAL = 30000;
const SSE_UPDATE_INTERVAL = 5000;

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

function runTokenBurn() {
  return new Promise((resolve, reject) => {
    const sessionsPath = path.join(process.env.HOME, '.pi/agent/sessions');
    const python = spawn('python3', [TOKEN_BURN_SCRIPT, sessionsPath, '--recursive', '--json']);
    
    let output = '';
    let error = '';
    let timeoutId;
    let isSettled = false;
    
    timeoutId = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        python.kill('SIGTERM');
        reject(new Error(`Token burn timeout after ${PYTHON_TIMEOUT}ms`));
      }
    }, PYTHON_TIMEOUT);
    
    python.stdout.on('data', (data) => output += data);
    python.stderr.on('data', (data) => error += data);
    
    python.on('close', (code) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutId);
      
      if (code !== 0) {
        reject(new Error(`Token burn failed (code ${code}): ${error || 'Unknown error'}`));
      } else {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      }
    });
    
    python.on('error', (err) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeoutId);
      reject(new Error(`Failed to spawn Python: ${err.message}`));
    });
  });
}

// Extract historical time-series data from session files
function extractHistoricalData() {
  return new Promise((resolve, reject) => {
    const sessionsPath = path.join(process.env.HOME, '.pi/agent/sessions');
    
    const pythonScript = `
import json
import sys
from pathlib import Path
from collections import defaultdict

def stream_jsonl_lines(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                yield line.strip()

def extract_historical(sessions_path):
    events = []
    
    base = Path(sessions_path)
    if not base.exists():
        return []
    
    files = []
    for pattern in ['**/*.jsonl']:
        files.extend(base.glob(pattern))
    
    for filepath in files:
        try:
            for line in stream_jsonl_lines(str(filepath)):
                try:
                    data = json.loads(line)
                    msg_type = data.get('type')
                    
                    if msg_type == 'message':
                        msg = data.get('message', {})
                        usage = msg.get('usage', {})
                        timestamp = msg.get('timestamp') or data.get('timestamp')
                        
                        if usage and timestamp:
                            provider = msg.get('provider', 'unknown')
                            model = msg.get('model', 'unknown')
                            model_name = f"{provider}/{model}" if provider != 'unknown' else model
                            
                            events.append({
                                'time': timestamp,
                                'model': model_name,
                                'input': usage.get('input', 0) or usage.get('inputTokens', 0) or 0,
                                'output': usage.get('output', 0) or usage.get('outputTokens', 0) or 0,
                                'cache_read': usage.get('cacheRead', 0) or 0,
                                'cache_write': usage.get('cacheWrite', 0) or 0,
                                'total': usage.get('totalTokens', 0) or 0
                            })
                except:
                    pass
        except:
            pass
    
    events.sort(key=lambda x: x['time'])
    
    # Aggregate into hourly buckets
    buckets = defaultdict(lambda: {'time': 0, 'tokens_by_model': defaultdict(int), 'total': 0, 'input': 0, 'output': 0, 'cache_read': 0})
    
    for event in events:
        hour_bucket = event['time'] // (3600 * 1000) * (3600 * 1000)
        buckets[hour_bucket]['time'] = hour_bucket
        buckets[hour_bucket]['tokens_by_model'][event['model']] += event['total']
        buckets[hour_bucket]['total'] += event['total']
        buckets[hour_bucket]['input'] += event['input']
        buckets[hour_bucket]['output'] += event['output']
        buckets[hour_bucket]['cache_read'] += event['cache_read']
    
    result = list(buckets.values())
    for r in result:
        r['tokens_by_model'] = dict(r['tokens_by_model'])
    
    result.sort(key=lambda x: x['time'])
    return result

print(json.dumps(extract_historical('${sessionsPath}')))
`;
    
    const python = spawn('python3', ['-c', pythonScript]);
    let output = '';
    let error = '';
    
    const timeoutId = setTimeout(() => {
      python.kill('SIGTERM');
      reject(new Error('Historical data extraction timeout'));
    }, 30000);
    
    python.stdout.on('data', (data) => output += data);
    python.stderr.on('data', (data) => error += data);
    
    python.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new Error(`Failed to extract: ${error}`));
      } else {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          reject(new Error(`Failed to parse: ${e.message}`));
        }
      }
    });
    
    python.on('error', reject);
  });
}

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  let requestTimeout;
  if (url.pathname !== '/api/tokens/stream') {
    requestTimeout = setTimeout(() => {
      if (!res.writableEnded) {
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Gateway timeout' }));
      }
    }, 35000);
  }
  
  // API: Current tokens
  if (url.pathname === '/api/tokens') {
    try {
      const data = await runTokenBurn();
      clearTimeout(requestTimeout);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      clearTimeout(requestTimeout);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  
  // API: Historical data from session files
  if (url.pathname === '/api/tokens/historical') {
    try {
      const historical = await extractHistoricalData();
      clearTimeout(requestTimeout);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(historical));
    } catch (err) {
      clearTimeout(requestTimeout);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  
  if (url.pathname === '/api/health') {
    clearTimeout(requestTimeout);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'ok', 
      timestamp: Date.now(),
      uptime: process.uptime()
    }));
    return;
  }
  
  // SSE endpoint
  if (url.pathname === '/api/tokens/stream') {
    let isActive = true;
    let intervalId = null;
    let keepaliveId = null;
    
    const cleanup = () => {
      isActive = false;
      if (intervalId) clearInterval(intervalId);
      if (keepaliveId) clearInterval(keepaliveId);
    };
    
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    
    const sendUpdate = async () => {
      if (!isActive || res.writableEnded) return;
      try {
        const data = await runTokenBurn();
        if (isActive && !res.writableEnded) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      } catch (err) {
        if (isActive && !res.writableEnded) {
          res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
        }
      }
    };
    
    const sendKeepalive = () => {
      if (isActive && !res.writableEnded) {
        res.write(`:keepalive ${Date.now()}\n\n`);
      }
    };
    
    sendUpdate();
    intervalId = setInterval(sendUpdate, SSE_UPDATE_INTERVAL);
    keepaliveId = setInterval(sendKeepalive, SSE_KEEPALIVE_INTERVAL);
    
    req.on('close', cleanup);
    req.on('error', cleanup);
    req.on('timeout', cleanup);
    
    setTimeout(() => {
      if (isActive && !res.writableEnded) {
        res.write(`event: timeout\ndata: {"message": "Connection expired, please reconnect"}\n\n`);
        res.end();
      }
      cleanup();
    }, 300000);
    
    return;
  }
  
  // Static files
  const staticMap = {
    '/': path.join(__dirname, 'dashboard/index.html'),
    '/mono-dashboard.css': path.join(__dirname, 'src/mono-dashboard.css')
  };
  
  const staticFile = staticMap[url.pathname];
  if (staticFile) {
    clearTimeout(requestTimeout);
    const ext = path.extname(staticFile);
    serveStatic(res, staticFile, MIME_TYPES[ext] || 'text/plain');
    return;
  }
  
  // Dashboard files
  if (url.pathname.startsWith('/dashboard/')) {
    const filePath = path.join(__dirname, url.pathname);
    const ext = path.extname(filePath);
    clearTimeout(requestTimeout);
    serveStatic(res, filePath, MIME_TYPES[ext] || 'text/plain');
    return;
  }
  
  // 404
  clearTimeout(requestTimeout);
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
║   Endpoints:                                               ║
║   • /api/tokens           - Current totals                 ║
║   • /api/tokens/historical - Time series from files        ║
║   • /api/tokens/stream    - Real-time SSE                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});
