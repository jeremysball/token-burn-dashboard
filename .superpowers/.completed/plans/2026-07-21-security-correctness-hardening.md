# Security & Correctness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four independently-scoped security and correctness gaps in the token-burn dashboard server and client (GitHub issues #2, #3, #5, #6), each landing as its own branch and its own PR.

> **Revision note (2026-07-21, post-merge):** This plan originally covered six issues. Since it was drafted, PRs #1/#16/#17 merged into `main` and independently fixed issue #4 (session ID / model name XSS — `escapeHtml` is now applied at every call site) and issue #9 (timestamp normalization — `normalizeTimeMs` already exists in `lib/historical-data.js`). Both are dropped from scope; nothing left to do. The same merge also refactored `dashboard/js/views/analytics.js` from ~1660 lines down to a 171-line shell, splitting its rendering logic into `dashboard/js/views/analytics/tabs/*.js`. Task 4 (issue #3) is rescoped below to match: only 3 raw `err.message` → `innerHTML` sites remain unescaped, in `tabs/git.js` and `tabs/spikes.js`, not in `analytics.js` itself.

**Architecture:** No new runtime dependencies. Server-side fixes add small, pure, unit-testable helper functions to a new `lib/security.js` module and new fields to the existing `lib/config.js`, then wire them into `server.js`, `lib/utils/static.js`, and `lib/routes/api.js`. Client-side fixes route already-untrusted strings through the project's existing DOM-based `escapeHtml` pattern (already imported in the target files from `./shared.js`) before any `innerHTML` assignment.

**Tech Stack:** Node.js built-in `http` module (no framework), CommonJS on the server, ES modules on the client, Jest for tests (`npm test`).

## Global Constraints

- Every task lands on its **own branch off `main` and its own PR** — never stack a task's branch on a prior task's unmerged branch. Task 2 adds functions to `lib/security.js`, which Task 1 creates — merge Task 1 before branching Task 2. All other tasks are mutually independent and may be branched off `main` in any order, but merge each before starting the next to avoid `lib/config.js` edit conflicts landing out of order.
- Do not change any existing success-path response shape, status code, or payload structure — only add validation, escaping, size limits, or logging around the existing behavior.
- Server-side test files use CommonJS `require` (see `tests/unit/lib/config.test.js`). Client-side test files targeting `dashboard/js/**` use ESM `import` with a `/** @jest-environment jsdom */` docblock (see `tests/unit/utils.test.js`).
- Any new HTML-escaping code must use the string-replace `escapeHtml` already defined in `dashboard/js/views/analytics/tabs/shared.js:132-140` and re-exported to every tab module (including `git.js` and `spikes.js`, which already import it):
  ```js
  const escapeHtml = (text) => {
      if (!text) return '';
      return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
  };
  ```
- Run `npm test` after every task's implementation step to confirm no regressions before handing off to review.

---

### Task 1: Restrict CORS to an allowlist, add optional bearer auth, default to loopback bind

Fixes issue #5 (no auth, wildcard CORS, unrestricted bind).

