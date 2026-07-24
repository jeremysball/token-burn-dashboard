import { readFile, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const THRESHOLD = 10;
const METRICS = ['branches', 'functions', 'lines', 'statements'];
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Worker-thread entry points that require worker_threads.parentPort at the top
// level and cannot be require()'d in a non-worker test context.  These files are
// exercised indirectly through their parent modules (lib/cache.js spawns them).
// Excluding them here avoids a false "missing in-scope file" failure while
// keeping every other unreported file visible.
const WORKER_ENTRY_POINTS = new Set([
  'lib/token-burn-worker.js',
  'lib/git-blame-worker.js'
]);

function normalizePath(file) {
  return relative(ROOT, resolve(ROOT, file)).split(sep).join('/');
}

function readCount(record, key) {
  const match = record.match(new RegExp(`^${key}:(\\d+)$`, 'm'));
  return Number(match?.[1] ?? 0);
}

function percentage(hit, found) {
  return found === 0 ? 100 : Number(((hit / found) * 100).toFixed(2));
}

export function summarizeLcov(lcov, inScopeFiles) {
  const counts = {
    branches: { found: 0, hit: 0 },
    functions: { found: 0, hit: 0 },
    lines: { found: 0, hit: 0 }
  };
  const reportedFiles = new Set();

  for (const record of lcov.split('end_of_record')) {
    const source = record.match(/^SF:(.+)$/m)?.[1];
    if (!source) continue;

    reportedFiles.add(normalizePath(source));
    counts.branches.found += readCount(record, 'BRF');
    counts.branches.hit += readCount(record, 'BRH');
    counts.functions.found += readCount(record, 'FNF');
    counts.functions.hit += readCount(record, 'FNH');
    counts.lines.found += readCount(record, 'LF');
    counts.lines.hit += readCount(record, 'LH');
  }

  const summary = {
    branches: percentage(counts.branches.hit, counts.branches.found),
    functions: percentage(counts.functions.hit, counts.functions.found),
    lines: percentage(counts.lines.hit, counts.lines.found),
    // LCOV has no separate statement counter. Bun's line records are the
    // closest equivalent for preserving the legacy statement threshold.
    statements: percentage(counts.lines.hit, counts.lines.found)
  };
  const missingFiles = inScopeFiles.filter((file) => !reportedFiles.has(file) && !WORKER_ENTRY_POINTS.has(file));
  const belowThreshold = METRICS.filter((metric) => summary[metric] < THRESHOLD);

  if (belowThreshold.length > 0 || missingFiles.length > 0) {
    const failures = belowThreshold.map((metric) => `${metric} ${summary[metric].toFixed(2)}% < ${THRESHOLD}%`);
    const missing = missingFiles.length > 0 ? `missing in-scope files: ${missingFiles.join(', ')}` : '';
    throw new Error(`Coverage thresholds not met: ${failures.join(', ')}${failures.length > 0 && missing ? '; ' : ''}${missing}`);
  }

  return summary;
}

async function sourceFiles(directory) {
  const entries = await readdir(resolve(ROOT, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.js') ? [path] : [];
  }));
  return files.flat();
}

if (import.meta.main) {
  try {
    const lcov = await readFile(resolve(ROOT, 'coverage/lcov.info'), 'utf8');
    const inScopeFiles = (await Promise.all(['dashboard/js', 'lib'].map(sourceFiles))).flat();
    const summary = summarizeLcov(lcov, inScopeFiles);
    console.log(`Coverage: ${METRICS.map((metric) => `${metric} ${summary[metric].toFixed(2)}%`).join(', ')}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
