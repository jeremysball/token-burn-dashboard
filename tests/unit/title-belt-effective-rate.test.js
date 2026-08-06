// tests/unit/title-belt-effective-rate.test.js
// Split out of title-belt.test.js to keep that file under the 300-line
// max-lines limit; the helper is exported and consumed by both
// title-belt.js's own scoreTitleBelt and the league-table.js surface.
import { describe, expect, it } from 'bun:test';
import { effectiveRatePerMillion } from '../../dashboard/js/title-belt.js';

describe('effectiveRatePerMillion (exported shared helper)', () => {
  // Regression for the league-table inline-formula divergence: league-table.js
  // now imports this helper rather than re-implementing the math, so the two
  // surfaces cannot drift on a missing or non-finite token dimension.
  it('returns the canonical $/M for a fully-priced model', () => {
    const stats = { total: 1_000_000, input: 500_000, output: 0, cache_read: 0, cache_write: 0, reasoning: 500_000 };
    const pricing = { input: 2, output: 0, reasoning: 20, cacheRead: 0, cacheWrite: 0 };
    expect(effectiveRatePerMillion(stats, pricing)).toBe(11);
  });

  it('returns null for stats with a missing dimension (rejects malformed inputs)', () => {
    const stats = { total: 1_000_000, input: 500_000, output: 0, cache_read: 0, cache_write: 0 }; // no reasoning
    const pricing = { input: 2, output: 0, reasoning: 20, cacheRead: 0, cacheWrite: 0 };
    expect(effectiveRatePerMillion(stats, pricing)).toBeNull();
  });

  it('returns null for stats with a NaN dimension (does not fabricate a number)', () => {
    const stats = { total: 1_000_000, input: 500_000, output: 0, cache_read: 0, cache_write: 0, reasoning: NaN };
    const pricing = { input: 2, output: 0, reasoning: 20, cacheRead: 0, cacheWrite: 0 };
    expect(effectiveRatePerMillion(stats, pricing)).toBeNull();
  });
});
