import { afterAll, describe, expect, test } from 'bun:test';

const fs = require('fs');
const os = require('os');
const path = require('path');
const discoveryModule = require('../../../lib/session-discovery');
const { createSessionDiscovery } = discoveryModule;

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-test-'));

afterAll(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

function writeFile(filePath, size = 16) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'x'.repeat(size));
}

function createDiscovery({ homeDir, env = {}, config, visiblePaths = [] }) {
  const visible = new Set(visiblePaths);
  const fsImpl = {
    ...fs,
    existsSync(target) {
      return visible.has(target) && fs.existsSync(target);
    }
  };

  return createSessionDiscovery({
    fsImpl,
    osImpl: { homedir: () => homeDir },
    pathImpl: path,
    env,
    config
  });
}

describe('createSessionDiscovery', () => {
  test('returns the legacy public constants and finder functions', () => {
    const discovery = createSessionDiscovery({
      fsImpl: fs,
      osImpl: { homedir: () => '/home/tester' },
      pathImpl: path,
      env: {},
      config: { MAX_FILE_BYTES: 128, CLAUDE_MAX_DEPTH: 4 }
    });

    expect(discovery.PI_SESSION_BASES).toContain('/home/tester/.pi/sessions');
    expect(discovery.CLAUDE_PROJECTS_ROOT).toBe('/home/tester/.claude/projects');
    expect(discovery.findPiSessionDirs).toBeFunction();
    expect(discovery.findPiJsonlFiles).toBeFunction();
    expect(discovery.findClaudeJsonlFiles).toBeFunction();
    expect(discovery.findAllSessionFiles).toBeFunction();
    expect(discovery.findAllSessionDirs).toBeFunction();
  });

  test('derives session roots from injected environment and home dependencies', () => {
    const homeDir = path.join(tmpBase, 'home');
    const extraOne = path.join(tmpBase, 'extra-one');
    const extraTwo = path.join(tmpBase, 'extra-two');
    const claudeRoot = path.join(tmpBase, 'claude-projects');
    const discovery = createDiscovery({
      homeDir,
      env: {
        EXTRA_SESSION_DIRS: ` ${extraOne} : ${extraTwo} `,
        CLAUDE_PROJECTS_DIR: claudeRoot
      },
      config: { MAX_FILE_BYTES: 128, CLAUDE_MAX_DEPTH: 4 },
      visiblePaths: [extraOne, extraTwo, claudeRoot]
    });

    expect(discovery.PI_SESSION_BASES).toEqual(expect.arrayContaining([
      path.join(homeDir, '.pi/sessions'),
      path.join(homeDir, '.pi/agent/sessions'),
      extraOne,
      extraTwo
    ]));
    expect(discovery.CLAUDE_PROJECTS_ROOT).toBe(claudeRoot);
  });

  test('uses injected filesystem and size configuration when finding Pi files', () => {
    const base = path.join(tmpBase, 'pi-files');
    writeFile(path.join(base, 'small.jsonl'), 16);
    writeFile(path.join(base, 'deleted.deleted.jsonl'), 16);
    writeFile(path.join(base, 'large.jsonl'), 129);

    const discovery = createDiscovery({
      homeDir: path.join(tmpBase, 'unused-home'),
      env: { EXTRA_SESSION_DIRS: base },
      config: { MAX_FILE_BYTES: 128, CLAUDE_MAX_DEPTH: 4 },
      visiblePaths: [base]
    });
    const files = discovery.findPiJsonlFiles();

    expect(files.map(file => path.basename(file.path))).toEqual(['small.jsonl']);
  });

  test('uses injected Claude root and maximum depth when finding Claude files', () => {
    const root = path.join(tmpBase, 'claude-files');
    writeFile(path.join(root, '-project', 'session.jsonl'));
    writeFile(path.join(root, '-project', 'subagents', 'nested.jsonl'));

    const discovery = createDiscovery({
      homeDir: path.join(tmpBase, 'unused-home'),
      env: { CLAUDE_PROJECTS_DIR: root },
      config: { MAX_FILE_BYTES: 128, CLAUDE_MAX_DEPTH: 1 },
      visiblePaths: [root]
    });
    const files = discovery.findClaudeJsonlFiles();

    expect(files.map(file => path.basename(file.path))).toEqual(['session.jsonl']);
  });

  test('keeps production exports available alongside the factory', () => {
    expect(discoveryModule.createSessionDiscovery).toBe(createSessionDiscovery);
    expect(discoveryModule.findAllSessionFiles).toBeFunction();
    expect(discoveryModule.PI_SESSION_BASES).toBeArray();
  });
});
