/**
 * Tests for session-parser usage parsing including reasoning tokens
 */

const { parsePiUsage, parseClaudeUsage } = require('../../../lib/session-parser');

describe('parsePiUsage', () => {
  it('preserves explicit totalTokens of 0 (not truthy fallback)', () => {
    const u = parsePiUsage({ input: 1, output: 1, reasoning: 5, totalTokens: 0 });
    expect(u.total).toBe(0);
    expect(u.reasoning).toBe(5);
  });

  it('computes total from components when totalTokens absent', () => {
    const u = parsePiUsage({ input: 1, output: 1, reasoning: 5 });
    expect(u.total).toBe(7);
    expect(u.reasoning).toBe(5);
  });

  it('preserves explicit totalTokens when present', () => {
    const u = parsePiUsage({ input: 1, output: 1, reasoning: 5, totalTokens: 100 });
    expect(u.total).toBe(100);
    expect(u.reasoning).toBe(5);
  });

  it('reads reasoning_tokens alternate key', () => {
    const u = parsePiUsage({ input: 2, output: 2, reasoning_tokens: 9 });
    expect(u.reasoning).toBe(9);
    expect(u.total).toBe(13);
  });

  it('handles zero values without NaN', () => {
    const u = parsePiUsage({});
    expect(u.total).toBe(0);
    expect(u.reasoning).toBe(0);
    expect(u.input).toBe(0);
  });
});

describe('parseClaudeUsage', () => {
  it('includes reasoning in computed total', () => {
    const u = parseClaudeUsage({ input_tokens: 1, output_tokens: 1, reasoning_tokens: 5 });
    expect(u.total).toBe(7);
    expect(u.reasoning).toBe(5);
  });

  it('reads reasoning alternate key', () => {
    const u = parseClaudeUsage({ input_tokens: 2, output_tokens: 2, reasoning: 9 });
    expect(u.reasoning).toBe(9);
  });

  it('sums nested cache_creation ephemeral fields', () => {
    const u = parseClaudeUsage({
      input_tokens: 10,
      output_tokens: 10,
      cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 7 }
    });
    expect(u.cacheWrite).toBe(10);
    expect(u.total).toBe(30);
  });

  it('preserves explicit totalTokens when provided', () => {
    const u = parseClaudeUsage({ input_tokens: 1, output_tokens: 1, reasoning_tokens: 5, totalTokens: 50 });
    expect(u.total).toBe(50);
  });

  it('preserves explicit totalTokens of 0 (not truthy fallback)', () => {
    const u = parseClaudeUsage({ input_tokens: 1, output_tokens: 1, reasoning_tokens: 5, totalTokens: 0 });
    expect(u.total).toBe(0);
    expect(u.reasoning).toBe(5);
  });

  it('handles zero values without NaN', () => {
    const u = parseClaudeUsage({});
    expect(u.total).toBe(0);
    expect(u.reasoning).toBe(0);
  });
});
