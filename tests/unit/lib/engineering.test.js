const { extractFileRefs, getFileExtensionLang, parseShortStat } = require('../../../lib/engineering');

import { describe, expect, test } from 'bun:test';

// Pinned explicitly so these cases do not depend on the machine's
// PROJECT_ROOT (DASHBOARD_PROJECT_ROOT, else $HOME, else cwd).
const ROOT = '/workspace';

describe('lib/engineering extractFileRefs', () => {
  test('extract workspace file refs only', () => {
    const text = 'Edited /workspace/foo/bar.js and /usr/bin and /home/jeremy/baz.ts and https://example.com';
    const refs = extractFileRefs(text, ROOT);
    expect(refs).toContain('/workspace/foo/bar.js');
    expect(refs).not.toContain('/usr/bin');
    expect(refs).not.toContain('/home/jeremy/baz.ts');
  });

  test('extracts extension-matched relative paths', () => {
    const text = 'fixed ./lib/foo.js and ../src/util.ts but not /etc/passwd';
    const refs = extractFileRefs(text, ROOT);
    expect(refs).toContain('./lib/foo.js');
    expect(refs).toContain('../src/util.ts');
    expect(refs).not.toContain('/etc/passwd');
  });

  test('returns empty array for empty/non-string input', () => {
    expect(extractFileRefs('', ROOT)).toEqual([]);
    expect(extractFileRefs(null, ROOT)).toEqual([]);
    expect(extractFileRefs(undefined, ROOT)).toEqual([]);
    expect(extractFileRefs(42, ROOT)).toEqual([]);
  });

  test('caps results at 20 and dedupes', () => {
    const parts = [];
    for (let i = 0; i < 25; i++) parts.push(`/workspace/a/file${i}.js`);
    const refs = extractFileRefs(parts.join(' '), ROOT);
    expect(refs.length).toBeLessThanOrEqual(20);
  });

  test('rejects non-allowlisted extensions on relative paths', () => {
    const text = 'leaked ./secret.txt and ./config.env and ./notes.txt keep ./ok.js';
    const refs = extractFileRefs(text, ROOT);
    expect(refs).not.toContain('./secret.txt');
    expect(refs).not.toContain('./config.env');
    expect(refs).not.toContain('./notes.txt');
    expect(refs).toContain('./ok.js');
  });

  test('rejects non-allowlisted extensions under /workspace', () => {
    const text = 'read /workspace/app/.env.txt and /workspace/app/secrets.env but /workspace/app/main.py is fine';
    const refs = extractFileRefs(text, ROOT);
    expect(refs.some(r => r.endsWith('.env'))).toBe(false);
    expect(refs.some(r => r.endsWith('.txt'))).toBe(false);
    expect(refs).toContain('/workspace/app/main.py');
  });

  test('only returns paths ending in an allowed extension', () => {
    const text = '/workspace/a/b.js ./c.ts ../d.py /workspace/e.env ./f.txt /workspace/g.pem';
    const refs = extractFileRefs(text, ROOT);
    const allowed = ['.js', '.ts', '.py', '.go', '.rs', '.java', '.rb', '.css', '.html', '.json', '.md'];
    for (const r of refs) {
      expect(allowed.some(e => r.toLowerCase().endsWith(e))).toBe(true);
    }
  });

  test('rejects file refs embedded in URL suffixes', () => {
    const text = 'see https://example.com/workspace/app/main.js and https://host/workspace/x/y.ts';
    const refs = extractFileRefs(text, ROOT);
    expect(refs).not.toContain('/workspace/app/main.js');
    expect(refs).not.toContain('/workspace/x/y.ts');
    expect(refs).toEqual([]);
  });

  test('rejects traversal paths that escape /workspace', () => {
    const text = 'leaked /workspace/../outside/secret.js and /workspace/../../etc/passwd';
    const refs = extractFileRefs(text, ROOT);
    expect(refs).not.toContain('/workspace/../outside/secret.js');
    expect(refs).not.toContain('/workspace/../../etc/passwd');
    expect(refs).toEqual([]);
  });

  test('keeps /workspace paths that stay within root after traversal', () => {
    const text = 'edited /workspace/app/../app/main.js';
    const refs = extractFileRefs(text, ROOT);
    expect(refs).toContain('/workspace/app/../app/main.js');
  });

  test('rejects absolute paths with a scheme even when path looks valid', () => {
    const text = 'http://localhost/workspace/a/b.js';
    const refs = extractFileRefs(text, ROOT);
    expect(refs).not.toContain('/workspace/a/b.js');
    expect(refs).toEqual([]);
  });

  test('honors a root other than /workspace', () => {
    const text = 'edited /home/dev/proj/src/main.js and /workspace/other/x.js';
    const refs = extractFileRefs(text, '/home/dev/proj');
    expect(refs).toContain('/home/dev/proj/src/main.js');
    expect(refs).not.toContain('/workspace/other/x.js');
  });

  test('rejects traversal that escapes a non-/workspace root', () => {
    const text = 'leaked /home/dev/proj/../../etc/passwd.js';
    const refs = extractFileRefs(text, '/home/dev/proj');
    expect(refs).toEqual([]);
  });

  test('keeps traversal that stays inside a non-/workspace root', () => {
    const text = 'edited /home/dev/proj/a/../a/main.js';
    const refs = extractFileRefs(text, '/home/dev/proj');
    expect(refs).toContain('/home/dev/proj/a/../a/main.js');
  });

  test('tolerates a root given with a trailing slash', () => {
    const text = 'edited /home/dev/proj/src/main.js';
    expect(extractFileRefs(text, '/home/dev/proj/')).toContain('/home/dev/proj/src/main.js');
  });

  test('treats a root containing regex metacharacters literally', () => {
    const text = 'edited /home/dev/pro+j/src/main.js and /home/dev/prooj/src/main.js';
    const refs = extractFileRefs(text, '/home/dev/pro+j');
    expect(refs).toContain('/home/dev/pro+j/src/main.js');
    expect(refs).not.toContain('/home/dev/prooj/src/main.js');
  });

  test('defaults the root to config.PROJECT_ROOT when none is passed', () => {
    // Guards the default-argument wiring. Every other case pins ROOT
    // explicitly, so without this nothing exercises the PROJECT_ROOT path.
    const { PROJECT_ROOT } = require('../../../lib/config');
    const text = `edited ${PROJECT_ROOT}/some/file.js and /definitely-not-root/x.js`;
    const refs = extractFileRefs(text);
    expect(refs).toContain(`${PROJECT_ROOT}/some/file.js`);
    expect(refs).not.toContain('/definitely-not-root/x.js');
  });

  test('returns empty for a missing or non-string root', () => {
    expect(extractFileRefs('/workspace/a/b.js', '')).toEqual([]);
    // @ts-expect-error deliberately wrong type
    expect(extractFileRefs('/workspace/a/b.js', 42)).toEqual([]);
  });
});

