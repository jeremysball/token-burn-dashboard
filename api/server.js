import http from 'http';
import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 7071;

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

// Serve static files
async function serveStatic(res, filePath, contentType) {
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType, ...corsHeaders });
    res.end(content);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

// Run token-burn Python script
function runTokenBurn(sessionsPath = null) {
  return new Promise((resolve, reject) => {
    const scriptPath = '/workspace/.pi/skills/token-burn/src/token_burn.py';
    const args = ['--json'];
    if (sessionsPath) args.push(sessionsPath);
    else args.push(join(process.env.HOME, '.pi', 'agent', 'sessions'));
    
    const python = spawn('python3', [scriptPath, ...args]);
    let output = '';
    let error = '';
    
    python.stdout.on('data', (data) => output += data);
    python.stderr.on('data', (data) => error += data);
    
    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Token burn failed: ${error || 'Unknown error'}`));
      } else {
        try {
          const result = JSON.parse(output);
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  
  // API Routes
  if (url.pathname === '/api/tokens') {
    try {
      const data = await runTokenBurn(url.searchParams.get('path'));
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }
  
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    return;
  }
  
  // Static files
  const staticPaths = {
    '/': join(__dirname, '../dashboard/index.html'),
    '/dashboard.js': join(__dirname, '../dashboard/dashboard.js'),
    '/mono-dashboard.css': join(__dirname, '../src/mono-dashboard.css'),
    '/api/tokens/stream': null // SSE endpoint
  };
  
  if (url.pathname === '/api/tokens/stream') {
    // SSE for real-time updates
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...corsHeaders
    });
    
    const sendUpdate = async () => {
      try {
        const data = await runTokenBurn();
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      }
    };
    
    // Send initial data
    sendUpdate();
    
    // Update every 5 seconds
    const interval = setInterval(sendUpdate, 5000);
    
    req.on('close', () => clearInterval(interval));
    return;
  }
  
  const staticFile = staticPaths[url.pathname];
  if (staticFile) {
    const ext = url.pathname.split('.').pop();
    const mimeTypes = {
      'html': 'text/html',
      'js': 'application/javascript',
      'css': 'text/css'
    };
    await serveStatic(res, staticFile, mimeTypes[ext] || 'text/plain');
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🔥 Token Burn Dashboard API                              ║
║                                                            ║
║   http://localhost:${PORT}                                  ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Endpoints:
  GET /api/tokens        - Get token usage data (JSON)
  GET /api/tokens/stream - Real-time SSE stream
  GET /api/health        - Health check
`);
});