**Files:**
- Create: `lib/security.js`
- Modify: `tests/unit/lib/security.test.js` (this file already exists — it was added by an earlier, unrelated security fix and currently covers `isValidCommitHash`, `safeStaticPath`, and `opencode-discovery`'s `queryJsonSafe`. Append new `describe` blocks to the end of the existing file; do not replace or remove any existing content.)
- Modify: `lib/config.js`
- Modify: `server.js`
- Modify: `lib/utils/static.js`
- Modify: `tests/unit/lib/config.test.js`

**Interfaces:**
- Produces: `lib/security.js` exports `resolveCorsOrigin(requestOrigin, allowedOrigins)` and `isAuthorized(req, authToken)`. Later tasks (Task 2) add more exports to this same file.
- Produces: `lib/config.js` gains `HOST` (string, default `'127.0.0.1'`), `ALLOWED_ORIGINS` (array of strings, default `[]`), `AUTH_TOKEN` (string or `null`, default `null`).

- [ ] **Step 1: Write the failing test for the security helpers**

`tests/unit/lib/security.test.js` already exists with unrelated tests (`isValidCommitHash`, `safeStaticPath`, `opencode-discovery`). Append the following to the **end** of the existing file — do not touch its current content, and do not remove its existing top-of-file `const path = require('path');`:

```js

const { resolveCorsOrigin, isAuthorized } = require('../../../lib/security');

describe('resolveCorsOrigin', () => {
  it('returns null when no allowlist is configured', () => {
    expect(resolveCorsOrigin('https://example.com', [])).toBeNull();
  });

  it('returns null when the request has no Origin header', () => {
    expect(resolveCorsOrigin(undefined, ['https://example.com'])).toBeNull();
  });

  it('returns the origin when it is in the allowlist', () => {
    expect(resolveCorsOrigin('https://example.com', ['https://example.com'])).toBe('https://example.com');
  });

  it('returns null when the origin is not in the allowlist', () => {
    expect(resolveCorsOrigin('https://evil.com', ['https://example.com'])).toBeNull();
  });
});

describe('isAuthorized', () => {
  it('allows any request when no auth token is configured', () => {
    expect(isAuthorized({ headers: {} }, null)).toBe(true);
  });

  it('rejects a request with no Authorization header when a token is configured', () => {
    expect(isAuthorized({ headers: {} }, 'secret')).toBe(false);
  });

  it('rejects a request with a mismatched bearer token', () => {
    expect(isAuthorized({ headers: { authorization: 'Bearer wrong' } }, 'secret')).toBe(false);
  });

  it('accepts a request with the matching bearer token', () => {
    expect(isAuthorized({ headers: { authorization: 'Bearer secret' } }, 'secret')).toBe(true);
  });

  it('accepts a case-insensitive Bearer prefix', () => {
    expect(isAuthorized({ headers: { authorization: 'bearer secret' } }, 'secret')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/lib/security.test.js`
Expected: FAIL with `Cannot find module '../../../lib/security'`

- [ ] **Step 3: Implement `lib/security.js`**

```js
/**
 * Security helpers: CORS origin allowlisting and bearer-token auth
 */

function resolveCorsOrigin(requestOrigin, allowedOrigins) {
  if (!requestOrigin || !allowedOrigins || allowedOrigins.length === 0) return null;
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

function isAuthorized(req, authToken) {
  if (!authToken) return true;
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return !!match && match[1] === authToken;
}

module.exports = { resolveCorsOrigin, isAuthorized };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/unit/lib/security.test.js`
Expected: PASS, 6/6 tests

- [ ] **Step 5: Add the failing test for the new config fields**

Modify `tests/unit/lib/config.test.js` — add a new `describe` block after the existing `'includes MIME type mappings'` test (before the final closing `});` of the outer `describe('Server Config', ...)`):

```js

  describe('security defaults', () => {
    it('defaults HOST to loopback', () => {
      const originalHost = process.env.HOST;
      delete process.env.HOST;
      jest.resetModules();
      const cfg = require('../../../lib/config');
      expect(cfg.HOST).toBe('127.0.0.1');
      if (originalHost !== undefined) process.env.HOST = originalHost;
      jest.resetModules();
    });

    it('parses ALLOWED_ORIGINS from a comma-separated env var', () => {
      const original = process.env.ALLOWED_ORIGINS;
      process.env.ALLOWED_ORIGINS = 'https://a.example, https://b.example';
      jest.resetModules();
      const cfg = require('../../../lib/config');
      expect(cfg.ALLOWED_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
      if (original === undefined) delete process.env.ALLOWED_ORIGINS;
      else process.env.ALLOWED_ORIGINS = original;
      jest.resetModules();
    });

    it('defaults ALLOWED_ORIGINS to an empty array', () => {
      const original = process.env.ALLOWED_ORIGINS;
      delete process.env.ALLOWED_ORIGINS;
      jest.resetModules();
      const cfg = require('../../../lib/config');
      expect(cfg.ALLOWED_ORIGINS).toEqual([]);
      if (original !== undefined) process.env.ALLOWED_ORIGINS = original;
      jest.resetModules();
    });

    it('defaults AUTH_TOKEN to null', () => {
      const original = process.env.DASHBOARD_AUTH_TOKEN;
      delete process.env.DASHBOARD_AUTH_TOKEN;
      jest.resetModules();
      const cfg = require('../../../lib/config');
      expect(cfg.AUTH_TOKEN).toBeNull();
      if (original !== undefined) process.env.DASHBOARD_AUTH_TOKEN = original;
      jest.resetModules();
    });
  });
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx jest tests/unit/lib/config.test.js`
Expected: FAIL — `cfg.HOST` etc. are `undefined`

- [ ] **Step 7: Add the new fields to `lib/config.js`**

Modify `lib/config.js` — add three new keys to the exported object, right after the existing `PORT` line:

```js
  PORT: process.env.PORT || 7071,
  HOST: process.env.HOST || '127.0.0.1',
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  AUTH_TOKEN: process.env.DASHBOARD_AUTH_TOKEN || null,
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx jest tests/unit/lib/config.test.js`
Expected: PASS, all tests

- [ ] **Step 9: Wire CORS allowlist and auth gate into `server.js`**

Modify `server.js`:

Replace:
```js
// Configuration
const { PORT, REQUEST_TIMEOUT } = require('./lib/config');
```
with:
```js
// Configuration
const { PORT, HOST, ALLOWED_ORIGINS, AUTH_TOKEN, REQUEST_TIMEOUT } = require('./lib/config');
const { resolveCorsOrigin, isAuthorized } = require('./lib/security');
```

Replace:
```js
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  // Gateway timeout configuration (not for SSE)
```
with:
```js
  // CORS Headers
  const corsOrigin = resolveCorsOrigin(req.headers.origin, ALLOWED_ORIGINS);
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  if (url.pathname.startsWith('/api/') && !isAuthorized(req, AUTH_TOKEN)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  
  // Gateway timeout configuration (not for SSE)
```

Replace (inside the `EADDRINUSE` handler):
```js
    server.close();
    server.listen(currentPort);
```
with:
```js
    server.close();
    server.listen(currentPort, HOST);
```

Replace the banner line:
```js
║   ${`http://localhost:${currentPort}`.padEnd(57)}║
```
with:
```js
║   ${`http://${HOST}:${currentPort}`.padEnd(57)}║
```

Replace the final:
```js
server.listen(currentPort);
```
with:
```js
server.listen(currentPort, HOST);
```

- [ ] **Step 10: Remove the redundant wildcard CORS header from `lib/utils/static.js`**

`server.js` already sets `Access-Control-Allow-Origin` for every response (including ones later handled by `handleStaticRoutes`) before routing occurs, so the header `serveStatic()` sets is dead weight that also reintroduces the wildcard this task is removing.

Modify `lib/utils/static.js` — replace:
```js
    const headers = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    };
