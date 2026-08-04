# Weekly Field Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A taskferry-generated weekly narrative paragraph in Analytics > Insights, alongside the title belt — the story counterpart to the daily field report, reasoning across a multi-week baseline (mean/stddev of trailing weeks) and same-calendar-position recurrence patterns instead of restating a longer version of the daily report.

**Architecture:** Reuses `dashboard/js/title-belt.js`'s `computeWeekWindow()` (this-week/last-week per-model deltas) and the generalized `runTaskferryAnalysis` dispatch machinery from the daily-field-report plan, adding multi-week baseline statistics (mean/stddev across trailing weeks), same-calendar-position recurrence detection, and a distinct weekly-trend prompt.

**Tech Stack:** Node `http`/`child_process` (`lib/routes/api.js`), taskferry CLI, vanilla ES modules, `bun:test` + `happy-dom`.

## Global Constraints

- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 3 ("Weekly field report (paragraph)") and Section 5 ("Taskferry dispatch failure").
- Depends on `.superpowers/plans/2026-07-28-dataviz-weekly-title-belt.md` having merged first — reuses `WEEKLY_HISTORY_DAYS` (`dashboard/js/config.js`) and `computeWeekWindow` (`dashboard/js/title-belt.js`).
- Depends on `.superpowers/plans/2026-07-28-dataviz-daily-field-report.md` having merged first — reuses the generalized `runTaskferryAnalysis(summary, execFileImpl, fsImpl, pathImpl, cryptoImpl, res, opts)` signature from `lib/routes/api.js`, and shared helpers `cacheHitRatePct`, `formatMarkdownBoldToHtml` from `dashboard/js/utils.js` plus `createTaskferryReportWidget`, `ensureWidgetBuilt` from `dashboard/js/report-widget.js`.
- **Documented data-availability constraint:** `weeklyData` is capped at `WEEKLY_HISTORY_DAYS` (15) daily snapshots, yielding up to two complete trailing weeks plus a partial current week — enough for a **multi-week baseline** (mean/stddev of the trailing complete weeks, excluding the current one) and a **same-calendar-position recurrence check** (compare each day in the current week against the same position in every trailing week, flag positions that are ≥2σ above the trailing mean). This matches the spec's Section 3 requirements (multi-week baseline for cache-efficiency drift; anomaly recurrence at the same calendar position across weeks) without fabricating data the snapshot window cannot provide.
- No silent fallback on dispatch failure — same convention as the daily field report and the existing `/api/insights/analyze` route.

---

### Task 1: Backend — weekly-report prompt, validation, and route

**Files:**
- Modify: `lib/routes/api.js`
- Modify: `server.js`
- Test: `tests/unit/lib/routes/api.test.js`

**Interfaces:**
- Produces: `handleWeeklyReportRoute(req, res, requestTimeout): Promise<void>`, wired to `POST /api/insights/weekly-report`. Request body shape (validated by `validateWeeklyReportSummary`):

```
{
  weekEndDay: string,
  totalTokensThisWeek: number,
  totalTokensLastWeek: number|null,
  growthPct: number|null,
  weeklyBaselineGrowthMean: number|null,     // mean growth% across trailing weeks
  weeklyBaselineGrowthStddev: number|null,    // stddev of growth% across trailing weeks
  cacheHitRateThisWeekPct: number,
  cacheHitRateLastWeekPct: number|null,
  weeklyBaselineCacheMean: number|null,       // mean cache rate across trailing weeks
  weeklyBaselineCacheStddev: number|null,     // stddev of cache rate across trailing weeks
  dailyTokensThisWeek: number[],              // 7 values, oldest to newest
  dailyTokensLastWeek: number[]|null,         // 7 values, oldest to newest, or null
  dailyPositionRecurrentFlags: boolean[],     // 7 values: true if position ≥2σ above trailing mean
  topModelThisWeek: string,
  modelShareThisWeek: Record<string, number>  // fractions, sum ~1
}
```

