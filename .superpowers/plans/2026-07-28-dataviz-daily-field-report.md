# Daily Field Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new dashboard section showing one taskferry-generated editorial paragraph per day, contrasting token-share vs. cost-share for the day's peak hour and refusing to hype a spike whose z-score is statistically unremarkable even if its ratio looks dramatic.

**Architecture:** The existing `handleInsightsAnalyzeRoute` / `runTaskferryAnalysis` taskferry-dispatch machinery in `lib/routes/api.js` is generalized to accept a pluggable prompt builder and scratch-file serializer (previously hardcoded to the deep-insights shape), then reused for a new `/api/insights/daily-report` route with its own prompt and its own client-computed summary shape. The frontend computes today's peak hour, per-model token/cost share at that hour, and a fleet-wide hourly mean/stddev baseline (for the prompt to reason about z-scores from), then POSTs that summary and renders the returned paragraph — caching it per calendar day.

**Tech Stack:** Node `http`/`child_process` (existing `lib/routes/api.js` patterns), taskferry CLI, vanilla ES modules, `bun:test` + `happy-dom`.

## Global Constraints

- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 2 ("Daily field report") and Section 5 ("Taskferry dispatch failure").
- **No silent fallback on dispatch failure** — matches the existing `handleInsightsAnalyzeRoute` convention exactly: surface a real, visible error state in the widget ("report generation failed"), never fabricated placeholder narrative text.
- The prompt must specifically instruct the model to contrast token-share vs. cost-share for the day's peak hour, and to downgrade any spike whose z-score (computed by the model from the supplied mean/stddev) is unremarkable despite a dramatic ratio — this is prompt-engineering guidance over raw numbers, the same pattern `buildAnalysisPrompt` already uses for the existing deep-insights route (it doesn't precompute insights server-side either; it hands the model schema + raw numbers + instructions).
- Reuses `TASKFERRY_INSIGHTS_MODEL` / `TASKFERRY_DISPATCH_TIMEOUT_MS` / `TASKFERRY_WAIT_TIMEOUT_MS` / `TASKFERRY_RESULT_TIMEOUT_MS` from `lib/config.js` — no new env vars.

---

### Task 1: Generalize `runTaskferryAnalysis` and add the daily-report route

**Files:**
- Modify: `lib/routes/api.js`
- Modify: `server.js`
- Test: `tests/unit/lib/routes/api.test.js`

**Interfaces:**
- Produces: `handleDailyReportRoute(req, res, requestTimeout): Promise<void>`, exported from `lib/routes/api.js` and wired into `server.js` at `POST /api/insights/daily-report`. Request body shape (validated by `validateDailyReportSummary`):

```
{
  date: string,               // "YYYY-MM-DD", UTC calendar day
  totalTokensToday: number,
  totalCostToday: number,
  topModelToday: string,
  peakHour: {
    hour: number,              // 0-23, UTC
    totalTokens: number,
    tokenShareByModel: Record<string, number>,  // fractions, sum ~1
    costShareByModel: Record<string, number>    // fractions, sum ~1
  },
  baseline: { meanHourlyTokens: number, stddevHourlyTokens: number },
  hourlyBuckets: Array<{ hour: number, totalTokens: number }>  // today's buckets, chronological
}
```

Response shape matches the existing `/api/insights/analyze` route: `{ insights: string, source: 'taskferry' }` on success, `{ error: string }` with a 4xx/503 status on failure.

- [ ] **Step 1: Write the failing tests**

```js
// Add to tests/unit/lib/routes/api.test.js — read the existing file first to
// match its describe()/mock-execFile conventions for handleInsightsAnalyzeRoute
// exactly (same execFileImpl mock shape, same fs/path/crypto impl mocks), then
// add a parallel describe block:

describe('handleDailyReportRoute', () => {
  const validSummary = {
    date: '2026-07-28',
    totalTokensToday: 500000,
    totalCostToday: 4.2,
    topModelToday: 'anthropic/claude-sonnet-5',
    peakHour: {
      hour: 14,
      totalTokens: 200000,
      tokenShareByModel: { 'anthropic/claude-sonnet-5': 0.76, 'kimi/k2p5': 0.24 },
      costShareByModel: { 'anthropic/claude-sonnet-5': 0.6, 'kimi/k2p5': 0.4 }
    },
    baseline: { meanHourlyTokens: 90000, stddevHourlyTokens: 30000 },
    hourlyBuckets: [{ hour: 13, totalTokens: 80000 }, { hour: 14, totalTokens: 200000 }]
  };

  it('rejects a malformed body with 400 before dispatching anything', async () => {
    // reuse the same makeReq/makeRes test helpers already in this file for
    // handleInsightsAnalyzeRoute's 400 test, with body: JSON.stringify({ date: 123 })
    // assert status 400 and that execFileImpl was never called.
  });

  it('dispatches taskferry with a daily-report-shaped prompt and returns its message on success', async () => {
    // mock execFileImpl to answer 'dispatch' -> 'id: task-1\n', 'wait' -> 'status: done\n',
    // 'result' -> 'message: "A quiet day..."\n' (matching the existing route's TOON-parsing test)
    // assert response body === { insights: 'A quiet day...', source: 'taskferry' }
    // assert the prompt passed to execFileImpl's 'dispatch' call's --prompt argument
    // contains 'token-share' and 'cost-share' and 'z-score'.
  });

  it('returns 503 without a silent fallback when taskferry dispatch fails', async () => {
    // mock execFileImpl's dispatch call to error; assert status 503 and
    // response body.error is a string (not a fabricated report paragraph).
  });
});
```

