const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

/**
 * Reserve an ephemeral port by binding a listener and holding it open.
 * Returns { port, release } where release() closes the listener.
 * Holding the listener prevents the OS from reassigning the port before
 * the child process binds to it.
 */
function reservePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ port, release: () => new Promise(r => srv.close(r)) });
    });
    srv.on('error', reject);
  });
}

/**
 * Probe a TCP port until a connection succeeds or timeout expires.
 */
function probePort(port, host = '127.0.0.1', timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error(`port ${port} did not become available within ${timeoutMs}ms`));
        return;
      }
      const sock = net.connect({ port, host }, () => {
        sock.destroy();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

/**
 * Start the real Bun server on an ephemeral port.
 * Returns { baseUrl, port, child } after the server is listening.
 * On startup failure the child process is killed before rejecting.
 */
async function startRealServer() {
  const { port, release } = await reservePort();
  const serverPath = path.resolve(__dirname, '..', '..', 'server.js');
  const child = spawn('bun', [serverPath], {
    cwd: path.resolve(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) }
  });

  try {
    // Wait for the child to bind the port (TCP probe succeeds),
    // then release the reserved listener so the port is fully owned by the child.
    await probePort(port, '127.0.0.1', 30000);
    await release();

    // Surface any early exit that raced past the probe
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        console.error(`server exited early with code ${code}`);
      }
    });
  } catch (err) {
    await release();
    if (!child.killed) child.kill('SIGTERM');
    throw err;
  }

  return { baseUrl: `http://127.0.0.1:${port}/`, port, child };
}

async function stopRealServer(child) {
  if (!child || child.killed) return;
  return new Promise((resolve) => {
    child.on('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 5000);
  });
}

module.exports = { startRealServer, stopRealServer };
