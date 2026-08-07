/**
 * Tests for API route handlers
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { EventEmitter } from 'events';
import * as path from 'path';
import {
  createDailyReportHandler,
  createInsightsHandler,
  createTokensHandler,
  handleGitBlameRoute
} from '../../../../lib/routes/api';

const gitBlame = require('../../../../lib/git-blame');

function createMockReq(url, headers = { host: 'localhost:7071' }) {
  const req = new EventEmitter();
  req.url = url;
  req.headers = headers;
  req.destroy = mock();
  return req;
}

function createMockRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.headers = null;
  res.body = '';
  res.writableEnded = false;
  res.writeHead = function(status, headers) {
    this.statusCode = status;
    this.headers = headers;
    return this;
  };
  res.end = function(body) {
    this.body = body || '';
    this.writableEnded = true;
    this.emit('finish');
    process.nextTick(() => this.emit('close'));
    return this;
  };
  return res;
}

async function submitSummary(handler, summary, res = createMockRes()) {
  const req = createMockReq('/api/insights/analyze');
  const promise = handler(req, res, undefined);
  req.emit('data', Buffer.from(JSON.stringify(summary)));
  req.emit('end');
  await promise;
  return res;
}

async function submitDailyReport(handler, summary, res = createMockRes()) {
  const req = createMockReq('/api/insights/daily-report');
  const promise = handler(req, res, undefined);
  req.emit('data', Buffer.from(JSON.stringify(summary)));
  req.emit('end');
  await promise;
  return res;
}

function createScratchFs(unlinkError) {
  const files = new Map();
  return {
    files,
    mkdirSync: mock(),
    writeFileSync: mock((filePath, contents) => files.set(filePath, contents)),
    existsSync: mock(filePath => files.has(filePath)),
    unlink: mock((filePath, callback) => {
      if (unlinkError) {
        callback(unlinkError);
        return;
      }
      files.delete(filePath);
      callback(null);
    })
  };
}

const validSummary = {
  totals: {
    tokens: 2_000_000_000,
    input: 1_200_000_000,
    output: 500_000_000,
    cacheRead: 250_000_000,
    cacheWrite: 40_000_000,
    reasoning: 10_000_000,
    cost: { input: 5, output: 4, cache_read: 2, cache_write: 1, reasoning: 0.34, total: 12.34 }
  },
  modelCount: 3,
  cacheRate: 0.4,
  inputOutputRatio: 2.1,
  models: [{
    name: 'gpt-5',
    tokens: { input: 700_000, output: 200_000, cacheRead: 100_000, cacheWrite: 0, reasoning: 0, total: 1_000_000 },
    cost: { input: 0.5, output: 0.5, cacheRead: 0.2, cacheWrite: 0, reasoning: 0.03, total: 1.23 },
    cacheRate: 0.5,
    pricePerMillion: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0, source: 'local' }
  }],
  history: [{ time: 1772949600000, tokens_by_model: { 'gpt-5': 1_000_000 }, total: 1_000_000, input: 700_000, output: 200_000, cache_read: 100_000, cache_write: 0, reasoning: 0 }]
};

describe('handleGitBlameRoute cwd validation', () => {
  let getGitBlameRouteData;
  let getGitBlameCommitDetails;

  beforeEach(() => {
    getGitBlameRouteData = spyOn(gitBlame, 'getGitBlameRouteData').mockReturnValue({ commits: [], projects: [], files: [], directories: [] });
    getGitBlameCommitDetails = spyOn(gitBlame, 'getGitBlameCommitDetails').mockReturnValue({ commit: {}, sessions: [], summary: {} });
  });

  afterEach(() => {
    getGitBlameRouteData.mockRestore();
    getGitBlameCommitDetails.mockRestore();
  });

  it('rejects a cwd outside PROJECT_ROOT with 400 and does not call into git-blame', async () => {
    const req = { url: '/api/git/blame?cwd=/etc', headers: { host: 'localhost:7071' } };
    const res = createMockRes();

    await handleGitBlameRoute(req, res, undefined);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid directory' });
    expect(getGitBlameRouteData).not.toHaveBeenCalled();
  });

  it('rejects a traversal cwd with 400', async () => {
    const req = { url: `/api/git/blame?cwd=${encodeURIComponent('../../etc')}`, headers: { host: 'localhost:7071' } };
    const res = createMockRes();

    await handleGitBlameRoute(req, res, undefined);

    expect(res.statusCode).toBe(400);
    expect(getGitBlameRouteData).not.toHaveBeenCalled();
  });

  it('allows a cwd within PROJECT_ROOT and calls into git-blame', async () => {
    const { PROJECT_ROOT } = require('../../../../lib/config');
    const allowedCwd = path.join(PROJECT_ROOT, 'some-project');
    const req = { url: `/api/git/blame?cwd=${encodeURIComponent(allowedCwd)}`, headers: { host: 'localhost:7071' } };
    const res = createMockRes();

    await handleGitBlameRoute(req, res, undefined);

    expect(res.statusCode).toBe(200);
    expect(getGitBlameRouteData).toHaveBeenCalledWith(30, allowedCwd);
  });

  it('defaults an omitted cwd to PROJECT_ROOT instead of the server process cwd, so the initial page load succeeds', async () => {
    const { PROJECT_ROOT } = require('../../../../lib/config');
    const req = { url: '/api/git/blame?days=30', headers: { host: 'localhost:7071' } };
    const res = createMockRes();

    await handleGitBlameRoute(req, res, undefined);

    expect(res.statusCode).toBe(200);
    expect(getGitBlameRouteData).toHaveBeenCalledWith(30, PROJECT_ROOT);
  });
});

describe('createInsightsHandler request validation', () => {
  it('rejects a body larger than MAX_REQUEST_BODY_BYTES with 413 and destroys the request', async () => {
    const { MAX_REQUEST_BODY_BYTES } = require('../../../../lib/config');
    const execFileImpl = mock();
    const handler = createInsightsHandler({ execFileImpl });
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    const promise = handler(req, res, undefined);
    req.emit('data', Buffer.alloc(MAX_REQUEST_BODY_BYTES + 1, 'a'));
    await promise;

    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body)).toEqual({ error: 'Request body too large' });
    expect(req.destroy).toHaveBeenCalledTimes(1);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a malformed summary with 400 without invoking the injected dependency', async () => {
    const execFileImpl = mock();
    const handler = createInsightsHandler({ execFileImpl });

    const res = await submitSummary(handler, { totals: {} });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a summary missing totals.* numeric fields with 400', async () => {
    const execFileImpl = mock();
    const handler = createInsightsHandler({ execFileImpl });
    const res = await submitSummary(handler, {
      totals: { cost: {} }, modelCount: 1, cacheRate: 0, inputOutputRatio: 0, models: [], history: []
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/totals\.tokens/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a summary missing totals.cost.* numeric fields with 400', async () => {
    const execFileImpl = mock();
    const handler = createInsightsHandler({ execFileImpl });
    const res = await submitSummary(handler, {
      totals: { tokens: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: {} },
      modelCount: 0, cacheRate: 0, inputOutputRatio: 0, models: [], history: []
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/totals\.cost\.total/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a summary with a non-object model entry with 400', async () => {
    const execFileImpl = mock();
    const handler = createInsightsHandler({ execFileImpl });
    const res = await submitSummary(handler, { ...validSummary, models: ['not-an-object'] });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/summary\.models\[0\]/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a summary with a history entry missing numeric total with 400', async () => {
    const execFileImpl = mock();
    const handler = createInsightsHandler({ execFileImpl });
    const res = await submitSummary(handler, { ...validSummary, history: [{ time: 1234, tokens_by_model: {} }] });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/summary\.history\[0\]\.total/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });
});

describe('createInsightsHandler taskferry analysis', () => {
  it('dispatches to taskferry and returns its message as insights text', async () => {
    const { TASKFERRY_INSIGHTS_MODEL, TASKFERRY_SCRATCH_DIR } = require('../../../../lib/config');
    let dataFilePathAtDispatchTime;
    let dataFileContentsAtDispatchTime;
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      const [subcommand] = args;
      if (subcommand === 'dispatch') {
        const promptArg = args[args.indexOf('--prompt') + 1];
        dataFilePathAtDispatchTime = (promptArg.match(/Complete input data:\*\* ([^\n]+)/) || [])[1];
        dataFileContentsAtDispatchTime = fsImpl.files.get(dataFilePathAtDispatchTime).trim().split('\n').map(line => JSON.parse(line));
        process.nextTick(() => callback(null, 'id: oc_test1\nstatus: running\n', ''));
      } else if (subcommand === 'wait') {
        process.nextTick(() => callback(null, 'id: oc_test1\nstatus: done\nexitCode: 0\n', ''));
      } else if (subcommand === 'result') {
        process.nextTick(() => callback(null, `taskId: oc_test1\nstatus: done\nmessage: ${JSON.stringify('**Use fewer big models.**')}\n`, ''));
      } else {
        process.nextTick(() => callback(null, '', ''));
      }
    });

    const res = await submitSummary(createInsightsHandler({ execFileImpl, fsImpl }), validSummary);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ insights: '**Use fewer big models.**', source: 'taskferry' });
    const dispatchCall = execFileImpl.mock.calls.find(call => call[1][0] === 'dispatch');
    expect(dispatchCall[1]).toEqual(expect.arrayContaining(['--model', TASKFERRY_INSIGHTS_MODEL, '--directory', TASKFERRY_SCRATCH_DIR]));
    expect(execFileImpl.mock.calls.find(call => call[1][0] === 'wait')[1]).toEqual(['wait', 'oc_test1']);
    expect(dataFilePathAtDispatchTime).toMatch(new RegExp(`^${TASKFERRY_SCRATCH_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/insights-data-.*\\.ndjson$`));
    expect(dataFileContentsAtDispatchTime[0]).toEqual({ type: 'meta', totals: validSummary.totals, modelCount: validSummary.modelCount, cacheRate: validSummary.cacheRate, inputOutputRatio: validSummary.inputOutputRatio });
    expect(dataFileContentsAtDispatchTime.slice(1, 1 + validSummary.models.length)).toEqual(validSummary.models.map(model => ({ type: 'model', ...model })));
    expect(dataFileContentsAtDispatchTime.slice(1 + validSummary.models.length)).toEqual(validSummary.history.map(history => ({ type: 'history', ...history })));
    expect(fsImpl.existsSync(dataFilePathAtDispatchTime)).toBe(false);
  });

  it('handles a bare (unquoted) TOON message value', async () => {
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      const responses = {
        dispatch: 'id: oc_test3\nstatus: running\n',
        wait: 'id: oc_test3\nstatus: done\nexitCode: 0\n',
        result: 'taskId: oc_test3\nstatus: done\nmessage: OK\n'
      };
      process.nextTick(() => callback(null, responses[args[0]] || '', ''));
    });

    const res = await submitSummary(createInsightsHandler({ execFileImpl, fsImpl }), validSummary);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ insights: 'OK', source: 'taskferry' });
  });

  it('does not leak the raw error message when the taskferry dispatch fails', async () => {
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      if (args[0] === 'dispatch') process.nextTick(() => callback(null, 'id: oc_test2\nstatus: running\n', ''));
      else if (args[0] === 'wait') process.nextTick(() => callback(new Error('TASKFERRY_INTERNAL_FAILURE_SENTINEL')));
      else process.nextTick(() => callback(null, '', ''));
    });
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

    const res = await submitSummary(createInsightsHandler({ execFileImpl, fsImpl }), validSummary);

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: 'AI analysis service unavailable' });
    expect(res.body).not.toContain('TASKFERRY_INTERNAL_FAILURE_SENTINEL');
    consoleErrorSpy.mockRestore();
  });

  it('does not write again if the outer gateway timeout already ended the response', async () => {
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      const responses = {
        dispatch: 'id: oc_test4\nstatus: running\n',
        wait: 'id: oc_test4\nstatus: done\nexitCode: 0\n',
        result: `taskId: oc_test4\nstatus: done\nmessage: ${JSON.stringify('late result')}\n`
      };
      process.nextTick(() => callback(null, responses[args[0]] || '', ''));
    });
    const handler = createInsightsHandler({ execFileImpl, fsImpl });
    const res = createMockRes();
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Gateway timeout' }));
    const writeHeadSpy = spyOn(res, 'writeHead');

    await submitSummary(handler, validSummary, res);

    expect(writeHeadSpy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(504);
    writeHeadSpy.mockRestore();
  });

  it('logs (but does not throw on) a scratch-file cleanup failure', async () => {
    const execFileImpl = mock((file, args, options, callback) => {
      const responses = {
        dispatch: 'id: oc_test5\nstatus: running\n',
        wait: 'id: oc_test5\nstatus: done\nexitCode: 0\n',
        result: `taskId: oc_test5\nstatus: done\nmessage: ${JSON.stringify('ok')}\n`
      };
      process.nextTick(() => callback(null, responses[args[0]] || '', ''));
    });
    const fsImpl = createScratchFs(new Error('EACCES: permission denied'));
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

    const res = await submitSummary(createInsightsHandler({ execFileImpl, fsImpl }), validSummary);

    expect(res.statusCode).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to clean up insights scratch file'), expect.any(Error));
    consoleErrorSpy.mockRestore();
  });

  it('cancels the taskferry worker if the response closes while wait is still pending', async () => {
    let cancelArgs = null;
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      if (args[0] === 'dispatch') process.nextTick(() => callback(null, 'id: oc_test_cancel\nstatus: running\n', ''));
      else if (args[0] === 'cancel') {
        cancelArgs = args;
        process.nextTick(() => callback(null, '', ''));
      }
    });
    const handler = createInsightsHandler({ execFileImpl, fsImpl });
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    handler(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(validSummary)));
    req.emit('end');
    await new Promise(resolve => process.nextTick(resolve));
    await new Promise(resolve => process.nextTick(resolve));
    res.emit('close');

    expect(cancelArgs).toEqual(['cancel', 'oc_test_cancel']);
  });

  // Final-review fix: the cancel listener was registered AFTER the
  // dispatch await, so a 'close' that fired while dispatch was still
  // in flight (e.g. the outer gateway timeout winning the race) was
  // silently dropped — leaving the worker to keep running for up to
  // ~200s after the response had already ended. The new contract
  // registers the cancel listener BEFORE dispatch and re-checks
  // `responseClosed` immediately after dispatch returns, so a close
  // during the dispatch phase also gets the task cancelled.
  it('cancels the taskferry worker if the response closes while dispatch is still in flight', async () => {
    const cancelCalls = [];
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      if (args[0] === 'dispatch') {
        // Emit 'close' on the response synchronously, BEFORE the dispatch
        // callback fires — this simulates the outer-gateway-timeout race
        // where the response ends while we're still waiting for dispatch
        // to return. The original code path would never have observed this
        // close (the cancel listener was attached after the await).
        res.emit('close');
        process.nextTick(() => callback(null, 'id: oc_test_dispatch_close\nstatus: running\n', ''));
      } else if (args[0] === 'cancel') {
        cancelCalls.push(args);
        process.nextTick(() => callback(null, '', ''));
      } else {
        process.nextTick(() => callback(null, '', ''));
      }
    });
    const handler = createInsightsHandler({ execFileImpl, fsImpl });
    const res = createMockRes();
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

    await submitSummary(handler, validSummary, res);

    expect(cancelCalls).toEqual([['cancel', 'oc_test_dispatch_close']]);
    consoleErrorSpy.mockRestore();
  });

  // Final-review fix: the shared runTaskferryAnalysis now rejects blank /
  // non-string results. The deep-insights route (createInsightsHandler) was
  // also vulnerable to the same "200 with empty insights" bug as the
  // daily-report route, so we lock in the same 503 behavior here.
  it('returns 503 (not 200 with empty insights) when taskferry result message is an empty string', async () => {
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      if (args[0] === 'dispatch') process.nextTick(() => callback(null, 'id: oc_blank\nstatus: running\n', ''));
      else if (args[0] === 'wait') process.nextTick(() => callback(null, 'id: oc_blank\nstatus: done\nexitCode: 0\n', ''));
      else if (args[0] === 'result') process.nextTick(() => callback(null, `taskId: oc_blank\nstatus: done\nmessage: ${JSON.stringify('')}\n`, ''));
      else process.nextTick(() => callback(null, '', ''));
    });
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

    const res = await submitSummary(createInsightsHandler({ execFileImpl, fsImpl }), validSummary);

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: 'AI analysis service unavailable' });
    expect(res.body).not.toMatch(/"insights"/);
    consoleErrorSpy.mockRestore();
  });
});

describe('handleDailyReportRoute', () => {
  const validDailyReportSummary = {
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
    const execFileImpl = mock();
    const handler = createDailyReportHandler({ execFileImpl });

    const res = await submitDailyReport(handler, { date: 123 });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('dispatches taskferry with a daily-report-shaped prompt and returns its message on success', async () => {
    const fsImpl = createScratchFs();
    let dispatchPrompt;
    const execFileImpl = mock((file, args, options, callback) => {
      const subcommand = args[0];
      if (subcommand === 'dispatch') {
        dispatchPrompt = args[args.indexOf('--prompt') + 1];
        process.nextTick(() => callback(null, 'id: task-1\nstatus: running\n', ''));
      } else if (subcommand === 'wait') {
        process.nextTick(() => callback(null, 'id: task-1\nstatus: done\nexitCode: 0\n', ''));
      } else if (subcommand === 'result') {
        process.nextTick(() => callback(null, `taskId: task-1\nstatus: done\nmessage: ${JSON.stringify('A quiet day...')}\n`, ''));
      } else {
        process.nextTick(() => callback(null, '', ''));
      }
    });

    const res = await submitDailyReport(createDailyReportHandler({ execFileImpl, fsImpl }), validDailyReportSummary);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ insights: 'A quiet day...', source: 'taskferry' });
    expect(dispatchPrompt).toContain('tokenShareByModel');
    expect(dispatchPrompt).toContain('costShareByModel');
    expect(dispatchPrompt).toContain('z-score');
  });

  // Final-review fix: the "HARD RULE: read exactly one file..." preamble
  // (the taskferry worker's tool-access restriction) was duplicated
  // verbatim across buildTaskferryPrompt and buildDailyReportPrompt.
  // The fix extracts it into a shared helper so a future tightening of
  // this security-relevant constraint only needs to change one place.
  // This test pins the new contract: the rule text appears identically
  // in both routes' dispatch prompts, AND both prompts point the rule
  // at the SAME data file path the route wrote to disk.
  it('embeds the same shared read-only-file rule in both the insights and daily-report dispatch prompts', async () => {
    const fsImpl = createScratchFs();
    const dispatchPrompts = [];
    const execFileImpl = mock((file, args, options, callback) => {
      const subcommand = args[0];
      if (subcommand === 'dispatch') {
        dispatchPrompts.push(args[args.indexOf('--prompt') + 1]);
        process.nextTick(() => callback(null, `id: ${subcommand}-shared-rule\nstatus: running\n`, ''));
      } else if (subcommand === 'wait') {
        process.nextTick(() => callback(null, `id: ${subcommand}-shared-rule\nstatus: done\nexitCode: 0\n`, ''));
      } else if (subcommand === 'result') {
        process.nextTick(() => callback(null, `taskId: ${subcommand}-shared-rule\nstatus: done\nmessage: ${JSON.stringify('ok')}\n`, ''));
      } else {
        process.nextTick(() => callback(null, '', ''));
      }
    });

    await submitSummary(createInsightsHandler({ execFileImpl, fsImpl }), validSummary);
    await submitDailyReport(createDailyReportHandler({ execFileImpl, fsImpl }), validDailyReportSummary);

    expect(dispatchPrompts).toHaveLength(2);
    const ruleFragment = 'HARD RULE: this is a read-only analysis task. You may read exactly one file — ';
    expect(dispatchPrompts[0]).toContain(ruleFragment);
    expect(dispatchPrompts[1]).toContain(ruleFragment);
    // Both prompts must read from their own scratch file — verify each
    // path appears in its own prompt.
    const insightsPath = (dispatchPrompts[0].match(/one file — ([^\s—]+)/) || [])[1];
    const dailyPath = (dispatchPrompts[1].match(/one file — ([^\s—]+)/) || [])[1];
    expect(insightsPath).toMatch(/insights-data-.*\.ndjson$/);
    expect(dailyPath).toMatch(/daily-report-data-.*\.json$/);
  });

  // Final-review fix: the daily-report scratch file used to be written
  // as a pretty-printed multi-line JSON object under a `.ndjson`
  // extension — but the file isn't newline-delimited. The worker's
  // file-read tool truncates at 2000 chars per line, so a single
  // pretty-printed multi-line object exposes only the first 2000 chars
  // of line 1 to the model. Fix: serialize as compact single-line JSON
  // and rename to `.json` so the file actually contains a single
  // object the worker can read whole, and the extension matches the
  // shape. This test pins the new contract: the scratch file path ends
  // in `.json` (not `.ndjson`) and its contents are a single line.
  it('writes the daily-report scratch file as a single-line .json file, not multi-line .ndjson', async () => {
    const { TASKFERRY_SCRATCH_DIR } = require('../../../../lib/config');
    const fsImpl = createScratchFs();
    let dispatchPrompt;
    let dataFilePathAtDispatchTime;
    let dataFileContentsAtDispatchTime;
    const execFileImpl = mock((file, args, options, callback) => {
      const subcommand = args[0];
      if (subcommand === 'dispatch') {
        dispatchPrompt = args[args.indexOf('--prompt') + 1];
        // The daily-report prompt wraps the file path in
        // "**Complete input data:** <path> (one JSON object, ...)" —
        // extract just the path before the trailing parenthetical.
        const match = dispatchPrompt.match(/Complete input data:\*\* (\S+\.json)/);
        dataFilePathAtDispatchTime = match ? match[1] : null;
        dataFileContentsAtDispatchTime = dataFilePathAtDispatchTime ? fsImpl.files.get(dataFilePathAtDispatchTime) : null;
        process.nextTick(() => callback(null, 'id: task-shape\nstatus: running\n', ''));
      } else if (subcommand === 'wait') {
        process.nextTick(() => callback(null, 'id: task-shape\nstatus: done\nexitCode: 0\n', ''));
      } else if (subcommand === 'result') {
        process.nextTick(() => callback(null, `taskId: task-shape\nstatus: done\nmessage: ${JSON.stringify('ok')}\n`, ''));
      } else {
        process.nextTick(() => callback(null, '', ''));
      }
    });

    await submitDailyReport(createDailyReportHandler({ execFileImpl, fsImpl }), validDailyReportSummary);

    expect(dataFilePathAtDispatchTime).toMatch(/\/daily-report-data-.*\.json$/);
    expect(dataFilePathAtDispatchTime).not.toMatch(/\.ndjson$/);
    expect(dataFilePathAtDispatchTime).toMatch(new RegExp(`^${TASKFERRY_SCRATCH_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
    expect(dataFileContentsAtDispatchTime).toBeDefined();
    expect(dataFileContentsAtDispatchTime.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(dataFileContentsAtDispatchTime);
    expect(parsed.date).toBe(validDailyReportSummary.date);
  });

  it('returns 503 without a silent fallback when taskferry dispatch fails', async () => {
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      if (args[0] === 'dispatch') process.nextTick(() => callback(new Error('TASKFERRY_INTERNAL_FAILURE_SENTINEL')));
      else process.nextTick(() => callback(null, '', ''));
    });
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

    const res = await submitDailyReport(createDailyReportHandler({ execFileImpl, fsImpl }), validDailyReportSummary);

    expect(res.statusCode).toBe(503);
    const parsed = JSON.parse(res.body);
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error).not.toContain('TASKFERRY_INTERNAL_FAILURE_SENTINEL');
    expect(res.body).not.toMatch(/quota|daily|hour|model/i);
    consoleErrorSpy.mockRestore();
  });

  // Final-review fix: a taskferry task that completed with status: done but
  // emitted an empty/whitespace-only message used to be passed through as a
  // 200 with insights: '' — the widget's renderCached would then render a
  // blank body with no error and no Retry. The shared runTaskferryAnalysis
  // now rejects blank/non-string results so the existing try/catch surfaces
  // it as 503, matching the AI-report-generation-unavailable error path
  // the widget already knows how to handle.
  it('returns 503 (not 200 with empty insights) when taskferry result message is an empty string', async () => {
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      if (args[0] === 'dispatch') process.nextTick(() => callback(null, 'id: task-blank\nstatus: running\n', ''));
      else if (args[0] === 'wait') process.nextTick(() => callback(null, 'id: task-blank\nstatus: done\nexitCode: 0\n', ''));
      else if (args[0] === 'result') process.nextTick(() => callback(null, `taskId: task-blank\nstatus: done\nmessage: ${JSON.stringify('')}\n`, ''));
      else process.nextTick(() => callback(null, '', ''));
    });
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

    const res = await submitDailyReport(createDailyReportHandler({ execFileImpl, fsImpl }), validDailyReportSummary);

    expect(res.statusCode).toBe(503);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({ error: 'AI report generation unavailable' });
    expect(res.body).not.toMatch(/"insights"/);
    consoleErrorSpy.mockRestore();
  });

  it('returns 503 when taskferry result message is whitespace-only', async () => {
    const fsImpl = createScratchFs();
    const execFileImpl = mock((file, args, options, callback) => {
      if (args[0] === 'dispatch') process.nextTick(() => callback(null, 'id: task-ws\nstatus: running\n', ''));
      else if (args[0] === 'wait') process.nextTick(() => callback(null, 'id: task-ws\nstatus: done\nexitCode: 0\n', ''));
      else if (args[0] === 'result') process.nextTick(() => callback(null, `taskId: task-ws\nstatus: done\nmessage: ${JSON.stringify('   \n\t  ')}\n`, ''));
      else process.nextTick(() => callback(null, '', ''));
    });
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

    const res = await submitDailyReport(createDailyReportHandler({ execFileImpl, fsImpl }), validDailyReportSummary);

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: 'AI report generation unavailable' });
    consoleErrorSpy.mockRestore();
  });
});

describe('handleDailyReportRoute request validation tightening', () => {
  // Final-review fix: validateDailyReportSummary used to accept any value
  // with `typeof === 'number'`, which lets NaN, Infinity, -Infinity, and
  // negative counts through — and dispatched the taskferry worker against
  // nonsensical numeric data. It now requires Number.isFinite plus range
  // checks on hour fields and non-negativity on the count/sum fields.
  const validDailyReportSummary = {
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

  const rejection = async (mutator) => {
    const execFileImpl = mock();
    const handler = createDailyReportHandler({ execFileImpl });
    const res = await submitDailyReport(handler, mutator(structuredClone(validDailyReportSummary)));
    return { res, execFileImpl };
  };

  it('rejects NaN totalTokensToday with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.totalTokensToday = NaN; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*totalTokensToday/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects Infinity baseline.meanHourlyTokens with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.baseline.meanHourlyTokens = Infinity; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*meanHourlyTokens/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects -Infinity baseline.stddevHourlyTokens with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.baseline.stddevHourlyTokens = -Infinity; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*stddevHourlyTokens/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects peakHour.hour = 24 with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.peakHour.hour = 24; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*peakHour\.hour/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects peakHour.hour = -1 with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.peakHour.hour = -1; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*peakHour\.hour/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range hourlyBuckets[i].hour with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.hourlyBuckets[0].hour = 25; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*hourlyBuckets\[0\]\.hour/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a negative hourlyBuckets[i].totalTokens with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.hourlyBuckets[0].totalTokens = -1; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*hourlyBuckets\[0\]\.totalTokens/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a negative totalTokensToday with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.totalTokensToday = -1; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*totalTokensToday/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a negative totalCostToday with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.totalCostToday = -0.01; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*totalCostToday/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a negative peakHour.totalTokens with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.peakHour.totalTokens = -100; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*peakHour\.totalTokens/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  // Final-review fix: validateDailyReportSummary's error message claims
  // "finite integer in 0..23" for the hour fields, but the check only
  // verified `Number.isFinite` + range — letting fractional hours like
  // 14.5 through and dispatching the taskferry worker against them. The
  // new check uses `Number.isInteger` to match the documented contract.
  it('rejects a fractional peakHour.hour (14.5) with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.peakHour.hour = 14.5; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*peakHour\.hour/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });

  it('rejects a fractional hourlyBuckets[i].hour (3.14) with 400 and never dispatches', async () => {
    const { res, execFileImpl } = await rejection((s) => { s.hourlyBuckets[0].hour = 3.14; return s; });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body.*hourlyBuckets\[0\]\.hour/);
    expect(execFileImpl).not.toHaveBeenCalled();
  });
});

describe('createTokensHandler error responses', () => {
  it('does not leak the raw error message to the client', async () => {
    const handler = createTokensHandler({
      getTokensDataImpl: mock(() => Promise.reject(new Error('ENOENT: /secret/internal/path')))
    });
    const res = createMockRes();
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});

    await handler({}, res, undefined);

    expect(res.statusCode).toBe(500);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe('Internal server error');
    expect(parsed.error).not.toMatch(/secret/);
    consoleErrorSpy.mockRestore();
  });
});
