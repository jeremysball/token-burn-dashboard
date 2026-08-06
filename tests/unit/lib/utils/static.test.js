import { describe, expect, test } from 'bun:test';

const { serveStatic, clearCache } = require('../../../../lib/utils/static');

function makeFakeRes() {
  const res = {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(statusCode, headers) {
      res.statusCode = statusCode;
      res.headers = headers;
    },
    end(body) {
      res.body = body;
    }
  };
  return res;
}

describe('serveStatic', () => {
  test('responds 404 instead of throwing when an .html file does not exist', () => {
    clearCache();
    const res = makeFakeRes();

    expect(() => serveStatic(res, '/nonexistent/path/does-not-exist.html', 'text/html')).not.toThrow();

    expect(res.statusCode).toBe(404);
  });
});
