const path = require('path');
const { getCommitLOC, generateGitBlameReport, isValidCommitHash } = require('../../../lib/git-blame');

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
