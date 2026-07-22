/**
 * Security hardening tests - Task 0
 * Covers hash validation and path traversal guards
 */

const path = require('path');

describe('Security: isValidCommitHash', () => {
  let gitBlame;
  beforeAll(() => {
    jest.resetModules();
    gitBlame = require('../../../lib/git-blame');
  });

  test('reject malicious hash injection', () => {
    expect(gitBlame.isValidCommitHash).toBeDefined();
    expect(gitBlame.isValidCommitHash('HEAD; rm -rf /')).toBe(false);
    expect(gitBlame.isValidCommitHash('HEAD && cat /etc/passwd')).toBe(false);
    expect(gitBlame.isValidCommitHash('$(whoami)')).toBe(false);
    expect(gitBlame.isValidCommitHash('`rm -rf /`')).toBe(false);
    expect(gitBlame.isValidCommitHash('../../etc/passwd')).toBe(false);
  });

  test('accept valid commit hashes', () => {
    expect(gitBlame.isValidCommitHash('abc1234')).toBe(true);
    expect(gitBlame.isValidCommitHash('ABC1234')).toBe(true);
    expect(gitBlame.isValidCommitHash('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5')).toBe(true);
    expect(gitBlame.isValidCommitHash('1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  test('reject invalid formats', () => {
    expect(gitBlame.isValidCommitHash('')).toBe(false);
    expect(gitBlame.isValidCommitHash('abc')).toBe(false);
    expect(gitBlame.isValidCommitHash('xyz1234')).toBe(false); // x,y,z not hex
    expect(gitBlame.isValidCommitHash('abc1234 ')).toBe(false);
    expect(gitBlame.isValidCommitHash(' abc1234')).toBe(false);
    expect(gitBlame.isValidCommitHash('g123456')).toBe(false);
    expect(gitBlame.isValidCommitHash(null)).toBe(false);
    expect(gitBlame.isValidCommitHash(undefined)).toBe(false);
  });

  test('getCommitFiles throws on invalid hash', () => {
    expect(() => gitBlame.getCommitFiles('HEAD; rm -rf /')).toThrow('Invalid commit hash');
    expect(() => gitBlame.getCommitFiles('')).toThrow('Invalid commit hash');
    expect(() => gitBlame.getCommitFiles('../../etc')).toThrow('Invalid commit hash');
  });

  test('getCommitFiles uses execFileSync not shell execSync', () => {
    // Ensure implementation does not contain dangerous shell string interpolation
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '../../../lib/git-blame.js'), 'utf-8');
    // Should use execFileSync
    expect(src).toMatch(/execFileSync/);
    // Should NOT have execSync with template literal interpolating commitHash or since
    // The file should not have execSync left (or at least not for git log/show)
    expect(src).not.toMatch(/execSync\s*\(\s*`git show/);
    expect(src).not.toMatch(/execSync\s*\(\s*`git log/);
  });
});

describe('Security: safeStaticPath traversal guard', () => {
  let staticRoute;
  beforeAll(() => {
    jest.resetModules();
    staticRoute = require('../../../lib/routes/static');
  });

  test('safeStaticPath exists and blocks traversal', () => {
    expect(staticRoute.safeStaticPath).toBeDefined();
    const root = '/workspace/dashboard';
    const bad = path.resolve('/workspace/dashboard/../etc/passwd');
    expect(bad.startsWith(root)).toBe(false);

    // Test safeStaticPath function directly
    const result = staticRoute.safeStaticPath(root, '../../../etc/passwd');
    expect(result).toBeNull();

    const result2 = staticRoute.safeStaticPath(root, '/dashboard/../../etc/passwd');
    expect(result2).toBeNull();

    const result3 = staticRoute.safeStaticPath(root, '%2e%2e%2f%2e%2e%2fetc%2fpasswd');
    expect(result3).toBeNull();
  });

  test('dashboard routes are resolved against dashboard/ directory, not repo root', () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const res = { writeHead: jest.fn(), end: jest.fn() };
    const url = new URL('/dashboard/%2e%2e%2fpackage.json', 'http://localhost');
    const result = staticRoute.handleStaticRoutes(url, res, null, repoRoot);
    expect(result).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    expect(res.end).toHaveBeenCalledWith('Forbidden');
  });

  test('safeStaticPath allows valid paths inside root', () => {
    const root = '/workspace/dashboard';
    const good = staticRoute.safeStaticPath(root, 'index.html');
    expect(good).not.toBeNull();
    expect(good.startsWith(path.resolve(root))).toBe(true);

    const good2 = staticRoute.safeStaticPath(root, '/dashboard/app.js');
    expect(good2).not.toBeNull();
    expect(good2.startsWith(path.resolve(root))).toBe(true);
  });

  test('handleStaticRoutes has traversal guard', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '../../../lib/routes/static.js'), 'utf-8');
    expect(src).toMatch(/startsWith/);
    expect(src).toMatch(/path\.resolve/);
    expect(src).toMatch(/403|Forbidden/);
  });
});

