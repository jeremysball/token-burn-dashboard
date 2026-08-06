const fs = require('fs');
const path = require('path');

import { describe, expect, it } from 'bun:test';

describe('server listener', () => {
  it('binds to the configured HOST', () => {
    const serverSource = fs.readFileSync(
      path.resolve(process.cwd(), 'server.js'),
      'utf8'
    );

    expect(serverSource).toMatch(/server\.listen\(currentPort, HOST\)/);
  });

  it('guards URL construction from the raw Host header against a process crash (#48)', () => {
    const serverSource = fs.readFileSync(
      path.resolve(process.cwd(), 'server.js'),
      'utf8'
    );

    // `new URL(req.url, http://${host})` throws on a malformed Host header;
    // it must be wrapped so the request handler responds instead of the
    // async callback rejecting unhandled and killing the whole process.
    expect(serverSource).toContain('try {\n    url = new URL(req.url');
    expect(serverSource).toContain('} catch {');
    expect(serverSource).toContain("res.writeHead(400, { 'Content-Type': 'text/plain' });");
  });
});