- [ ] **Step 1: Write the failing tests**

```js
// Add to tests/unit/lib/routes/api.test.js, mirroring the handleDailyReportRoute
// describe block added by the daily-field-report plan (same execFileImpl mock
// shape) — read that block first so the two stay consistent, then add:

describe('handleWeeklyReportRoute', () => {
  const validSummary = {
    weekEndDay: '2026-07-28',
    totalTokensThisWeek: 4200000000,
    totalTokensLastWeek: 3900000000,
    growthPct: 7.7,
    weeklyBaselineGrowthMean: 5.0,
    weeklyBaselineGrowthStddev: 2.1,
    cacheHitRateThisWeekPct: 98.5,
    cacheHitRateLastWeekPct: 97.1,
    weeklyBaselineCacheMean: 97.8,
    weeklyBaselineCacheStddev: 0.5,
    dailyTokensThisWeek: [500e6, 600e6, 580e6, 620e6, 610e6, 640e6, 650e6],
    dailyTokensLastWeek: [480e6, 550e6, 560e6, 590e6, 570e6, 580e6, 570e6],
    dailyPositionRecurrentFlags: [false, false, false, false, false, false, false],
    topModelThisWeek: 'anthropic/claude-sonnet-5',
    modelShareThisWeek: { 'anthropic/claude-sonnet-5': 0.76, 'kimi/k2p5': 0.24 }
  };

  it('rejects a malformed body with 400 before dispatching anything', async () => {
    // body: JSON.stringify({ weekEndDay: 123 }); assert 400, execFileImpl never called.
  });

  it('dispatches taskferry with a weekly-trend-shaped prompt and returns its message on success', async () => {
    // same TOON mock chain as handleDailyReportRoute's success test; assert the
    // dispatched --prompt argument contains 'week over week' and 'cache-efficiency'.
  });

  it('returns 503 without a silent fallback when taskferry dispatch fails', async () => {
    // assert 503 and a real error string, no fabricated paragraph.
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/lib/routes/api.test.js`
Expected: FAIL — `handleWeeklyReportRoute` is not exported yet.

- [ ] **Step 3: Add validation and the prompt builder**

In `lib/routes/api.js`, add after `buildDailyReportPrompt` (added by the daily-field-report plan):