describe('Security: opencode-discovery spawnSync', () => {
  test('queryJsonSafe uses spawnSync not execSync', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '../../../lib/opencode-discovery.js'), 'utf-8');
    expect(src).toMatch(/spawnSync/);
    expect(src).not.toMatch(/execSync.*sqlite3/);
    // Should pass SQL via input option, not tmp file + shell redirection
    expect(src).toMatch(/input:\s*sql/);
  });

  test('queryJsonSafe exists and is function', () => {
    const { queryJsonSafe } = require('../../../lib/opencode-discovery');
    expect(typeof queryJsonSafe).toBe('function');
  });
});

const { resolveCorsOrigin, isAuthorized, isPathWithinRoot } = require('../../../lib/security');

describe('resolveCorsOrigin', () => {
  it('returns null when no allowlist is configured', () => {
    expect(resolveCorsOrigin('https://example.com', [])).toBeNull();
  });

  it('returns null when the request has no Origin header', () => {
    expect(resolveCorsOrigin(undefined, ['https://example.com'])).toBeNull();
  });

  it('returns the origin when it is in the allowlist', () => {
    expect(resolveCorsOrigin('https://example.com', ['https://example.com'])).toBe('https://example.com');
  });

  it('returns null when the origin is not in the allowlist', () => {
    expect(resolveCorsOrigin('https://evil.com', ['https://example.com'])).toBeNull();
  });
});

describe('isAuthorized', () => {
  it('allows any request when no auth token is configured', () => {
    expect(isAuthorized({ headers: {} }, null)).toBe(true);
  });

  it('rejects a request with no Authorization header when a token is configured', () => {
    expect(isAuthorized({ headers: {} }, 'secret')).toBe(false);
  });

  it('rejects a request with a mismatched bearer token', () => {
    expect(isAuthorized({ headers: { authorization: 'Bearer wrong' } }, 'secret')).toBe(false);
  });

  it('accepts a request with the matching bearer token', () => {
    expect(isAuthorized({ headers: { authorization: 'Bearer secret' } }, 'secret')).toBe(true);
  });

  it('accepts a case-insensitive Bearer prefix', () => {
    expect(isAuthorized({ headers: { authorization: 'bearer secret' } }, 'secret')).toBe(true);
  });
});

describe('isPathWithinRoot', () => {
  const { isPathWithinRoot } = require('../../../lib/security');

  it('accepts the root itself', () => {
    expect(isPathWithinRoot('/home/user/projects', '/home/user/projects')).toBe(true);
  });

  it('accepts a subdirectory of the root', () => {
    expect(isPathWithinRoot('/home/user/projects/foo', '/home/user/projects')).toBe(true);
  });

  it('accepts a relative subdirectory resolved against the root', () => {
    expect(isPathWithinRoot('foo/bar', '/home/user/projects')).toBe(true);
  });

  it('rejects an absolute path outside the root', () => {
    expect(isPathWithinRoot('/etc', '/home/user/projects')).toBe(false);
  });

  it('rejects a relative traversal that escapes the root', () => {
    expect(isPathWithinRoot('../../etc', '/home/user/projects')).toBe(false);
  });

  it('rejects a sibling directory that merely shares a name prefix', () => {
    expect(isPathWithinRoot('/home/user/projects-evil', '/home/user/projects')).toBe(false);
  });
});
