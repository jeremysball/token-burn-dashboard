/**
 * Tests for API route handlers
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { EventEmitter } from 'events';
import * as path from 'path';
import {
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
});

describe('createInsightsHandler request validation', () => {
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
