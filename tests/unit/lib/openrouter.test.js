/**
 * Tests for OpenRouter first-slash parsing consistency
 */

const { stripProviderPrefix, buildOpenRouterPricingRecord } = require('../../../lib/openrouter');

describe('OpenRouter first-slash parsing', () => {
  it('strips only the first provider segment, keeps the rest', () => {
    expect(stripProviderPrefix('anthropic/claude-3-5-sonnet/20240620')).toBe('claude-3-5-sonnet/20240620');
  });

  it('returns the value unchanged when there is no slash', () => {
    expect(stripProviderPrefix('gpt-4o')).toBe('gpt-4o');
  });

  it('buildOpenRouterPricingRecord derives provider from first slash', () => {
    const rec = buildOpenRouterPricingRecord({
      id: 'anthropic/claude-3-5-sonnet/20240620',
      name: 'Claude 3.5 Sonnet',
      pricing: { prompt: 3, completion: 15 }
    });
    expect(rec.provider).toBe('anthropic');
    expect(rec.canonicalSlug).toBe('anthropic/claude-3-5-sonnet/20240620');
  });
});
