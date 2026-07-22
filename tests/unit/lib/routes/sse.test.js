/**
 * Tests for /api/tokens/stream error responses
 */

jest.mock('../../../../lib/cache', () => ({
  getTokensData: jest.fn()
}));

const { handleSseRoute } = require('../../../../lib/routes/sse');
const cache = require('../../../../lib/cache');
const { EventEmitter } = require('events');

function createMockRes() {
  const writes = [];
  return {
    writableEnded: false,
    writeHead: jest.fn(),
    write: jest.fn(chunk => writes.push(chunk)),
    end: jest.fn(),
    writes
  };
}

describe('handleSseRoute error responses', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not leak the raw error message to SSE clients', async () => {
    cache.getTokensData.mockReturnValue(Promise.reject(new Error('ENOENT: /secret/internal/path')));
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
