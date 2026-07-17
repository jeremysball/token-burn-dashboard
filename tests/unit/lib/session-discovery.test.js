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

  afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  function makeFile(name, size = 64) {
    const p = path.join(tmpBase, name);
    fs.writeFileSync(p, 'x'.repeat(size));
    return p;
  }

  function makeFileIn(p, size = 64) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x'.repeat(size));
  }

  afterEach(() => {
    delete process.env.EXTRA_SESSION_DIRS;
  });

  it('excludes .deleted. jsonl files', () => {
    makeFile('session-1.jsonl');
    makeFile('session-1.deleted.jsonl');
    const discovery = require(DISCOVERY_PATH);
    discovery.PI_SESSION_BASES.length = 0;
    discovery.PI_SESSION_BASES.push(tmpBase);
    const files = discovery.findPiJsonlFiles();
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('session-1.jsonl');
    expect(names).not.toContain('session-1.deleted.jsonl');
  });

  it('enforces the configured maximum file size from MAX_FILE_BYTES', () => {
    makeFile('small.jsonl', 64);
    makeFile('big.jsonl', config.MAX_FILE_BYTES + 1);
    const discovery = require(DISCOVERY_PATH);
    discovery.PI_SESSION_BASES.length = 0;
    discovery.PI_SESSION_BASES.push(tmpBase);
    const files = discovery.findPiJsonlFiles();
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('small.jsonl');
    expect(names).not.toContain('big.jsonl');
  });

  it('deduplicates symlinked aliases by realpath and supports symlink jsonl', () => {
    const realDir = path.join(tmpBase, 'realdir');
    fs.mkdirSync(realDir, { recursive: true });
    const realPath = path.join(realDir, 'dup.jsonl');
    fs.writeFileSync(realPath, 'x'.repeat(64));

    const linkDir = path.join(tmpBase, 'linkdir');
    fs.mkdirSync(linkDir, { recursive: true });
    const linkPath = path.join(linkDir, 'dup-linked.jsonl');
    fs.symlinkSync(realPath, linkPath);

    const discovery = require(DISCOVERY_PATH);
    discovery.PI_SESSION_BASES.length = 0;
    discovery.PI_SESSION_BASES.push(realDir, linkDir);
    const files = discovery.findPiJsonlFiles();
    // Both aliases are scanned (symlink jsonl supported), but collapse to one.
    expect(files.length).toBe(1);
    const reals = new Set(files.map(f => fs.realpathSync(f.path)));
    expect(reals.size).toBe(1);
  });

  it('reads home-directory session bases from the environment at init', () => {
    const homeDir = path.join(os.tmpdir(), `home-${Date.now()}`);
    makeFileIn(path.join(homeDir, '.pi', 'sessions', 'home-session.jsonl'));

    const origExtra = process.env.EXTRA_SESSION_DIRS;
    const homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(homeDir);
    try {
      delete process.env.EXTRA_SESSION_DIRS;
      jest.resetModules();
      const discovery = require(DISCOVERY_PATH);
      const homeBase = path.join(homeDir, '.pi', 'sessions');
      expect(discovery.PI_SESSION_BASES).toContain(homeBase);
      const files = discovery.findPiJsonlFiles();
      const names = files.map(f => path.basename(f.path));
      expect(names).toContain('home-session.jsonl');
    } finally {
      homedirSpy.mockRestore();
      if (origExtra === undefined) delete process.env.EXTRA_SESSION_DIRS;
      else process.env.EXTRA_SESSION_DIRS = origExtra;
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('reads EXTRA_SESSION_DIRS from the environment at init', () => {
    const extraDir = path.join(tmpBase, `extra-${Date.now()}`);
    makeFileIn(path.join(extraDir, 'extra-session.jsonl'));

    const origExtra = process.env.EXTRA_SESSION_DIRS;
    process.env.EXTRA_SESSION_DIRS = extraDir;
    try {
      jest.resetModules();
      const discovery = require(DISCOVERY_PATH);
      expect(discovery.PI_SESSION_BASES).toContain(extraDir);
      const files = discovery.findPiJsonlFiles();
      const names = files.map(f => path.basename(f.path));
      expect(names).toContain('extra-session.jsonl');
    } finally {
      if (origExtra === undefined) delete process.env.EXTRA_SESSION_DIRS;
      else process.env.EXTRA_SESSION_DIRS = origExtra;
      fs.rmSync(extraDir, { recursive: true, force: true });
    }
  });

  it('uses os.homedir() for Claude projects root when CLAUDE_PROJECTS_DIR is unset', () => {
    const fakeHome = path.join(os.tmpdir(), `claude-home-${Date.now()}`);
    const orig = process.env.CLAUDE_PROJECTS_DIR;
    const homedirSpy = jest.spyOn(os, 'homedir').mockReturnValue(fakeHome);
    try {
      delete process.env.CLAUDE_PROJECTS_DIR;
      jest.resetModules();
      const discovery = require(DISCOVERY_PATH);
      expect(discovery.CLAUDE_PROJECTS_ROOT).toBe(path.join(fakeHome, '.claude/projects'));
    } finally {
      homedirSpy.mockRestore();
      if (orig === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
      else process.env.CLAUDE_PROJECTS_DIR = orig;
    }
  });
});