```
with:
```js
    const headers = {
      'Content-Type': contentType
    };
```

- [ ] **Step 11: Run the full test suite and manually smoke-test the server**

Run: `npm test`
Expected: all suites pass, including the new `security.test.js` and updated `config.test.js`.

Run: `node server.js &` then `curl -i http://127.0.0.1:7071/api/health`, then `curl -i -H 'Origin: https://evil.example' http://127.0.0.1:7071/api/health` (confirm no `Access-Control-Allow-Origin` header on the second call), then kill the background server.

- [ ] **Step 12: Commit**

```bash
git add lib/security.js lib/config.js server.js lib/utils/static.js tests/unit/lib/security.test.js tests/unit/lib/config.test.js
git commit -m "fix(server): restrict CORS to an allowlist, add optional bearer auth, default to loopback bind"
```

---

### Task 2: Validate the `cwd` query parameter to stop arbitrary directory listing

Fixes issue #2 (path traversal via the git-blame route's `cwd` parameter). **Depends on Task 1 being merged first** — this task adds a function to `lib/security.js`, which Task 1 creates.

**Files:**
- Modify: `lib/security.js`
- Test: `tests/unit/lib/security.test.js`
- Modify: `lib/config.js`
- Modify: `lib/routes/api.js`
- Test: `tests/unit/lib/routes/api.test.js` (new file)