```js
/**
 * @param {any} summary
 * @returns {string | null}
 */
function validateWeeklyReportSummary(summary) {
  if (!summary || typeof summary !== 'object') return 'summary must be an object';
  if (typeof summary.weekEndDay !== 'string') return 'summary.weekEndDay must be a string';
  if (typeof summary.totalTokensThisWeek !== 'number') return 'summary.totalTokensThisWeek must be a number';
  if (summary.totalTokensLastWeek !== null && typeof summary.totalTokensLastWeek !== 'number') return 'summary.totalTokensLastWeek must be a number or null';
  if (summary.growthPct !== null && typeof summary.growthPct !== 'number') return 'summary.growthPct must be a number or null';
  if (summary.weeklyBaselineGrowthMean !== null && typeof summary.weeklyBaselineGrowthMean !== 'number') return 'summary.weeklyBaselineGrowthMean must be a number or null';
  if (summary.weeklyBaselineGrowthStddev !== null && typeof summary.weeklyBaselineGrowthStddev !== 'number') return 'summary.weeklyBaselineGrowthStddev must be a number or null';
  if (typeof summary.cacheHitRateThisWeekPct !== 'number') return 'summary.cacheHitRateThisWeekPct must be a number';
  if (summary.cacheHitRateLastWeekPct !== null && typeof summary.cacheHitRateLastWeekPct !== 'number') return 'summary.cacheHitRateLastWeekPct must be a number or null';
  if (summary.weeklyBaselineCacheMean !== null && typeof summary.weeklyBaselineCacheMean !== 'number') return 'summary.weeklyBaselineCacheMean must be a number or null';
  if (summary.weeklyBaselineCacheStddev !== null && typeof summary.weeklyBaselineCacheStddev !== 'number') return 'summary.weeklyBaselineCacheStddev must be a number or null';
  if (!Array.isArray(summary.dailyTokensThisWeek) || summary.dailyTokensThisWeek.length !== 7 || !summary.dailyTokensThisWeek.every((/** @type {any} */ n) => typeof n === 'number')) {
    return 'summary.dailyTokensThisWeek must be an array of 7 numbers';
  }
  if (summary.dailyTokensLastWeek !== null && (!Array.isArray(summary.dailyTokensLastWeek) || summary.dailyTokensLastWeek.length !== 7 || !summary.dailyTokensLastWeek.every((/** @type {any} */ n) => typeof n === 'number'))) {
    return 'summary.dailyTokensLastWeek must be an array of 7 numbers, or null';
  }
  if (!Array.isArray(summary.dailyPositionRecurrentFlags) || summary.dailyPositionRecurrentFlags.length !== 7 || !summary.dailyPositionRecurrentFlags.every((/** @type {any} */ v) => typeof v === 'boolean')) {
    return 'summary.dailyPositionRecurrentFlags must be an array of 7 booleans';
  }
  if (typeof summary.topModelThisWeek !== 'string') return 'summary.topModelThisWeek must be a string';
  if (!summary.modelShareThisWeek || typeof summary.modelShareThisWeek !== 'object') return 'summary.modelShareThisWeek must be an object';
  return null;
}

/**
 * @param {any} summary
 * @param {string} dataFilePath
 * @returns {string}
 */
function buildWeeklyReportPrompt(summary, dataFilePath) {
  return `You are a data analyst writing a short weekly "field report" for an LLM token-usage dashboard, running as an UNATTENDED background task.

HARD RULE: this is a read-only analysis task. You may read exactly one file — ${dataFilePath} — and must not read, write, or modify any other file, run any shell command, or use any other tool. Respond with ONLY the report paragraph described below — no preamble, no markdown fencing, no heading.

**Complete input data:** ${dataFilePath} (one JSON object, the full weekly summary ending ${summary.weekEndDay}).

**What to write:** ONE paragraph, 5-7 sentences, genuinely reasoning at WEEK scale — this is explicitly NOT a longer version of a daily report. Use ONLY numbers derivable from the file.

**Required content (this is what makes it week-scale, not day-scale):**
1. Compare growthPct against the multi-week baseline mean (weeklyBaselineGrowthMean) and characterize the current week as accelerating, decelerating, or inline with the historical pattern — use weeklyBaselineGrowthStddev to gauge significance.
2. Compare cacheHitRateThisWeekPct against the multi-week baseline (weeklyBaselineCacheMean) and call out any real drift (a change of more than ~1 percentage point is worth naming; smaller than that, say cache discipline "held steady"). Use weeklyBaselineCacheStddev to gauge significance.
3. For each day in dailyTokensThisWeek, check whether it is ≥2σ above the same-calendar-position mean across trailing weeks (dailyPositionRecurrentFlags, 7 booleans). Name any positions flagged as recurrent; if none recur, say so instead of inventing a pattern.
4. Name topModelThisWeek and its share from modelShareThisWeek.

**Style:** Direct, specific, numbers-first. Markdown bold (**text**) for model names and key numbers. No bullet points — this is prose, one paragraph.`;
}
```

- [ ] **Step 4: Add `createWeeklyReportHandler` and wire it into `server.js`**

In `lib/routes/api.js`, add after `createDailyReportHandler`/`handleDailyReportRoute`:

