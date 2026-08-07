import { describe, expect, it } from 'bun:test';

const { GIT_BLAME_WARM_CWD } = require('../../../lib/cache');
const { PROJECT_ROOT } = require('../../../lib/config');

describe('git blame warmup cwd', () => {
  it('primes the route cache under config PROJECT_ROOT, not the server process cwd (#117 finding 6)', () => {
    // Must match handleGitBlameRoute's default cwd (lib/routes/api.js) so
    // the warmed cache key is the one the route actually requests.
    expect(GIT_BLAME_WARM_CWD).toBe(PROJECT_ROOT);
    expect(GIT_BLAME_WARM_CWD).not.toBe(process.cwd());
  });
});
