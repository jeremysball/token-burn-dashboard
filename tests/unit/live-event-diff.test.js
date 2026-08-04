// tests/unit/live-event-diff.test.js
import { describe, expect, it } from 'bun:test';
import { computeGrowthEvents, pickLatestEvent } from '../../dashboard/js/live-event-diff.js';

describe('computeGrowthEvents', () => {
  it('returns one event per model whose total grew', () => {
    const prev = { 'a/model-1': { total: 100 }, 'a/model-2': { total: 500 } };
    const curr = { 'a/model-1': { total: 150 }, 'a/model-2': { total: 500 } };
    expect(computeGrowthEvents(prev, curr)).toEqual([{ model: 'a/model-1', delta: 50 }]);
  });

  it('treats a brand-new model (absent from prev) as growth from 0', () => {
    const prev = { 'a/model-1': { total: 100 } };
    const curr = { 'a/model-1': { total: 100 }, 'a/model-2': { total: 40 } };
    expect(computeGrowthEvents(prev, curr)).toEqual([{ model: 'a/model-2', delta: 40 }]);
  });

  it('ignores a model whose total shrank or stayed flat', () => {
    const prev = { 'a/model-1': { total: 200 } };
    const curr = { 'a/model-1': { total: 200 } };
    expect(computeGrowthEvents(prev, curr)).toEqual([]);
  });
});

describe('pickLatestEvent', () => {
  const currMap = {
    'a/model-1': { total: 150, input: 40, cache_read: 60, output: 50 },
    'a/model-2': { total: 700, input: 800, cache_read: 200, output: 100 }
  };
  const pricingByModel = {
    'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
  };

  it('returns null for an empty events list', () => {
    expect(pickLatestEvent([], currMap, pricingByModel)).toBeNull();
  });

  it('picks the largest-delta event when multiple models grew in the same poll', () => {
    const events = [{ model: 'a/model-1', delta: 50 }, { model: 'a/model-2', delta: 200 }];
    const picked = pickLatestEvent(events, currMap, pricingByModel);
    expect(picked.model).toBe('a/model-2');
    expect(picked.delta).toBe(200);
  });

  it('computes the cache percentage from the model current totals', () => {
    const events = [{ model: 'a/model-1', delta: 50 }];
    const picked = pickLatestEvent(events, currMap, pricingByModel);
    expect(picked.cachePct).toBeCloseTo(60, 0); // 60 / (40 + 60) * 100
  });

  it('returns a null cost when the model has no usable pricing', () => {
    const events = [{ model: 'a/model-2', delta: 200 }];
    const picked = pickLatestEvent(events, currMap, pricingByModel);
    expect(picked.cost).toBeNull();
  });

  it('returns a finite estimated cost when pricing is available', () => {
    const events = [{ model: 'a/model-1', delta: 50 }];
    const picked = pickLatestEvent(events, currMap, pricingByModel);
    expect(picked.cost).toBeGreaterThan(0);
  });
});