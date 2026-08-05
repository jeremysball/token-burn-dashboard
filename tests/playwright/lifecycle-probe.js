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
 * The probe relies on ROGUE_PID_FILE so each rogue instance writes its
 * own PID to a temp file and the probe can SIGTERM the exact process
 * without scanning ps.
 *
 * Run with: bun tests/playwright/lifecycle-probe.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startRealServer, stopRealServer } = require('./real-server-fixtures');

const ROGUE_SERVER_PATH = path.resolve(__dirname, 'rogue-server.js');
const STARTUP_REJECTION_BUDGET_MS = 2000;
const STOP_GRANDCHILD_LIFETIME_MS = 7000;
const STOP_PROBE_HARD_LIMIT_MS = 11000;
const STOP_PROBE_MIN_MS = 6000;
const PS_BIN = '/bin/ps';

function assert(condition, message) {
  if (!condition) {
    throw new Error(`lifecycle probe assertion failed: ${message}`);
  }
}

function makePidFile(label) {
  const file = path.join(os.tmpdir(), `rogue-${label}-${process.pid}-${Date.now()}.pid`);
  try { fs.unlinkSync(file); } catch { /* fresh probe */ }
  return file;
}

function readPidFile(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8').trim();
    const pid = parseInt(txt, 10);
    if (Number.isFinite(pid) && pid > 0) return pid;
  } catch { /* not written yet */ }
  return null;
}

function waitForPidFile(file, timeoutMs) {
  // Poll via setTimeout (NOT a busy-wait spin). The busy-wait would
  // starve the rogue server's startup because Bun's spawn of rogue
  // happens behind an await reservePort() in startRealServer, and a
  // busy-wait blocks the event loop that drives that await.
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const pid = readPidFile(file);
      if (pid) return resolve(pid);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, 10);
    };
    tick();
  });
}

function cleanupPidFile(file) {
  try { fs.unlinkSync(file); } catch { /* already cleaned */ }
}

function isRogueGrandchildLine(line) {
  return line.includes("process.stdout.write('')");
}

function extractPid(line) {
  const m = line.trim().match(/^(\d+)/);
  if (!m) return null;
  const pid = parseInt(m[1], 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function cleanupRogueDescendants() {
  // The rogue grandchild outlives its parent when the parent is
  // SIGTERM'd. Find any bun process whose argv contains the rogue
  // grandchild's distinctive stdout.write('') inline source.
  const { spawnSync } = require('child_process');
  const ps = spawnSync(PS_BIN, ['-eo', 'pid=,args=']);
  const lines = String(ps.stdout || '').split('\n');
  for (const line of lines) {
    if (!isRogueGrandchildLine(line)) continue;
    const pid = extractPid(line);
    if (!pid) continue;
    try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
  }
}

async function probeStartupRejection() {
  // Grandchild outlives the SIGTERM window by a wide margin so the
  // probe can prove that startRealServer does NOT await childClosed
  // on the startup error path.
  const pidFile = makePidFile('startup');
  process.env.ROGUE_MODE = 'no-banner';
  process.env.ROGUE_GRANDCHILD_LIFETIME_MS = '8000';
  process.env.ROGUE_PID_FILE = pidFile;

  const t0 = Date.now();
  let err = null;

  const startPromise = startRealServer({ serverPath: ROGUE_SERVER_PATH });
  const roguePid = await waitForPidFile(pidFile, 5000);
  assert(roguePid, 'rogue server must have written its PID within 5s');
  try { process.kill(roguePid, 'SIGTERM'); } catch { /* already dead */ }

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
  cleanupPidFile(pidFile);
  cleanupRogueDescendants();
}

async function probeStopRealServerAwaitsClose() {
  const pidFile = makePidFile('stop');
  process.env.ROGUE_MODE = 'banner';
  process.env.ROGUE_GRANDCHILD_LIFETIME_MS = String(STOP_GRANDCHILD_LIFETIME_MS);
  process.env.ROGUE_PID_FILE = pidFile;

  const server = await startRealServer({ serverPath: ROGUE_SERVER_PATH });
  assert(server && server.child && server.childClosed, 'startRealServer must return a server handle with child and childClosed');
  assert(server.child.exitCode === null && server.child.signalCode === null, 'fresh rogue server must be alive');
  assert(server.child.pid && server.child.pid > 0, 'fresh rogue server must expose a pid');

  // SIGTERM the rogue child. The rogue handler exits promptly via
  // process.exit(0), so 'exit' fires quickly but the inherited stdout
  // pipe stays held by the orphan grandchild for ~7s.
  process.kill(server.child.pid, 'SIGTERM');

  const t0 = Date.now();
  await stopRealServer(server);
  const elapsed = Date.now() - t0;
  console.log(`stopRealServer elapsed: ${elapsed}ms (must be >= ${STOP_PROBE_MIN_MS} and < ${STOP_PROBE_HARD_LIMIT_MS})`);

  // Probe 1: stopRealServer must not return before childClosed resolves.
  // We verify by awaiting childClosed again; if it has not yet
  // resolved, stopRealServer returned too early.
  const verifyStart = Date.now();
  await server.childClosed;
  const verifyElapsed = Date.now() - verifyStart;
  console.log(`post-return childClosed await: ${verifyElapsed}ms (budget < 200ms)`);
  assert(
    verifyElapsed < 200,
    `stopRealServer must await childClosed before returning; post-return await took ${verifyElapsed}ms`
  );

  // Probe 2: stopRealServer must actually wait past the SIGTERM race
  // timeout (5s). With a 7s grandchild lifetime, total elapsed should
  // be at least 6s and at most ~9s. If stopRealServer bailed out at
  // the 5s race without awaiting childClosed, elapsed would be ~5s.
  assert(
    elapsed >= STOP_PROBE_MIN_MS,
    `stopRealServer must not return before childClosed resolves even after the SIGTERM race window; got ${elapsed}ms (expected >= ${STOP_PROBE_MIN_MS}ms)`
  );
  assert(
    elapsed < STOP_PROBE_HARD_LIMIT_MS,
    `stopRealServer must complete within hard limit; got ${elapsed}ms (limit ${STOP_PROBE_HARD_LIMIT_MS}ms)`
  );
  cleanupPidFile(pidFile);
  cleanupRogueDescendants();
}

async function main() {
  console.log('--- probe 1: startRealServer rejection stays prompt under SIGTERM + descendant-held-pipe');
  await probeStartupRejection();
  console.log('  PASS');

  console.log('--- probe 2: stopRealServer awaits childClosed unconditionally');
  await probeStopRealServerAwaitsClose();
  console.log('  PASS');

  cleanupRogueDescendants();
  console.log('--- lifecycle probe: ALL PASS');
}

main().catch((err) => {
  cleanupRogueDescendants();
  console.error('--- lifecycle probe: FAIL');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});