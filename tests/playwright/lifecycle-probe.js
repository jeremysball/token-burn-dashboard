/**
 * Lifecycle probe for tests/playwright/real-server-fixtures.js.
 *
 * Exercises the two P1 findings from the final scoped review using the
 * real spawn and lifecycle path that the fixture uses in production.
 * The rogue server (tests/playwright/rogue-server.js) is the target
 * because it deliberately forks a grandchild that inherits stdout,
 * so killing the rogue leaves the inherited pipe open until the
 * grandchild exits on its own timer.
 *
 *   1. startRealServer() must reject promptly on synchronous and
 *      asynchronous signal termination, even when a descendant holds
 *      an inherited stdio pipe past the child's exit. The previous
 *      implementation awaited childClosed inside the startup catch
 *      block, which turned a millisecond-scale rejection into a
 *      multi-second stdio-flush delay.
 *
 *   2. stopRealServer() must never return before childClosed resolves.
 *      The previous implementation could return after the SIGTERM
 *      timeout race when exitCode/signalCode was set, even though
 *      childClosed was still pending because a descendant held an
 *      inherited stdio pipe.
 *
 * The probe relies on a per-run unique set of files so concurrent
 * probes cannot collide:
 *
 *   ROGUE_PARENT_PID_FILE      — written by the rogue after spawn.
 *   ROGUE_GRANDCHILD_PID_FILE  — written by the rogue when the
 *                                 grandchild 'spawn' event fires.
 *   ROGUE_GRANDCHILD_READY_FILE — written by the grandchild after
 *                                 its first successful write to the
 *                                 inherited stdout. The probe waits
 *                                 for this marker before signalling
 *                                 the parent.
 *   ROGUE_GRANDCHILD_EXIT_FILE  — written by the grandchild as its
 *                                 last act before process.exit(0).
 *                                 stopRealServer's await of childClosed
 *                                 can only fire after the grandchild's
 *                                 inherited handles release the pipe,
 *                                 which is exactly when the exit marker
 *                                 is written — so its presence proves
 *                                 the assertion directly.
 *
 * Cleanup reads only the PIDs from this run's files, signals them if
 * alive, and removes the files. Already-gone PIDs/files are expected.
 * Unexpected filesystem or process errors surface as probe failures
 * rather than being silently swallowed. Cleanup runs in try/finally so
 * assertion failures never leave a rogue grandchild alive.
 *
 * Run with: bun tests/playwright/lifecycle-probe.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { startRealServer, stopRealServer } = require('./real-server-fixtures');

const ROGUE_SERVER_PATH = path.resolve(__dirname, 'rogue-server.js');
const STARTUP_REJECTION_BUDGET_MS = 2000;
const STOP_GRANDCHILD_LIFETIME_MS = 7000;
const STOP_PROBE_HARD_LIMIT_MS = 11000;
const READY_HARD_LIMIT_MS = 5000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`lifecycle probe assertion failed: ${message}`);
  }
}

function uniqueFiles(label) {
  // crypto.randomBytes avoids the sonarjs/pseudo-random warning while
  // remaining cheap; the value is used purely for filename uniqueness,
  // not security.
  const suffix = crypto.randomBytes(4).toString('hex');
  const base = path.join(
    os.tmpdir(),
    `rogue-${label}-${process.pid}-${Date.now()}-${suffix}`
  );
  return {
    parent: `${base}-parent.pid`,
    grandchild: `${base}-grandchild.pid`,
    ready: `${base}-grandchild-ready.marker`,
    exit: `${base}-grandchild-exit.marker`
  };
}

function setRogueEnv(files) {
  process.env.ROGUE_PARENT_PID_FILE = files.parent;
  process.env.ROGUE_GRANDCHILD_PID_FILE = files.grandchild;
  process.env.ROGUE_GRANDCHILD_READY_FILE = files.ready;
  process.env.ROGUE_GRANDCHILD_EXIT_FILE = files.exit;
}

function clearRogueState() {
  delete process.env.ROGUE_PARENT_PID_FILE;
  delete process.env.ROGUE_GRANDCHILD_PID_FILE;
  delete process.env.ROGUE_GRANDCHILD_READY_FILE;
  delete process.env.ROGUE_GRANDCHILD_EXIT_FILE;
  delete process.env.ROGUE_MODE;
  delete process.env.ROGUE_GRANDCHILD_LIFETIME_MS;
}

function readPidFromFile(file) {
  const txt = fs.readFileSync(file, 'utf8').trim();
  const pid = parseInt(txt, 10);
  assert(
    Number.isFinite(pid) && pid > 0,
    `pid file ${file} did not contain a positive integer: ${JSON.stringify(txt)}`
  );
  return pid;
}

function waitFor(file, timeoutMs, reader) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        return resolve(reader(file));
      } catch (e) {
        if (e && e.code === 'ENOENT') {
          if (Date.now() - start > timeoutMs) return resolve(null);
          return setTimeout(tick, 10);
        }
        return reject(e);
      }
    };
    tick();
  });
}

async function waitForPid(file, timeoutMs) {
  return waitFor(file, timeoutMs, readPidFromFile);
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    if (e && e.code === 'ENOENT') return false;
    throw new Error(`unexpected error checking ${p}: ${e && e.message ? e.message : e}`, { cause: e });
  }
}

async function waitForFile(file, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    if (fileExists(file)) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

function signalOrThrow(pid, signal) {
  // Treat ESRCH (already gone) as expected. Surface anything else so
  // unexpected process errors fail the probe rather than being silently
  // swallowed.
  try {
    process.kill(pid, signal);
  } catch (e) {
    if (e && e.code === 'ESRCH') return;
    throw new Error(`unexpected error signalling pid ${pid} with ${signal}: ${e && e.message ? e.message : e}`, { cause: e });
  }
}

function unlinkOrThrow(file) {
  try {
    fs.unlinkSync(file);
    return true;
  } catch (e) {
    if (e && e.code === 'ENOENT') return false;
    throw new Error(`unexpected error removing ${file}: ${e && e.message ? e.message : e}`, { cause: e });
  }
}

function readPidIfExists(file, errors) {
  try {
    return readPidFromFile(file);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    if (errors) errors.push(`read ${file}: ${e.message}`);
    return null;
  }
}

async function cleanupRun(files) {
  // Best-effort, exact-PID cleanup. We read our own PID files and
  // signal only those PIDs. Files we wrote are removed.
  const cleanupErrors = [];

  const grandchildPid = readPidIfExists(files.grandchild, cleanupErrors);
  const parentPid = readPidIfExists(files.parent, cleanupErrors);

  // Signal in grandchild-then-parent order so the parent never reaps
  // the grandchild before we get a chance to signal it.
  if (grandchildPid) signalOrThrow(grandchildPid, 'SIGKILL');
  if (parentPid) signalOrThrow(parentPid, 'SIGKILL');

  for (const file of [files.ready, files.exit, files.grandchild, files.parent]) {
    try {
      unlinkOrThrow(file);
    } catch (e) {
      cleanupErrors.push(e.message);
    }
  }

  if (cleanupErrors.length > 0) {
    throw new Error(`cleanup failed: ${cleanupErrors.join('; ')}`, { cause: new Error(cleanupErrors.join('; ')) });
  }
}

async function waitForDescendantReady(files) {
  const parentPid = await waitForPid(files.parent, 5000);
  assert(parentPid, 'rogue parent must have written its PID within 5s after spawn');
  const grandchildPid = await waitForPid(files.grandchild, 5000);
  assert(grandchildPid, 'rogue grandchild must have written its PID within 5s after spawn');
  const ready = await waitForFile(files.ready, READY_HARD_LIMIT_MS);
  assert(
    ready,
    `rogue grandchild must write its ready marker before SIGTERM; file ${files.ready} did not appear within ${READY_HARD_LIMIT_MS}ms`
  );
  return { parentPid, grandchildPid };
}

async function probeStartupRejection() {
  const files = uniqueFiles('startup');
  setRogueEnv(files);
  process.env.ROGUE_MODE = 'no-banner';
  process.env.ROGUE_GRANDCHILD_LIFETIME_MS = '8000';

  let err = null;
  let startPromise = null;
  try {
    const t0 = Date.now();
    startPromise = startRealServer({ serverPath: ROGUE_SERVER_PATH });
    // Defensive: if the rogue later exits naturally and we abort before
    // awaiting the promise, suppress the resulting unhandled rejection so
    // the probe's own assertion is what the test runner sees.
    startPromise.catch(() => {});

    await waitForDescendantReady(files);
    const { parentPid } = readDescendantPids(files);
    signalOrThrow(parentPid, 'SIGTERM');

    try {
      await startPromise;
    } catch (e) {
      err = e;
    }

    const elapsed = Date.now() - t0;
    console.log(`startup rejection elapsed: ${elapsed}ms (budget < ${STARTUP_REJECTION_BUDGET_MS}ms)`);
    console.log(`startup rejection error: ${err ? err.message.split('\n')[0] : 'NONE'}`);
    assert(err instanceof Error, 'startRealServer must reject when signalled before banner');
    assert(
      elapsed < STARTUP_REJECTION_BUDGET_MS,
      `startRealServer must reject promptly (< ${STARTUP_REJECTION_BUDGET_MS}ms) when a descendant holds an inherited stdio pipe after SIGTERM; got ${elapsed}ms`
    );
    assert(
      /terminated by signal SIGTERM|spawn failed|terminated before emitting/.test(err.message),
      `startup rejection diagnostic must include termination reason; got: ${err.message}`
    );
  } finally {
    await cleanupRun(files);
    clearRogueState();
    if (startPromise) {
      try { await startPromise; } catch { /* surfaced above */ }
    }
  }
}

