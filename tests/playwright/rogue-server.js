/**
 * Rogue server for the real-server-fixture lifecycle probe.
 *
 * Runs under Bun (matching the spawn shape of startRealServer) and
 * deliberately exhibits two behaviors that the production server does
 * not:
 *
 *   1. Forks a grandchild that inherits stdout, so when this script is
 *      killed the inherited pipe stays open until the grandchild itself
 *      exits. This delays the canonical 'close' event on the parent
 *      child process for several seconds, exercising the descendant-
 *      held-pipe path that the fixture must handle deterministically.
 *
 *   2. Exits promptly on SIGTERM/SIGKILL without forwarding the signal
 *      to the grandchild, so the grandchild leaks past the parent and
 *      truly holds the pipe open across the fixture's await window.
 *
 * The mode is selected by the ROGUE_MODE environment variable:
 *
 *   'banner' (default) — prints the listening URL immediately so
 *      startRealServer returns successfully. Used to exercise the
 *      stopRealServer path against an already-started server.
 *
 *   'no-banner' — never prints the listening URL, so the banner wait in
 *      startRealServer can only resolve via termination. Used to
 *      exercise the startup catch path.
 *
 * The grandchild exits on its own after ROGUE_GRANDCHILD_LIFETIME_MS
 * (default 5000ms).
 *
 * File-based readiness protocol (consumed by lifecycle-probe.js).
 * Each invocation reads its own unique file paths so concurrent probes
 * never collide:
 *
 *   ROGUE_PARENT_PID_FILE      — written by this script AFTER the
 *      grandchild has been spawned. The probe uses this PID to signal
 *      exactly this instance without scanning ps.
 *
 *   ROGUE_GRANDCHILD_PID_FILE  — written by this script in the
 *      grandchild's 'spawn' event handler. The probe uses it during
 *      cleanup if the grandchild outlives the parent.
 *
 *   ROGUE_GRANDCHILD_READY_FILE — written by the grandchild after its
 *      first successful process.stdout.write(''). The probe waits for
 *      this marker before signalling the parent, so the marker proves
 *      the inherited stdout pipe is alive on the descendant side before
 *      the SIGTERM.
 *
 *   ROGUE_GRANDCHILD_EXIT_FILE — written by the grandchild as its last
 *      action before process.exit(0). stopRealServer's childClosed can
 *      only resolve after the grandchild's inherited handles release
 *      the pipe — exactly when this marker is written — so the marker
 *      is the direct proof that the descendant actually exited before
 *      stopRealServer returned.
 */
const cp = require('child_process');
const fs = require('fs');

const mode = process.env.ROGUE_MODE || 'banner';
const port = process.env.PORT || 0;

// Per-run unique file paths. We don't reference these by name in the
// parent; they are passed through to the grandchild via process.env
// so the read of ROGUE_GRANDCHILD_*_FILE happens inside the spawned
// grandchild's -e script. parentPidFile is the only one this script
// reads directly.
const parentPidFile = process.env.ROGUE_PARENT_PID_FILE || '';
const grandchildPidFile = process.env.ROGUE_GRANDCHILD_PID_FILE || '';

function failFast(message, cause) {
  // Surface unexpected filesystem errors rather than silently swallowing
  // them, per the probe's contract. We still exit non-zero so the probe
  // can see this rogue instance died for an unrelated reason.
  process.stderr.write(`rogue-server: ${message}\n`);
  if (cause) process.stderr.write(`${cause.stack || cause.message || cause}\n`);
  process.exit(2);
}

function writeMarker(file, contents) {
  if (!file) return;
  try {
    fs.writeFileSync(file, contents);
  } catch (e) {
    failFast(`failed to write ${file}`, e);
  }
}

// Spawn the grandchild FIRST. cp.spawn returns synchronously after the
// OS has created the child descriptor, so by writing the parent PID
// below we guarantee the descriptor exists. The grandchild runs with
// the same environment as this script, including ROGUE_GRANDCHILD_*
// marker file paths.
const grandchildSource = `
const fs = require('fs');
const readyFile = process.env.ROGUE_GRANDCHILD_READY_FILE || '';
const exitFile = process.env.ROGUE_GRANDCHILD_EXIT_FILE || '';
const lifetime = Number(process.env.ROGUE_GRANDCHILD_LIFETIME_MS || 5000);
if (!readyFile || !exitFile) {
  process.stderr.write('rogue grandchild: missing marker file env\\n');
  process.exit(2);
}
try { process.stdout.write(''); } catch { /* pipe existence check */ }
fs.writeFileSync(readyFile, String(process.pid));
const start = Date.now();
const interval = setInterval(() => {
  try { process.stdout.write(''); } catch { /* best-effort hold */ }
  if (Date.now() - start > lifetime) {
    clearInterval(interval);
    try {
      fs.writeFileSync(exitFile, String(process.pid));
    } catch (e) {
      process.stderr.write('rogue grandchild: failed to write exit marker\\n');
      process.stderr.write((e && e.stack) || String(e));
      process.exit(2);
    }
    process.exit(0);
  }
}, 100);
`;

const grandchild = cp.spawn(process.execPath, ['-e', grandchildSource], {
  stdio: 'inherit'
});

grandchild.on('spawn', () => {
  if (grandchildPidFile) writeMarker(grandchildPidFile, String(grandchild.pid));
});

grandchild.on('error', (err) => {
  failFast('grandchild spawn error', err);
});

// Parent readiness: write the parent PID AFTER cp.spawn has returned,
// but BEFORE the parent logs the banner. The probe treats the PID
// file's existence as proof that the child descriptor was created.
writeMarker(parentPidFile, String(process.pid));

// On SIGTERM, exit promptly. We deliberately do NOT forward the signal
// to the grandchild — the orphan grandchild is what holds the inherited
// pipe open, which is exactly the behaviour the fixture must handle.
process.on('SIGTERM', () => process.exit(0));
// SIGKILL cannot be caught; the kernel kills us instantly.

if (mode === 'banner') {
  // Emit the banner synchronously so startRealServer returns the
  // server handle immediately and the probe can move on to
  // exercising stopRealServer.
  process.stdout.write(`http://127.0.0.1:${port}\n`);
}

// Keep this process alive until signalled or the grandchild finishes.
const keepAlive = setInterval(() => {}, 60000);
grandchild.on('exit', () => {
  // Once the grandchild is gone, the inherited pipe is closed and the
  // parent's 'close' event can finally fire. We can exit too.
  clearInterval(keepAlive);
  process.exit(0);
});
