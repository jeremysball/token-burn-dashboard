/**
 * Tests for unified session discovery
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../../lib/config');

const DISCOVERY_PATH = '../../../lib/session-discovery';

describe('Session Discovery', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-test-'));

  // Original environment snapshot for full isolation across tests.
  const origEnv = {
    HOME: process.env.HOME,
    EXTRA_SESSION_DIRS: process.env.EXTRA_SESSION_DIRS,
    CLAUDE_PROJECTS_DIR: process.env.CLAUDE_PROJECTS_DIR
  };
  let homedirSpy;

  beforeEach(() => {
    // Fresh module per test => no shared-state leakage between tests.
    jest.resetModules();
  });

  afterEach(() => {
    if (homedirSpy) {
      homedirSpy.mockRestore();
      homedirSpy = null;
    }
    // Restore original env: delete vars that were originally absent (assigning
    // undefined would coerce to the literal string "undefined" and leak).
    if (origEnv.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = origEnv.HOME;
    if (origEnv.EXTRA_SESSION_DIRS === undefined) delete process.env.EXTRA_SESSION_DIRS;
    else process.env.EXTRA_SESSION_DIRS = origEnv.EXTRA_SESSION_DIRS;
    if (origEnv.CLAUDE_PROJECTS_DIR === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
    else process.env.CLAUDE_PROJECTS_DIR = origEnv.CLAUDE_PROJECTS_DIR;
    jest.resetModules();
  });

  afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  // Load a fresh discovery module with os.homedir() pointed at homeDir.
  // This derives PI_SESSION_BASES purely from module initialization.
  function loadWithHome(homeDir) {
    homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(homeDir);
    return require(DISCOVERY_PATH);
  }

  // Restrict a freshly loaded module's bases to only the given dirs, so
  // behavior tests are isolated from real session dirs on the machine.
  function loadIsolated(...dirs) {
    const discovery = require(DISCOVERY_PATH);
    discovery.PI_SESSION_BASES.length = 0;
    discovery.PI_SESSION_BASES.push(...dirs);
    return discovery;
  }

  function makeFileIn(p, size = 64) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x'.repeat(size));
  }

  it('excludes .deleted. jsonl files', () => {
    const base = path.join(tmpBase, 't-deleted');
    makeFileIn(path.join(base, 'session-1.jsonl'));
    makeFileIn(path.join(base, 'session-1.deleted.jsonl'));

    const discovery = loadIsolated(base);
    const files = discovery.findPiJsonlFiles();
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('session-1.jsonl');
    expect(names).not.toContain('session-1.deleted.jsonl');
  });

  it('enforces the configured maximum file size from MAX_FILE_BYTES', () => {
    const base = path.join(tmpBase, 't-maxsize');
    makeFileIn(path.join(base, 'small.jsonl'), 64);
    makeFileIn(path.join(base, 'big.jsonl'), config.MAX_FILE_BYTES + 1);

    const discovery = loadIsolated(base);
    const files = discovery.findPiJsonlFiles();
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('small.jsonl');
    expect(names).not.toContain('big.jsonl');
  });

  it('deduplicates symlinked aliases by realpath and supports symlink jsonl', () => {
    const realDir = path.join(tmpBase, 't-dedup', 'realdir');
    fs.mkdirSync(realDir, { recursive: true });
    const realPath = path.join(realDir, 'dup.jsonl');
    fs.writeFileSync(realPath, 'x'.repeat(64));

    const linkDir = path.join(tmpBase, 't-dedup', 'linkdir');
    fs.mkdirSync(linkDir, { recursive: true });
    fs.symlinkSync(realPath, path.join(linkDir, 'dup-linked.jsonl'));

    const discovery = loadIsolated(realDir, linkDir);
    const files = discovery.findPiJsonlFiles();
    // Both aliases are scanned (symlink jsonl supported), but collapse to one.
    expect(files.length).toBe(1);
    const reals = new Set(files.map(f => fs.realpathSync(f.path)));
    expect(reals.size).toBe(1);
  });

  it('does not emit a .jsonl symlink that points to a directory (Pi)', () => {
    const base = path.join(tmpBase, 't-dirsym');
    fs.mkdirSync(base, { recursive: true });
    const realDir = path.join(base, 'realsub');
    fs.mkdirSync(realDir, { recursive: true });
    // A symlink named like a jsonl file, but targeting a directory, sitting in
    // an otherwise flat session dir so it is actually scanned as a jsonl entry.
    fs.symlinkSync(realDir, path.join(base, 'not-a-file.jsonl'));

    const discovery = loadIsolated(base);
    const files = discovery.findPiJsonlFiles();
    const names = files.map(f => path.basename(f.path));
    expect(names).not.toContain('not-a-file.jsonl');
  });

  it('does not emit a .jsonl symlink that points to a directory (Claude)', () => {
    const root = path.join(tmpBase, 't-claudesym');
    const proj = path.join(root, '-workspace-x');
    fs.mkdirSync(path.join(proj, 'realsub'), { recursive: true });
    // Symlink named like a jsonl file but targeting a directory.
    fs.symlinkSync(path.join(proj, 'realsub'), path.join(proj, 'not-a-file.jsonl'));

    const orig = process.env.CLAUDE_PROJECTS_DIR;
    process.env.CLAUDE_PROJECTS_DIR = root;
    try {
      jest.resetModules();
      const discovery = require(DISCOVERY_PATH);
      const files = discovery.findClaudeJsonlFiles();
      const names = files.map(f => path.basename(f.path));
      expect(names).not.toContain('not-a-file.jsonl');
    } finally {
      if (orig === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
      else process.env.CLAUDE_PROJECTS_DIR = orig;
    }
  });

  it('reads home-directory session bases from the environment at init', () => {
    const homeDir = path.join(tmpBase, 't-home');
    makeFileIn(path.join(homeDir, '.pi', 'sessions', 'home-session.jsonl'));

    const discovery = loadWithHome(homeDir);
    const homeBase = path.join(homeDir, '.pi', 'sessions');
    // Module initialization derived the home base from os.homedir().
    expect(discovery.PI_SESSION_BASES).toContain(homeBase);
  });

  it('reads EXTRA_SESSION_DIRS from the environment at init', () => {
    const homeDir = path.join(tmpBase, 't-extra-home');
    const extraDir = path.join(tmpBase, 't-extra-dir');
    fs.mkdirSync(extraDir, { recursive: true });

    process.env.EXTRA_SESSION_DIRS = extraDir;
    const discovery = loadWithHome(homeDir);
    // Module initialization derived the extra base from EXTRA_SESSION_DIRS.
    expect(discovery.PI_SESSION_BASES).toContain(extraDir);
  });

  it('uses os.homedir() for Claude projects root when CLAUDE_PROJECTS_DIR is unset', () => {
    const fakeHome = path.join(tmpBase, 't-claude-home');
    delete process.env.CLAUDE_PROJECTS_DIR;
    const discovery = loadWithHome(fakeHome);
    expect(discovery.CLAUDE_PROJECTS_ROOT).toBe(path.join(fakeHome, '.claude/projects'));
  });

  it('cleanup restores absent env vars via delete, not literal "undefined"', () => {
    // afterEach runs after the previous test; an originally-absent var must
    // remain absent (or its original value), never the string "undefined".
    expect(process.env.EXTRA_SESSION_DIRS).not.toBe('undefined');
    expect(process.env.CLAUDE_PROJECTS_DIR).not.toBe('undefined');
    expect(process.env.HOME).not.toBe('undefined');
  });
});