function readDescendantPids(files) {
  // Sibling file existence uses fs.existsSync before the read; see
  // readPidIfExists. This helper only wraps two reads so probe bodies
  // stay linear.
  const errors = [];
  const parentPid = readPidIfExists(files.parent, errors);
  const grandchildPid = readPidIfExists(files.grandchild, errors);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return { parentPid, grandchildPid };
}

function assertServerHandle(server) {
  assert(server && server.child && server.childClosed, 'startRealServer must return a server handle with child and childClosed');
  assert(server.child.exitCode === null && server.child.signalCode === null, 'fresh rogue server must be alive');
  assert(server.child.pid && server.child.pid > 0, 'fresh rogue server must expose a pid');
}

function assertParentPidMatches(server, files) {
  const parentPid = readPidFromFile(files.parent);
  assert(
    parentPid === server.child.pid,
    `parent PID file (${parentPid}) must match server.child.pid (${server.child.pid}); proves rogue wrote parent PID only after spawn`
  );
}

async function assertChildClosedAlreadySettled(server) {
  // Probe invariant: stopRealServer must not return before childClosed
  // resolves. A second await that completes immediately is the direct
  // proof; if it has not yet resolved, stopRealServer returned too early.
  const verifyStart = Date.now();
  await server.childClosed;
  const verifyElapsed = Date.now() - verifyStart;
  console.log(`post-return childClosed await: ${verifyElapsed}ms (must be near-zero)`);
  assert(
    verifyElapsed < 200,
    `stopRealServer must await childClosed before returning; post-return await took ${verifyElapsed}ms`
  );
}