```js
function createWeeklyReportHandler({ execFileImpl = execFile, fsImpl = fs, pathImpl = path, cryptoImpl = crypto } = {}) {
  /**
   * Handle /api/insights/weekly-report route
   * @param {Req} req
   * @param {Res} res
   * @param {NodeJS.Timeout | undefined} requestTimeout
   */
  async function handleWeeklyReportRoute(req, res, requestTimeout) {
    try {
      const body = await readInsightsRequestBody(req, res, requestTimeout);
      if (body === null) return;

      let summary;
      try {
        summary = JSON.parse(body);
      } catch {
        sendError(res, requestTimeout, 400, 'Invalid request body');
        return;
      }

      const validationError = validateWeeklyReportSummary(summary);
      if (validationError) {
        sendError(res, requestTimeout, 400, `Invalid request body: ${validationError}`);
        return;
      }

      try {
        const insights = await runTaskferryAnalysis(summary, execFileImpl, fsImpl, pathImpl, cryptoImpl, res, {
          buildPrompt: buildWeeklyReportPrompt,
          serialize: (s) => JSON.stringify(s, null, 2),
          filePrefix: 'weekly-report-data'
        });
        clearTimeout(requestTimeout);
        if (res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ insights, source: 'taskferry' }));
      } catch (err) {
        console.error('Taskferry weekly-report analysis failed:', err);
        sendError(res, requestTimeout, 503, 'AI report generation unavailable');
      }
    } catch (err) {
      console.error('handleWeeklyReportRoute error:', err);
      sendError(res, requestTimeout, 500, 'Internal server error');
    }
  }

  return handleWeeklyReportRoute;
}

const handleWeeklyReportRoute = createWeeklyReportHandler();
```

Add `handleWeeklyReportRoute` to `module.exports` in `lib/routes/api.js`.

In `server.js`:
- Add `handleWeeklyReportRoute` to the destructured import on line 16.
- Widen the long-timeout check again (`server.js:55`, already touched by the daily-field-report plan):

```js
    const isInsightsAnalyze = ['/api/insights/analyze', '/api/insights/daily-report', '/api/insights/weekly-report'].includes(url.pathname) && req.method === 'POST';
```

- Add the route block after the daily-report block:

```js
  if (url.pathname === '/api/insights/weekly-report' && req.method === 'POST') {
    const result = await handleWeeklyReportRoute(req, res, requestTimeout);
    logResponse(res.statusCode);
    return result;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/lib/routes/api.test.js`
Expected: PASS

- [ ] **Step 6: Run the full unit suite**

Run: `bun run test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add lib/routes/api.js server.js tests/unit/lib/routes/api.test.js
git commit -m "feat(api): add the taskferry-backed weekly field report route"
```

---

### Task 2: Frontend — compute the weekly summary and render the report

**Files:**
- Create: `dashboard/js/weekly-report.js`
- Modify: `dashboard/index.html`
- Modify: `dashboard/js/views/analytics.js`
- Modify: `dashboard/styles/design-v2.css`
- Test: `tests/unit/weekly-report.test.js`

**Interfaces:**
- Produces:
  - `buildWeeklyReportSummary(weeklyData): object|null` — pure function, `null` when `computeWeekWindow(weeklyData)` returns `null` (fewer than 8 daily snapshots).
  - `renderWeeklyFieldReport(container: HTMLElement, weeklyData): void` — called whenever the Insights tab renders. Fetches/caches at most once per `weekEndDay`, mirroring the daily report's cache-and-retry pattern.

- [ ] **Step 1: Write the failing tests for the summary builder**