**Interfaces:**
- Consumes: `lib/security.js`'s existing `resolveCorsOrigin`/`isAuthorized` exports (from Task 1) — unchanged, only adding a new export alongside them.
- Produces: `lib/security.js` gains `isPathWithinRoot(candidatePath, rootPath)` (boolean).
- Produces: `lib/config.js` gains `PROJECT_ROOT` (string, default `process.env.HOME || process.cwd()`).

- [ ] **Step 1: Write the failing test for `isPathWithinRoot`**

Modify `tests/unit/lib/security.test.js` — add a new `describe` block after the existing `isAuthorized` block:

```js

describe('isPathWithinRoot', () => {
  const { isPathWithinRoot } = require('../../../lib/security');

  it('accepts the root itself', () => {
    expect(isPathWithinRoot('/home/user/projects', '/home/user/projects')).toBe(true);
  });

  it('accepts a subdirectory of the root', () => {
    expect(isPathWithinRoot('/home/user/projects/foo', '/home/user/projects')).toBe(true);
  });

  it('accepts a relative subdirectory resolved against the root', () => {
    expect(isPathWithinRoot('foo/bar', '/home/user/projects')).toBe(true);
  });

  it('rejects an absolute path outside the root', () => {
    expect(isPathWithinRoot('/etc', '/home/user/projects')).toBe(false);
  });

  it('rejects a relative traversal that escapes the root', () => {
    expect(isPathWithinRoot('../../etc', '/home/user/projects')).toBe(false);
  });

  it('rejects a sibling directory that merely shares a name prefix', () => {
    expect(isPathWithinRoot('/home/user/projects-evil', '/home/user/projects')).toBe(false);
  });
});
```

