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
 * Two distinct lifecycle promises are established immediately after spawn —
 * before the reserved port is released — so every way the child can die
 * before banner arrival is captured without weakening either guarantee:
 *
 *   childExited — resolves on the earliest termination signal ('exit' or
 *     'error', plus a synchronous exitCode/signalCode check). The startup
 *     promise races against childExited so synchronous and asynchronous
 *     signal termination reject the banner wait immediately rather than
 *     waiting for stdio to flush or hitting the 30s timeout.
 *
 *   childClosed — resolves only on the canonical 'close' event (stdio
 *     flushed) or on a spawn 'error'. stopRealServer awaits this so it
 *     never returns while inherited stdio pipes remain held by a
 *     descendant.
 *
 * The reserved port is released before the banner-parsing promise starts, so
 * the TCP probe can only succeed once the child actually binds the port. The
 * actual port is parsed from the server's stdout banner, which handles the
 * case where server.js falls back to an adjacent port on EADDRINUSE.
 *
 * The optional `options.serverPath` argument allows focused lifecycle probes
 * to inject a deliberate target (e.g. a rogue child that holds an inherited
 * stdio pipe via a surviving descendant) without altering the production
 * path. The default is the repository's real server.js.
 */
async function startRealServer(options = {}) {
  const { port, release } = await reservePort();
  const serverPath = options.serverPath || path.resolve(__dirname, '..', '..', 'server.js');
  const child = spawn('bun', [serverPath], {
    cwd: path.resolve(__dirname, '..', '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port) }
  });

  // Collect stderr for diagnostics in error messages.
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  // Two distinct lifecycle promises sharing a single terminationReason:
  //   childExited — prompt, used by startup rejection.
  //   childClosed — canonical 'close' (stdio flushed), used by cleanup.
  let exited = false;
  let closed = false;
  let terminationReason = null;

  const childExited = new Promise((resolve) => {
    const finishExit = (reason) => {
      if (exited) return;
      exited = true;
      terminationReason = reason;
      resolve();
    };

    // Synchronous check: spawn may have already exited or been signalled
    // before we could attach listeners.
    if (child.exitCode !== null) {
      finishExit({ kind: 'exit', code: child.exitCode, signal: child.signalCode });
      return;
    }
    if (child.signalCode !== null) {
      finishExit({ kind: 'signal', code: null, signal: child.signalCode });
      return;
    }

    // 'exit' may fire before 'close' on signal termination; this is what
    // gives childExited its prompt signal-detection guarantee.
    child.on('exit', (code, signal) => {
      finishExit({ kind: signal ? 'signal' : 'exit', code, signal });
    });
    // Spawn failures (ENOENT, EACCES) emit 'error' without ever emitting
    // 'exit' or 'close'.
    child.on('error', (err) => {
      finishExit({ kind: 'spawn-error', error: err });
    });
  });

  const childClosed = new Promise((resolve) => {
    const finishClose = (reason) => {
      if (closed) return;
      closed = true;
      // Don't clobber terminationReason if childExited already populated it.
      // On 'error' both finishers would record the same reason; on 'close'
      // the exit/signal info matches what 'exit' would have carried.
      if (terminationReason === null) terminationReason = reason;
      resolve();
    };

    // Synchronous check: same as above for the stdio-flush path.
    if (child.exitCode !== null) {
      finishClose({ kind: 'exit', code: child.exitCode, signal: child.signalCode });
      return;
    }
    if (child.signalCode !== null) {
      finishClose({ kind: 'signal', code: null, signal: child.signalCode });
      return;
    }

    // 'close' is the canonical terminal event — it waits for stdio to flush.
    child.on('close', (code, signal) => {
      finishClose({ kind: signal ? 'signal' : 'exit', code, signal });
    });
    // Spawn failures emit 'error' without 'close', so resolve childClosed
    // here too — otherwise stopRealServer would hang on a never-emitted
    // 'close'.
    child.on('error', (err) => {
      finishClose({ kind: 'spawn-error', error: err });
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
      if (exited) {
        clearTimeout(timeout);
        reject(new Error(
          formatTermination('server terminated before emitting listening URL', terminationReason, stderr)
        ));
        return;
      }

      // Race later termination against the banner wait. childExited resolves
      // on 'exit' or 'error' (or the synchronous check above) so signal
      // kills reject promptly without waiting for stdio to flush.
      childExited.then(() => {
        clearTimeout(timeout);
        // Guard against double-rejection if the banner already arrived or
        // the synchronous check above already rejected.
        if (!exited) return;
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
    // Kill only if the child is still alive (exit/signal not yet observed).
    if (!exited) child.kill('SIGKILL');
    // Do NOT await childClosed on the startup error path. A descendant
    // holding an inherited stdio pipe (e.g. a SIGTERM'd child whose
    // grandchild survived) keeps the canonical 'close' event pending for
    // seconds, which would turn a millisecond-scale rejection into a
    // multi-second delay. Startup rejection must remain prompt on both
    // synchronous and asynchronous signal termination. Attach a no-op
    // catch so the orphaned lifecycle promise can never surface as an
    // unhandled rejection if it ever fails to settle.
    childClosed.catch(() => {});
    throw err;
  }
}

/**
 * Stop a real server child process deterministically.
 *
 * Sends SIGTERM, waits up to 5s, then force-kills with SIGKILL.
 * Awaits the canonical 'close' event (stdio flushed) via childClosed
 * rather than 'exit', so this function never returns while inherited
 * stdio pipes remain held by a descendant. Checks exitCode and
 * signalCode to handle an already-exited child.
 */
async function stopRealServer(server) {
  if (!server) return;
  const { child, childClosed } = server;

  // Already exited or signalled — wait for stdio to flush, then return.
  if (child.exitCode !== null || child.signalCode !== null) {
    await childClosed;
    return;
  }

  // Send SIGTERM and wait up to 5s for a clean exit (and stdio flush).
  child.kill('SIGTERM');
  const raced = await Promise.race([
    childClosed.then(() => 'done'),
    new Promise((r) => setTimeout(() => r('timeout'), 5000))
  ]);

  // After the timeout, force-kill only when the child still appears alive.
  // Do NOT await childClosed inside this branch — the unconditional await
  // below guarantees that this function never returns before stdio is fully
  // flushed, even when a descendant still holds an inherited pipe after
  // signal termination.
  if (raced === 'timeout' && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }

  // Always await childClosed before returning. When the 'done' branch
  // already resolved it this is a no-op; when the timeout branch fired and
  // a descendant holds the pipe, this blocks until the pipe drains so
  // callers never observe inherited handles still in use.
  await childClosed;
}

module.exports = { startRealServer, stopRealServer };