```js
// tests/unit/weekly-report.test.js (Part 1 — pure summary builder)
import { describe, expect, it } from 'bun:test';
import { buildWeeklyReportSummary } from '../../dashboard/js/weekly-report.js';

function fixtureWeeklyData(days, perDayGrowth) {
  const out = [];
  const cumulative = {};
  for (const name of Object.keys(perDayGrowth)) cumulative[name] = 0;
  let cumulativeTotal = 0;
  for (let d = 0; d < days; d++) {
    const models = {};
    for (const [name, growth] of Object.entries(perDayGrowth)) {
      cumulative[name] += growth;
      cumulativeTotal += growth;
      models[name] = { total: cumulative[name], input: cumulative[name], output: 0, cache_read: 0, cache_write: 0 };
    }
    out.push({ day: `d${d}`, tokens: cumulativeTotal, models });
  }
  return out;
}

describe('buildWeeklyReportSummary', () => {
  it('returns null with fewer than 8 daily snapshots', () => {
    expect(buildWeeklyReportSummary(fixtureWeeklyData(5, { 'a/model-1': 1000 }))).toBeNull();
  });

  it('reports totalTokensLastWeek and growthPct as null with only one week of history', () => {
    const summary = buildWeeklyReportSummary(fixtureWeeklyData(8, { 'a/model-1': 1000 }));
    expect(summary.totalTokensThisWeek).toBeGreaterThan(0);
    expect(summary.totalTokensLastWeek).toBeNull();
    expect(summary.growthPct).toBeNull();
    expect(summary.dailyTokensLastWeek).toBeNull();
  });

  it('computes growthPct and 7-value daily breakdowns once 15+ snapshots exist', () => {
    const summary = buildWeeklyReportSummary(fixtureWeeklyData(15, { 'a/model-1': 1000 }));
    expect(summary.dailyTokensThisWeek.length).toBe(7);
    expect(summary.dailyTokensLastWeek.length).toBe(7);
    expect(summary.growthPct).toBeCloseTo(0, 0); // flat linear growth -> ~0% week-over-week change
  });

  it('names the highest-token model as topModelThisWeek', () => {
    const summary = buildWeeklyReportSummary(fixtureWeeklyData(15, { 'a/model-1': 1000, 'a/model-2': 200 }));
    expect(summary.topModelThisWeek).toBe('a/model-1');
  });

  it('computes multi-week baseline mean and stddev for growth and cache rate with 15+ snapshots', () => {
    const summary = buildWeeklyReportSummary(fixtureWeeklyData(15, { 'a/model-1': 1000 }));
    expect(summary.weeklyBaselineGrowthMean).not.toBeNull();
    expect(summary.weeklyBaselineGrowthStddev).not.toBeNull();
    expect(summary.weeklyBaselineCacheMean).not.toBeNull();
    expect(summary.weeklyBaselineCacheStddev).not.toBeNull();
  });

  it('returns all-true dailyPositionRecurrentFlags when current week is flat and trailing weeks were zero', () => {
    const out = [];
    for (let d = 0; d < 22; d++) {
      out.push({ day: `d${d}`, tokens: d < 15 ? 1000 : 2000, models: { 'a/model-1': { total: d < 15 ? 1000 : 2000, input: d < 15 ? 1000 : 2000, output: 0, cache_read: 0, cache_write: 0 } } });
    }
    const summary = buildWeeklyReportSummary(out);
    expect(summary.dailyPositionRecurrentFlags.length).toBe(7);
    expect(summary.dailyPositionRecurrentFlags.some((f) => f)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/weekly-report.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/weekly-report.js'`

- [ ] **Step 3: Write `buildWeeklyReportSummary`**

