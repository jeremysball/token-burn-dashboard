import { afterEach, describe, expect, it, spyOn } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { findSpikes } = require('../../../lib/spike-detective');

describe('spike-detective findSpikes', () => {
  it('returns empty array for null input', () => {
    expect(findSpikes(null)).toEqual([]);
  });

  it('returns empty array for fewer than 3 data points', () => {
    expect(findSpikes([{ time: 1, total: 100 }, { time: 2, total: 200 }])).toEqual([]);
  });

  it('detects a spike when current value is >= 2x the rolling average', () => {
    const data = [
      { time: 1, total: 10000 },
      { time: 2, total: 10000 },
      { time: 3, total: 30000 },
    ];
    const spikes = findSpikes(data, 2.0);
    expect(spikes).toHaveLength(1);
    expect(spikes[0].time).toBe(3);
    expect(spikes[0].tokens).toBe(30000);
  });

  it('does not flag normal fluctuations below the threshold', () => {
    const data = [
      { time: 1, total: 10000 },
      { time: 2, total: 10000 },
      { time: 3, total: 15000 },
    ];
    expect(findSpikes(data, 2.0)).toEqual([]);
  });

  it('ignores small token counts even when the ratio is high', () => {
    const data = [
      { time: 1, total: 10 },
      { time: 2, total: 10 },
      { time: 3, total: 50 },
    ];
    expect(findSpikes(data, 2.0)).toEqual([]);
  });

  it('caps output at 10 most recent spikes', () => {
    const data = [];
    for (let i = 0; i < 20; i++) {
      const normal = i % 3 === 2 ? 100 : 10000;
      const spike = i % 3 === 2 ? 100000 : 10000;
      data.push({ time: i, total: i % 3 === 2 ? spike : normal });
    }
    const spikes = findSpikes(data, 2.0);
    expect(spikes.length).toBeLessThanOrEqual(10);
  });
});

