/**
 * Tests for OpenRouter first-slash parsing consistency
 */

const {
  stripProviderPrefix,
  buildOpenRouterPricingRecord,
  getOpenRouterPricingRecord,
  setOpenRouterPricingSnapshot
} = require('../../../lib/openrouter');

import { describe, expect, it, beforeEach } from 'bun:test';

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

describe('getOpenRouterPricingRecord fuzzy fallback', () => {
  // Reset the pricing snapshot before each test to avoid order-dependent failures
  beforeEach(() => {
    setOpenRouterPricingSnapshot({ models: [] });
  });

  it('does not match a shorter model id onto a longer catalog-only entry', () => {
    setOpenRouterPricingSnapshot({
      fetchedAt: Date.now(),
      source: 'openrouter',
      models: [
        {
          id: 'openai/gpt-4o-mini',
          name: 'GPT-4o Mini',
          pricing: { prompt: 0.00000015, completion: 0.0000006 }
        }
      ]
    });

    expect(getOpenRouterPricingRecord('gpt-4o')).toBeNull();
  });

  it('still matches aliases that differ only by provider prefix or casing', () => {
    setOpenRouterPricingSnapshot({
      fetchedAt: Date.now(),
      source: 'openrouter',
      models: [
        {
          id: 'openai/gpt-4o-mini',
          name: 'GPT-4o Mini',
          pricing: { prompt: 0.00000015, completion: 0.0000006 }
        }
      ]
    });

    const record = getOpenRouterPricingRecord('GPT-4o-Mini');
    expect(record).not.toBeNull();
    expect(record?.id).toBe('openai/gpt-4o-mini');
    // Pricing is normalized to per-million: 0.00000015 * 1,000,000 = 0.15
    // Use a small tolerance for floating point comparison
    const tolerance = 0.0001;
    expect(Math.abs((record?.input || 0) - 0.15)).toBeLessThan(tolerance);
    expect(Math.abs((record?.output || 0) - 0.6)).toBeLessThan(tolerance);
  });
});
