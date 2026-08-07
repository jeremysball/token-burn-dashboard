const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { getCommitLOC, generateGitBlameReport, isValidCommitHash, getSessionTimeWindow } = require('../../../lib/git-blame');

import { afterEach, describe, expect, test } from 'bun:test';

describe('lib/git-blame getCommitLOC', () => {
  const cwd = path.resolve(__dirname, '../../'); // repo root, a real git repo

  test('returns zeroed shape for invalid hash', () => {
    const r = getCommitLOC('not-a-hash');
    expect(r).toEqual({ filesChanged: 0, insertions: 0, deletions: 0, loc: 0 });
  });

  test('returns zeroed shape for non-existent but valid-format hash', () => {
    const r = getCommitLOC('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(r).toEqual({ filesChanged: 0, insertions: 0, deletions: 0, loc: 0 });
  });

  test('parses shortstat for a real commit hash', () => {
    const { execSync } = require('child_process');
    const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    const r = getCommitLOC(head, cwd);
    expect(r.filesChanged).toBeGreaterThanOrEqual(0);
    expect(typeof r.loc).toBe('number');
    expect(r.loc).toBe(r.insertions + r.deletions);
  });
});

describe('lib/git-blame getCommitLOC integration shape', () => {
  const cwd = path.resolve(__dirname, '../../');

  test('returns the exact shortstat shape consumed by analytics KPIs', () => {
    const { execSync } = require('child_process');
    const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    const loc = getCommitLOC(head, cwd);
    // Analytics reads c.loc?.loc, so the nested .loc field must be numeric.
    expect(typeof loc.filesChanged).toBe('number');
    expect(typeof loc.insertions).toBe('number');
    expect(typeof loc.deletions).toBe('number');
    expect(typeof loc.loc).toBe('number');
    expect(loc.loc).toBe(loc.insertions + loc.deletions);
  });

  test('isValidCommitHash rejects shell metacharacters', () => {
    expect(isValidCommitHash('abc; rm -rf /')).toBe(false);
    expect(isValidCommitHash('$(whoami)')).toBe(false);
    expect(isValidCommitHash('a'.repeat(40))).toBe(true);
  });
});

describe('lib/git-blame getSessionTimeWindow', () => {
  const tmpFiles = [];
  afterEach(() => {
    while (tmpFiles.length) {
      fs.rmSync(tmpFiles.pop(), { force: true });
    }
  });

  /** @param {string} contents */
  const writeTmpSession = (contents) => {
    const file = path.join(os.tmpdir(), `git-blame-time-window-${crypto.randomUUID()}.jsonl`);
    fs.writeFileSync(file, contents, 'utf-8');
    tmpFiles.push(file);
    return file;
  };

  test('derives startTime/endTime/midpoint from message timestamps', () => {
    const file = writeTmpSession([
      JSON.stringify({ type: 'message', message: { timestamp: 1000, usage: { input: 10, output: 5 } } }),
      JSON.stringify({ type: 'message', message: { timestamp: 3000, usage: { input: 10, output: 5 } } })
    ].join('\n') + '\n');

    const window = getSessionTimeWindow(file);
    expect(window.startTime).toBe(1000);
    expect(window.endTime).toBe(3000);
    expect(window.midpoint).toBe(2000);
  });

  test('falls back to file mtime when no usage-carrying lines parse', () => {
    const file = writeTmpSession('not valid jsonl\n');
    const mtime = fs.statSync(file).mtime.getTime();

    const window = getSessionTimeWindow(file);
    expect(window.startTime).toBe(mtime);
    expect(window.endTime).toBe(mtime);
    expect(window.midpoint).toBe(mtime);
  });
});

describe('lib/git-blame session lookup (Claude + Pi formats, #117 finding 4)', () => {
  const origExtraDirs = process.env.EXTRA_SESSION_DIRS;
  const origClaudeDir = process.env.CLAUDE_PROJECTS_DIR;
  const tmpDirs = [];

  afterEach(() => {
    if (origExtraDirs === undefined) delete process.env.EXTRA_SESSION_DIRS;
    else process.env.EXTRA_SESSION_DIRS = origExtraDirs;
    if (origClaudeDir === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
    else process.env.CLAUDE_PROJECTS_DIR = origClaudeDir;
    while (tmpDirs.length) {
      fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
    }
  });

  // findAllSessionFiles reads CLAUDE_PROJECTS_DIR/EXTRA_SESSION_DIRS at
  // require time (module-level singleton), so session-discovery and
  // git-blame must both be re-required after changing the env vars.
  const reloadGitBlame = () => {
    delete require.cache[require.resolve('../../../lib/session-discovery')];
    delete require.cache[require.resolve('../../../lib/git-blame')];
    return require('../../../lib/git-blame');
  };

  test('getSessionFilesInRange finds a Claude-format session, previously invisible to the Pi-only session-paths.js scan', () => {
    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-claude-'));
    const projectDir = path.join(claudeRoot, 'test-project');
    fs.mkdirSync(projectDir);
    const sessionId = crypto.randomUUID();
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    const now = Date.now();

    fs.writeFileSync(sessionFile, JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50 } },
      timestamp: new Date(now).toISOString()
    }) + '\n');

    const emptyExtraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-extra-empty-'));
    tmpDirs.push(claudeRoot, emptyExtraDir);
    process.env.CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.EXTRA_SESSION_DIRS = emptyExtraDir;

    const { getSessionFilesInRange } = reloadGitBlame();
    const sessions = getSessionFilesInRange(now - 60000, now + 60000);

    const found = sessions.find(s => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.path).toBe(sessionFile);
  });

  test('calculateSessionTokens computes real tokens/cost/model for a Claude-format session (was silently all-zero before unification)', () => {
    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-claude-tokens-'));
    const projectDir = path.join(claudeRoot, 'test-project');
    fs.mkdirSync(projectDir);
    const sessionId = crypto.randomUUID();
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    const iso = new Date().toISOString();

    fs.writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-sonnet-5',
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 }
        },
        timestamp: iso
      })
    ].join('\n') + '\n');

    const emptyExtraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-extra-empty-'));
    tmpDirs.push(claudeRoot, emptyExtraDir);
    process.env.CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.EXTRA_SESSION_DIRS = emptyExtraDir;

    const { calculateSessionTokens } = reloadGitBlame();
    const usage = calculateSessionTokens(sessionFile, true);

    expect(usage.totalTokens).toBe(165);
    expect(usage.totalCost).toBeGreaterThan(0);
    expect(usage.models['anthropic/claude-sonnet-5']).toBeDefined();
    expect(usage.models['anthropic/claude-sonnet-5'].tokens).toBe(165);
    expect(usage.details).toHaveLength(1);
    expect(usage.details[0].model).toBe('anthropic/claude-sonnet-5');
    expect(usage.details[0].tokens).toBe(165);
  });

  test('calculateSessionTokens still computes tokens/cost for a Pi-format session (regression guard)', () => {
    const piRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-pi-'));
    const sessionId = crypto.randomUUID();
    const sessionFile = path.join(piRoot, `${sessionId}.jsonl`);

    fs.writeFileSync(sessionFile, JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        model: 'gpt-5.6-luna',
        provider: 'openai',
        timestamp: Date.now(),
        usage: { input: 200, output: 80 }
      }
    }) + '\n');

    tmpDirs.push(piRoot);
    process.env.EXTRA_SESSION_DIRS = piRoot;
    process.env.CLAUDE_PROJECTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-claude-empty-'));
    tmpDirs.push(process.env.CLAUDE_PROJECTS_DIR);

    const { calculateSessionTokens } = reloadGitBlame();
    const usage = calculateSessionTokens(sessionFile);

    expect(usage.totalTokens).toBe(280);
    expect(usage.totalCost).toBeGreaterThan(0);
    expect(usage.models['openai/gpt-5.6-luna']).toBeDefined();
  });
});

