import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ESLint } from 'eslint';
import { mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { compareReport, getPolicyHash } from '../../scripts/lint-baseline.mjs';

const repositoryRoot = resolve(import.meta.dir, '../..');
const temporaryDirectory = join('/tmp', `lint-baseline-${process.pid}`);
const scriptPath = join(repositoryRoot, 'scripts/lint-baseline.mjs');

function warningReport(ruleId, count = 1) {
  return [{
    filePath: join(repositoryRoot, 'server.js'),
    messages: Array.from({ length: count }, () => ({ severity: 1, ruleId, message: 'warning' }))
  }];
}

function baseline(warnings) {
  return { policyHash: getPolicyHash(), warnings };
}

async function runGate(reportPath) {
  const process = Bun.spawn({
    cmd: ['bun', scriptPath, reportPath],
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  await process.exited;
  return process.exitCode;
}

describe('lint baseline gate', () => {
  beforeAll(async () => {
    await mkdir(temporaryDirectory, { recursive: true });
  });

  afterAll(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  test('rejects a warning for a new file and rule bucket', () => {
    const result = compareReport(warningReport('complexity'), baseline({}));

    expect(result.ok).toBeFalse();
    expect(result.violations).toContain('new warning bucket: server.js|complexity');
  });

  test('rejects an increased warning count in an existing bucket', () => {
    const result = compareReport(warningReport('complexity', 2), baseline({ 'server.js|complexity': 1 }));

    expect(result.ok).toBeFalse();
    expect(result.violations).toContain('increased warning bucket: server.js|complexity (1 -> 2)');
  });

  test('accepts a decreased warning count', () => {
    const result = compareReport(warningReport('complexity'), baseline({ 'server.js|complexity': 2 }));

    expect(result).toEqual({ ok: true, violations: [] });
  });

  test('rejects lint errors and fatal parser messages', () => {
    const result = compareReport([{
      filePath: join(repositoryRoot, 'server.js'),
      messages: [
        { severity: 2, ruleId: 'no-undef', message: 'undefined name' },
        { severity: 1, fatal: true, message: 'parser failed' }
      ]
    }], baseline({}));

    expect(result.ok).toBeFalse();
    expect(result.violations).toContain('lint error: server.js|no-undef');
    expect(result.violations).toContain('fatal lint message: server.js');
  });

  test('rejects a changed lint policy hash', () => {
    const result = compareReport(warningReport('complexity'), {
      policyHash: 'stale-policy',
      warnings: { 'server.js|complexity': 1 }
    });

    expect(result.ok).toBeFalse();
    expect(result.violations).toContain('lint policy hash changed');
  });

  test('rejects malformed and unreadable report input', async () => {
    const malformedPath = join(temporaryDirectory, 'malformed.json');
    await Bun.write(malformedPath, '{invalid json');

    expect(await runGate(malformedPath)).not.toBe(0);
    expect(await runGate(join(temporaryDirectory, 'missing.json'))).not.toBe(0);
  });

  test('resolves every enabled SonarJS rule at warning severity', async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const configuration = await eslint.calculateConfigForFile(join(repositoryRoot, 'server.js'));
    const sonarRules = Object.entries(configuration.rules).filter(([ruleId]) => ruleId.startsWith('sonarjs/'));

    expect(sonarRules.length).toBeGreaterThan(0);
    expect(sonarRules.filter(([, setting]) => setting[0] === 2)).toEqual([]);
  });

  test('provides Node globals to linted module scripts', async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const configuration = await eslint.calculateConfigForFile(scriptPath);

    expect(configuration.languageOptions.globals.process).toBeFalse();
    expect(configuration.languageOptions.globals.Bun).toBe('readonly');
  });

  test('provides Bun globals to native test files', async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const configuration = await eslint.calculateConfigForFile(join(repositoryRoot, 'tests/unit/lint-baseline.test.js'));

    expect(configuration.languageOptions.globals.Bun).toBe('readonly');
  });

  test('does not retain Jest compatibility globals', async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const configuration = await eslint.calculateConfigForFile(join(repositoryRoot, 'tests/unit/lint-baseline.test.js'));

    expect(configuration.languageOptions.globals.jest).toBeUndefined();
  });
});
