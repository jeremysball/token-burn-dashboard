import { describe, expect, test } from 'bun:test';
import { summarizeLcov } from '../../scripts/check-coverage.mjs';

const inScopeFiles = [
  'dashboard/js/dashboard.js',
  'lib/cache.js'
];

describe('summarizeLcov', () => {
  test('calculates global coverage percentages across the legacy source scope', () => {
    const summary = summarizeLcov(`SF:dashboard/js/dashboard.js
FNF:2
FNH:1
BRF:4
BRH:3
LF:10
LH:8
end_of_record
SF:lib/cache.js
FNF:3
FNH:3
BRF:2
BRH:1
LF:5
LH:5
end_of_record
`, inScopeFiles);

    expect(summary).toEqual({
      branches: 66.67,
      functions: 80,
      lines: 86.67,
      statements: 86.67
    });
  });

  test('rejects coverage below the legacy 10 percent threshold', () => {
    expect(() => summarizeLcov(`SF:dashboard/js/dashboard.js
FNF:10
FNH:0
BRF:10
BRH:0
LF:10
LH:0
end_of_record
`, inScopeFiles)).toThrow(
      'Coverage thresholds not met: branches 0.00% < 10%, functions 0.00% < 10%, lines 0.00% < 10%, statements 0.00% < 10%; missing in-scope files: lib/cache.js'
    );
  });

  test('does not flag worker-thread entry points as missing', () => {
    const summary = summarizeLcov(`SF:dashboard/js/dashboard.js
FNF:2
FNH:1
BRF:4
BRH:3
LF:10
LH:8
end_of_record
SF:lib/cache.js
FNF:3
FNH:3
BRF:2
BRH:1
LF:5
LH:5
end_of_record
`, ['dashboard/js/dashboard.js', 'lib/cache.js', 'lib/token-burn-worker.js', 'lib/git-blame-worker.js']);

    expect(summary).toEqual({
      branches: 66.67,
      functions: 80,
      lines: 86.67,
      statements: 86.67
    });
  });
});