```js
// dashboard/js/weekly-report.js (Part 1 of 2 — pure summary builder)
import { computeWeekWindow } from './title-belt.js';
import { cacheHitRatePct } from './utils.js';

/**
 * Day-over-day .tokens deltas for `count` consecutive days ending right
 * before weeklyData[endIdxExclusive]. Requires weeklyData[endIdxExclusive - count - 1]
 * to exist as the predecessor for the first delta.
 * @param {any[]} weeklyData
 * @param {number} endIdxExclusive
 * @param {number} count
 * @returns {number[]|null}
 */
function dailyDeltas(weeklyData, endIdxExclusive, count) {
    const startIdx = endIdxExclusive - count;
    if (startIdx - 1 < 0) return null;
    const deltas = [];
    for (let i = startIdx; i < endIdxExclusive; i++) {
        deltas.push(Math.max(0, (weeklyData[i]?.tokens || 0) - (weeklyData[i - 1]?.tokens || 0)));
    }
    return deltas;
}

/**
 * Returns all overlapping week windows from weeklyData (each 7 consecutive days),
 * skipping the last (current) week. Used to compute multi-week baselines.
 * @param {any[]} weeklyData
 * @returns {Array<{thisWeek: Record<string, object>, lastWeek: Record<string, object>|null, weekEndDay: string}>}
 */
function computeAllWeekWindows(weeklyData) {
    const windows = [];
    for (let endIdx = weeklyData.length; endIdx >= 7; endIdx -= 7) {
        const weekDays = weeklyData.slice(endIdx - 7, endIdx);
        const thisWeek = {};
        for (const day of weekDays) {
            for (const [name, stats] of Object.entries(day.models || {})) {
                thisWeek[name] = thisWeek[name] || { total: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
                thisWeek[name].total += stats.total || 0;
                thisWeek[name].input += stats.input || 0;
                thisWeek[name].output += stats.output || 0;
                thisWeek[name].cache_read += stats.cache_read || 0;
                thisWeek[name].cache_write += stats.cache_write || 0;
            }
        }
        const prevDays = weeklyData.slice(endIdx - 14, endIdx - 7);
        const lastWeek = prevDays.length === 7 ? (() => {
            const lw = {};
            for (const day of prevDays) {
                for (const [name, stats] of Object.entries(day.models || {})) {
                    lw[name] = lw[name] || { total: 0, input: 0, output: 0, cache_read: 0, cache_write: 0 };
                    lw[name].total += stats.total || 0;
                    lw[name].input += stats.input || 0;
                    lw[name].output += stats.output || 0;
                    lw[name].cache_read += stats.cache_read || 0;
                    lw[name].cache_write += stats.cache_write || 0;
                }
            }
            return lw;
        })() : null;
        windows.push({ thisWeek, lastWeek, weekEndDay: weekDays[weekDays.length - 1]?.day || '' });
    }
    return windows;
}

/**
 * @param {any[]} weeklyData
 * @returns {object|null}
 */
export function buildWeeklyReportSummary(weeklyData) {
    const window = computeWeekWindow(weeklyData);
    if (!window) return null;

    const { thisWeek, lastWeek, weekEndDay } = window;

    const totalTokensThisWeek = Object.values(thisWeek).reduce((sum, s) => sum + s.total, 0);
    const totalTokensLastWeek = lastWeek ? Object.values(lastWeek).reduce((sum, s) => sum + s.total, 0) : null;
    const growthPct = totalTokensLastWeek && totalTokensLastWeek > 0
        ? ((totalTokensThisWeek - totalTokensLastWeek) / totalTokensLastWeek) * 100
        : null;

    const cacheRate = (week) => cacheHitRatePct(Object.values(week).reduce((s, m) => s + m.input, 0), Object.values(week).reduce((s, m) => s + m.cache_read, 0));

    const dailyTokensThisWeek = dailyDeltas(weeklyData, weeklyData.length, 7) || [];
    const dailyTokensLastWeek = lastWeek ? dailyDeltas(weeklyData, weeklyData.length - 7, 7) : null;

    // Multi-week baseline: collect per-week growth% and cache rates across all available trailing windows
    const allWindows = computeAllWeekWindows(weeklyData);
    const trailingWindows = allWindows.filter((w) => w.weekEndDay !== weekEndDay && w.lastWeek);

    let weeklyBaselineGrowthMean = null;
    let weeklyBaselineGrowthStddev = null;
    let weeklyBaselineCacheMean = null;
    let weeklyBaselineCacheStddev = null;

    if (trailingWindows.length >= 2) {
        const growths = trailingWindows.map((w) => {
            const thisTotal = Object.values(w.thisWeek).reduce((s, m) => s + m.total, 0);
            const lastTotal = Object.values(w.lastWeek).reduce((s, m) => s + m.total, 0);
            return lastTotal > 0 ? ((thisTotal - lastTotal) / lastTotal) * 100 : 0;
        });
        weeklyBaselineGrowthMean = growths.reduce((s, v) => s + v, 0) / growths.length;
        weeklyBaselineGrowthStddev = Math.sqrt(growths.reduce((s, v) => s + (v - weeklyBaselineGrowthMean) ** 2, 0) / growths.length);

        const caches = trailingWindows.map((w) => cacheRate(w.thisWeek));
        weeklyBaselineCacheMean = caches.reduce((s, v) => s + v, 0) / caches.length;
        weeklyBaselineCacheStddev = Math.sqrt(caches.reduce((s, v) => s + (v - weeklyBaselineCacheMean) ** 2, 0) / caches.length);
    }

    // Daily position recurrence: for each of 7 positions, check if current day ≥2σ above trailing mean
    const dailyPositionRecurrentFlags = [];
    for (let pos = 0; pos < 7; pos++) {
        const trailingValues = trailingWindows
            .map((w) => {
                const deltas = dailyDeltas(weeklyData, allWindows.indexOf(w) * 7 + 7, 7);
                return deltas ? deltas[pos] : null;
            })
            .filter((v) => v !== null);
        if (trailingValues.length >= 2 && dailyTokensThisWeek[pos] !== undefined) {
            const mean = trailingValues.reduce((s, v) => s + v, 0) / trailingValues.length;
            const stddev = Math.sqrt(trailingValues.reduce((s, v) => s + (v - mean) ** 2, 0) / trailingValues.length);
            dailyPositionRecurrentFlags.push(stddev > 0 ? (dailyTokensThisWeek[pos] - mean) / stddev >= 2 : dailyTokensThisWeek[pos] > mean);
        } else {
            dailyPositionRecurrentFlags.push(false);
        }
    }

    const topModelThisWeek = Object.entries(thisWeek).sort((a, b) => b[1].total - a[1].total)[0]?.[0] || 'unknown';
    /** @type {Record<string, number>} */
    const modelShareThisWeek = {};
    for (const [name, stats] of Object.entries(thisWeek)) {
        modelShareThisWeek[name] = totalTokensThisWeek > 0 ? stats.total / totalTokensThisWeek : 0;
    }

    return {
        weekEndDay,
        totalTokensThisWeek,
        totalTokensLastWeek,
        growthPct,
        weeklyBaselineGrowthMean,
        weeklyBaselineGrowthStddev,
        cacheHitRateThisWeekPct: cacheRate(thisWeek),
        cacheHitRateLastWeekPct: lastWeek ? cacheRate(lastWeek) : null,
        weeklyBaselineCacheMean,
        weeklyBaselineCacheStddev,
        dailyTokensThisWeek,
        dailyTokensLastWeek,
        dailyPositionRecurrentFlags,
        topModelThisWeek,
        modelShareThisWeek
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/weekly-report.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the render/fetch half, section markup, and CSS**

Append to `dashboard/js/weekly-report.js`:

```js
// dashboard/js/weekly-report.js (Part 2 of 2 — render/fetch)
import { createTaskferryReportWidget } from './report-widget.js';
import { formatMarkdownBoldToHtml } from './utils.js';

