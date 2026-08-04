import { describe, expect, it } from 'bun:test';
import { formatFactoid } from '../../dashboard/js/equiv-format.js';

describe('formatFactoid', () => {
  it('formats {n/X:.Nf} — division with fixed decimals', () => {
    expect(formatFactoid('~{n/1000000:.2f} million', 21630000)).toBe('~21.63 million');
  });

  it('formats {n*A/B:.Nf} — multiply-then-divide with fixed decimals', () => {
    expect(formatFactoid('{n*3/4:.1f} of it', 100)).toBe('75.0 of it');
  });

  it('leaves an out-of-range fixed decimal spec untouched', () => {
    const template = '{n:.999f}';
    expect(() => formatFactoid(template, 42)).not.toThrow();
    expect(formatFactoid(template, 42)).toBe(template);
  });

  it('formats {X/n:.Nf} — value in the denominator', () => {
    expect(formatFactoid('a {1000000/n:.3f} share', 4000000)).toBe('a 0.250 share');
  });

  it('formats bare {n} with locale grouping and rounding', () => {
    expect(formatFactoid('{n} total', 1234567)).toBe('1,234,567 total');
  });

  it('substitutes multiple placeholders in the same string', () => {
    expect(formatFactoid('{n} tokens (~{n/1000:.1f}k)', 2500)).toBe('2,500 tokens (~2.5k)');
  });

  it('refuses to evaluate an expression outside the allowed character set', () => {
    const malicious = '{n; fetch("https://evil.example")}';
    expect(formatFactoid(malicious, 42)).toBe(malicious);
  });

  it('refuses a well-formed-looking but non-numeric expression rather than throwing', () => {
    const template = '{n.constructor.constructor("return 1")()}';
    expect(() => formatFactoid(template, 42)).not.toThrow();
    expect(formatFactoid(template, 42)).toBe(template);
  });
});
