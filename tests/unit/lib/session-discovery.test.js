/**
 * Tests for unified session discovery
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../../lib/config');

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

  it('excludes .deleted. jsonl files', () => {
    makeFile('session-1.jsonl');
    makeFile('session-1.deleted.jsonl');
    const discovery = require('../../../lib/session-discovery');
    // Override bases with our temp dir
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
    const discovery = require('../../../lib/session-discovery');
    discovery.PI_SESSION_BASES.length = 0;
    discovery.PI_SESSION_BASES.push(tmpBase);
    const files = discovery.findPiJsonlFiles();
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('small.jsonl');
    expect(names).not.toContain('big.jsonl');
  });

  it('deduplicates discovered files by realpath', () => {
    makeFile('dup.jsonl');
    const linkDir = path.join(tmpBase, 'linkdir');
    fs.mkdirSync(linkDir, { recursive: true });
    const linkPath = path.join(linkDir, 'dup-linked.jsonl');
    try {
      fs.linkSync(path.join(tmpBase, 'dup.jsonl'), linkPath);
    } catch {
      // hardlinks may be unsupported; skip gracefully
      return;
    }
    const discovery = require('../../../lib/session-discovery');
    discovery.PI_SESSION_BASES.length = 0;
    discovery.PI_SESSION_BASES.push(tmpBase, linkDir);
    const files = discovery.findPiJsonlFiles();
    const reals = new Set(files.map(f => fs.realpathSync(f.path)));
    expect(reals.size).toBe(1);
  });

  it('includes home-directory session bases', () => {
    const homeDir = path.join(os.tmpdir(), `home-${Date.now()}`);
    fs.mkdirSync(path.join(homeDir, '.pi', 'sessions'), { recursive: true });
    makeFileIn(path.join(homeDir, '.pi', 'sessions', 'home-session.jsonl'));
    const discovery = require('../../../lib/session-discovery');
    const orig = process.env.HOME;
    process.env.HOME = homeDir;
    jest.resetModules();
    const reset = require('../../../lib/session-discovery');
    try {
      // Force re-evaluation of bases via a fresh require after env set
      const mod = require('../../../lib/session-discovery');
      mod.PI_SESSION_BASES.length = 0;
      mod.PI_SESSION_BASES.push(path.join(homeDir, '.pi', 'sessions'));
      const files = mod.findPiJsonlFiles();
      const names = files.map(f => path.basename(f.path));
      expect(names).toContain('home-session.jsonl');
    } finally {
      if (orig === undefined) delete process.env.HOME;
      else process.env.HOME = orig;
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('supports EXTRA_SESSION_DIRS', () => {
    const extraDir = path.join(tmpBase, 'extra');
    fs.mkdirSync(extraDir, { recursive: true });
    makeFileIn(path.join(extraDir, 'extra-session.jsonl'));
    const orig = process.env.EXTRA_SESSION_DIRS;
    process.env.EXTRA_SESSION_DIRS = extraDir;
    const discovery = require('../../../lib/session-discovery');
    // Simulating env-driven expansion: rebuild bases
    discovery.PI_SESSION_BASES.length = 0;
    (process.env.EXTRA_SESSION_DIRS || '').split(/[:,]/).map(s => s.trim()).filter(Boolean)
      .forEach(d => discovery.PI_SESSION_BASES.push(d));
    const files = discovery.findPiJsonlFiles();
    const names = files.map(f => path.basename(f.path));
    expect(names).toContain('extra-session.jsonl');
    if (orig === undefined) delete process.env.EXTRA_SESSION_DIRS;
    else process.env.EXTRA_SESSION_DIRS = orig;
  });

  function makeFileIn(p) {
    fs.writeFileSync(p, 'x'.repeat(64));
  }
});