const weeklyReport = createTaskferryReportWidget({
    endpoint: '/api/insights/weekly-report',
    cacheKeyField: 'weekEndDay',
    bodyId: 'weeklyFieldReportBody',
    dateLabelId: 'weeklyFieldReportDate',
    retryId: 'weeklyFieldReportRetry',
    containerId: 'weekly-field-report-container',
    loadingText: "Loading this week's field report…",
    headingFor: (d) => `FIELD REPORT // WEEK ENDING ${d}`,
    notEnoughText: (summary) => summary ? null : 'Not enough history yet for a weekly report.',
    buildFlag: 'weeklyReportBuilt'
});
export const renderWeeklyFieldReport = weeklyReport.render;
export const resetWeeklyFieldReportForTest = weeklyReport.resetForTest;
```

In `dashboard/index.html`, add the section inside `#analytics-tab-insights`, right after `#weekly-title-belt-container` (added by the weekly-title-belt plan):

```html
                <div id="weekly-field-report-container"></div>
```

`dashboard/styles/design-v2.css` needs no new CSS here — this widget reuses the `.field-report` class already added by the daily-field-report plan.

- [ ] **Step 6: Write the failing integration tests for the render/fetch half**

```js
// Append to tests/unit/weekly-report.test.js
import { beforeEach, mock } from 'bun:test';
import { renderWeeklyFieldReport, resetWeeklyFieldReportForTest } from '../../dashboard/js/weekly-report.js';

describe('renderWeeklyFieldReport', () => {
  let container;

  beforeEach(() => {
    resetWeeklyFieldReportForTest();
    document.body.innerHTML = '<div id="weekly-field-report-container"></div>';
    container = document.getElementById('weekly-field-report-container');
  });

  it('shows a "not enough history" state with fewer than 8 daily snapshots', () => {
    renderWeeklyFieldReport(container, fixtureWeeklyData(3, { 'a/model-1': 1000 }));
    expect(container.querySelector('#weeklyFieldReportBody').textContent).toMatch(/not enough history/i);
  });

  it('renders the returned paragraph on a successful fetch', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ insights: 'A **steady** week.', source: 'taskferry' }), { status: 200 })));
    renderWeeklyFieldReport(container, fixtureWeeklyData(15, { 'a/model-1': 1000 }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(container.querySelector('#weeklyFieldReportBody').innerHTML).toContain('<b>steady</b>');
  });

  it('shows a visible error and retry control on dispatch failure', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: 'AI report generation unavailable' }), { status: 503 })));
    renderWeeklyFieldReport(container, fixtureWeeklyData(15, { 'a/model-1': 1000 }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(container.querySelector('#weeklyFieldReportBody').textContent).toMatch(/failed/i);
    expect(container.querySelector('#weeklyFieldReportRetry')).not.toBeNull();
  });
});
```

