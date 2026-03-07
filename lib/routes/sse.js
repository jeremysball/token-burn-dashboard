/**
 * Server-Sent Events (SSE) route handler
 */

const { getTokensData } = require('../cache');
const { SSE_UPDATE_INTERVAL, SSE_KEEPALIVE_INTERVAL, SSE_MAX_CONNECTION_TIME } = require('../config');

/**
 * Handle /api/tokens/stream route
 */
function handleSseRoute(req, res) {
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
      const data = await getTokensData();
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
  }, SSE_MAX_CONNECTION_TIME);
}

module.exports = { handleSseRoute };