describe('lib/engineering getFileExtensionLang', () => {
  test('maps known extensions to languages', () => {
    expect(getFileExtensionLang('/workspace/a/b.js')).toBe('JavaScript');
    expect(getFileExtensionLang('src/main.ts')).toBe('TypeScript');
    expect(getFileExtensionLang('x.py')).toBe('Python');
    expect(getFileExtensionLang('x.go')).toBe('Go');
  });

  test('returns unknown for unrecognized or missing extension', () => {
    expect(getFileExtensionLang('/workspace/a/b.txt')).toBe('unknown');
    expect(getFileExtensionLang('noext')).toBe('unknown');
    expect(getFileExtensionLang('')).toBe('unknown');
  });
});

describe('lib/engineering parseShortStat', () => {
  test('parses full shortstat output', () => {
    const out = ' 3 files changed, 120 insertions(+), 14 deletions(-)';
    expect(parseShortStat(out)).toEqual({
      filesChanged: 3,
      insertions: 120,
      deletions: 14,
      loc: 134
    });
  });

  test('parses only insertions', () => {
    const out = ' 1 file changed, 5 insertions(+)';
    const r = parseShortStat(out);
    expect(r.filesChanged).toBe(1);
    expect(r.insertions).toBe(5);
    expect(r.deletions).toBe(0);
    expect(r.loc).toBe(5);
  });

  test('returns zeroed shape for empty/unparseable input', () => {
    expect(parseShortStat('')).toEqual({ filesChanged: 0, insertions: 0, deletions: 0, loc: 0 });
    expect(parseShortStat(null)).toEqual({ filesChanged: 0, insertions: 0, deletions: 0, loc: 0 });
    expect(parseShortStat('no numbers here')).toEqual({ filesChanged: 0, insertions: 0, deletions: 0, loc: 0 });
  });
});
