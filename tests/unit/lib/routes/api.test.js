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

describe('handleInsightsAnalyzeRoute taskferry analysis', () => {
  const validSummary = {
    topModels: [{
      name: 'gpt-5',
      tokens: 1_000_000,
      inputTokens: 700_000,
      outputTokens: 200_000,
      cacheReadTokens: 100_000,
      cost: 1.23,
      cacheRate: 0.5,
      pricePerMillion: { input: 2.5, output: 10, cacheRead: 1.25 }
    }],
    totalTokens: 2_000_000_000,
    totalCost: 12.34,
    modelCount: 3,
    cacheRate: 0.4,
    inputOutputRatio: 2.1
  };

  afterEach(() => {
    jest.dontMock('child_process');
    jest.resetModules();
  });

  it('dispatches to taskferry and returns its message as insights text', async () => {
    jest.resetModules();
    const { TASKFERRY_INSIGHTS_MODEL, TASKFERRY_SCRATCH_DIR } = require('../../../../lib/config');
    jest.doMock('child_process', () => ({
      execFile: jest.fn((file, args, options, callback) => {
        const [subcommand] = args;
        if (subcommand === 'dispatch') {
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
