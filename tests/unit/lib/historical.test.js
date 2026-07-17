/**
 * Tests for historical-data normalization and bucketing
 */

const { normalizeTimeMs } = require('../../../lib/historical-data');

describe('normalizeTimeMs', () => {
  it('returns null for non-numeric input', () => {
    expect(normalizeTimeMs('1700000000')).toBe(null);
    expect(normalizeTimeMs(NaN)).toBe(null);
    expect(normalizeTimeMs(undefined)).toBe(null);
  });

  it('leaves millisecond timestamps untouched when >= 1e10', () => {
    expect(normalizeTimeMs(999999999999)).toBe(999999999999);
    expect(normalizeTimeMs(1700000000000)).toBe(1700000000000);
  });

  it('converts second timestamps (1e9..1e10) to milliseconds', () => {
    expect(normalizeTimeMs(1700000000)).toBe(1700000000000);
  });

  it('leaves values below 1e9 untouched', () => {
    expect(normalizeTimeMs(123456)).toBe(123456);
  });

  it('handles the threshold boundary correctly', () => {
    // exactly 1e9 is not in the (1e9, 1e10) window -> untouched
    expect(normalizeTimeMs(1e9)).toBe(1e9);
    // exactly 1e10 is not in the (1e9, 1e10) window -> untouched
    expect(normalizeTimeMs(1e10)).toBe(1e10);
  });
});
