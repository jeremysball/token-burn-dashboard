const { extractFileRefs, getFileExtensionLang, parseShortStat } = require('../../../lib/engineering');

describe('lib/engineering extractFileRefs', () => {
  test('extract workspace file refs only', () => {
    const text = 'Edited /workspace/foo/bar.js and /usr/bin and /home/jeremy/baz.ts and https://example.com';
    const refs = extractFileRefs(text);
    expect(refs).toContain('/workspace/foo/bar.js');
    expect(refs).not.toContain('/usr/bin');
    expect(refs).not.toContain('/home/jeremy/baz.ts');
  });

  test('extracts extension-matched relative paths', () => {
    const text = 'fixed ./lib/foo.js and ../src/util.ts but not /etc/passwd';
    const refs = extractFileRefs(text);
    expect(refs).toContain('./lib/foo.js');
    expect(refs).toContain('../src/util.ts');
    expect(refs).not.toContain('/etc/passwd');
  });

  test('returns empty array for empty/non-string input', () => {
    expect(extractFileRefs('')).toEqual([]);
    expect(extractFileRefs(null)).toEqual([]);
    expect(extractFileRefs(undefined)).toEqual([]);
    expect(extractFileRefs(42)).toEqual([]);
  });

  test('caps results at 20 and dedupes', () => {
    const parts = [];
    for (let i = 0; i < 25; i++) parts.push(`/workspace/a/file${i}.js`);
    const refs = extractFileRefs(parts.join(' '));
    expect(refs.length).toBeLessThanOrEqual(20);
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
