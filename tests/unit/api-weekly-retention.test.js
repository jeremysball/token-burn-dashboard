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
        // updateData's day-key derivation) also sees the mocked time, and
        // forward explicit string arguments so the ISO calendar-day round-trip
        // check in updateData parses them against the real calendar.
        globalThis.Date = class extends RealDate {
          constructor(...args) {
            if (args.length === 0) super(day.getTime()); else super(...args);
          }
          static now() { return day.getTime(); }
        };
        updateData({
          total_tokens: 1000 * (i + 1),
          tokens_by_model: { 'a/model-1': { total: 1000 * (i + 1), input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 } }
        });
      }
    } finally {
      globalThis.Date = RealDate;
      Date.now = realDateNow;
    }

    expect(weeklyData.length).toBe(WEEKLY_HISTORY_DAYS);
    expect(weeklyData[0].day).toBe('2026-01-04');
    expect(weeklyData.at(-1).day).toBe('2026-01-18');
  });

  it('updates duplicate days without synthesizing missing middle days', () => {
    const realDateNow = Date.now;
    const RealDate = Date;
    const setDay = (day) => {
      const time = new RealDate(`${day}T00:00:00Z`).getTime();
      Date.now = () => time;
      globalThis.Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(time); else super(...args);
        }
        static now() { return time; }
      };
    };
    try {
      setDay('2026-02-01');
      updateData({ total_tokens: 100, tokens_by_model: {} });
      setDay('2026-02-03');
      updateData({ total_tokens: 300, tokens_by_model: {} });
      setDay('2026-02-03');
      updateData({ total_tokens: 350, tokens_by_model: {} });
    } finally {
      globalThis.Date = RealDate;
      Date.now = realDateNow;
    }
    expect(weeklyData.map((entry) => entry.day)).toEqual(['2026-02-01', '2026-02-03']);
    expect(weeklyData.at(-1).tokens).toBe(350);
  });

  it('preserves the existing same-day snapshot when a later update does not advance the cumulative', () => {
    // A later same-day update with a lower or equal cumulative must not
    // overwrite the previously stored, monotonically advancing day/model
    // data, or the weekly deltas will silently regress.
    const realDateNow = Date.now;
    const RealDate = Date;
    const setDay = (day) => {
      const time = new RealDate(`${day}T00:00:00Z`).getTime();
      Date.now = () => time;
      globalThis.Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(time); else super(...args);
        }
        static now() { return time; }
      };
    };
    try {
      setDay('2026-03-01');
      updateData({
        total_tokens: 500,
        tokens_by_model: { 'a/advancing': { total: 500, input: 500, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 } }
      });
      setDay('2026-03-01');
      updateData({
        total_tokens: 700, // advances cumulative — should replace the stored day
        tokens_by_model: { 'a/advancing': { total: 700, input: 700, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 } }
      });
      setDay('2026-03-01');
      updateData({
        total_tokens: 650, // stale, lower than the stored 700 — must NOT replace
        tokens_by_model: { 'a/advancing': { total: 650, input: 650, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 } }
      });
      setDay('2026-03-01');
      updateData({
        total_tokens: 700, // equal to stored — must NOT regress the model total
        tokens_by_model: { 'a/advancing': { total: 50, input: 50, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 } }
      });
      setDay('2026-03-02');
      updateData({ total_tokens: 900, tokens_by_model: {} });
    } finally {
      globalThis.Date = RealDate;
      Date.now = realDateNow;
    }
    expect(weeklyData.map((entry) => entry.day)).toEqual(['2026-03-01', '2026-03-02']);
    const marchFirst = weeklyData.find((entry) => entry.day === '2026-03-01');
    expect(marchFirst.tokens).toBe(700);
    expect(marchFirst.models['a/advancing'].total).toBe(700);
  });

  it('drops calendar-invalid ISO day keys (2026-02-30, 2026-13-01, 2026-02-29 in a non-leap year)', () => {
    // 2026 is not a leap year; February has 28 days. Syntactically matching but
    // calendar-invalid days must be discarded, not treated as real snapshots.
    const realDateNow = Date.now;
    const RealDate = Date;
    const time = new RealDate('2026-01-15T00:00:00Z').getTime();
    try {
      Date.now = () => time;
      // Forward arguments so `new Date('YYYY-MM-DDTHH:MM:SSZ')` still parses
      // the ISO string the way the real constructor would.
      globalThis.Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(time); else super(...args);
        }
        static now() { return time; }
      };
      setWeeklyData([
        { day: '2026-02-30', tokens: 100, models: {} },
        { day: '2026-13-01', tokens: 200, models: {} },
        { day: '2026-02-29', tokens: 300, models: {} },
        { day: '2026-02-28', tokens: 400, models: {} },
        { day: '2026-01-01', tokens: 500, models: {} }
      ]);
      updateData({ total_tokens: 700, tokens_by_model: {} });
    } finally {
      globalThis.Date = RealDate;
      Date.now = realDateNow;
    }
    const days = weeklyData.map((entry) => entry.day);
    expect(days).not.toContain('2026-02-30');
    expect(days).not.toContain('2026-13-01');
    expect(days).not.toContain('2026-02-29');
    expect(days).toEqual(['2026-01-01', '2026-01-15', '2026-02-28']);
  });

  it('does not let calendar-invalid day keys consume the 15-day retention budget', () => {
    // Pre-populate with 14 valid days + 1 calendar-invalid day, then add a new
    // valid day. After the fix: 14 + 1 = 15 valid days are retained, so the
    // invalid day must be the one dropped (not a valid day).
    const realDateNow = Date.now;
    const RealDate = Date;
    const setDay = (day) => {
      const time = new RealDate(`${day}T00:00:00Z`).getTime();
      Date.now = () => time;
      globalThis.Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) super(time); else super(...args);
        }
        static now() { return time; }
      };
    };
    try {
      const valid = [];
      for (let i = 1; i <= 14; i++) {
        valid.push({
          day: `2026-01-${String(i).padStart(2, '0')}`,
          tokens: i,
          models: {}
        });
      }
      setWeeklyData([...valid, { day: '2026-02-30', tokens: 999, models: {} }]);
      setDay('2026-01-15');
      updateData({ total_tokens: 2000, tokens_by_model: {} });
    } finally {
      globalThis.Date = RealDate;
      Date.now = realDateNow;
    }
    const days = weeklyData.map((entry) => entry.day);
    expect(days).not.toContain('2026-02-30');
    expect(days).toContain('2026-01-01');
    expect(days).toContain('2026-01-15');
    expect(weeklyData).toHaveLength(WEEKLY_HISTORY_DAYS);
  });
});
