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
 * Format a child-termination reason into a diagnostic string.
 * Handles every termination mode: spawn error, signal kill, normal exit.
 */
function formatTermination(prefix, reason, stderr) {
  const tail = `stderr: ${stderr.slice(0, 500)}`;
  if (!reason) return `${prefix}. ${tail}`;
  if (reason.kind === 'spawn-error') {
    return `${prefix}: spawn failed (${reason.error.message}). ${tail}`;
  }
  if (reason.kind === 'signal') {
    return `${prefix}: terminated by signal ${reason.signal}. ${tail}`;
  }
  return `${prefix}: exited with code ${reason.code}. ${tail}`;
}

/**
 * Start the real Bun server on an ephemeral port.
 * Returns { baseUrl, port, child, childClosed } after the server is listening.
 *
 * A single coherent lifecycle state (childClosed + the closed / terminationReason
 * bindings) is established immediately after spawn — before the reserved port
 * is released — so every way the child can die before banner arrival is
 * captured:
 *   - synchronous exit (exitCode already set when listeners attach)
 *   - synchronous signal termination (signalCode already set)
 *   - spawn failure (ENOENT, EACCES, …) that emits 'error' without 'exit'
 *   - async exit/close/signal after release() returns
 *
 * The startup promise checks this state synchronously before scheduling its
 * banner wait, so a child killed by signal before the reservation is released
 * rejects immediately instead of letting the banner wait hit its 30s timeout.
 *
 * The reserved port is released before the banner-parsing promise starts, so
 * the TCP probe can only succeed once the child actually binds the port. The
 * actual port is parsed from the server's stdout banner, which handles the
 * case where server.js falls back to an adjacent port on EADDRINUSE.
 */
async function startRealServer() {
  const { port, release } = await reservePort();
  const serverPath = path.resolve(__dirname, '..', '..', 'server.js');
  const child = spawn('bun', [serverPath], {
    cwd: path.resolve(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) }
  });

  // Collect stderr for diagnostics in error messages.
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  // Single coherent lifecycle state. Listeners for close / error / exit are
  // attached immediately after spawn — before await release() — so a child
  // that is signalled or exits before the reservation is released cannot
  // slip past the banner wait. `closed` and `terminationReason` are updated
  // synchronously by whichever event fires first.
  let closed = false;
  let terminationReason = null;
  const childClosed = new Promise((resolve) => {
    const finish = (reason) => {
      if (closed) return;
      closed = true;
      terminationReason = reason;
      resolve();
    };

    // Synchronous check: spawn may have already exited or been signalled
    // before we could attach listeners (rare, but possible for fast-failing
    // children).
    if (child.exitCode !== null) {
      finish({ kind: 'exit', code: child.exitCode, signal: child.signalCode });
      return;
    }
    if (child.signalCode !== null) {
      finish({ kind: 'signal', code: null, signal: child.signalCode });
      return;
    }

    // 'close' is the canonical terminal event — it waits for stdio to flush.
    child.on('close', (code, signal) => {
      finish({ kind: signal ? 'signal' : 'exit', code, signal });
    });
    // Spawn failures (ENOENT, EACCES) emit 'error' without ever emitting
    // 'exit' or 'close'.
    child.on('error', (err) => {
      finish({ kind: 'spawn-error', error: err });
    });
    // 'exit' may fire before 'close' on signal termination, where exitCode
    // remains null and signalCode carries the signal name. Capturing it
    // here ensures closed flips immediately rather than waiting for stdio.
    child.on('exit', (code, signal) => {
      finish({ kind: signal ? 'signal' : 'exit', code, signal });
    });
  });

  try {
    // Release the reservation first so the probe can only succeed
    // once the child actually binds the port.
    await release();

    // Parse stdout for the actual listening URL from server.js banner.
    // Rejects immediately on any prior or concurrent termination.
    const actualPort = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(
          `server did not emit listening URL within 30s. stderr: ${stderr.slice(0, 500)}`
        ));
      }, 30000);

      // Synchronous termination: reject before scheduling any listeners so
      // the 30s timer is cleared immediately.
      if (closed) {
        clearTimeout(timeout);
        reject(new Error(
          formatTermination('server terminated before emitting listening URL', terminationReason, stderr)
        ));
        return;
      }

      // Race later termination against the banner wait.
      childClosed.then(() => {
        clearTimeout(timeout);
        // Guard against double-rejection if the banner already arrived or
        // the synchronous check above already rejected.
        if (!closed) return;
        reject(new Error(
          formatTermination('server terminated before emitting listening URL', terminationReason, stderr)
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
 * 'exit'. Checks exitCode and signalCode to handle an already-exited child.
 */
async function stopRealServer(server) {
  if (!server) return;
  const { child, childClosed } = server;

  // Already exited or signalled — nothing to do.
  if (child.exitCode !== null || child.signalCode !== null) {
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
  if (exited === 'timeout' && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await childClosed;
  }
}

module.exports = { startRealServer, stopRealServer };
