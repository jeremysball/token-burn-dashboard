/**
 * @jest-environment jsdom
 */

import { 
  emojis, 
  getEmoji, 
  CHART_COLORS, 
  MODEL_PRICING, 
  getPricing, 
  calculateCost,
  CACHE_KEY,
  CACHE_VERSION 
} from '../../dashboard/js/config.js';

describe('Config Module', () => {
  describe('getEmoji', () => {
    it('returns correct badge for kimi models', () => {
      expect(getEmoji('kimi-coding/k2p5')).toBe('K');
      expect(getEmoji('KIMI-PRO')).toBe('K');
    });

    it('returns correct badge for claude models', () => {
      expect(getEmoji('claude-3.5-sonnet')).toBe('C');
      expect(getEmoji('anthropic/claude')).toBe('C');
    });

    it('returns correct badge for gpt models', () => {
      expect(getEmoji('gpt-4o')).toBe('O');
      expect(getEmoji('openai/gpt-4')).toBe('O');
    });

    it('returns correct badge for gemini models', () => {
      expect(getEmoji('gemini-1.5-pro')).toBe('G');
      expect(getEmoji('google/gemini')).toBe('G');
    });

    it('returns default badge for unknown models', () => {
      expect(getEmoji('unknown-model')).toBe('?');
      expect(getEmoji('')).toBe('?');
    });
  });

  describe('getPricing', () => {
    it('returns correct pricing for gpt-4o', () => {
      const pricing = getPricing('gpt-4o');
      expect(pricing.input).toBe(2.5);
      expect(pricing.output).toBe(10);
    });

    it('returns correct pricing for gpt-4o-mini', () => {
      const pricing = getPricing('gpt-4o-mini');
      expect(pricing.input).toBe(0.15);
      expect(pricing.output).toBe(0.6);
    });

    it('returns correct pricing for claude-3.5-sonnet', () => {
      const pricing = getPricing('claude-3.5-sonnet');
      expect(pricing.input).toBe(3);
      expect(pricing.output).toBe(15);
    });

    it('returns correct pricing for deepseek-chat', () => {
      const pricing = getPricing('deepseek-chat');
      expect(pricing.input).toBe(0.27);
      expect(pricing.output).toBe(1.1);
    });

    it('returns default pricing for unknown models', () => {
      const pricing = getPricing('unknown-model');
      expect(pricing.input).toBe(2.5);
      expect(pricing.output).toBe(10);
    });
  });

  describe('calculateCost', () => {
    it('calculates cost correctly for input/output tokens', () => {
      const tokens = { input: 1_000_000, output: 500_000, cache_read: 0, cache_write: 0 };
      const cost = calculateCost(tokens, 'gpt-4o');
      // Returns object with breakdown: {input, output, cache_read, cache_write, total}
      // (1M * 2.5 + 0.5M * 10) / 1M = 2.5 + 5 = 7.5
      expect(cost.total).toBeCloseTo(7.5, 2);
      expect(cost.input).toBeCloseTo(2.5, 2);
      expect(cost.output).toBeCloseTo(5, 2);
    });

    it('includes cache read costs when applicable', () => {
      const tokens = { input: 0, output: 0, cache_read: 1_000_000, cache_write: 0 };
      const cost = calculateCost(tokens, 'claude-3.5-sonnet');
      // 1M * 0.3 / 1M = 0.3
      expect(cost.total).toBeCloseTo(0.3, 2);
      expect(cost.cache_read).toBeCloseTo(0.3, 2);
    });

    it('handles zero tokens gracefully', () => {
      const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
      const cost = calculateCost(tokens, 'gpt-4o');
      expect(cost.total).toBe(0);
      expect(cost.input).toBe(0);
      expect(cost.output).toBe(0);
    });
  });

  describe('constants', () => {
    it('has expected cache configuration', () => {
      expect(CACHE_KEY).toBe('tokenBurnCache');
      expect(CACHE_VERSION).toBe('v2');
    });

    it('has color palette defined', () => {
      expect(CHART_COLORS).toBeInstanceOf(Array);
      expect(CHART_COLORS.length).toBeGreaterThan(0);
      expect(CHART_COLORS[0]).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});
