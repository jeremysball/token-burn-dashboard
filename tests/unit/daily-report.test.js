// tests/unit/daily-report.test.js (Part 1 — pure summary builder)
import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { buildDailyReportSummary, renderDailyFieldReport, resetDailyFieldReportForTest } from '../../dashboard/js/daily-report.js';

const H = 3600 * 1000;

describe('buildDailyReportSummary', () => {
  it('returns null when there are no historical buckets for today', () => {
    const longAgo = Date.UTC(2020, 0, 1, 10);
    const fileHistoricalData = [{ time: longAgo, total: 1000, tokens_by_model: { 'a/model': 1000 } }];
    expect(buildDailyReportSummary({ pricing_by_model: {} }, fileHistoricalData)).toBeNull();
  });

  it('picks the highest-total bucket among today\'s buckets as the peak hour', () => {
    const now = Date.now();
    const todayMidnightUTC = Math.floor(now / (24 * H)) * 24 * H;
    const fileHistoricalData = [
      { time: todayMidnightUTC + 9 * H, total: 50000, tokens_by_model: { 'a/model-1': 50000 } },
      { time: todayMidnightUTC + 14 * H, total: 200000, tokens_by_model: { 'a/model-1': 152000, 'a/model-2': 48000 } }
    ];
    const currentData = {
      pricing_by_model: {
        'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        'a/model-2': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }
      }
    };

    const summary = buildDailyReportSummary(currentData, fileHistoricalData, now);

    expect(summary.peakHour.hour).toBe(14);
    expect(summary.peakHour.totalTokens).toBe(200000);
    expect(summary.peakHour.tokenShareByModel['a/model-1']).toBeCloseTo(0.76, 2);
    expect(summary.totalTokensToday).toBe(250000);
  });

  it('computes a token-weighted cost share for the peak hour distinct from token share', () => {
    const now = Date.now();
    const todayMidnightUTC = Math.floor(now / (24 * H)) * 24 * H;
    // model-1 has far more tokens but model-2 is priced much higher per token,
    // so cost share should skew toward model-2 relative to its token share.
    const fileHistoricalData = [
      { time: todayMidnightUTC + 14 * H, total: 110000, tokens_by_model: { 'a/model-1': 100000, 'a/model-2': 10000 } }
    ];
    const currentData = {
      pricing_by_model: {
        'a/model-1': { input: 0.5, output: 1, cacheRead: 0.05, cacheWrite: 0.6 },
        'a/model-2': { input: 20, output: 40, cacheRead: 2, cacheWrite: 25 }
      }
    };

    const summary = buildDailyReportSummary(currentData, fileHistoricalData, now);

    expect(summary.peakHour.tokenShareByModel['a/model-2']).toBeCloseTo(10000 / 110000, 2);
    expect(summary.peakHour.costShareByModel['a/model-2']).toBeGreaterThan(summary.peakHour.tokenShareByModel['a/model-2']);
  });

  it('computes a baseline mean/stddev across the full supplied history, not just today', () => {
    const now = Date.now();
    const todayMidnightUTC = Math.floor(now / (24 * H)) * 24 * H;
    const fileHistoricalData = [
      { time: todayMidnightUTC - 24 * H, total: 100000, tokens_by_model: {} },
      { time: todayMidnightUTC - 12 * H, total: 100000, tokens_by_model: {} },
      { time: todayMidnightUTC + 9 * H, total: 100000, tokens_by_model: { 'a/model-1': 100000 } }
    ];
    const summary = buildDailyReportSummary({ pricing_by_model: {} }, fileHistoricalData, now);

    expect(summary.baseline.meanHourlyTokens).toBeCloseTo(100000, 0);
    expect(summary.baseline.stddevHourlyTokens).toBeCloseTo(0, 0);
  });
});

describe('renderDailyFieldReport', () => {
  let container;
  const H2 = 3600 * 1000;

  beforeEach(() => {
    resetDailyFieldReportForTest();
    document.body.innerHTML = '<section id="daily-report-section"></section>';
    container = document.getElementById('daily-report-section');
  });

  const summaryFixture = () => {
    const now = Date.now();
    const todayMidnightUTC = Math.floor(now / (24 * H2)) * 24 * H2;
    return [{ time: todayMidnightUTC + 10 * H2, total: 5000, tokens_by_model: { 'a/model-1': 5000 } }];
  };

  it('shows a "not enough data" state when there is nothing for today', () => {
    renderDailyFieldReport(container, { pricing_by_model: {} }, []);
    expect(container.querySelector('#dailyFieldReportBody').textContent).toMatch(/not enough data/i);
  });

  it('renders the returned paragraph on a successful fetch', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ insights: 'A **quiet** day.', source: 'taskferry' }), { status: 200 })));
    renderDailyFieldReport(container, { pricing_by_model: {} }, summaryFixture());
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(container.querySelector('#dailyFieldReportBody').innerHTML).toContain('<b>quiet</b>');
  });

  it('shows a visible error and a retry control on dispatch failure, never a fabricated report', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: 'AI report generation unavailable' }), { status: 503 })));
    renderDailyFieldReport(container, { pricing_by_model: {} }, summaryFixture());
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(container.querySelector('#dailyFieldReportBody').textContent).toMatch(/failed/i);
    expect(container.querySelector('#dailyFieldReportRetry')).not.toBeNull();
  });

  it('replaces the "not enough data" placeholder with a real report when data arrives on a later render', async () => {
    // Regression guard for the brief's not-enough-data + later-data race:
    // the not-enough-data branch must NOT set the dailyReportBuilt flag,
    // otherwise the next call that finds data would skip the build and
    // crash trying to populate a #dailyFieldReportDate element that the
    // placeholder markup doesn't include.
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ insights: 'A **quiet** day.', source: 'taskferry' }), { status: 200 })));
    renderDailyFieldReport(container, { pricing_by_model: {} }, []);
    expect(container.querySelector('#dailyFieldReportBody').textContent).toMatch(/not enough data/i);
    expect(container.querySelector('#dailyFieldReportDate')).toBeNull();

    renderDailyFieldReport(container, { pricing_by_model: {} }, summaryFixture());
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(container.querySelector('#dailyFieldReportBody').innerHTML).toContain('<b>quiet</b>');
    expect(container.querySelector('#dailyFieldReportDate')).not.toBeNull();
  });
});
