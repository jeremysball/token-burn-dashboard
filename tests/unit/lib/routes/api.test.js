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
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    end(body) { this.body = body || ''; }
  };
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
          dataFilePathAtDispatchTime = (promptArg.match(/Complete input data:\*\* (\S+)/) || [])[1];
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
