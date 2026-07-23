/**
 * @jest-environment jsdom
 *
 * Pricing is now single-sourced from lib/pricing.js and served via GET /api/pricing.
 * This test verifies that getAllPricing() output (patterns as strings) can be
 * round-tripped back into working RegExp objects on the client side.
 */

const { MODEL_PRICING: BACKEND_PRICING, getAllPricing } = require('../../lib/pricing');

/**
 * Replicate the client-side _parsePattern logic that converts
 * "/^gpt-4o$/i" back into a RegExp.
 * @param {string} str
 * @returns {RegExp}
 */
function parsePattern(str) {
  const m = str.match(/^\/(.*)\/([gimsuys]*)$/);
  if (m) return new RegExp(m[1], m[2]);
  return /.*/;
}

describe('pricing round-trip', () => {
  const serverData = getAllPricing();

  it('returns all pricing entries from the server', () => {
    expect(serverData).toBeInstanceOf(Array);
    expect(serverData.length).toBe(BACKEND_PRICING.length);
  });

  it('every server pattern string can be parsed back to a valid RegExp', () => {
    for (const entry of serverData) {
      const re = parsePattern(entry.pattern);
      expect(re).toBeInstanceOf(RegExp);
    }
  });

  it('reconstructed RegExp objects match the same model names as the originals', () => {
    const testNames = [
      'gpt-4o',
      'gpt-4o-mini',
      'o1',
      'o3-mini',
      'claude-3-5-sonnet',
      'claude',
      'deepseek-chat',
      'deepseek-reasoner',
      'gemini-1.5-pro',
      'gemini-1.5-flash',
      'glm-4',
      'kimi-k2',
      'k2p5',
    ];

    for (let i = 0; i < serverData.length; i++) {
      const original = BACKEND_PRICING[i];
      const reconstructed = parsePattern(serverData[i].pattern);

      for (const name of testNames) {
        expect(reconstructed.test(name)).toBe(original.pattern.test(name));
      }
    }
  });

  it('pricing values match between server and API response', () => {
    for (let i = 0; i < serverData.length; i++) {
      expect(serverData[i].input).toBe(BACKEND_PRICING[i].input);
      expect(serverData[i].output).toBe(BACKEND_PRICING[i].output);
      expect(serverData[i].cacheRead).toBe(BACKEND_PRICING[i].cacheRead);
      expect(serverData[i].cacheWrite).toBe(BACKEND_PRICING[i].cacheWrite);
    }
  });
});
