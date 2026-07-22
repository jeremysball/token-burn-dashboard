/**
 * @jest-environment jsdom
 */
import { cacheDiscountRatioFromPricing } from '../../dashboard/js/views/analytics';

describe('cacheDiscountRatioFromPricing', () => {
    it('uses cacheRead/input when pricing present', () => {
        expect(cacheDiscountRatioFromPricing({ input: 3, cacheRead: 0.3 })).toBeCloseTo(0.1, 5);
    });

    it('produces a 0 ratio when cacheRead is a valid numeric 0', () => {
        expect(cacheDiscountRatioFromPricing({ input: 3, cacheRead: 0 })).toBe(0);
    });

    it('falls back to 0.1 only when pricing is missing/invalid', () => {
        expect(cacheDiscountRatioFromPricing(undefined)).toBe(0.1);
        expect(cacheDiscountRatioFromPricing(null)).toBe(0.1);
        expect(cacheDiscountRatioFromPricing({ input: 'n/a', cacheRead: 0 })).toBe(0.1);
    });

    it('handles zero input denominator without producing NaN', () => {
        expect(cacheDiscountRatioFromPricing({ input: 0, cacheRead: 0 })).toBe(0);
    });
});