describe('generateGitBlameReport session attribution across adjacent commit windows (review round 2 finding)', () => {
  const origExtraDirs = process.env.EXTRA_SESSION_DIRS;
  const origClaudeDir = process.env.CLAUDE_PROJECTS_DIR;
  const tmpDirs = [];

  afterEach(() => {
    if (origExtraDirs === undefined) delete process.env.EXTRA_SESSION_DIRS;
    else process.env.EXTRA_SESSION_DIRS = origExtraDirs;
    if (origClaudeDir === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
    else process.env.CLAUDE_PROJECTS_DIR = origClaudeDir;
    while (tmpDirs.length) {
      fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
    }
  });

  const reloadGitBlame = () => {
    delete require.cache[require.resolve('../../../lib/session-discovery')];
    delete require.cache[require.resolve('../../../lib/git-blame')];
    return require('../../../lib/git-blame');
  };

  /** @param {string} repoDir @param {string[]} args @param {Record<string,string>} [env] */
  const git = (repoDir, args, env) => execFileSync('git', args, { cwd: repoDir, env: env ? { ...process.env, ...env } : process.env });

  const commitAt = (repoDir, isoDate, message) => {
    fs.writeFileSync(path.join(repoDir, 'file.txt'), `${message}\n`, { flag: 'a' });
    git(repoDir, ['add', '.']);
    git(repoDir, ['commit', '-m', message], { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate });
  };

  test('a session spanning two adjacent commit windows is attributed exactly once, not summed into both', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-report-repo-'));
    git(repoDir, ['init']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);

    const t0 = Date.now() - 5 * 60 * 1000; // 5 minutes ago, well inside the report window
    commitAt(repoDir, new Date(t0).toISOString(), 'oldest');
    commitAt(repoDir, new Date(t0 + 60_000).toISOString(), 'middle');
    commitAt(repoDir, new Date(t0 + 120_000).toISOString(), 'newest');

    // Session usage spans [t0+10s, t0+90s]: overlaps the "oldest" commit's
    // window [t0, t0+60s] AND the "middle" commit's window [t0+60s, t0+120s],
    // but its midpoint (t0+50s) only ever fell in one window under the old
    // midpoint-only match. 100 tokens per event, 200 total across the file.
    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-report-claude-'));
    const projectDir = path.join(claudeRoot, 'test-project');
    fs.mkdirSync(projectDir);
    const sessionFile = path.join(projectDir, `${crypto.randomUUID()}.jsonl`);
    fs.writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 0 } },
        timestamp: new Date(t0 + 10_000).toISOString()
      }),
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 0 } },
        timestamp: new Date(t0 + 90_000).toISOString()
      })
    ].join('\n') + '\n');

    const emptyExtraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-report-extra-empty-'));
    tmpDirs.push(repoDir, claudeRoot, emptyExtraDir);
    process.env.CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.EXTRA_SESSION_DIRS = emptyExtraDir;

    const { generateGitBlameReport } = reloadGitBlame();
    const report = generateGitBlameReport(1, repoDir);

    const totalTokens = report.reduce((sum, c) => sum + c.tokens, 0);
    expect(totalTokens).toBe(200);

    const commitsWithTokens = report.filter(c => c.tokens > 0);
    expect(commitsWithTokens).toHaveLength(1);
  });
});
