/**
 * @jest-environment jsdom
 */
import { resolveAvailableRange } from '../../dashboard/js/views/analytics/tabs/shared.js';

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const point = (msAgo) => ({ time: now - msAgo, total: 100 });

describe('resolveAvailableRange', () => {
  it('keeps the requested range when it already has enough data', () => {
    const data = [point(HOUR), point(2 * HOUR)];
    expect(resolveAvailableRange(data, '24h')).toBe('24h');
  });

  it('widens from 24h to 7d when 24h has insufficient data', () => {
    const data = [point(3 * 24 * HOUR), point(5 * 24 * HOUR)];
    expect(resolveAvailableRange(data, '24h')).toBe('7d');
  });

  it('widens all the way to "all" when nothing else qualifies', () => {
    const data = [point(60 * 24 * HOUR), point(90 * 24 * HOUR)];
    expect(resolveAvailableRange(data, '24h')).toBe('all');
  });

  it('does not widen past the requested range if it is already "all"', () => {
    expect(resolveAvailableRange([], 'all')).toBe('all');
  });

  it('does not narrow — widening only ever moves to a wider range than requested', () => {
    const data = [point(HOUR), point(2 * HOUR)];
    expect(resolveAvailableRange(data, '7d')).toBe('7d');
  });
});
