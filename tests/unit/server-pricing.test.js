const {
  buildOpenRouterPricingRecord,
  getOpenRouterPricingRecord,
  setOpenRouterPricingSnapshot
} = require('../../lib/openrouter');
const { getPricing, calculateCost } = require('../../lib/pricing');

describe('server pricing', () => {
  beforeEach(() => {
    setOpenRouterPricingSnapshot({
      fetchedAt: 0,
      source: 'local',
      models: [],
      error: null
    });
  });

  it('normalizes OpenRouter pricing to per-1M token rates', () => {
    const record = buildOpenRouterPricingRecord({
      id: 'openai/gpt-4o',
      canonical_slug: 'openai/gpt-4o',
      name: 'OpenAI: GPT-4o',
      context_length: 128000,
      pricing: {
        prompt: '0.0000025',
        completion: '0.00001',
        input_cache_read: '0.00000125'
      }
    });

    expect(record).toMatchObject({
      id: 'openai/gpt-4o',
      canonicalSlug: 'openai/gpt-4o',
      name: 'OpenAI: GPT-4o',
      contextLength: 128000,
      input: 2.5,
      output: 10,
      cacheRead: 1.25,
      cacheWrite: null,
      source: 'openrouter'
    });
  });

  it('matches OpenRouter pricing by full id and alias', () => {
    setOpenRouterPricingSnapshot({
      fetchedAt: Date.now(),
      source: 'openrouter',
      models: [
        {
          id: 'deepseek/deepseek-chat',
          canonical_slug: 'deepseek/deepseek-chat-v3',
          name: 'DeepSeek: DeepSeek V3',
          context_length: 163840,
          pricing: {
            prompt: '0.00000032',
            completion: '0.00000089'
          }
        }
      ],
      error: null
    });

    expect(getOpenRouterPricingRecord('deepseek/deepseek-chat')).toMatchObject({
      id: 'deepseek/deepseek-chat',
      input: 0.32,
      output: 0.89,
      source: 'openrouter'
    });

    expect(getOpenRouterPricingRecord('deepseek-chat')).toMatchObject({
      id: 'deepseek/deepseek-chat',
      input: 0.32,
      output: 0.89,
      source: 'openrouter'
    });
  });

  it('uses OpenRouter pricing when available and falls back otherwise', () => {
    setOpenRouterPricingSnapshot({
      fetchedAt: Date.now(),
      source: 'openrouter',
      models: [
        {
          id: 'anthropic/claude-3.5-sonnet',
          canonical_slug: 'anthropic/claude-3.5-sonnet',
          name: 'Anthropic: Claude 3.5 Sonnet',
          context_length: 200000,
          pricing: {
            prompt: '0.000006',
            completion: '0.00003',
            input_cache_read: '0.0000006',
            input_cache_write: '0.0000075'
          }
        }
      ],
      error: null
    });

    const pricing = getPricing('claude-3.5-sonnet');
    expect(pricing.source).toBe('openrouter');
    expect(pricing.input).toBeCloseTo(6, 5);
    expect(pricing.output).toBeCloseTo(30, 5);
    expect(pricing.cacheRead).toBeCloseTo(0.6, 5);
    expect(pricing.cacheWrite).toBeCloseTo(7.5, 5);

    const cost = calculateCost({ input: 1_000_000, output: 500_000, cache_read: 1_000_000, cache_write: 1_000_000 }, 'claude-3.5-sonnet');
    expect(cost.input).toBeCloseTo(6, 5);
    expect(cost.output).toBeCloseTo(15, 5);
    expect(cost.cache_read).toBeCloseTo(0.6, 5);
    expect(cost.cache_write).toBeCloseTo(7.5, 5);
    expect(cost.total).toBeCloseTo(29.1, 5);

    expect(getPricing('unknown-model')).toMatchObject({
      source: 'local',
      input: 2.5,
      output: 10
    });
  });
});
