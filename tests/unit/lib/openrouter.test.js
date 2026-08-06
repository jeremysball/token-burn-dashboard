/**
 * Tests for OpenRouter first-slash parsing consistency
 */

const {
  stripProviderPrefix,
  buildOpenRouterPricingRecord,
  getOpenRouterPricingRecord,
  setOpenRouterPricingSnapshot
} = require('../../../lib/openrouter');

import { describe, expect, it } from 'bun:test';

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

    expect(getOpenRouterPricingRecord('GPT-4o-Mini')).not.toBeNull();
  });
});