Also add `isPathWithinRoot` to the existing top-of-file import for consistency (leave the new `describe`'s local `require` as-is; it is redundant but harmless — Node caches the module):

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/lib/security.test.js`
Expected: FAIL — `isPathWithinRoot is not a function`

- [ ] **Step 3: Implement `isPathWithinRoot` in `lib/security.js`**

Modify `lib/security.js` — add `path` import and the new function:

```js
/**
 * Security helpers: CORS origin allowlisting, bearer-token auth, and path containment
 */

const path = require('path');

function resolveCorsOrigin(requestOrigin, allowedOrigins) {
  if (!requestOrigin || !allowedOrigins || allowedOrigins.length === 0) return null;
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

function isAuthorized(req, authToken) {
  if (!authToken) return true;
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return !!match && match[1] === authToken;
}

function isPathWithinRoot(candidatePath, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(resolvedRoot, candidatePath || '.');
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

module.exports = { resolveCorsOrigin, isAuthorized, isPathWithinRoot };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/unit/lib/security.test.js`
Expected: PASS, all tests

- [ ] **Step 5: Add `PROJECT_ROOT` to `lib/config.js`**

Modify `lib/config.js` — add after the `AUTH_TOKEN` line added in Task 1:

```js
  PROJECT_ROOT: process.env.DASHBOARD_PROJECT_ROOT || process.env.HOME || process.cwd(),
```

- [ ] **Step 6: Write the failing test for the route-level validation**

Create `tests/unit/lib/routes/api.test.js`:

```js
/**
 * Tests for /api/git/blame cwd validation (path traversal guard)
 */

jest.mock('../../../../lib/git-blame', () => ({
  getGitBlameRouteData: jest.fn(() => ({ commits: [], projects: [], files: [], directories: [] })),
  getGitBlameCommitDetails: jest.fn(() => ({ commit: {}, sessions: [], summary: {} }))
}));

const { handleGitBlameRoute } = require('../../../../lib/routes/api');
const gitBlame = require('../../../../lib/git-blame');

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

    await handleGitBlameRoute(req, res, undefined);

    expect(res.statusCode).toBe(200);
    expect(gitBlame.getGitBlameRouteData).toHaveBeenCalledWith(30, allowedCwd);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx jest tests/unit/lib/routes/api.test.js`
Expected: FAIL — first two tests get `statusCode: 200` instead of `400`

- [ ] **Step 8: Add the validation to `handleGitBlameRoute` in `lib/routes/api.js`**

Modify `lib/routes/api.js` — replace:

```js
async function handleGitBlameRoute(req, res, requestTimeout) {
  try {
    const { getGitBlameRouteData, getGitBlameCommitDetails } = require('../git-blame');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const days = parseInt(url.searchParams.get('days')) || 30;
    const cwd = url.searchParams.get('cwd') || process.cwd();
    const commitHash = url.searchParams.get('commit');
    
    // If commit hash provided, return session details for that commit
```

with:

```js
async function handleGitBlameRoute(req, res, requestTimeout) {
  try {
    const { getGitBlameRouteData, getGitBlameCommitDetails } = require('../git-blame');
    const { isPathWithinRoot } = require('../security');
    const { PROJECT_ROOT } = require('../config');
    
    const url = new URL(req.url, `http://${req.headers.host}`);
    const days = parseInt(url.searchParams.get('days')) || 30;
    const cwd = url.searchParams.get('cwd') || process.cwd();
    const commitHash = url.searchParams.get('commit');

    if (!isPathWithinRoot(cwd, PROJECT_ROOT)) {
      clearTimeout(requestTimeout);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid directory' }));
      return;
    }
    
    // If commit hash provided, return session details for that commit
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx jest tests/unit/lib/routes/api.test.js`
Expected: PASS, all 3 tests

- [ ] **Step 10: Run the full test suite**

Run: `npm test`
Expected: all suites pass

- [ ] **Step 11: Commit**

```bash
git add lib/security.js lib/config.js lib/routes/api.js tests/unit/lib/security.test.js tests/unit/lib/routes/api.test.js
git commit -m "fix(api): reject git-blame cwd values outside the configured project root"
```

---

### Task 3: Cap request body size and stop leaking raw error messages

Fixes issue #6 (unbounded request body on `/api/insights/analyze`, internal error strings echoed to clients).

**Files:**
- Modify: `lib/config.js`
- Modify: `lib/routes/api.js`
- Test: `tests/unit/lib/routes/api.test.js`

**Interfaces:**
- Produces: `lib/config.js` gains `MAX_REQUEST_BODY_BYTES` (number, default `1048576` — 1 MiB).

- [ ] **Step 1: Add `MAX_REQUEST_BODY_BYTES` to `lib/config.js`**

Modify `lib/config.js` — add after the `PROJECT_ROOT` line (or after `AUTH_TOKEN` if Task 2 has not merged yet):

```js
  MAX_REQUEST_BODY_BYTES: 1024 * 1024,
```

- [ ] **Step 2: Write the failing tests**

Modify `tests/unit/lib/routes/api.test.js` — add near the top, alongside the existing `git-blame` mock:

```js
const { handleInsightsAnalyzeRoute, handleTokensRoute } = require('../../../../lib/routes/api');
const { EventEmitter } = require('events');

function createMockReq(url, headers = { host: 'localhost:7071' }) {
  const req = new EventEmitter();
  req.url = url;
  req.headers = headers;
  req.destroy = jest.fn();
  return req;
}
```

Add new `describe` blocks:

```js

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
    jest.dontMock('../../../../lib/cache');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest tests/unit/lib/routes/api.test.js`
Expected: FAIL — body-size test gets no `413`/never resolves as expected; error-message test sees the raw `ENOENT: /secret/internal/path` string in `parsed.error`

- [ ] **Step 4: Cap the body size in `handleInsightsAnalyzeRoute`**

Modify `lib/routes/api.js` — add the config import near the top:

```js
const { getTokensData, getHistoricalData } = require('../cache');
const { MAX_REQUEST_BODY_BYTES } = require('../config');
```

Replace:

```js
async function handleInsightsAnalyzeRoute(req, res, requestTimeout) {
  try {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
```

with:

```js
async function handleInsightsAnalyzeRoute(req, res, requestTimeout) {
  try {
    let body = '';
    let bodyBytes = 0;
    let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_REQUEST_BODY_BYTES) {
        rejected = true;
        clearTimeout(requestTimeout);
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', async () => {
      if (rejected) return;
      try {
```

- [ ] **Step 5: Stop leaking raw error messages in all five route catch blocks**

Modify `lib/routes/api.js` — in each of the five handlers below, replace the raw `err.message` in the client-facing JSON with a generic message, and log the real error server-side.

Replace (in `handleTokensRoute`):
```js
  } catch (err) {
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * Call Kimi K2.5 API for insights
 */
```
with:
```js
  } catch (err) {
    console.error('handleTokensRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Call Kimi K2.5 API for insights
 */
```

Replace (in `handleHistoricalRoute`):
```js
  } catch (err) {
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * Handle /api/health route
 */
```
with:
```js
  } catch (err) {
    console.error('handleHistoricalRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Handle /api/health route
 */
```

Replace (in `handleGitBlameRoute`):
```js
  } catch (err) {
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * Handle /api/spikes/detect route
 */
```
with:
```js
  } catch (err) {
    console.error('handleGitBlameRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Handle /api/spikes/detect route
 */
```

Replace (in `handleSpikesListRoute`):
```js
  } catch (err) {
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * Handle /api/spikes/investigate route
 */
```
with:
```js
  } catch (err) {
    console.error('handleSpikesListRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Handle /api/spikes/investigate route
 */
```

Replace (in `handleSpikeDetectiveRoute`, the last occurrence in the file, immediately before `module.exports`):
```js
  } catch (err) {
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

module.exports = {
```
with:
```js
  } catch (err) {
    console.error('handleSpikeDetectiveRoute error:', err);
    clearTimeout(requestTimeout);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

module.exports = {
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest tests/unit/lib/routes/api.test.js`
Expected: PASS, all tests

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: all suites pass

- [ ] **Step 8: Commit**

```bash
git add lib/config.js lib/routes/api.js tests/unit/lib/routes/api.test.js
git commit -m "fix(api): cap request body size and stop echoing raw error messages to clients"
```

---

### Task 4: Escape `err.message` before rendering as HTML in analytics tabs

Fixes issue #3 (XSS via unescaped `err.message` rendered into `innerHTML`). Rescoped from the original plan: `dashboard/js/views/analytics.js` was refactored down to a 171-line shell since this plan was drafted, and `renderLLMInsights`'s own escaping already landed upstream (`dashboard/js/views/analytics/tabs/insights.js:397`). Only 3 raw `err.message` sites remain, in `tabs/git.js` (2 sites) and `tabs/spikes.js` (2 sites, one shared line pattern) — 4 call sites in total across the two files.

**Files:**
- Modify: `dashboard/js/views/analytics/tabs/git.js`
- Modify: `dashboard/js/views/analytics/tabs/spikes.js`
- Test: `tests/unit/analytics-tabs-error-escaping.test.js` (new file)

**Interfaces:**
- Consumes: the existing `escapeHtml` export from `dashboard/js/views/analytics/tabs/shared.js`, already imported into both target files — no new imports needed.
- No exports change; `loadGitBlame`, `showCommitDetails` (or its details-loading function), `loadSpikes`, and `investigateSpike` keep their existing signatures. Confirm the exact function name wrapping the `content.innerHTML = ... commit-details-error ...` site by reading `git.js` in full before editing (the plan's earlier line numbers are approximate; the merge that rescoped this task did not renumber `git.js`/`spikes.js` internally, but always verify against the file in front of you, not this plan's remembered line numbers).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/analytics-tabs-error-escaping.test.js`:

```js
/**
 * @jest-environment jsdom
 */

import { loadGitBlame, showCommitDetails } from '../../dashboard/js/views/analytics/tabs/git.js';
import { loadSpikes, investigateSpike } from '../../dashboard/js/views/analytics/tabs/spikes.js';

const XSS_MESSAGE = '<img src=x onerror=alert(1)>';

beforeEach(() => {
  document.body.innerHTML = `
    <select id="git-days-selector"><option value="30" selected>30</option></select>
    <select id="git-directory-selector"><option value="" selected></option></select>
    <div id="git-commits-list"></div>
    <div id="git-files-list"></div>
    <div id="commit-details-content"></div>
    <div id="spikes-list"></div>
    <div id="spike-investigation" style="display:none"></div>
    <div id="spike-details"></div>
    <div id="spike-sessions"></div>
  `;
  global.fetch = jest.fn().mockRejectedValue(new Error(XSS_MESSAGE));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('git blame tab error escaping', () => {
  it('escapes err.message when the git blame fetch fails', async () => {
    await loadGitBlame();
    const html = document.getElementById('git-commits-list').innerHTML;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('spike detective tab error escaping', () => {
  it('escapes err.message when the spikes list fetch fails', async () => {
    await loadSpikes();
    const html = document.getElementById('spikes-list').innerHTML;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('escapes err.message when spike investigation fetch fails', async () => {
    await investigateSpike(1700000000000);
    const html = document.getElementById('spike-details').innerHTML;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
```

Note: the `showCommitDetails` test for `git.js`'s second site (`commit-details-error`) is intentionally omitted from the initial failing-test set if `showCommitDetails` requires DOM/state setup beyond what's shown above (e.g. an open commit-details panel) — read the function in `git.js` first and add a matching test for it in Step 1 alongside the three above, following the same `global.fetch` rejection pattern. Do not skip covering it; all 4 call sites need a passing regression test before Step 5.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/analytics-tabs-error-escaping.test.js`
Expected: FAIL — each assertion's `innerHTML` contains the raw `<img` tag

- [ ] **Step 3: Escape the `err.message` sites in `git.js`**

Modify `dashboard/js/views/analytics/tabs/git.js`. Replace:
```js
                <p>${err.message}</p>
```
with:
```js
                <p>${escapeHtml(err.message)}</p>
```

Replace:
```js
        content.innerHTML = `<div class="commit-details-error">Error: ${err.message}</div>`;
```
with:
```js
        content.innerHTML = `<div class="commit-details-error">Error: ${escapeHtml(err.message)}</div>`;
```

- [ ] **Step 4: Escape the `err.message` sites in `spikes.js`**

Modify `dashboard/js/views/analytics/tabs/spikes.js` at both occurrences of:
```js
    listEl.innerHTML = `<div class="loading-placeholder">Error: ${err.message}</div>`;
```
with:
```js
    listEl.innerHTML = `<div class="loading-placeholder">Error: ${escapeHtml(err.message)}</div>`;
```

and:
```js
    detailsEl.innerHTML = `<div class="loading-placeholder">Error: ${err.message}</div>`;
```
with:
```js
    detailsEl.innerHTML = `<div class="loading-placeholder">Error: ${escapeHtml(err.message)}</div>`;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/unit/analytics-tabs-error-escaping.test.js`
Expected: PASS, all tests (including the `showCommitDetails` test added in Step 1)

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all suites pass

- [ ] **Step 7: Commit**

```bash
git add dashboard/js/views/analytics/tabs/git.js dashboard/js/views/analytics/tabs/spikes.js tests/unit/analytics-tabs-error-escaping.test.js
git commit -m "fix(analytics): escape err.message before innerHTML rendering in git-blame and spike-detective tabs"
```