Read `tests/unit/lib/routes/api.test.js` in full before writing this block, so the request/response test doubles match the file's existing helpers exactly (do not invent a second mocking style in the same file).

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/lib/routes/api.test.js`
Expected: FAIL — `handleDailyReportRoute` is not exported from `lib/routes/api.js` yet.

- [ ] **Step 3: Generalize `runTaskferryAnalysis`**

In `lib/routes/api.js`, change `runTaskferryAnalysis`'s signature and body (`lib/routes/api.js:105-199`) so the NDJSON-serialization and prompt-building steps are pluggable, defaulting to today's exact behavior for the existing deep-insights route:

```js
/**
 * Default scratch-file serializer for the deep-insights route's summary
 * shape (one JSON object per line: meta, then one per model, then one per
 * history bucket) — see the file-level comment on the original implementation
 * for why NDJSON instead of one JSON blob.
 * @param {any} summary
 * @returns {string}
 */
function serializeInsightsSummary(summary) {
  const lines = [
    JSON.stringify({ type: 'meta', totals: summary.totals, modelCount: summary.modelCount, cacheRate: summary.cacheRate, inputOutputRatio: summary.inputOutputRatio }),
    ...summary.models.map((/** @type {any} */ m) => JSON.stringify({ type: 'model', ...m })),
    ...summary.history.map((/** @type {any} */ h) => JSON.stringify({ type: 'history', ...h }))
  ];
  return lines.join('\n') + '\n';
}

/**
 * @param {any} summary
 * @param {typeof execFile} execFileImpl
 * @param {typeof fs} fsImpl
 * @param {typeof path} pathImpl
 * @param {typeof crypto} cryptoImpl
 * @param {Res} [res]
 * @param {{buildPrompt?: (summary: any, dataFilePath: string) => string, serialize?: (summary: any) => string, filePrefix?: string}} [opts]
 */
