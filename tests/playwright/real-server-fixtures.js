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
 * Returns { baseUrl, port, child, childClosed } after the server is listening.
 *
 * Child lifecycle handlers (close, error) are registered immediately after
 * spawn, before the reserved port is released. The startup promise rejects
 * on error or early close/exit, so a dead child or failed spawn never
 * leaves the banner wait hanging for30 seconds.
 *
 * The reserved port is released before the banner-parsing promise starts,
 * so the TCP probe can only succeed once the child actually binds the port.
 * The actual port is parsed from the server's stdout banner, which handles
 * the case where server.js falls back to an adjacent port on EADDRINUSE.
 */
async function startRealServer() {
  const { port, release } = await reservePort();
  const serverPath = path.resolve(__dirname, '..', '..', 'server.js');
  const child = spawn('bun', [serverPath], {
    cwd: path.resolve(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) }
  });

  // Track whether the child has closed (stdio flushed).
  // Check exitCode first in case the child already exited synchronously.
  let closed = false;
  const childClosed = new Promise((resolve) => {
    if (child.exitCode !== null) { closed = true; resolve(); return; }
    child.on('close', () => { closed = true; resolve(); });
  });

  // Collect stderr for diagnostics in error messages.
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  // Register error handler immediately — covers spawn failures (ENOENT, EACCES)
  // that emit 'error' without ever emitting 'exit'.
  let spawnError = null;
  child.on('error', (err) => { spawnError = err; });

  try {
    // Release the reservation first so the probe can only succeed
    // once the child actually binds the port.
    await release();

    // Parse stdout for the actual listening URL from server.js banner.
    // Rejects immediately on spawn error or early close/exit.
    const actualPort = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(
          `server did not emit listening URL within 30s. stderr: ${stderr.slice(0, 500)}`
        ));
      }, 30000);

      // If spawn already failed before we got here, reject now.
      if (spawnError) {
        clearTimeout(timeout);
        reject(new Error(`spawn failed: ${spawnError.message}`));
        return;
      }

      // If the child already exited before we got here, reject now.
      if (child.exitCode !== null) {
        clearTimeout(timeout);
        reject(new Error(
          `server exited with code ${child.exitCode} before emitting listening URL. stderr: ${stderr.slice(0, 500)}`
        ));
        return;
      }

      // Listen for spawn error (may fire after release() if spawn was slow).
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`spawn failed: ${err.message}`));
      });

      // Listen for early exit/close before the banner arrives.
      child.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(
          `server exited with code ${code} before emitting listening URL. stderr: ${stderr.slice(0, 500)}`
        ));
      });

      // Parse stdout for the banner URL.
      let stdout = '';
      const onData = (chunk) => {
        stdout += chunk.toString();
        const match = stdout.match(/https?:\/\/[^:]+:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          child.stdout.off('data', onData);
          resolve(Number(match[1]));
        }
      };
      child.stdout.on('data', onData);
    });

    return {
      baseUrl: `http://127.0.0.1:${actualPort}/`,
      port: actualPort,
      child,
      childClosed
    };
  } catch (err) {
    // Kill only if the child is still alive.
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
