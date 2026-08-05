const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

/**
 * Find an available port by briefly binding a TCP listener.
 */
function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Start the real Bun server on an ephemeral port.
 * Returns { baseUrl, port, child } after the server is listening.
 */
async function startRealServer() {
  const port = await getAvailablePort();
  const serverPath = path.resolve(__dirname, '..', '..', 'server.js');
  const child = spawn('bun', [serverPath], {
    cwd: path.resolve(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) }
  });

  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('server did not start within 30s')), 30000);

    const onData = (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match && Number(match[1]) === port) {
        clearTimeout(timeout);
        child.stdout.off('data', onData);
        resolve();
      }
    };

    child.stdout.on('data', onData);
    child.on('error', (err) => { clearTimeout(timeout); reject(err); });
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`server exited with code ${code}`));
      }
    });
  });

  return { baseUrl: `http://127.0.0.1:${port}/`, port, child };
}

function stopRealServer(child) {
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
}

module.exports = { startRealServer, stopRealServer };
