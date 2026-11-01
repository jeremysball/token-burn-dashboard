/**
 * Tests for /api/tokens/stream error responses
 */

mock.module('../../../../lib/cache', () => ({
  getTokensData: mock(),
  GIT_BLAME_WARM_CWD: require('../../../../lib/config').PROJECT_ROOT
}));

const { handleSseRoute } = require('../../../../lib/routes/sse');
const cache = require('../../../../lib/cache');
const { EventEmitter } = require('events');

function createMockRes() {
  const writes = [];
  return {
    writableEnded: false,
    writeHead: mock(),
    write: mock(chunk => writes.push(chunk)),
    end: mock(),
    writes
  };
}

import { describe, expect, it, mock } from 'bun:test';

describe('handleSseRoute error responses', () => {
  it('does not leak the raw error message to SSE clients', async () => {
    // Throw from inside the call rather than handing back a rejected promise:
    // bun's module mocks are process-wide, so a sibling test file that mocked
    // the same cache module leaves the route bound to a different instance and
    // an orphan rejected promise here surfaces as an unhandled rejection.
    cache.getTokensData.mockImplementation(() => { throw new Error('ENOENT: /secret/internal/path'); });
    const req = new EventEmitter();
    const res = createMockRes();

    handleSseRoute(req, res);
    // handleSseRoute's initial sendUpdate() call is fire-and-forget; flush the
    // microtask queue so its rejection settles before we assert on it.
    await Promise.resolve();
    await Promise.resolve();

    req.emit('close'); // stop the update/keepalive intervals started above

    const errorEvent = res.writes.find(chunk => chunk.startsWith('event: error'));
    expect(errorEvent).toBeDefined();
    expect(errorEvent).not.toContain('secret');
    expect(JSON.parse(errorEvent.slice(errorEvent.indexOf('data: ') + 'data: '.length))).toEqual({ error: 'Internal server error' });
  });
});
