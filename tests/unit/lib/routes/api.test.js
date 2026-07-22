/**
 * Tests for /api/git/blame cwd validation (path traversal guard)
 */

jest.mock('../../../../lib/git-blame', () => ({
  getGitBlameRouteData: jest.fn(() => ({ commits: [], projects: [], files: [], directories: [] })),
  getGitBlameCommitDetails: jest.fn(() => ({ commit: {}, sessions: [], summary: {} }))
}));

const { handleGitBlameRoute, handleInsightsAnalyzeRoute, handleTokensRoute } = require('../../../../lib/routes/api');
const gitBlame = require('../../../../lib/git-blame');
const { EventEmitter } = require('events');

function createMockReq(url, headers = { host: 'localhost:7071' }) {
  const req = new EventEmitter();
  req.url = url;
  req.headers = headers;
  req.destroy = jest.fn();
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
    // Real Node responses emit 'close' on a subsequent tick after 'finish'
    // (after the underlying connection terminates). Mirror that ordering so
    // listeners attached via res.once('close', ...) — e.g. the cancel-on-close
    // hook in runTaskferryAnalysis — fire after 'finish' on the same response.
    process.nextTick(() => this.emit('close'));
    return this;
  };
  return res;
}

describe('handleGitBlameRoute cwd validation', () => {
  beforeEach(() => {
    gitBlame.getGitBlameRouteData.mockClear();
    gitBlame.getGitBlameCommitDetails.mockClear();
  });

  it('rejects a cwd outside PROJECT_ROOT with 400 and does not call into git-blame', async () => {
    const req = { url: '/api/git/blame?cwd=/etc', headers: { host: 'localhost:7071' } };
    const res = createMockRes();

    await handleGitBlameRoute(req, res, undefined);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid directory' });
    expect(gitBlame.getGitBlameRouteData).not.toHaveBeenCalled();
  });

  it('rejects a traversal cwd with 400', async () => {
    const req = { url: '/api/git/blame?cwd=' + encodeURIComponent('../../etc'), headers: { host: 'localhost:7071' } };
    const res = createMockRes();

    await handleGitBlameRoute(req, res, undefined);

    expect(res.statusCode).toBe(400);
    expect(gitBlame.getGitBlameRouteData).not.toHaveBeenCalled();
  });

  it('allows a cwd within PROJECT_ROOT and calls into git-blame', async () => {
    const { PROJECT_ROOT } = require('../../../../lib/config');
    const path = require('path');
    const allowedCwd = path.join(PROJECT_ROOT, 'some-project');
    const req = { url: '/api/git/blame?cwd=' + encodeURIComponent(allowedCwd), headers: { host: 'localhost:7071' } };
    const res = createMockRes();

    await handleGitBlameRoute(req, res, undefined); // undefined requestTimeout — no timeout to clear in this test case

    expect(res.statusCode).toBe(200);
    expect(gitBlame.getGitBlameRouteData).toHaveBeenCalledWith(30, allowedCwd);
  });
});

describe('handleInsightsAnalyzeRoute body size limit', () => {
  it('rejects a body larger than MAX_REQUEST_BODY_BYTES with 413', async () => {
    const { MAX_REQUEST_BODY_BYTES } = require('../../../../lib/config');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.alloc(MAX_REQUEST_BODY_BYTES + 1, 'a'));
    await promise;

    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body)).toEqual({ error: 'Request body too large' });
    expect(req.destroy).toHaveBeenCalled();
  });
});

