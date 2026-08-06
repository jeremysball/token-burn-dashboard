/**
 * Tests for how lib/pricing.js merges Models.dev into the OpenRouter/local
 * pricing chain, including the Haiku 4.5 mispricing bug this source was
 * added to fix (see tests/unit/lib/modelsdev.test.js for module-level
 * catalog/matching tests).
 */

const { setOpenRouterPricingSnapshot } = require('../../../lib/openrouter');
const { setModelsDevPricingSnapshot } = require('../../../lib/modelsdev');
const { getPricing, calculateCost } = require('../../../lib/pricing');

import { beforeEach, describe, expect, it } from 'bun:test';

describe('Models.dev pricing merge', () => {
  beforeEach(() => {
    setOpenRouterPricingSnapshot({ fetchedAt: 0, source: 'local', models: [], error: null });
    setModelsDevPricingSnapshot({ fetchedAt: 0, source: 'local', catalog: {}, error: null });
  });

  it('fixes the Haiku 4.5 mispricing bug: falls through to Haiku-tier local rates, not Sonnet-tier, without Models.dev', () => {
    // Regression guard for the bug itself: claude-haiku-4-5 isn't a
    // "claude-3-haiku" substring match, so with no live source available it
    // used to silently land on the generic /claude/i (Sonnet-tier) rate.
    // The /haiku/i local safety net now catches it instead.
    const pricing = getPricing('anthropic/claude-haiku-4-5-20251001');
    expect(pricing.source).toBe('local');
    expect(pricing.input).toBeCloseTo(1, 5);
    expect(pricing.output).toBeCloseTo(5, 5);
    expect(pricing.input).not.toBe(3);
    expect(pricing.output).not.toBe(15);
  });

  it('prefers Models.dev pricing over both OpenRouter and local for the same model', () => {
    setOpenRouterPricingSnapshot({
      fetchedAt: Date.now(),
      source: 'openrouter',
      models: [{
        id: 'anthropic/claude-haiku-4-5',
        canonical_slug: 'anthropic/claude-haiku-4-5',
        name: 'Anthropic: Claude Haiku 4.5',
        pricing: { prompt: '0.000002', completion: '0.00001' }
      }],
      error: null
    });
    setModelsDevPricingSnapshot({
      fetchedAt: Date.now(),
      source: 'models.dev',
      catalog: {
        anthropic: {
          models: {
            'claude-haiku-4-5-20251001': {
              name: 'Claude Haiku 4.5',
              cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 }
            }
          }
        }
      },
      error: null
    });

    const pricing = getPricing('anthropic/claude-haiku-4-5-20251001');
    expect(pricing.source).toBe('models.dev');
    expect(pricing.input).toBeCloseTo(1, 5);
    expect(pricing.output).toBeCloseTo(5, 5);
    expect(pricing.cacheRead).toBeCloseTo(0.1, 5);
    expect(pricing.cacheWrite).toBeCloseTo(1.25, 5);

    const cost = calculateCost({ input: 1_000_000, output: 1_000_000 }, 'anthropic/claude-haiku-4-5-20251001');
    expect(cost.input).toBeCloseTo(1, 5);
    expect(cost.output).toBeCloseTo(5, 5);
  });

  it('falls back to OpenRouter fields Models.dev does not publish for the same model', () => {
    setOpenRouterPricingSnapshot({
      fetchedAt: Date.now(),
      source: 'openrouter',
      models: [{
        id: 'anthropic/claude-haiku-4-5',
        pricing: { prompt: '0.000002', completion: '0.00001', input_cache_write: '0.0000025' }
      }],
      error: null
    });
    setModelsDevPricingSnapshot({
      fetchedAt: Date.now(),
      source: 'models.dev',
      catalog: {
        anthropic: {
          models: {
            'claude-haiku-4-5': { name: 'Claude Haiku 4.5', cost: { input: 1, output: 5 } }
          }
        }
      },
      error: null
    });

    const pricing = getPricing('anthropic/claude-haiku-4-5');
    expect(pricing.source).toBe('models.dev');
    expect(pricing.input).toBeCloseTo(1, 5);
    expect(pricing.output).toBeCloseTo(5, 5);
    // cacheWrite wasn't published by Models.dev for this model, so it falls
    // back to OpenRouter's value rather than the local default.
    expect(pricing.cacheWrite).toBeCloseTo(2.5, 5);
  });
});
