/**
 * Tests for historical-data normalization and bucketing
 */

const { extractHistoricalData, normalizeTimeMs } = require('../../../lib/historical-data');
const fs = require('fs');
const os = require('os');
const path = require('path');

const writeTemp = (lines) => {
  const file = path.join(os.tmpdir(), `hd-test-${Date.now()}-${Math.random()}.jsonl`);
  fs.writeFileSync(file, lines.join('\n'));
  return file;
};

jest.mock('../../../lib/session-discovery', () => ({
  findAllSessionFiles: jest.fn()
}));

describe('normalizeTimeMs', () => {
  it('returns null for non-numeric input', () => {
    expect(normalizeTimeMs('1700000000')).toBe(null);
    expect(normalizeTimeMs(NaN)).toBe(null);
    expect(normalizeTimeMs(undefined)).toBe(null);
  });

  it('leaves millisecond timestamps untouched when >= 1e10', () => {
    expect(normalizeTimeMs(999999999999)).toBe(999999999999);
    expect(normalizeTimeMs(1700000000000)).toBe(1700000000000);
  });

  it('converts second timestamps (1e9..1e10) to milliseconds', () => {
    expect(normalizeTimeMs(1700000000)).toBe(1700000000000);
  });

  it('leaves values below 1e9 untouched', () => {
    expect(normalizeTimeMs(123456)).toBe(123456);
  });

  it('handles the threshold boundary correctly', () => {
    // exactly 1e9 is not in the (1e9, 1e10) window -> untouched
    expect(normalizeTimeMs(1e9)).toBe(1e9);
    // exactly 1e10 is not in the (1e9, 1e10) window -> untouched
    expect(normalizeTimeMs(1e10)).toBe(1e10);
  });

  it('parses ISO strings to their actual epoch bucket', () => {
    const ts = new Date('2026-07-10T05:00:00Z').getTime();
    expect(normalizeTimeMs('2026-07-10T05:00:00Z')).toBe(ts);
  });

  it('rejects invalid timestamp strings instead of coercing to bucket zero', () => {
    expect(normalizeTimeMs('not-a-timestamp')).toBe(null);
  });
});

describe('extractHistoricalData ISO timestamp regression', () => {
  const { findAllSessionFiles } = require('../../../lib/session-discovery');
  const tempFiles = [];

  afterEach(() => {
    tempFiles.forEach(f => {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    });
    tempFiles.length = 0;
    findAllSessionFiles.mockReset();
  });

  it('buckets ISO timestamps by their actual UTC hour, not epoch zero', async () => {
    const file = writeTemp([
      JSON.stringify({
        type: 'message',
        message: {
          model: 'claude',
          provider: 'anthropic',
          timestamp: '2026-07-10T05:00:00Z',
          usage: { input: 1, output: 1, totalTokens: 2 }
        }
      })
    ]);
    tempFiles.push(file);
    findAllSessionFiles.mockReturnValue([{ path: file, source: 'pi' }]);

    const data = await extractHistoricalData();

    expect(data.length).toBe(1);
    const expectedMs = new Date('2026-07-10T05:00:00Z').getTime();
    const expectedBucket = Math.floor(expectedMs / (3600 * 1000)) * (3600 * 1000);
    expect(data[0].time).toBe(expectedBucket);
    expect(data[0].total).toBe(2);
  });

  it('handles a mix of numeric epoch-ms and ISO-string timestamps', async () => {
    const t1 = new Date('2026-07-10T05:00:00Z');
    const t2 = new Date('2026-07-10T05:30:00Z'); // same UTC hour bucket
    const otherHour = new Date('2026-07-10T07:00:00Z'); // different bucket

    const file = writeTemp([
      JSON.stringify({
        type: 'message',
        message: {
          model: 'claude',
          provider: 'anthropic',
          timestamp: t1.getTime(),
          usage: { input: 100, output: 100, totalTokens: 200 }
        }
      }),
      JSON.stringify({
        type: 'message',
        message: {
          model: 'gpt-4',
          provider: 'openai',
          timestamp: t2.toISOString(),
          usage: { input: 50, output: 50, totalTokens: 100 }
        }
      }),
      JSON.stringify({
        type: 'message',
        message: {
          model: 'gemini',
          provider: 'google',
          timestamp: otherHour.getTime(),
          usage: { input: 10, output: 10, totalTokens: 20 }
        }
      })
    ]);
    tempFiles.push(file);
    findAllSessionFiles.mockReturnValue([{ path: file, source: 'pi' }]);

    const data = await extractHistoricalData();

    expect(data.length).toBe(2);

    const bucket1 = Math.floor(t1.getTime() / (3600 * 1000)) * (3600 * 1000);
    const bucket2 = Math.floor(otherHour.getTime() / (3600 * 1000)) * (3600 * 1000);

    const b1 = data.find(b => b.time === bucket1);
    const b2 = data.find(b => b.time === bucket2);

    expect(b1).toBeDefined();
    expect(b2).toBeDefined();
    expect(b1.total).toBe(300);
    expect(b2.total).toBe(20);
  });

  it('ignores events with invalid timestamps', async () => {
    const file = writeTemp([
      JSON.stringify({
        type: 'message',
        message: {
          model: 'claude',
          provider: 'anthropic',
          timestamp: 'invalid',
          usage: { input: 1, output: 1, totalTokens: 2 }
        }
      })
    ]);
    tempFiles.push(file);
    findAllSessionFiles.mockReturnValue([{ path: file, source: 'pi' }]);

    const data = await extractHistoricalData();

    expect(data.length).toBe(0);
  });
});
