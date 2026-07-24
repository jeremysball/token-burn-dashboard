import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const baselinePath = 'config/eslint-baseline.json';
const policyFiles = ['eslint.config.mjs', 'bun.lock'];

export function getPolicyHash() {
  const hash = createHash('sha256');

  for (const file of policyFiles) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(resolve(file)));
    hash.update('\0');
  }

  return hash.digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateBaseline(baseline) {
  if (!isObject(baseline) || typeof baseline.policyHash !== 'string' || !isObject(baseline.warnings)) {
    return 'malformed lint baseline';
  }

  for (const [bucket, count] of Object.entries(baseline.warnings)) {
    if (!bucket || !Number.isSafeInteger(count) || count < 0) {
      return 'malformed lint baseline';
    }
  }

  return null;
}

function relativeFilePath(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    return null;
  }

  const path = relative(process.cwd(), resolve(filePath));
  if (!path || path === '..' || path.startsWith(`..${sep}`)) {
    return null;
  }

  return path.split(sep).join('/');
}

function inspectReport(report) {
  if (!Array.isArray(report)) {
    return { violations: ['malformed lint report'], warnings: {} };
  }

  const violations = [];
  const warnings = {};

  for (const fileResult of report) {
    if (!isObject(fileResult) || !Array.isArray(fileResult.messages)) {
      violations.push('malformed lint report');
      continue;
    }

    const filePath = relativeFilePath(fileResult.filePath);
    if (!filePath) {
      violations.push('malformed lint report');
      continue;
    }

    for (const message of fileResult.messages) {
      if (!isObject(message) || !Number.isInteger(message.severity)) {
        violations.push('malformed lint report');
        continue;
      }

      const ruleId = typeof message.ruleId === 'string' && message.ruleId ? message.ruleId : 'unknown';
      if (message.fatal === true) {
        violations.push(`fatal lint message: ${filePath}`);
      }
      if (message.severity === 2) {
        violations.push(`lint error: ${filePath}|${ruleId}`);
      } else if (message.severity === 1) {
        if (ruleId === 'unknown') {
          violations.push('malformed lint report');
          continue;
        }
        const bucket = `${filePath}|${ruleId}`;
        warnings[bucket] = (warnings[bucket] ?? 0) + 1;
      } else if (message.severity !== 0) {
        violations.push('malformed lint report');
      }
    }
  }

  return { violations, warnings };
}

export function compareReport(report, baseline) {
  const comparison = inspectReport(report);
  const baselineError = validateBaseline(baseline);

  if (baselineError) {
    comparison.violations.push(baselineError);
  } else {
    if (baseline.policyHash !== getPolicyHash()) {
      comparison.violations.push('lint policy hash changed');
    }

    for (const [bucket, count] of Object.entries(comparison.warnings)) {
      const previousCount = baseline.warnings[bucket];
      if (previousCount === undefined) {
        comparison.violations.push(`new warning bucket: ${bucket}`);
      } else if (count > previousCount) {
        comparison.violations.push(`increased warning bucket: ${bucket} (${previousCount} -> ${count})`);
      }
    }
  }

  return { ok: comparison.violations.length === 0, violations: comparison.violations };
}

function parseReport(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`unable to read lint report ${path}: ${error.message}`, { cause: error });
  }
}

function readBaseline() {
  try {
    return JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    throw new Error(`unable to read lint baseline ${baselinePath}: ${error.message}`, { cause: error });
  }
}

function run() {
  const args = process.argv.slice(2);
  const update = args[0] === '--update';
  const reportPath = update ? args[1] : args[0];
  if (!reportPath || args.length !== (update ? 2 : 1)) {
    throw new Error('usage: bun scripts/lint-baseline.mjs [--update] <eslint-json-report>');
  }

  const report = parseReport(reportPath);
  if (update) {
    const inspection = inspectReport(report);
    if (inspection.violations.length > 0) {
      throw new Error(inspection.violations.join('\n'));
    }

    const warnings = Object.fromEntries(Object.entries(inspection.warnings).sort(([left], [right]) => left.localeCompare(right)));
    writeFileSync(baselinePath, `${JSON.stringify({ policyHash: getPolicyHash(), warnings }, null, 2)}\n`);
    return;
  }

  const result = compareReport(report, readBaseline());
  if (!result.ok) {
    throw new Error(result.violations.join('\n'));
  }
}

if (import.meta.main) {
  try {
    run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
