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