describe('handleInsightsAnalyzeRoute request validation', () => {
  it('rejects a malformed summary with 400 and does not dispatch to taskferry', async () => {
    jest.resetModules();
    const execFileMock = jest.fn();
    jest.doMock('child_process', () => ({ execFile: execFileMock }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify({ totals: {} })));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Invalid request body/);
    expect(execFileMock).not.toHaveBeenCalled();

    jest.dontMock('child_process');
    jest.resetModules();
  });

  it('rejects a summary missing totals.* numeric fields with 400 (shallow-validation gap)', async () => {
    jest.resetModules();
    const execFileMock = jest.fn();
    jest.doMock('child_process', () => ({ execFile: execFileMock }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    // Passes the OLD shallow validation (all top-level shapes are valid objects/arrays,
    // numeric modelCount/cacheRate/inputOutputRatio) but is missing every numeric
    // field under totals.tokens and totals.cost that buildAnalysisPrompt directly
    // interpolates — used to throw TypeError: Cannot read properties of undefined
    // (reading 'toFixed') inside runTaskferryAnalysis, which got caught and
    // misreported as 503 'AI analysis service unavailable' instead of the 400
    // this validator exists to produce.
    const shallowValidButNumericallyBroken = {
      totals: { cost: {} },
      modelCount: 1,
      cacheRate: 0,
      inputOutputRatio: 0,
      models: [],
      history: []
    };

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(shallowValidButNumericallyBroken)));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(400);
    const errorMessage = JSON.parse(res.body).error;
    expect(errorMessage).toMatch(/Invalid request body/);
    expect(errorMessage).toMatch(/totals\.tokens/);
    expect(execFileMock).not.toHaveBeenCalled();

    jest.dontMock('child_process');
    jest.resetModules();
  });

  it('rejects a summary missing totals.cost.* numeric fields with 400', async () => {
    jest.resetModules();
    const execFileMock = jest.fn();
    jest.doMock('child_process', () => ({ execFile: execFileMock }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    // totals.* is fully numeric but totals.cost.* is an empty object — exercises
    // the cost-side numeric checks added alongside totals.tokens/input/...
    const shallowValidButCostBroken = {
      totals: {
        tokens: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        cost: {}
      },
      modelCount: 0,
      cacheRate: 0,
      inputOutputRatio: 0,
      models: [],
      history: []
    };

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(shallowValidButCostBroken)));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(400);
    const errorMessage = JSON.parse(res.body).error;
    expect(errorMessage).toMatch(/Invalid request body/);
    expect(errorMessage).toMatch(/totals\.cost\.total/);
    expect(execFileMock).not.toHaveBeenCalled();

    jest.dontMock('child_process');
    jest.resetModules();
  });

  it('rejects a summary with a non-object model entry with 400', async () => {
    jest.resetModules();
    const execFileMock = jest.fn();
    jest.doMock('child_process', () => ({ execFile: execFileMock }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    const withBadModel = {
      totals: {
        tokens: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        cost: { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, total: 0 }
      },
      modelCount: 1,
      cacheRate: 0,
      inputOutputRatio: 0,
      models: ['not-an-object'],
      history: []
    };

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(withBadModel)));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(400);
    const errorMessage = JSON.parse(res.body).error;
    expect(errorMessage).toMatch(/Invalid request body/);
    expect(errorMessage).toMatch(/summary\.models\[0\]/);
    expect(execFileMock).not.toHaveBeenCalled();

    jest.dontMock('child_process');
    jest.resetModules();
  });

  it('rejects a summary with a history entry missing numeric total with 400', async () => {
    jest.resetModules();
    const execFileMock = jest.fn();
    jest.doMock('child_process', () => ({ execFile: execFileMock }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    const withBadHistory = {
      totals: {
        tokens: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0,
        cost: { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, total: 0 }
      },
      modelCount: 0,
      cacheRate: 0,
      inputOutputRatio: 0,
      models: [],
      history: [{ time: 1234, tokens_by_model: {} }]
    };

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(withBadHistory)));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(400);
    const errorMessage = JSON.parse(res.body).error;
    expect(errorMessage).toMatch(/Invalid request body/);
    expect(errorMessage).toMatch(/summary\.history\[0\]\.total/);
    expect(execFileMock).not.toHaveBeenCalled();

    jest.dontMock('child_process');
    jest.resetModules();
  });
});

