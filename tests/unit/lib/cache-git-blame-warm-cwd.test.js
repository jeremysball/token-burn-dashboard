import { describe, expect, it } from 'bun:test';

const { __GIT_BLAME_WARM_CWD_FOR_TESTING } = require('../../../lib/cache');
const { PROJECT_ROOT } = require('../../../lib/config');

describe('git blame warmup cwd', () => {
  it('primes the route cache under config PROJECT_ROOT, not the server process cwd (#117 finding 6)', () => {
    // Must match handleGitBlameRoute's default cwd (lib/routes/api.js) so
    // the warmed cache key is the one the route actually requests.
    expect(__GIT_BLAME_WARM_CWD_FOR_TESTING).toBe(PROJECT_ROOT);
    expect(__GIT_BLAME_WARM_CWD_FOR_TESTING).not.toBe(process.cwd());
  });
});
