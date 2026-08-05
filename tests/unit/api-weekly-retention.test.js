// tests/unit/api-weekly-retention.test.js
import { beforeEach, describe, expect, it } from 'bun:test';
import { updateData } from '../../dashboard/js/api.js';
import { weeklyData, setWeeklyData, setCurrentData, setHistoryData } from '../../dashboard/js/state.js';
import { WEEKLY_HISTORY_DAYS } from '../../dashboard/js/config.js';

describe('weeklyData retention', () => {
  beforeEach(() => {
    setWeeklyData([]);
    setCurrentData(null);
    setHistoryData([]);
  });

  it('retains up to WEEKLY_HISTORY_DAYS distinct-day snapshots, not just 7', () => {
    const realDateNow = Date.now;
    const RealDate = Date;
    try {
      for (let i = 0; i < WEEKLY_HISTORY_DAYS + 3; i++) {
        const day = new RealDate(Date.UTC(2026, 0, 1 + i));
        Date.now = () => day.getTime();
        // Override Date constructor so `new Date().toISOString()` (used by
        // updateData's day-key derivation) also sees the mocked time.
        globalThis.Date = class extends RealDate {
          constructor() { super(day.getTime()); }
          static now() { return day.getTime(); }
        };
        updateData({
          total_tokens: 1000 * (i + 1),
          tokens_by_model: { 'a/model-1': { total: 1000 * (i + 1), input: 0, output: 0, cache_read: 0, cache_write: 0 } }
        });
      }
    } finally {
      globalThis.Date = RealDate;
      Date.now = realDateNow;
    }

    expect(weeklyData.length).toBe(WEEKLY_HISTORY_DAYS);
  });
});
