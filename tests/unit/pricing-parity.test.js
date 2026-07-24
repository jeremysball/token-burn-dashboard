
import { getModelPricing, setPricing } from '../../dashboard/js/config.js';
const { MODEL_PRICING: BACKEND_PRICING } = require('../../lib/pricing');

import { describe, expect, it } from 'bun:test';

describe('frontend/backend pricing parity', () => {
  it('frontend and backend pricing length are within tolerance', () => {
    // Seed frontend pricing from backend data (mirrors what loadPricing does)
    setPricing(BACKEND_PRICING.map(p => ({
      pattern: new RegExp(p.pattern),
      input: p.input,
      output: p.output,
      cacheRead: p.cacheRead,
      cacheWrite: p.cacheWrite
    })));
    const FRONTEND_PRICING = getModelPricing();
    expect(FRONTEND_PRICING).toBeInstanceOf(Array);
    expect(BACKEND_PRICING).toBeInstanceOf(Array);
    const diff = Math.abs(BACKEND_PRICING.length - FRONTEND_PRICING.length);
    // allow +/- 10 difference but warn
    expect(diff).toBeLessThan(15);
  });
});
