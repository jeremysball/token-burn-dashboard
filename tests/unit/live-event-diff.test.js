// tests/unit/live-event-diff.test.js
import { describe, expect, it } from 'bun:test';
import { computeGrowthEvents, pickLatestEvent } from '../../dashboard/js/live-event-diff.js';

describe('computeGrowthEvents', () => {
  it('returns per-dimension deltas for a model whose all five dimensions grow', () => {
    const prev = { 'a/model-1': { total: 100, input: 40, output: 30, cache_read: 20, cache_write: 5, reasoning: 5 } };
    const curr = { 'a/model-1': { total: 200, input: 70, output: 50, cache_read: 40, cache_write: 10, reasoning: 30 } };
    const events = computeGrowthEvents(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      model: 'a/model-1',
      delta: 100,
      inputDelta: 30,
      outputDelta: 20,
      cacheReadDelta: 20,
      cacheWriteDelta: 5,
      reasoningDelta: 25,
    });
  });

  it('computes mixed negative deltas clamping only the affected dimension to zero', () => {
    const prev = { 'a/model-1': { total: 100, input: 60, output: 30, cache_read: 10, cache_write: 5, reasoning: 5 } };
    const curr = { 'a/model-1': { total: 150, input: 40, output: 50, cache_read: 30, cache_write: 3, reasoning: 27 } };
    const events = computeGrowthEvents(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].inputDelta).toBe(0);
    expect(events[0].outputDelta).toBe(20);
    expect(events[0].cacheReadDelta).toBe(20);
    expect(events[0].cacheWriteDelta).toBe(0);
    expect(events[0].reasoningDelta).toBe(22);
    expect(events[0].delta).toBe(62);
  });

  it('treats a brand-new model (absent from prev) as growth from 0 for all dimensions', () => {
    const prev = { 'a/model-1': { total: 100, input: 50, output: 30, cache_read: 15, cache_write: 3, reasoning: 2 } };
    const curr = {
      'a/model-1': { total: 100, input: 50, output: 30, cache_read: 15, cache_write: 3, reasoning: 2 },
      'a/model-2': { total: 80, input: 30, output: 20, cache_read: 20, cache_write: 5, reasoning: 5 },
    };
    const events = computeGrowthEvents(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      model: 'a/model-2',
      delta: 80,
      inputDelta: 30,
      outputDelta: 20,
      cacheReadDelta: 20,
      cacheWriteDelta: 5,
      reasoningDelta: 5,
    });
  });

  it('ignores a model whose total stayed flat or shrank', () => {
    const prev = { 'a/model-1': { total: 200, input: 100, output: 50, cache_read: 40, cache_write: 5, reasoning: 5 } };
    const curr = { 'a/model-1': { total: 200, input: 100, output: 50, cache_read: 40, cache_write: 5, reasoning: 5 } };
    expect(computeGrowthEvents(prev, curr)).toEqual([]);
  });

  it('carries the positive total delta for event ordering while cost uses dimensional deltas', () => {
    const prev = { 'a/model-1': { total: 100, input: 50, output: 20, cache_read: 20, cache_write: 5, reasoning: 5 } };
    const curr = { 'a/model-1': { total: 300, input: 100, output: 60, cache_read: 80, cache_write: 10, reasoning: 50 } };
    const events = computeGrowthEvents(prev, curr);
    expect(events).toHaveLength(1);
    expect(events[0].delta).toBe(200);
    expect(events[0].inputDelta + events[0].outputDelta + events[0].cacheReadDelta + events[0].cacheWriteDelta + events[0].reasoningDelta).toBe(200);
  });
});

