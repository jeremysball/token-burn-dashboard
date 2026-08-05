const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

/**
 * Reserve an ephemeral port by binding a listener and holding it open.
 * Returns { port, release } where release() closes the listener.
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
 * Start the real Bun server on an ephemeral port.
 * Returns { baseUrl, port, child } after the server is listening.
 *
 * The reserved port is released before probing so that the TCP probe
 * can only succeed once the child process has actually bound the port.
 * The actual port is parsed from the server's stdout banner, which
 * handles the case where server.js falls back to an adjacent port
 * on EADDRINUSE.
 */
async function startRealServer() {
  const { port, release } = await reservePort();
  const serverPath = path.resolve(__dirname, '..', '..', 'server.js');
  const child = spawn('bun', [serverPath], {
    cwd: path.resolve(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) }
  });

  let closed = false;
  const childClosed = new Promise((resolve) => {
    if (child.exitCode !== null) { closed = true; resolve(); return; }
    child.on('close', () => { closed = true; resolve(); });
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    // Release the reservation first so the probe can only succeed
    // once the child actually binds the port.
    await release();

    // Parse stdout for the actual listening URL from server.js banner.
    // This handles the case where server.js falls back to an adjacent port.
    const actualPort = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`server did not emit listening URL within 30s. stderr: ${stderr.slice(0, 500)}`));
      }, 30000);

      let stdout = '';
      const onData = (chunk) => {
        stdout += chunk.toString();
        // Match the banner line: http://HOST:PORT
        const match = stdout.match(/https?:\/\/[^:]+:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          child.stdout.off('data', onData);
          resolve(Number(match[1]));
        }
      };
      child.stdout.on('data', onData);

      // If the child exits before emitting the URL, reject immediately.
      child.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`server exited with code ${code} before emitting listening URL. stderr: ${stderr.slice(0, 500)}`));
      });
    });

    return {
      baseUrl: `http://127.0.0.1:${actualPort}/`,
      port: actualPort,
      child,
      childClosed,
      _closed: () => closed
    };
  } catch (err) {
    if (!closed) child.kill('SIGKILL');
    await childClosed;
    throw err;
  }
}

/**
 * Stop a real server child process deterministically.
 *
 * Sends SIGTERM, waits up to 5s, then force-kills with SIGKILL.
 * Uses the 'close' event (waits for stdio to flush) rather than
 * 'exit'. Checks exitCode to handle an already-exited child.
 */
async function stopRealServer(server) {
  if (!server) return;
  const { child, childClosed } = server;

  // Already exited and closed — nothing to do.
  if (child.exitCode !== null) {
    await childClosed;
    return;
  }

  // Send SIGTERM and wait up to 5s for a clean exit.
  child.kill('SIGTERM');
  const exited = await Promise.race([
    childClosed.then(() => 'done'),
    new Promise((r) => setTimeout(() => r('timeout'), 5000))
  ]);

  // If still alive after SIGTERM, force-kill and wait for close.
  if (exited === 'timeout' && child.exitCode === null) {
    child.kill('SIGKILL');
    await childClosed;
  }
}

module.exports = { startRealServer, stopRealServer };
