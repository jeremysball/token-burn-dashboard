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
 * (default 5000ms) so leftover processes self-clean during the probe.
 *
 * If ROGUE_PID_FILE points to a writable path, this script writes its
 * own PID to it so the probe can signal this exact process without
 * scanning ps.
 */
const cp = require('child_process');
const fs = require('fs');

const mode = process.env.ROGUE_MODE || 'banner';
const grandchildLifetimeMs = Number(process.env.ROGUE_GRANDCHILD_LIFETIME_MS || 5000);
const port = process.env.PORT || 0;

if (process.env.ROGUE_PID_FILE) {
  try {
    fs.writeFileSync(process.env.ROGUE_PID_FILE, String(process.pid));
  } catch { /* best-effort PID file */ }
}

// Spawn a grandchild that inherits our stdout. stdio: 'inherit' means
// the grandchild receives the same stdout file descriptors as this
// process, so when we exit without forwarding SIGTERM the grandchild
// keeps the write end of the pipe alive.
const grandchild = cp.spawn(
  process.execPath,
  [
    '-e',
    `
const lifetime = ${grandchildLifetimeMs};
const start = Date.now();
const interval = setInterval(() => {
  try { process.stdout.write(''); } catch { /* best-effort hold */ }
  if (Date.now() - start > lifetime) {
    clearInterval(interval);
    process.exit(0);
  }
}, 100);
`
  ],
  { stdio: 'inherit' }
);

// On SIGTERM, exit promptly. We deliberately do NOT kill the grandchild
// here so the pipe stays held past our exit.
process.on('SIGTERM', () => process.exit(0));
// SIGKILL cannot be caught; the kernel kills us instantly, and the
// grandchild — which is a separate process — is reparented to init and
// continues to hold stdout until its own timer fires.

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