describe('handleInsightsAnalyzeRoute taskferry analysis', () => {
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

  afterEach(() => {
    jest.dontMock('child_process');
    jest.dontMock('fs');
    jest.resetModules();
  });

  it('dispatches to taskferry and returns its message as insights text', async () => {
    jest.resetModules();
    const fs = require('fs');
    const { TASKFERRY_INSIGHTS_MODEL, TASKFERRY_SCRATCH_DIR } = require('../../../../lib/config');
    let dataFilePathAtDispatchTime;
    let dataFileContentsAtDispatchTime;
    jest.doMock('child_process', () => ({
      execFile: jest.fn((file, args, options, callback) => {
        const [subcommand] = args;
        if (subcommand === 'dispatch') {
          const promptArg = args[args.indexOf('--prompt') + 1];
          dataFilePathAtDispatchTime = (promptArg.match(/Complete input data:\*\* ([^\n]+)/) || [])[1];
          dataFileContentsAtDispatchTime = fs.readFileSync(dataFilePathAtDispatchTime, 'utf-8')
            .trim().split('\n').map(line => JSON.parse(line));
          process.nextTick(() => callback(null, 'id: oc_test1\nstatus: running\n', ''));
        } else if (subcommand === 'wait') {
          process.nextTick(() => callback(null, 'id: oc_test1\nstatus: done\nexitCode: 0\n', ''));
        } else if (subcommand === 'result') {
          process.nextTick(() => callback(null, `taskId: oc_test1\nstatus: done\nmessage: ${JSON.stringify('**Use fewer big models.**')}\n`, ''));
        } else {
          process.nextTick(() => callback(null, '', ''));
        }
      })
    }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const { execFile } = require('child_process');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(validSummary)));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ insights: '**Use fewer big models.**', source: 'taskferry' });

    const dispatchCall = execFile.mock.calls.find(call => call[1][0] === 'dispatch');
    expect(dispatchCall[1]).toEqual(expect.arrayContaining(['--model', TASKFERRY_INSIGHTS_MODEL, '--directory', TASKFERRY_SCRATCH_DIR]));
    const waitCall = execFile.mock.calls.find(call => call[1][0] === 'wait');
    expect(waitCall[1]).toEqual(['wait', 'oc_test1']);

    // The full dataset must be written to a scratch file as NDJSON (not embedded inline in
    // argv, which has a hard per-argument size cap, and not as a single JSON blob, which the
    // worker's own file-read tool truncates past 2000 chars per line) — referenced by path in
    // the prompt, and cleaned up once the analysis completes.
    expect(dataFilePathAtDispatchTime).toMatch(new RegExp(`^${TASKFERRY_SCRATCH_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/insights-data-.*\\.ndjson$`));
    expect(dataFileContentsAtDispatchTime[0]).toEqual({
      type: 'meta',
      totals: validSummary.totals,
      modelCount: validSummary.modelCount,
      cacheRate: validSummary.cacheRate,
      inputOutputRatio: validSummary.inputOutputRatio
    });
    expect(dataFileContentsAtDispatchTime.slice(1, 1 + validSummary.models.length))
      .toEqual(validSummary.models.map(m => ({ type: 'model', ...m })));
    expect(dataFileContentsAtDispatchTime.slice(1 + validSummary.models.length))
      .toEqual(validSummary.history.map(h => ({ type: 'history', ...h })));
    expect(fs.existsSync(dataFilePathAtDispatchTime)).toBe(false);
  });

  it('handles a bare (unquoted) TOON message value', async () => {
    jest.resetModules();
    jest.doMock('child_process', () => ({
      execFile: jest.fn((file, args, options, callback) => {
        const [subcommand] = args;
        if (subcommand === 'dispatch') {
          process.nextTick(() => callback(null, 'id: oc_test3\nstatus: running\n', ''));
        } else if (subcommand === 'wait') {
          process.nextTick(() => callback(null, 'id: oc_test3\nstatus: done\nexitCode: 0\n', ''));
        } else if (subcommand === 'result') {
          process.nextTick(() => callback(null, 'taskId: oc_test3\nstatus: done\nmessage: OK\n', ''));
        } else {
          process.nextTick(() => callback(null, '', ''));
        }
      })
    }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(validSummary)));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ insights: 'OK', source: 'taskferry' });
  });

  it('does not leak the raw error message when the taskferry dispatch fails', async () => {
    jest.resetModules();
    jest.doMock('child_process', () => ({
      execFile: jest.fn((file, args, options, callback) => {
        const [subcommand] = args;
        if (subcommand === 'dispatch') {
          process.nextTick(() => callback(null, 'id: oc_test2\nstatus: running\n', ''));
        } else if (subcommand === 'wait') {
          process.nextTick(() => callback(new Error('TASKFERRY_INTERNAL_FAILURE_SENTINEL')));
        } else {
          process.nextTick(() => callback(null, '', ''));
        }
      })
    }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(validSummary)));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: 'AI analysis service unavailable' });
    expect(res.body).not.toContain('TASKFERRY_INTERNAL_FAILURE_SENTINEL');
  });

  it('does not write again if the outer gateway timeout already ended the response', async () => {
    jest.resetModules();
    jest.doMock('child_process', () => ({
      execFile: jest.fn((file, args, options, callback) => {
        const [subcommand] = args;
        if (subcommand === 'dispatch') {
          process.nextTick(() => callback(null, 'id: oc_test4\nstatus: running\n', ''));
        } else if (subcommand === 'wait') {
          process.nextTick(() => callback(null, 'id: oc_test4\nstatus: done\nexitCode: 0\n', ''));
        } else if (subcommand === 'result') {
          process.nextTick(() => callback(null, `taskId: oc_test4\nstatus: done\nmessage: ${JSON.stringify('late result')}\n`, ''));
        } else {
          process.nextTick(() => callback(null, '', ''));
        }
      })
    }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    // Simulate server.js's gateway-timeout setTimeout firing and ending the
    // response before this (slower) taskferry chain resolves.
    res.writeHead(504, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Gateway timeout' }));
    res.writableEnded = true;
    const writeHeadSpy = jest.spyOn(res, 'writeHead');

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(validSummary)));
    req.emit('end');
    await promise;

    expect(writeHeadSpy).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(504);
  });

  it('logs (but does not throw on) a scratch-file cleanup failure', async () => {
    jest.resetModules();
    const realFs = jest.requireActual('fs');
    jest.doMock('child_process', () => ({
      execFile: jest.fn((file, args, options, callback) => {
        const [subcommand] = args;
        if (subcommand === 'dispatch') {
          process.nextTick(() => callback(null, 'id: oc_test5\nstatus: running\n', ''));
        } else if (subcommand === 'wait') {
          process.nextTick(() => callback(null, 'id: oc_test5\nstatus: done\nexitCode: 0\n', ''));
        } else if (subcommand === 'result') {
          process.nextTick(() => callback(null, `taskId: oc_test5\nstatus: done\nmessage: ${JSON.stringify('ok')}\n`, ''));
        } else {
          process.nextTick(() => callback(null, '', ''));
        }
      })
    }));
    jest.doMock('fs', () => ({
      ...realFs,
      unlink: jest.fn((filePath, cb) => cb(new Error('EACCES: permission denied')))
    }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    const promise = handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(validSummary)));
    req.emit('end');
    await promise;

    expect(res.statusCode).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clean up insights scratch file'),
      expect.any(Error)
    );
    consoleErrorSpy.mockRestore();
  });

  it('cancels the taskferry worker if the response closes while wait is still pending', async () => {
    // Regression for the race where the outer gateway timeout
    // (INSIGHTS_REQUEST_TIMEOUT, 220s) fires while the inner wait() is still
    // legitimately pending — previously the worker kept running and burning
    // quota for up to ~200s after the response ended, because cancel was only
    // wired into the wait() catch block.
    jest.resetModules();
    let cancelArgs = null;
    jest.doMock('child_process', () => ({
      execFile: jest.fn((file, args, options, callback) => {
        const [subcommand] = args;
        if (subcommand === 'dispatch') {
          process.nextTick(() => callback(null, 'id: oc_test_cancel\nstatus: running\n', ''));
        } else if (subcommand === 'cancel') {
          cancelArgs = args;
          process.nextTick(() => callback(null, '', ''));
        }
        // wait/result: never resolve — the test only verifies cancel is
        // issued when the response closes mid-flight; the handler stays
        // pending until the 180s wait timeout (well past this test's
        // lifetime), and jest moves on without awaiting it.
      })
    }));

    const { handleInsightsAnalyzeRoute } = require('../../../../lib/routes/api');
    const req = createMockReq('/api/insights/analyze');
    const res = createMockRes();

    handleInsightsAnalyzeRoute(req, res, undefined);
    req.emit('data', Buffer.from(JSON.stringify(validSummary)));
    req.emit('end');

    // Let dispatch resolve and the cancel-on-close listener register.
    await new Promise(r => process.nextTick(r));
    await new Promise(r => process.nextTick(r));

    // Simulate the response closing mid-flight (client disconnect / gateway
    // timeout). The 'close' listener fires synchronously on emit.
    res.emit('close');

    expect(cancelArgs).toEqual(['cancel', 'oc_test_cancel']);
  });
});

describe('handleTokensRoute error responses', () => {
  it('does not leak the raw error message to the client', async () => {
    jest.resetModules();
    jest.doMock('../../../../lib/cache', () => ({
      getTokensData: jest.fn(() => Promise.reject(new Error('ENOENT: /secret/internal/path'))),
      getHistoricalData: jest.fn()
    }));
    const { handleTokensRoute: handler } = require('../../../../lib/routes/api');
    const res = createMockRes();

    await handler({}, res, undefined);

    expect(res.statusCode).toBe(500);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe('Internal server error');
    expect(parsed.error).not.toMatch(/secret/);
  });
});
