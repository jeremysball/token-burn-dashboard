/**
 * Tests for /api/spikes (#37): handleSpikesListRoute must not write after the
 * outer gateway timeout has already ended the response, the same
 * writableEnded-race guard already applied to handleTokensRoute/
 * handleHistoricalRoute for #26/#36.
 */

import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'events';

mock.module('../../../../lib/cache', () => ({
  getTokensData: mock(),
  getHistoricalData: mock(() => Promise.resolve({ some: 'data' }))
}));

mock.module('../../../../lib/spike-detective', () => ({
  findSpikes: mock(() => [{ id: 'spike-1' }])
}));

const { handleSpikesListRoute } = require('../../../../lib/routes/api');

function createMockReq() {
  const req = new EventEmitter();
  req.url = '/api/spikes';
  req.headers = { host: 'localhost:7071' };
  return req;
}

function createMockRes() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.writeHead = mock(function (status, headers) {
    this.statusCode = status;
    this.headers = headers;
    return this;
  });
  res.end = mock(function (body) {
    this.body = body;
    this.writableEnded = true;
    return this;
  });
  return res;
}

describe('handleSpikesListRoute writableEnded guard', () => {
  it('does not write to the response once the gateway timeout already ended it', async () => {
    const req = createMockReq();
    const res = createMockRes();

    // Simulate the outer gateway timeout firing and ending the response
    // while getHistoricalData() is still in flight.
    res.writableEnded = true;
    res.end('{"error":"Gateway timeout"}');
    res.writeHead.mockClear();
    res.end.mockClear();

    await handleSpikesListRoute(req, res, undefined);

    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it('responds normally when the response has not already ended', async () => {
    const req = createMockReq();
    const res = createMockRes();

    await handleSpikesListRoute(req, res, undefined);

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ spikes: [{ id: 'spike-1' }] });
  });
});
