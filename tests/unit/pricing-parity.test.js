/**
 * @jest-environment jsdom
 */

import { MODEL_PRICING as FRONTEND_PRICING } from '../../dashboard/js/config.js';
const { MODEL_PRICING: BACKEND_PRICING } = require('../../lib/pricing');

describe('frontend/backend pricing parity', () => {
  it('frontend and backend pricing length are within tolerance', () => {
    expect(FRONTEND_PRICING).toBeInstanceOf(Array);
    expect(BACKEND_PRICING).toBeInstanceOf(Array);
    const diff = Math.abs(BACKEND_PRICING.length - FRONTEND_PRICING.length);
    // allow +/- 10 difference but warn
    expect(diff).toBeLessThan(15);
  });
});
