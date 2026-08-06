const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { getCommitLOC, generateGitBlameReport, isValidCommitHash, getSessionTimeWindow } = require('../../../lib/git-blame');

import { afterEach, describe, expect, test } from 'bun:test';

describe('lib/git-blame getCommitLOC', () => {
  const cwd = path.resolve(__dirname, '../../'); // repo root, a real git repo

  test('returns zeroed shape for invalid hash', () => {
    const r = getCommitLOC('not-a-hash');
    expect(r).toEqual({ filesChanged: 0, insertions: 0, deletions: 0, loc: 0 });
  });

  test('returns zeroed shape for non-existent but valid-format hash', () => {
    const r = getCommitLOC('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(r).toEqual({ filesChanged: 0, insertions: 0, deletions: 0, loc: 0 });
  });

  test('parses shortstat for a real commit hash', () => {
    const { execSync } = require('child_process');
    const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    const r = getCommitLOC(head, cwd);
    expect(r.filesChanged).toBeGreaterThanOrEqual(0);
    expect(typeof r.loc).toBe('number');
    expect(r.loc).toBe(r.insertions + r.deletions);
  });
});

describe('lib/git-blame getCommitLOC integration shape', () => {
  const cwd = path.resolve(__dirname, '../../');

  test('returns the exact shortstat shape consumed by analytics KPIs', () => {
    const { execSync } = require('child_process');
    const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    const loc = getCommitLOC(head, cwd);
    // Analytics reads c.loc?.loc, so the nested .loc field must be numeric.
    expect(typeof loc.filesChanged).toBe('number');
    expect(typeof loc.insertions).toBe('number');
    expect(typeof loc.deletions).toBe('number');
    expect(typeof loc.loc).toBe('number');
    expect(loc.loc).toBe(loc.insertions + loc.deletions);
  });

  test('isValidCommitHash rejects shell metacharacters', () => {
    expect(isValidCommitHash('abc; rm -rf /')).toBe(false);
    expect(isValidCommitHash('$(whoami)')).toBe(false);
    expect(isValidCommitHash('a'.repeat(40))).toBe(true);
  });
});

describe('lib/git-blame getSessionTimeWindow', () => {
  const tmpFiles = [];
  afterEach(() => {
    while (tmpFiles.length) {
      fs.rmSync(tmpFiles.pop(), { force: true });
    }
  });

  /** @param {string} contents */
  const writeTmpSession = (contents) => {
    const file = path.join(os.tmpdir(), `git-blame-time-window-${crypto.randomUUID()}.jsonl`);
    fs.writeFileSync(file, contents, 'utf-8');
    tmpFiles.push(file);
    return file;
  };

  test('derives startTime/endTime/midpoint from message timestamps', () => {
    const file = writeTmpSession([
      JSON.stringify({ type: 'message', message: { timestamp: 1000, usage: { input: 10, output: 5 } } }),
      JSON.stringify({ type: 'message', message: { timestamp: 3000, usage: { input: 10, output: 5 } } })
    ].join('\n') + '\n');

    const window = getSessionTimeWindow(file);
    expect(window.startTime).toBe(1000);
    expect(window.endTime).toBe(3000);
    expect(window.midpoint).toBe(2000);
  });

  test('falls back to file mtime when no usage-carrying lines parse', () => {
    const file = writeTmpSession('not valid jsonl\n');
    const mtime = fs.statSync(file).mtime.getTime();

    const window = getSessionTimeWindow(file);
    expect(window.startTime).toBe(mtime);
    expect(window.endTime).toBe(mtime);
    expect(window.midpoint).toBe(mtime);
  });
});