(`fixtureWeeklyData` here is the same helper defined in Part 1 of this test file — no need to redefine it.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test tests/unit/weekly-report.test.js`
Expected: PASS (9 tests total)

- [ ] **Step 8: Wire into the Insights tab**

In `dashboard/js/views/analytics.js`, add the import:

```js
import { renderWeeklyFieldReport } from '../weekly-report.js';
```

Extend the `'insights'` case again (already touched by the weekly-title-belt plan):

```js
        case 'insights':
            renderDeepInsightsTab();
            renderTitleBelt(document.getElementById('weekly-title-belt-container'), weeklyData, currentData?.pricing_by_model);
            renderWeeklyFieldReport(document.getElementById('weekly-field-report-container'), weeklyData);
            break;
```

- [ ] **Step 9: Run the full unit suite**

Run: `bun run test`
Expected: PASS

- [ ] **Step 10: Add Playwright fixtures and an overflow check**

In `tests/playwright-fixtures.js`, add a route stub next to the daily-report one added by that plan:

```js
  await page.route('**/api/insights/weekly-report', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ insights: 'A steady week, nothing dramatic.', source: 'taskferry' })
    });
  });
```

In `tests/playwright/overflow.spec.js`, add:

```js
  test('weekly field report', async ({ page }) => {
    await page.click('button:has-text("Analytics")');
    await page.click('button:has-text("Insights")');
    await expect(page.locator('#weeklyFieldReportBody')).not.toBeEmpty({ timeout: 10000 });
    await expectNoOverflow(page, '#weekly-field-report-container');
  });
```

- [ ] **Step 11: Run the Playwright suite**

Run: `bun run test:e2e`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add dashboard/js/weekly-report.js dashboard/index.html dashboard/js/views/analytics.js tests/unit/weekly-report.test.js tests/playwright-fixtures.js tests/playwright/overflow.spec.js
git commit -m "feat(dashboard): add the weekly field report widget"
```