describe('pickLatestEvent', () => {
  const pricingByModel = {
    'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0.05 },
    'a/model-2': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, reasoning: 0.03 },
  };

  it('returns null for an empty events list', () => {
    expect(pickLatestEvent([], pricingByModel)).toBeNull();
  });

  it('picks the largest-delta event when multiple models grew', () => {
    const events = [
      { model: 'a/model-1', delta: 50, inputDelta: 30, outputDelta: 10, cacheReadDelta: 5, cacheWriteDelta: 3, reasoningDelta: 2 },
      { model: 'a/model-2', delta: 200, inputDelta: 100, outputDelta: 50, cacheReadDelta: 30, cacheWriteDelta: 10, reasoningDelta: 10 },
    ];
    const picked = pickLatestEvent(events, pricingByModel);
    expect(picked.model).toBe('a/model-2');
    expect(picked.delta).toBe(200);
  });

  it('computes cachePct from cacheReadDelta / (inputDelta + cacheReadDelta)', () => {
    const events = [{ model: 'a/model-1', delta: 100, inputDelta: 50, outputDelta: 10, cacheReadDelta: 50, cacheWriteDelta: 5, reasoningDelta: 15 }];
    const picked = pickLatestEvent(events, pricingByModel);
    expect(picked.cachePct).toBeCloseTo(50, 0);
  });

  it('uses only the cache-read rate for a pure cache-read delta (inputDelta=0)', () => {
    const events = [{ model: 'a/model-1', delta: 100, inputDelta: 0, outputDelta: 0, cacheReadDelta: 100, cacheWriteDelta: 0, reasoningDelta: 0 }];
    const picked = pickLatestEvent(events, pricingByModel);
    expect(picked.cachePct).toBe(100);
    expect(picked.cost).toBeCloseTo((100 / 1e6) * 0.3, 10);
  });

  it('prices each positive dimension with its matching rate', () => {
    const events = [{ model: 'a/model-1', delta: 80, inputDelta: 30, outputDelta: 20, cacheReadDelta: 20, cacheWriteDelta: 5, reasoningDelta: 5 }];
    const picked = pickLatestEvent(events, pricingByModel);
    const expectedCost =
      (30 / 1e6) * 3 +
      (20 / 1e6) * 15 +
      (20 / 1e6) * 0.3 +
      (5 / 1e6) * 3.75 +
      (5 / 1e6) * 0.05;
    expect(picked.cost).toBeCloseTo(expectedCost, 10);
  });

  it('returns cost null when a nonzero dimension lacks a usable rate', () => {
    const events = [{ model: 'a/model-1', delta: 80, inputDelta: 30, outputDelta: 20, cacheReadDelta: 20, cacheWriteDelta: 5, reasoningDelta: 5 }];
    const noOutputPricing = { 'a/model-1': { input: 3, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0.05 } };
    const picked = pickLatestEvent(events, noOutputPricing);
    expect(picked.cost).toBeNull();
  });

  it('returns a finite cost when all nonzero dimensions have usable rates including zero rates', () => {
    const events = [{ model: 'a/model-1', delta: 50, inputDelta: 30, outputDelta: 0, cacheReadDelta: 20, cacheWriteDelta: 0, reasoningDelta: 0 }];
    const picked = pickLatestEvent(events, pricingByModel);
    expect(picked.cost).not.toBeNull();
    expect(picked.cost).toBeGreaterThanOrEqual(0);
  });

  it('returns cost null when pricingByModel is undefined', () => {
    const events = [{ model: 'a/model-1', delta: 50, inputDelta: 30, outputDelta: 10, cacheReadDelta: 5, cacheWriteDelta: 3, reasoningDelta: 2 }];
    const picked = pickLatestEvent(events, undefined);
    expect(picked.cost).toBeNull();
  });

  it('returns cost null when pricingByModel has no entry for the model', () => {
    const events = [{ model: 'a/model-1', delta: 50, inputDelta: 30, outputDelta: 10, cacheReadDelta: 5, cacheWriteDelta: 3, reasoningDelta: 2 }];
    const picked = pickLatestEvent(events, { 'other/model': pricingByModel['a/model-1'] });
    expect(picked.cost).toBeNull();
  });
});