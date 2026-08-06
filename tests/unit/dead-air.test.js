// tests/unit/dead-air.test.js
import { describe, expect, it } from 'bun:test';
import { detectDeadAirBands } from '../../dashboard/js/dead-air.js';

const HOUR = 3600 * 1000;
/** @param {number} startHour @param {number[]} presentOffsets hour offsets (from startHour) that have a real bucket */
function fixtureBuckets(startHour, presentOffsets) {
    return presentOffsets.map((offset) => ({ time: startHour + offset * HOUR, total: 100 }));
}

describe('detectDeadAirBands', () => {
  it('returns no bands for fewer than 2 buckets', () => {
    expect(detectDeadAirBands([])).toEqual([]);
    expect(detectDeadAirBands([{ time: 0 }])).toEqual([]);
  });

  it('returns no bands for perfectly consecutive hourly buckets', () => {
    const buckets = fixtureBuckets(0, [0, 1, 2, 3, 4]);
    expect(detectDeadAirBands(buckets)).toEqual([]);
  });

  it('ignores gaps below the threshold (2 missing hours)', () => {
    const buckets = fixtureBuckets(0, [0, 3]); // hours 1, 2 missing = 2-hour gap
    expect(detectDeadAirBands(buckets, 3)).toEqual([]);
  });

  it('flags a gap exactly at the threshold (3 missing hours)', () => {
    const buckets = fixtureBuckets(0, [0, 4]); // hours 1, 2, 3 missing = 3-hour gap
    const bands = detectDeadAirBands(buckets, 3);
    expect(bands).toEqual([{ start: HOUR, end: 4 * HOUR }]);
  });

  it('flags multiple independent gaps in one series', () => {
    const buckets = fixtureBuckets(0, [0, 5, 10]); // two 4-hour gaps
    const bands = detectDeadAirBands(buckets, 3);
    expect(bands).toEqual([
      { start: HOUR, end: 5 * HOUR },
      { start: 6 * HOUR, end: 10 * HOUR }
    ]);
  });

  it('respects a custom threshold', () => {
    const buckets = fixtureBuckets(0, [0, 3]); // 2-hour gap
    expect(detectDeadAirBands(buckets, 2)).toEqual([{ start: HOUR, end: 3 * HOUR }]);
  });

  it('detects a trailing gap through the completed chart boundary', () => {
    const h = (hour) => hour * HOUR;
    expect(detectDeadAirBands([{ time: h(9) }], 3, h(13))).toEqual([{ start: h(10), end: h(13) }]);
    expect(detectDeadAirBands([{ time: h(9) }], 3, h(12))).toEqual([]);
    expect(detectDeadAirBands([{ time: h(9) }], 3, h(8))).toEqual([]);
  });

  it('rejects non-hour-aligned, duplicate, descending, and invalid one-bucket input', () => {
    const h = (hour) => hour * HOUR;
    expect(detectDeadAirBands([{ time: h(9) + 5 * 60_000 }, { time: h(13) }], 3, h(16))).toEqual([]);
    expect(detectDeadAirBands([{ time: h(9) }])).toEqual([]);
    expect(detectDeadAirBands([{ time: h(9) }, { time: h(9) }, { time: h(13) }], 3, h(16))).toEqual([]);
    expect(detectDeadAirBands([{ time: h(13) }, { time: h(9) }], 3, h(16))).toEqual([]);
  });
});