describe('spike-detective session lookup (Claude + Pi formats)', () => {
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
  // require time (module-level singleton), so both session-discovery and
  // spike-detective must be re-required after changing the env vars.
  const reloadSpikeDetective = () => {
    delete require.cache[require.resolve('../../../lib/session-discovery')];
    delete require.cache[require.resolve('../../../lib/spike-detective')];
    return require('../../../lib/spike-detective');
  };

  it('finds a Claude-format session, extracting tokens/cost/model/preview', () => {
    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-claude-'));
    const projectDir = path.join(claudeRoot, 'test-project');
    fs.mkdirSync(projectDir);
    const sessionId = crypto.randomUUID();
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    const now = Date.now();
    const iso = new Date(now).toISOString();

    fs.writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Investigate the cache-hit spike please' }] },
        timestamp: iso
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-sonnet-5',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 5
          }
        },
        timestamp: iso
      })
    ].join('\n') + '\n');

    const emptyExtraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-extra-empty-'));
    tmpDirs.push(claudeRoot, emptyExtraDir);
    process.env.CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.EXTRA_SESSION_DIRS = emptyExtraDir;

    const { getSessionsInWindow } = reloadSpikeDetective();
    const sessions = getSessionsInWindow(now - 60000, now + 60000);

    const found = sessions.find(s => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.tokens).toBe(165);
    expect(found.cost).toBeGreaterThan(0);
    expect(found.models).toContain('anthropic/claude-sonnet-5');
    expect(found.previews[0]).toContain('Investigate the cache-hit spike');
  });

  it('investigateSpike returns non-empty sessions for a Claude-format spike (bug repro)', () => {
    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-claude-spike-'));
    const projectDir = path.join(claudeRoot, 'test-project');
    fs.mkdirSync(projectDir);
    const sessionId = crypto.randomUUID();
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    const now = Date.now();

    fs.writeFileSync(sessionFile, JSON.stringify({
      type: 'assistant',
      message: {
        model: 'claude-sonnet-5',
        usage: { input_tokens: 1000, output_tokens: 500 }
      },
      timestamp: new Date(now).toISOString()
    }) + '\n');

    const emptyExtraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-extra-empty-'));
    tmpDirs.push(claudeRoot, emptyExtraDir);
    process.env.CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.EXTRA_SESSION_DIRS = emptyExtraDir;

    const { investigateSpike } = reloadSpikeDetective();
    const result = investigateSpike(now, 30);

    expect(result.summary.totalSessions).toBeGreaterThan(0);
    expect(result.sessions.some(s => s.id === sessionId)).toBe(true);
  });

  it('finds a session whose content overlaps the window even though its last write (mtime) is well after it', () => {
    // A long-running session gets appended to well past any earlier spike
    // it contains, so its mtime (the *last* write) can sit far outside a
    // window whose *content* it genuinely overlaps.
    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-claude-longrun-'));
    const projectDir = path.join(claudeRoot, 'test-project');
    fs.mkdirSync(projectDir);
    const sessionId = crypto.randomUUID();
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);

    const spikeTime = Date.now() - 6 * 60 * 60 * 1000; // 6 hours ago
    const laterTime = Date.now() - 60 * 1000; // 1 minute ago

    fs.writeFileSync(sessionFile, JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet-5', usage: { input_tokens: 500, output_tokens: 200 } },
      timestamp: new Date(spikeTime).toISOString()
    }) + '\n');
    // Appending later moves the file's mtime forward, simulating the
    // session continuing well past the spike window.
    fs.appendFileSync(sessionFile, JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 } },
      timestamp: new Date(laterTime).toISOString()
    }) + '\n');

    const emptyExtraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-extra-empty-'));
    tmpDirs.push(claudeRoot, emptyExtraDir);
    process.env.CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.EXTRA_SESSION_DIRS = emptyExtraDir;

    const { getSessionsInWindow } = reloadSpikeDetective();
    const sessions = getSessionsInWindow(spikeTime - 15 * 60 * 1000, spikeTime + 15 * 60 * 1000);

    const found = sessions.find(s => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.tokens).toBe(715); // full session total: 500+200 + 10+5
  });

  it('finds a session even when the first sampled line is not the chronologically earliest (#117 finding 7)', () => {
    // approxSessionStartTime's cheap pre-filter must take the *minimum*
    // timestamp across the sampled lines, not just the first one found -
    // an out-of-order sample (legacy/cross-device write, EXTRA_SESSION_DIRS)
    // could otherwise report a start time later than the file's true
    // earliest usage, wrongly excluding a file whose real content overlaps
    // the window.
    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-claude-outoforder-'));
    const projectDir = path.join(claudeRoot, 'test-project');
    fs.mkdirSync(projectDir);
    const sessionId = crypto.randomUUID();
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);

    const trueEarliest = Date.now();
    const laterFirstLine = trueEarliest + 10 * 60 * 1000; // 10 minutes later

    // First line in the file (and thus first in the 64KB sample) has a
    // LATER timestamp than the second line - out of chronological order.
    fs.writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-5', usage: { input_tokens: 10, output_tokens: 5 } },
        timestamp: new Date(laterFirstLine).toISOString()
      }),
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-5', usage: { input_tokens: 500, output_tokens: 200 } },
        timestamp: new Date(trueEarliest).toISOString()
      })
    ].join('\n') + '\n');

    const emptyExtraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-extra-empty-'));
    tmpDirs.push(claudeRoot, emptyExtraDir);
    process.env.CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.EXTRA_SESSION_DIRS = emptyExtraDir;

    const { getSessionsInWindow } = reloadSpikeDetective();
    // Window only covers the true-earliest end; the buggy first-line-found
    // estimate (laterFirstLine) would sit after this window's endTime and
    // get the file wrongly skipped by the cheap pre-filter.
    const sessions = getSessionsInWindow(trueEarliest - 5 * 60 * 1000, trueEarliest + 2 * 60 * 1000);

    const found = sessions.find(s => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.tokens).toBe(715); // full session total: 10+5 + 500+200
  });

  it('reads each session file at most once per investigation (#117 finding 3: no separate preview re-read)', () => {
    const claudeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-claude-singleread-'));
    const projectDir = path.join(claudeRoot, 'test-project');
    fs.mkdirSync(projectDir);
    const sessionId = crypto.randomUUID();
    const sessionFile = path.join(projectDir, `${sessionId}.jsonl`);
    const now = Date.now();
    const iso = new Date(now).toISOString();

    fs.writeFileSync(sessionFile, [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'why the spike' }] },
        timestamp: iso
      }),
      JSON.stringify({
        type: 'assistant',
        message: { model: 'claude-sonnet-5', usage: { input_tokens: 100, output_tokens: 50 } },
        timestamp: iso
      })
    ].join('\n') + '\n');

    const emptyExtraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-extra-empty-'));
    tmpDirs.push(claudeRoot, emptyExtraDir);
    process.env.CLAUDE_PROJECTS_DIR = claudeRoot;
    process.env.EXTRA_SESSION_DIRS = emptyExtraDir;

    const { getSessionsInWindow } = reloadSpikeDetective();

    const readFileSyncSpy = spyOn(fs, 'readFileSync');
    let sessions;
    let readsOfThisFile;
    try {
      sessions = getSessionsInWindow(now - 60000, now + 60000);
      // mockRestore() below also clears .mock.calls, so snapshot it first.
      readsOfThisFile = readFileSyncSpy.mock.calls.filter(([p]) => p === sessionFile);
    } finally {
      readFileSyncSpy.mockRestore();
    }

    const found = sessions.find(s => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.previews[0]).toContain('why the spike');
    expect(readsOfThisFile).toHaveLength(1);
  });

  it('still finds a Pi-format nested session (regression guard)', () => {
    const piBase = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-pi-'));
    const sessionId = crypto.randomUUID();
    const sessionDir = path.join(piBase, sessionId);
    fs.mkdirSync(sessionDir);
    const now = Date.now();

    fs.writeFileSync(path.join(sessionDir, 'session.jsonl'), [
      JSON.stringify({
        type: 'message',
        message: { role: 'user', content: 'What is causing this spike?' },
        timestamp: now
      }),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          provider: 'test',
          model: 'pi-test-model',
          timestamp: now,
          usage: { input: 20, output: 10, totalTokens: 30 }
        }
      })
    ].join('\n') + '\n');

    const emptyClaudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-claude-empty-'));
    tmpDirs.push(piBase, emptyClaudeDir);
    process.env.EXTRA_SESSION_DIRS = piBase;
    process.env.CLAUDE_PROJECTS_DIR = emptyClaudeDir;

    const { getSessionsInWindow } = reloadSpikeDetective();
    const sessions = getSessionsInWindow(now - 60000, now + 60000);

    const found = sessions.find(s => s.id === sessionId);
    expect(found).toBeDefined();
    expect(found.tokens).toBe(30);
    expect(found.models).toContain('test/pi-test-model');
    expect(found.previews[0]).toContain('What is causing this spike');
  });
});