function assertGrandchildExitMarker(files) {
  // The grandchild-exit marker is the last thing the grandchild writes
  // before process.exit(0). stopRealServer's childClosed resolves only
  // when stdio closes — which happens precisely when the grandchild's
  // inherited handles release the pipe. The marker presence is
  // therefore the direct proof of the invariant.
  assert(
    fileExists(files.exit),
    `grandchild-exit marker must exist after stopRealServer returns; file ${files.exit} is missing`
  );
}

function assertGrandchildIsGone(files) {
  const recordedGrandchildPid = readPidFromFile(files.grandchild);
  let alive = true;
  try {
    process.kill(recordedGrandchildPid, 0);
  } catch (e) {
    if (e && e.code === 'ESRCH') alive = false;
    else throw new Error(`unexpected signal-0 error on grandchild ${recordedGrandchildPid}: ${e && e.message ? e.message : e}`, { cause: e });
  }
  assert(!alive, `grandchild pid ${recordedGrandchildPid} should be gone after stopRealServer returns`);
}

async function probeStopRealServerAwaitsClose() {
  const files = uniqueFiles('stop');
  setRogueEnv(files);
  process.env.ROGUE_MODE = 'banner';
  process.env.ROGUE_GRANDCHILD_LIFETIME_MS = String(STOP_GRANDCHILD_LIFETIME_MS);

  let server = null;
  try {
    server = await startRealServer({ serverPath: ROGUE_SERVER_PATH });
    assertServerHandle(server);
    assertParentPidMatches(server, files);
    await waitForDescendantReady(files);

    const t0 = Date.now();
    process.kill(server.child.pid, 'SIGTERM');
    await stopRealServer(server);
    const elapsed = Date.now() - t0;
    console.log(`stopRealServer elapsed: ${elapsed}ms (hard limit < ${STOP_PROBE_HARD_LIMIT_MS}ms)`);

    await assertChildClosedAlreadySettled(server);
    assertGrandchildExitMarker(files);
    assertGrandchildIsGone(files);

    // Operational upper timeout: a hung implementation that ignores the
    // marker and never closes stdio must not hang CI.
    assert(
      elapsed < STOP_PROBE_HARD_LIMIT_MS,
      `stopRealServer must complete within hard limit; got ${elapsed}ms (limit ${STOP_PROBE_HARD_LIMIT_MS}ms)`
    );
  } finally {
    if (server) {
      try {
        if (server.child && server.child.exitCode === null && server.child.signalCode === null) {
          await stopRealServer(server).catch(() => {});
        }
      } catch { /* surface only cleanup errors below */ }
    }
    await cleanupRun(files);
    clearRogueState();
  }
}

async function main() {
  console.log('--- probe 1: startRealServer rejection stays prompt under SIGTERM + descendant-held-pipe');
  await probeStartupRejection();
  console.log('  PASS');

  console.log('--- probe 2: stopRealServer awaits childClosed unconditionally');
  await probeStopRealServerAwaitsClose();
  console.log('  PASS');

  console.log('--- lifecycle probe: ALL PASS');
}

main().catch((err) => {
  console.error('--- lifecycle probe: FAIL');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