async function runTaskferryAnalysis(summary, execFileImpl, fsImpl, pathImpl, cryptoImpl, res, opts = {}) {
  const {
    buildPrompt = buildTaskferryPrompt,
    serialize = serializeInsightsSummary,
    filePrefix = 'insights-data'
  } = opts;

  fsImpl.mkdirSync(TASKFERRY_SCRATCH_DIR, { recursive: true });

  const dataFilePath = pathImpl.join(TASKFERRY_SCRATCH_DIR, `${filePrefix}-${cryptoImpl.randomUUID()}.ndjson`);

  let writeSucceeded = false;
  let taskCompleted = false;
  try {
    fsImpl.writeFileSync(dataFilePath, serialize(summary));
    writeSucceeded = true;

    const prompt = buildPrompt(summary, dataFilePath);

    const dispatchOut = await execFileP(execFileImpl, 'taskferry', [
      'dispatch',
      '--prompt', prompt,
      '--model', TASKFERRY_INSIGHTS_MODEL,
      '--directory', TASKFERRY_SCRATCH_DIR
    ], { timeout: TASKFERRY_DISPATCH_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf-8' });

    const taskId = (dispatchOut.match(/^id: (\S+)/m) || [])[1];
    if (!taskId) {
      throw new Error('taskferry dispatch did not return a task id');
    }

    if (res) {
      res.once('close', () => {
        if (taskCompleted) return;
        execFileImpl('taskferry', ['cancel', taskId], {}, () => {});
      });
    }

    const waitOut = await execFileP(execFileImpl, 'taskferry', ['wait', taskId], {
      timeout: TASKFERRY_WAIT_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf-8'
    });

    const status = (waitOut.match(/^status: (\S+)/m) || [])[1];
    if (status !== 'done') {
      throw new Error(`taskferry task ${taskId} did not complete (status: ${status || 'unknown'})`);
    }

    const resultOut = await execFileP(execFileImpl, 'taskferry', ['result', taskId, '--fields', 'message'], {
      timeout: TASKFERRY_RESULT_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf-8'
    });

    const messageMatch = resultOut.match(/^message: (.*)$/m);
    if (!messageMatch) {
      throw new Error(`taskferry result for task ${taskId} had no message field`);
    }
    const rawValue = messageMatch[1];
    const result = rawValue.startsWith('"') ? JSON.parse(rawValue) : rawValue;
    taskCompleted = true;
    return result;
  } finally {
    if (writeSucceeded && fsImpl.existsSync(dataFilePath)) {
      fsImpl.unlink(dataFilePath, err => {
        if (err) console.error(`Failed to clean up insights scratch file ${dataFilePath}:`, err);
      });
    }
  }
}
```

This is a pure refactor of the existing function body (the NDJSON-building lines move into `serializeInsightsSummary`, called via `opts.serialize`'s default); the existing `/api/insights/analyze` route's behavior is unchanged, since `createInsightsHandler`'s call site doesn't pass `opts` and picks up the same defaults.

- [ ] **Step 4: Add `validateDailyReportSummary` and the daily-report prompt builders**

In `lib/routes/api.js`, add after `validateInsightsSummary` (`lib/routes/api.js:218-254`):

```js
/**
 * @param {any} summary
 * @returns {string | null}
 */
function validateDailyReportSummary(summary) {
  if (!summary || typeof summary !== 'object') return 'summary must be an object';
  if (typeof summary.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(summary.date)) return 'summary.date must be a YYYY-MM-DD string';
  if (typeof summary.totalTokensToday !== 'number') return 'summary.totalTokensToday must be a number';
  if (typeof summary.totalCostToday !== 'number') return 'summary.totalCostToday must be a number';
  if (typeof summary.topModelToday !== 'string') return 'summary.topModelToday must be a string';
  const { peakHour, baseline, hourlyBuckets } = summary;
  if (!peakHour || typeof peakHour !== 'object') return 'summary.peakHour must be an object';
  if (typeof peakHour.hour !== 'number') return 'summary.peakHour.hour must be a number';
  if (typeof peakHour.totalTokens !== 'number') return 'summary.peakHour.totalTokens must be a number';
  if (!peakHour.tokenShareByModel || typeof peakHour.tokenShareByModel !== 'object') return 'summary.peakHour.tokenShareByModel must be an object';
  if (!peakHour.costShareByModel || typeof peakHour.costShareByModel !== 'object') return 'summary.peakHour.costShareByModel must be an object';
  if (!baseline || typeof baseline !== 'object') return 'summary.baseline must be an object';
  if (typeof baseline.meanHourlyTokens !== 'number') return 'summary.baseline.meanHourlyTokens must be a number';
  if (typeof baseline.stddevHourlyTokens !== 'number') return 'summary.baseline.stddevHourlyTokens must be a number';
  if (!Array.isArray(hourlyBuckets)) return 'summary.hourlyBuckets must be an array';
  for (let i = 0; i < hourlyBuckets.length; i++) {
    const h = hourlyBuckets[i];
    if (!h || typeof h !== 'object' || typeof h.hour !== 'number' || typeof h.totalTokens !== 'number') {
      return `summary.hourlyBuckets[${i}] must be {hour: number, totalTokens: number}`;
    }
  }
  return null;
}

/**
 * @param {any} summary
 * @param {string} dataFilePath
 * @returns {string}
 */
function buildDailyReportPrompt(summary, dataFilePath) {
  return `You are a data analyst writing a short "field report" for an LLM token-usage dashboard, running as an UNATTENDED background task.

HARD RULE: this is a read-only analysis task. You may read exactly one file — ${dataFilePath} — and must not read, write, or modify any other file, run any shell command, or use any other tool. Respond with ONLY the report paragraph described below — no preamble, no markdown fencing, no heading.

**Complete input data:** ${dataFilePath} (one JSON object, the full summary for ${summary.date}).

**What to write:** ONE tight paragraph, 4-6 sentences, in a slightly wry field-report voice (see the style notes below). Use ONLY numbers derivable from the file — do not invent model names, dollar figures, or events.

**Required content:**
1. Open with a one-clause characterization of the day's overall shape (quiet, steady, spiky, etc.), grounded in totalTokensToday vs baseline.meanHourlyTokens × 24.
2. Name topModelToday and its role in the day.
3. Contrast peakHour.tokenShareByModel against peakHour.costShareByModel for the SAME peak hour — call out explicitly if the model that dominated token volume is different from the model that dominated dollar cost that hour (a model can burn most of the tokens while a pricier model quietly burns most of the dollars, or vice versa). If the two shares roughly agree, say so instead of forcing a contrast that isn't there.
4. For every hour in hourlyBuckets, compute z = (totalTokens - baseline.meanHourlyTokens) / baseline.stddevHourlyTokens (treat stddevHourlyTokens <= 0 as "no baseline, skip z-score commentary"). If the hour with the highest raw totalTokens has |z| < 2, say so explicitly and do NOT describe it as a dramatic spike — a big-looking hour that's still within normal variance should read as unremarkable, not alarming. Only call something a real spike if |z| >= 2.

**Style:** Direct, specific, numbers-first. Markdown bold (**text**) for model names and key numbers. No bullet points — this is prose, one paragraph.`;
}
```

- [ ] **Step 5: Add `createDailyReportHandler` and wire it into `server.js`**

In `lib/routes/api.js`, add after `createInsightsHandler`/`handleInsightsAnalyzeRoute` (`lib/routes/api.js:363-414`):

```js
function createDailyReportHandler({ execFileImpl = execFile, fsImpl = fs, pathImpl = path, cryptoImpl = crypto } = {}) {
  /**
   * Handle /api/insights/daily-report route
   * @param {Req} req
   * @param {Res} res
   * @param {NodeJS.Timeout | undefined} requestTimeout
   */
  async function handleDailyReportRoute(req, res, requestTimeout) {
    try {
      const body = await readInsightsRequestBody(req, res, requestTimeout);
      if (body === null) return; // 413 already sent

      let summary;
      try {
        summary = JSON.parse(body);
      } catch {
        sendError(res, requestTimeout, 400, 'Invalid request body');
        return;
      }

      const validationError = validateDailyReportSummary(summary);
      if (validationError) {
        sendError(res, requestTimeout, 400, `Invalid request body: ${validationError}`);
        return;
      }

      try {
        const insights = await runTaskferryAnalysis(summary, execFileImpl, fsImpl, pathImpl, cryptoImpl, res, {
          buildPrompt: buildDailyReportPrompt,
          serialize: (s) => JSON.stringify(s, null, 2),
          filePrefix: 'daily-report-data'
        });
        clearTimeout(requestTimeout);
        if (res.writableEnded) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ insights, source: 'taskferry' }));
      } catch (err) {
        console.error('Taskferry daily-report analysis failed:', err);
        sendError(res, requestTimeout, 503, 'AI report generation unavailable');
      }
    } catch (err) {
      console.error('handleDailyReportRoute error:', err);
      sendError(res, requestTimeout, 500, 'Internal server error');
    }
  }

  return handleDailyReportRoute;
}

