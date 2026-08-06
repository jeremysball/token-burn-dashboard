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

