import { describe, expect, it, mock } from 'bun:test';

const { findSpikes } = require('../../../lib/spike-detective');

describe('spike-detective findSpikes', () => {
  it('returns empty array for null input', () => {
    expect(findSpikes(null)).toEqual([]);
  });

  it('returns empty array for fewer than 3 data points', () => {
    expect(findSpikes([{ time: 1, total: 100 }, { time: 2, total: 200 }])).toEqual([]);
  });

  it('detects a spike when current value is >= 2x the rolling average', () => {
    const data = [
      { time: 1, total: 10000 },
      { time: 2, total: 10000 },
      { time: 3, total: 30000 },
    ];
    const spikes = findSpikes(data, 2.0);
    expect(spikes).toHaveLength(1);
    expect(spikes[0].time).toBe(3);
    expect(spikes[0].tokens).toBe(30000);
  });

  it('does not flag normal fluctuations below the threshold', () => {
    const data = [
      { time: 1, total: 10000 },
      { time: 2, total: 10000 },
      { time: 3, total: 15000 },
    ];
    expect(findSpikes(data, 2.0)).toEqual([]);
  });

  it('ignores small token counts even when the ratio is high', () => {
    const data = [
      { time: 1, total: 10 },
      { time: 2, total: 10 },
      { time: 3, total: 50 },
    ];
    expect(findSpikes(data, 2.0)).toEqual([]);
  });

  it('caps output at 10 most recent spikes', () => {
    const data = [];
    for (let i = 0; i < 20; i++) {
      const normal = i % 3 === 2 ? 100 : 10000;
      const spike = i % 3 === 2 ? 100000 : 10000;
      data.push({ time: i, total: i % 3 === 2 ? spike : normal });
    }
    const spikes = findSpikes(data, 2.0);
    expect(spikes.length).toBeLessThanOrEqual(10);
  });
});