const handleDailyReportRoute = createDailyReportHandler();
```

At the bottom of `lib/routes/api.js`, add `handleDailyReportRoute` to `module.exports` alongside the existing `handleInsightsAnalyzeRoute` entry.

In `server.js`:
- Add `handleDailyReportRoute` to the destructured import on line 16.
- On line 55, widen the long-timeout check so the daily-report route also gets `INSIGHTS_REQUEST_TIMEOUT` instead of the default (it dispatches the same kind of taskferry worker):

```js
    const isInsightsAnalyze = (url.pathname === '/api/insights/analyze' || url.pathname === '/api/insights/daily-report') && req.method === 'POST';
```

- Add the route block right after the existing `/api/insights/analyze` block (`server.js:98-102`):

```js
  if (url.pathname === '/api/insights/daily-report' && req.method === 'POST') {
    const result = await handleDailyReportRoute(req, res, requestTimeout);
    logResponse(res.statusCode);
    return result;
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/unit/lib/routes/api.test.js`
Expected: PASS (all existing tests still pass, plus the 3 new ones)

- [ ] **Step 7: Run the full unit suite to catch regressions from the `runTaskferryAnalysis` refactor**

Run: `bun run test`
Expected: PASS — in particular, every existing `/api/insights/analyze` test in `tests/unit/lib/routes/api.test.js` and `tests/unit/api.test.js` still passes unchanged, confirming the refactor preserved that route's exact prior behavior.

- [ ] **Step 8: Commit**

```bash
git add lib/routes/api.js server.js tests/unit/lib/routes/api.test.js
git commit -m "feat(api): add the taskferry-backed daily field report route"
```

---

### Task 2: Frontend — compute the daily summary and render the report

**Files:**
- Create: `dashboard/js/daily-report.js`
- Modify: `dashboard/index.html`
- Modify: `dashboard/js/views/dashboard.js`
- Modify: `dashboard/styles/design-v2.css`
- Test: `tests/unit/daily-report.test.js`

**Interfaces:**
- Produces:
  - `buildDailyReportSummary(currentData, fileHistoricalData): object|null` — pure function. Returns `null` when there's no data for today's UTC calendar day yet (caller shows a "not enough data yet" state instead of dispatching). Otherwise returns the exact shape `validateDailyReportSummary` (Task 1) accepts.
  - `renderDailyFieldReport(container: HTMLElement, currentData, fileHistoricalData): void` — called on every `renderDashboard()`. Generates and POSTs the summary at most once per UTC calendar day (cached in module state keyed by `summary.date`), showing a loading state while in flight and a visible error (with a Retry control) on failure — never a silently fabricated paragraph.

- [ ] **Step 1: Write the failing tests for `buildDailyReportSummary`**

```js
// tests/unit/daily-report.test.js (Part 1 — pure summary builder)
import { describe, expect, it } from 'bun:test';
import { buildDailyReportSummary } from '../../dashboard/js/daily-report.js';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/daily-report.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/daily-report.js'`

- [ ] **Step 3: Write `buildDailyReportSummary`**

```js
// dashboard/js/daily-report.js (Part 1 of 2 — pure summary builder; the
// render/fetch half is added in Step 5 below)

import { calculateCostWithPricing } from './modelsdev-pricing.js';
import { meanStddev } from './utils.js';

/** @param {number} ms @returns {string} */
function toUtcDateKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

/**
 * @param {Record<string, number>} tokensByModel
 * @param {Record<string, any>} pricingByModel
 * @returns {{tokenShareByModel: Record<string, number>, costShareByModel: Record<string, number>}}
 */
function computeShares(tokensByModel, pricingByModel) {
    const totalTokens = Object.values(tokensByModel).reduce((a, b) => a + b, 0) || 1;
    /** @type {Record<string, number>} */
    const tokenShareByModel = {};
    /** @type {Record<string, number>} */
    const costByModel = {};
    let totalCost = 0;

    for (const [model, tokens] of Object.entries(tokensByModel)) {
        tokenShareByModel[model] = tokens / totalTokens;
        // Hourly buckets carry total tokens per model without a per-type
        // (input/output/cache/reasoning) split, so we approximate cost via
        // calculateCostWithPricing's blended rate (input+output when only a
        // total is available) — more accurate than input-only pricing.
        const cost = calculateCostWithPricing(tokens, pricingByModel?.[model] || null).total;
        costByModel[model] = cost;
        totalCost += cost;
    }

    /** @type {Record<string, number>} */
    const costShareByModel = {};
    for (const [model, cost] of Object.entries(costByModel)) {
        costShareByModel[model] = totalCost > 0 ? cost / totalCost : tokenShareByModel[model];
    }

    return { tokenShareByModel, costShareByModel };
}

/**
 * @param {any} currentData
 * @param {Array<{time: number, total: number, tokens_by_model?: Record<string, number>}>} fileHistoricalData
 * @returns {object|null}
 */
export function buildDailyReportSummary(currentData, fileHistoricalData, now = Date.now()) {
    if (!fileHistoricalData || fileHistoricalData.length === 0) return null;

    const todayKey = toUtcDateKey(now);
    // Cache date-key lookups per unique timestamp to avoid repeated
    // Date+toISOString allocations on every bucket every 5s render.
    /** @type {Map<number, string>} */
    const dateKeyCache = new Map();
    const cachedDateKey = (ms) => {
        let k = dateKeyCache.get(ms);
        if (k === undefined) { k = toUtcDateKey(ms); dateKeyCache.set(ms, k); }
        return k;
    };
    const todaysBuckets = fileHistoricalData.filter((b) => cachedDateKey(b.time) === todayKey);
    if (todaysBuckets.length === 0) return null;

    const pricingByModel = currentData?.pricing_by_model || {};

    const hourlyBuckets = todaysBuckets
        .slice()
        .sort((a, b) => a.time - b.time)
        .map((b) => ({ hour: new Date(b.time).getUTCHours(), totalTokens: b.total || 0 }));

    const peakBucket = todaysBuckets.slice().sort((a, b) => (b.total || 0) - (a.total || 0))[0];
    const { tokenShareByModel, costShareByModel } = computeShares(peakBucket.tokens_by_model || {}, pricingByModel);

    const totalTokensToday = todaysBuckets.reduce((sum, b) => sum + (b.total || 0), 0);
    /** @type {Record<string, number>} */
    const tokensByModelToday = {};
    for (const bucket of todaysBuckets) {
        for (const [model, tokens] of Object.entries(bucket.tokens_by_model || {})) {
            tokensByModelToday[model] = (tokensByModelToday[model] || 0) + tokens;
        }
    }
    const topModelToday = Object.entries(tokensByModelToday).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';

    let totalCostToday = 0;
    for (const [model, tokens] of Object.entries(tokensByModelToday)) {
        totalCostToday += calculateCostWithPricing(tokens, pricingByModel?.[model] || null).total;
    }

    const { mean: meanHourlyTokens, stddev: stddevHourlyTokens } = meanStddev(fileHistoricalData.map((b) => b.total || 0));

    return {
        date: todayKey,
        totalTokensToday,
        totalCostToday,
        topModelToday,
        peakHour: {
            hour: new Date(peakBucket.time).getUTCHours(),
            totalTokens: peakBucket.total || 0,
            tokenShareByModel,
            costShareByModel
        },
        baseline: { meanHourlyTokens, stddevHourlyTokens },
        hourlyBuckets
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/daily-report.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the render/fetch half, section markup, and CSS**

Append to `dashboard/js/daily-report.js`:

```js
// dashboard/js/daily-report.js (Part 2 of 2 — widget wiring, appended below Part 1)

import { createTaskferryReportWidget } from './report-widget.js';
import { ensureWidgetBuilt } from './utils.js';
const dailyReport = createTaskferryReportWidget({
    endpoint: '/api/insights/daily-report',
    cacheKeyField: 'date',
    bodyId: 'dailyFieldReportBody',
    dateLabelId: 'dailyFieldReportDate',
    retryId: 'dailyFieldReportRetry',
    containerId: 'daily-field-report-container',
    loadingText: "Loading today's field report…",
    headingFor: (d) => `FIELD REPORT // ${d}`,
    notEnoughText: () => null,
    buildFlag: 'dailyReportBuilt'
});

/** @type {string|null} */
let lastBuiltDateKey = null;

/**
 * @param {HTMLElement} container
 * @param {any} currentData
 * @param {any[]} fileHistoricalData
 */
export function renderDailyFieldReport(container, currentData, fileHistoricalData) {
    // C19-2: compute today's UTC date key in O(1) instead of building the
    // full summary just to check the cache — the summary is only built when
    // we know we need a new report.
    const todayKey = new Date().toISOString().slice(0, 10);
    if (lastBuiltDateKey === todayKey) return;

    const summary = buildDailyReportSummary(currentData, fileHistoricalData);
    if (!summary) {
        ensureWidgetBuilt(container, 'dailyReportBuilt', (c) => {
            c.innerHTML = '<div class="field-report" id="dailyFieldReport">'
                + '<div id="dailyFieldReportBody">Not enough data yet for a report today.</div></div>';
        });
        return;
    }

    lastBuiltDateKey = todayKey;
    dailyReport.render(container, summary);
}

export const resetDailyFieldReportForTest = () => {
    lastBuiltDateKey = null;
    dailyReport.resetForTest();
};
```
`notEnoughText: () => null` matches this plan's upstream null guard at `buildDailyReportSummary` (~line 369, returns `null` when there's no data for today's UTC calendar day yet) — the render side has no separate empty-state logic.

In `dashboard/index.html`, add the section after `live-feed-section` (or, if that plan hasn't landed, after the hero section):

```html
            <!-- Daily Field Report -->
            <section class="daily-report-section" id="daily-report-section"></section>
```

In `dashboard/styles/design-v2.css`, add:

```css
.field-report {
  background: var(--mono-surface);
  border: 1px solid var(--mono-border);
  border-radius: var(--radius-lg);
  border-top: 3px solid var(--mono-accent);
  padding: 22px 24px;
  font-size: 0.9rem;
  line-height: 1.75;
  color: var(--mono-text);
  margin-bottom: 24px;
}
.field-report .fr-date { color: var(--mono-text-muted); font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 12px; }
.field-report b { color: var(--mono-accent); }
```

- [ ] **Step 6: Add shared helpers to `dashboard/js/utils.js`**

Add `ensureWidgetBuilt`, `meanStddev`, and `formatMarkdownBoldToHtml` to `dashboard/js/utils.js` (at the bottom, before the closing of the file). `meanStddev` delegates to the existing exported `computeSeriesStats` in `dashboard/js/views/analytics/tabs/spikes.js:52` — import it into utils.js:

```js
import { computeSeriesStats } from './views/analytics/tabs/spikes.js';

// ===== WIDGET HELPERS =====
/**
 * Ensure a widget's DOM is built exactly once by checking/setting a data-* flag.
 * @param {HTMLElement} container
 * @param {string} flagName   dataset key, e.g. 'dailyReportBuilt'
 * @param {(container: HTMLElement) => void} buildFn
 */
export const ensureWidgetBuilt = (container, flagName, buildFn) => {
    if (container.dataset[flagName] !== 'true') {
        buildFn(container);
        container.dataset[flagName] = 'true';
    }
};

// ===== STATISTICS =====
/**
 * Delegates to the existing computeSeriesStats() core formula, adapting
 * shapes at the boundary: computeSeriesStats expects an array of
 * {total: number} points (it reads p.total) and returns {mean, std, count},
 * not the plain-number-array-in / {mean, stddev}-out shape this call site
 * and its callers use — verified directly against
 * dashboard/js/views/analytics/tabs/spikes.js:52-61, not assumed.
 * @param {number[]} values
 * @returns {{mean: number, stddev: number}}
 */
export const meanStddev = (values) => {
    const { mean, std } = computeSeriesStats((values || []).map((v) => ({ total: v })));
    return { mean, stddev: std };
};

// ===== MARKDOWN HELPERS =====
/**
 * Convert markdown bold to HTML <b>. Mirrors the existing field-report
 * response renderers. Pattern-only transform with no content escaping —
 * preserves current behavior on untrusted taskferry output.
 * @param {string} text
 * @returns {string}
 */
export function formatMarkdownBoldToHtml(text) {
    return text.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
```

Add unit tests for these helpers to `tests/unit/utils.test.js`:

```js
import { describe, expect, it } from 'bun:test';
import { meanStddev, formatMarkdownBoldToHtml } from '../../dashboard/js/utils.js';

describe('meanStddev', () => {
  it('returns correct mean and stddev for a populated array', () => {
    const { mean, stddev } = meanStddev([10, 20, 30]);
    expect(mean).toBeCloseTo(20, 5);
    expect(stddev).toBeCloseTo(8.165, 2);
  });

  it('returns zeros for an empty array', () => {
    const { mean, stddev } = meanStddev([]);
    expect(mean).toBe(0);
    expect(stddev).toBe(0);
  });

  it('returns zero stddev for a single value', () => {
    const { mean, stddev } = meanStddev([42]);
    expect(mean).toBe(42);
    expect(stddev).toBe(0);
  });
});

describe('formatMarkdownBoldToHtml', () => {
  it('converts a single bold pair', () => {
    expect(formatMarkdownBoldToHtml('hello **world**')).toBe('hello <b>world</b>');
  });

  it('converts multiple bold pairs', () => {
    expect(formatMarkdownBoldToHtml('**a** and **b**')).toBe('<b>a</b> and <b>b</b>');
  });

  it('returns text unchanged when there are no bold markers', () => {
    expect(formatMarkdownBoldToHtml('no bold here')).toBe('no bold here');
  });
});
```

- [ ] **Step 7: Create `dashboard/js/report-widget.js`**

Create `dashboard/js/report-widget.js` with the `createTaskferryReportWidget` factory (this factory imports `formatMarkdownBoldToHtml` and `ensureWidgetBuilt` from `./utils.js`):

```js
import { formatMarkdownBoldToHtml, ensureWidgetBuilt } from './utils.js';

/**
 * @typedef {object} ReportWidgetOptions
 * @property {string} endpoint
 * @property {string} cacheKeyField           'date' or 'weekEndDay' — which summary field
 *                                            identifies the cached bucket
 * @property {string} bodyId
 * @property {string} dateLabelId
 * @property {string} retryId
 * @property {string} containerId
 * @property {string} loadingText
 * @property {(cacheKeyValue: string) => string} headingFor
 * @property {(summary: any) => string|null} notEnoughText    returns null if summary is acceptable,
 *                                                             returns a message string if not enough
 * @property {string} buildFlag                                 e.g. 'dailyReportBuilt'
 */

/**
 * @param {ReportWidgetOptions} opts
 * @returns {{
 *   render: (container: HTMLElement, summary: any) => void,
 *   resetForTest: () => void
 * }}
 */
export function createTaskferryReportWidget(opts) {
    let cached = null;
    let inFlight = null;

    function build(container) {
        container.innerHTML = `
            <div class="field-report" id="${opts.containerId.replace(/-container$/, '')}">
                <div class="fr-date" id="${opts.dateLabelId}"></div>
                <div id="${opts.bodyId}">${opts.loadingText}</div>
            </div>
        `;
    }

    async function fetchAndRender(container, summary) {
        const cacheKeyValue = summary[opts.cacheKeyField];
        inFlight = cacheKeyValue;
        const bodyEl = container.querySelector(`#${opts.bodyId}`);
        bodyEl.textContent = opts.loadingText;
        try {
            const res = await fetch(opts.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(summary)
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Server error: ${res.status}`);
            }
            const data = await res.json();
            cached = { [opts.cacheKeyField]: cacheKeyValue, text: data.insights };
            renderCached(container);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            bodyEl.innerHTML = `<span style="color: var(--mono-danger, #ef4444);">Report generation failed: ${message}</span> `
                + `<button type="button" class="retry-btn" id="${opts.retryId}">↻ Retry</button>`;
            container.querySelector(`#${opts.retryId}`)?.addEventListener('click', () => fetchAndRender(container, summary));
        } finally {
            inFlight = null;
        }
    }

    function renderCached(container) {
        if (!cached) return;
        const cacheKeyValue = cached[opts.cacheKeyField];
        container.querySelector(`#${opts.dateLabelId}`).textContent = opts.headingFor(cacheKeyValue);
        container.querySelector(`#${opts.bodyId}`).innerHTML = formatMarkdownBoldToHtml(cached.text);
    }

    function render(container, summary) {
        ensureWidgetBuilt(container, opts.buildFlag, build);

        const noData = opts.notEnoughText(summary);
        if (noData !== null) {
            container.querySelector(`#${opts.bodyId}`).textContent = noData;
            return;
        }

        const cacheKeyValue = summary[opts.cacheKeyField];
        if (cached?.[opts.cacheKeyField] === cacheKeyValue) {
            renderCached(container);
            return;
        }
        if (inFlight === cacheKeyValue) return;
        fetchAndRender(container, summary);
    }

    function resetForTest() {
        cached = null;
        inFlight = null;
    }

    return { render, resetForTest };
}
```

- [ ] **Step 8: Add `tests/unit/report-widget.test.js`**

Create `tests/unit/report-widget.test.js` covering: empty-summary short-circuit, build-once, body text on success, error path with retry, in-flight de-duplication, cache-hit served from memory, and `resetForTest` clearing state:

```js
import { describe, expect, it, beforeEach, mock } from 'bun:test';
import { createTaskferryReportWidget } from '../../dashboard/js/report-widget.js';

describe('createTaskferryReportWidget', () => {
  let container;
  let widget;

  beforeEach(() => {
    document.body.innerHTML = '<div id="test-container"></div>';
    container = document.getElementById('test-container');
    widget = createTaskferryReportWidget({
      endpoint: '/api/test-report',
      cacheKeyField: 'date',
      bodyId: 'testBody',
      dateLabelId: 'testDate',
      retryId: 'testRetry',
      containerId: 'test-container',
      loadingText: 'Loading…',
      headingFor: (d) => `REPORT // ${d}`,
      notEnoughText: (s) => (s.data ? null : 'Not enough data'),
      buildFlag: 'testBuilt'
    });
  });

  it('shows notEnoughText when the summary is insufficient', () => {
    widget.render(container, { data: null });
    expect(container.querySelector('#testBody').textContent).toBe('Not enough data');
  });

  it('builds the widget DOM exactly once', () => {
    widget.render(container, { date: '2026-07-28', data: true });
    widget.render(container, { date: '2026-07-28', data: true });
    expect(container.querySelectorAll('.field-report').length).toBe(1);
  });

  it('renders body text on a successful fetch', async () => {
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ insights: 'A **quiet** day.' }), { status: 200 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#testBody').innerHTML).toContain('<b>quiet</b>');
  });

  it('shows an error and retry control on fetch failure', async () => {
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#testBody').textContent).toMatch(/failed/i);
    expect(container.querySelector('#testRetry')).not.toBeNull();
  });

  it('de-duplicates in-flight requests for the same cache key', () => {
    globalThis.fetch = mock(() => new Promise(() => {})); // never resolves
    widget.render(container, { date: '2026-07-28', data: true });
    widget.render(container, { date: '2026-07-28', data: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('serves a cache hit from memory without fetching', async () => {
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ insights: 'Cached.' }), { status: 200 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    globalThis.fetch = mock(() => { throw new Error('should not be called'); });
    widget.render(container, { date: '2026-07-28', data: true });
    expect(container.querySelector('#testBody').innerHTML).toContain('Cached.');
  });

  it('clears state on resetForTest', async () => {
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ insights: 'Done.' }), { status: 200 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    widget.resetForTest();
    globalThis.fetch = mock(() => Promise.resolve(
      new Response(JSON.stringify({ insights: 'Fresh.' }), { status: 200 })
    ));
    widget.render(container, { date: '2026-07-28', data: true });
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('#testBody').innerHTML).toContain('Fresh.');
  });
});
```

- [ ] **Step 9: Write the failing integration test for the render/fetch half**

```js
// Append to tests/unit/daily-report.test.js
import { beforeEach, mock } from 'bun:test';
import { renderDailyFieldReport, resetDailyFieldReportForTest } from '../../dashboard/js/daily-report.js';

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
});
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `bun test tests/unit/daily-report.test.js`
Expected: PASS (7 tests total)

- [ ] **Step 11: Wire into `renderDashboard()`**

In `dashboard/js/views/dashboard.js`, add the import:

```js
import { renderDailyFieldReport } from '../daily-report.js';
```

`renderDashboard`'s parameter list only has `currentData`/`historyData` in module scope; it also needs `fileHistoricalData`, already imported at the top of the file (`dashboard/js/views/dashboard.js:3`). Inside `renderDashboard`, right after the live-event-feed call added by that plan (or, if not yet landed, right after `updateBurnRateGauge();`), add:

```js
    const dailyReportSection = document.getElementById('daily-report-section');
    if (dailyReportSection) renderDailyFieldReport(dailyReportSection, cd, fileHistoricalData);
```

- [ ] **Step 12: Run the full unit suite to catch regressions**

Run: `bun run test`
Expected: PASS

- [ ] **Step 13: Add a Playwright check**

In `tests/playwright-fixtures.js`, add route stubs for both endpoints next to the existing `**/api/insights/analyze`-style stubs (there isn't one for `/api/insights/analyze` currently in that file — add both, following the same `page.route(...)` pattern as the other stubs in `routeDashboardApis`):

```js
  await page.route('**/api/insights/analyze', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ insights: 'Mock analysis result.', source: 'taskferry' })
    });
  });
  await page.route('**/api/insights/daily-report', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ insights: 'A quiet day, nothing dramatic.', source: 'taskferry' })
    });
  });
```

In `tests/playwright/overflow.spec.js`, inside `test.describe('no horizontal overflow on critical selectors', ...)`, add:

```js
  test('daily field report', async ({ page }) => {
    await expect(page.locator('#dailyFieldReportBody')).not.toBeEmpty({ timeout: 10000 });
    await expectNoOverflow(page, '.field-report');
  });
```

- [ ] **Step 14: Run the Playwright suite**

Run: `bun run test:e2e`
Expected: PASS

- [ ] **Step 15: Commit**

```bash
git add dashboard/js/daily-report.js dashboard/js/report-widget.js dashboard/js/utils.js dashboard/index.html dashboard/js/views/dashboard.js dashboard/styles/design-v2.css tests/unit/daily-report.test.js tests/unit/report-widget.test.js tests/unit/utils.test.js tests/playwright-fixtures.js tests/playwright/overflow.spec.js
git commit -m "feat(dashboard): add the daily field report widget"
```
