# Bun Runtime And Strict Lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the dashboard and its quality gates on Bun while migrating unit tests off Jest and enforcing strict warning-only structural lint rules without allowing lint debt to grow.

**Architecture:** Bun replaces npm/Node as the repository's package manager, application runtime, CI runtime, and container runtime without changing the CommonJS server or browser ESM modules. Native `bun:test` uses happy-dom preloads and explicit dependency factories where Jest's module-cache mocking cannot translate. ESLint and SonarJS warnings are held to a committed per-file/per-rule baseline, not a global warning count.

**Tech Stack:** Bun `1.3.11`, `bun:test`, happy-dom `20.11.1`, `@happy-dom/global-registrator` `20.11.1`, ESLint `10.0.2`, eslint-plugin-sonarjs `4.2.0`, Vite, Playwright.

## Global Constraints

- Pin every newly installed dependency to the exact versions stated above.
- Commit `bun.lock`; delete `package-lock.json` after the Bun installation is reproducible.
- Keep `server.js`, `lib/**`, and `dashboard/js/**` in their current CJS/ESM module styles.
- Keep Playwright on its own `bunx playwright` command; never include `.spec.js` files in `bun test tests/unit`.
- Every new structural and SonarJS lint rule has warning severity. No exception.
- Structural limits: complexity `10`, file length `300`, function length `50`, statements `15`, depth `4`, parameters `4`, nested callbacks `3`.
- The lint baseline rejects errors, malformed reports, policy drift, new warning buckets, and increased warning counts.
- Execute implementation inside an isolated worktree. Do not modify the current main checkout.

---

## File Map

| Path | Responsibility |
| --- | --- |
| `package.json` | Pinned Bun package manager, scripts, dependency set, hook install command. |
| `bun.lock` | Committed Bun dependency graph. |
| `bunfig.toml` | Test preloads and Bun test defaults. |
| `tests/bun.preload.js` | Registers happy-dom before tests import application modules. |
| `tests/bun.setup.js` | Resets browser-global Bun mocks before every test. |
| `tests/unit/bun-runtime.test.js` | Proves Bun metadata, test scope, and Playwright separation. |
| `tests/unit/lib/config.test.js` | Uses `loadConfig(env)` rather than module reloading. |
| `tests/unit/lib/session-discovery.test.js` | Uses the session-discovery factory instead of process-global module reloads. |
| `tests/unit/lib/routes/api.test.js` | Injects taskferry and token dependencies rather than `jest.doMock`. |
| `tests/unit/lib/historical.test.js` | Injects session discovery rather than Jest module replacement. |
| `lib/config.js` | Exposes a pure configuration loader while preserving current exports. |
| `lib/session-discovery.js` | Exposes a discovery factory with explicit environment and filesystem dependencies. |
| `lib/routes/api.js` | Exposes focused handler factories for injected execution dependencies. |
| `lib/historical-data.js` | Exposes an extractor factory for injected session discovery. |
| `eslint.config.mjs` | Warning-only structural and SonarJS policy plus test-specific exceptions. |
| `scripts/lint-baseline.mjs` | Fail-closed per-file/per-rule lint debt checker. |
| `scripts/check-coverage.mjs` | Preserves Jest's 10% global coverage threshold from Bun LCOV output. |
| `config/eslint-baseline.json` | Reviewed initial warning baseline and policy identity. |
| `.github/workflows/check.yml` | Bun install, lint baseline, coverage, and typecheck CI legs. |
| `.githooks/pre-commit` | Bun-based staged lint, typecheck, and lint baseline gate. |
| `scripts/install-hooks.mjs` | Installs the hook inside a Git checkout and skips only non-checkout environments. |
| `Dockerfile` | Three-stage Bun image retaining git and non-root runtime behavior. |
| `_run.sh` | Bun local install, build, development, and production commands. |
| `.gitignore`, `.dockerignore` | Bun lockfile handling. |

---

### Task 1: Establish The Bun Substrate And Native Test Environment

**Files:**
- Create: `bunfig.toml`
- Create: `tests/bun.preload.js`
- Create: `tests/bun.setup.js`
- Create: `tests/unit/bun-runtime.test.js`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `.dockerignore`
- Delete: `package-lock.json`
- Create: `bun.lock`

**Interfaces:**
- Produces `bun test tests/unit` as the unit-test command.
- Produces happy-dom globals before every Bun test file loads.
- Later tasks import `mock`, `spyOn`, and test hooks directly from `bun:test`.

- [ ] **Step 1: Add a failing Bun-runtime contract test**

Create `tests/unit/bun-runtime.test.js`:

```js
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../..');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('Bun runtime contract', () => {
  test('pins Bun and scopes native tests to unit files', () => {
    expect(packageJson.packageManager).toBe('bun@1.3.11');
    expect(packageJson.scripts.test).toBe('bun test tests/unit --coverage');
    expect(packageJson.scripts['test:e2e']).toContain('bunx playwright');
  });
});
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `bun test tests/unit/bun-runtime.test.js`

Expected: FAIL because `packageManager` and Bun test scripts do not exist yet.

- [ ] **Step 3: Replace the package-manager and test substrate**

Update `package.json` to include these exact dependency and script changes:

```json
{
  "packageManager": "bun@1.3.11",
  "scripts": {
    "start": "bun server.js",
    "dev": "bun server.js",
    "build": "bun build.js",
    "test": "bun test tests/unit --coverage",
    "test:watch": "bun test tests/unit --watch",
    "test:e2e": "bunx playwright test tests/playwright/overflow.spec.js --reporter=list",
    "lint": "bunx eslint .",
    "lint:fix": "bunx eslint . --fix",
    "typecheck": "bunx tsc --noEmit",
    "check": "bun run lint && bun run typecheck",
    "prepare": "bun scripts/install-hooks.mjs",
    "dev:ui": "bunx --bun vite",
    "build:ui": "bunx --bun vite build"
  }
}
```

Replace the Jest/Babel dependencies with exact versions:

```json
"devDependencies": {
  "@eslint/js": "10.0.1",
  "@happy-dom/global-registrator": "20.11.1",
  "eslint": "10.0.2",
  "eslint-plugin-sonarjs": "4.2.0",
  "globals": "17.4.0",
  "happy-dom": "20.11.1",
  "typescript": "5.9.3",
  "vite": "7.3.6"
}
```

Remove `jest`, `jest-environment-jsdom`, `@babel/core`, and `@babel/preset-env`. Run `bun install`, commit the generated `bun.lock`, and delete `package-lock.json`.

Create `bunfig.toml`:

```toml
[test]
preload = ["./tests/bun.preload.js", "./tests/bun.setup.js"]
coverageDir = "./coverage"
```

Create `tests/bun.preload.js`:

```js
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();
```

Create `tests/bun.setup.js`:

```js
import { beforeEach, mock } from 'bun:test';

globalThis.Plotly = {
  newPlot: mock(() => Promise.resolve()),
  react: mock(() => Promise.resolve()),
  Plots: { resize: mock(() => {}) }
};

const createEventSource = () => ({ close: mock(() => {}), onmessage: null, onerror: null });
globalThis.EventSource = mock(createEventSource);
globalThis.fetch = mock(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

beforeEach(() => {
  globalThis.Plotly.newPlot.mockReset();
  globalThis.Plotly.react.mockReset();
  globalThis.Plotly.Plots.resize.mockReset();
  globalThis.EventSource.mockReset();
  globalThis.fetch.mockReset();
});
```

Add `bun.lockb` to `.gitignore` and `.dockerignore`; do not ignore `bun.lock`.

- [ ] **Step 4: Verify the native runner foundation**

Run: `bun install --frozen-lockfile && bun test tests/unit/bun-runtime.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the substrate**

```bash
git add package.json bun.lock bunfig.toml tests/bun.preload.js tests/bun.setup.js tests/unit/bun-runtime.test.js .gitignore .dockerignore package-lock.json
git commit -m "build: bootstrap Bun runtime and test environment"
```

### Task 2: Replace Environment-Reload Tests With Explicit Factories

**Files:**
- Modify: `lib/config.js`
- Modify: `lib/session-discovery.js`
- Modify: `tests/unit/lib/config.test.js`
- Modify: `tests/unit/lib/session-discovery.test.js`

**Interfaces:**
- Produces `loadConfig(env, cwd)` returning the current config shape.
- Produces `createSessionDiscovery({ fsImpl, osImpl, pathImpl, env, config })`.
- Existing callers retain the current `require('./lib/config')` and `require('./lib/session-discovery')` exports.

- [ ] **Step 1: Convert configuration tests to a failing factory contract**

Replace module-reload assertions in `tests/unit/lib/config.test.js` with direct factory tests:

```js
import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../../../lib/config.js';

test('loadConfig derives security defaults from the supplied environment', () => {
  expect(loadConfig({}, '/repo').HOST).toBe('127.0.0.1');
  expect(loadConfig({ PORT: '8080' }, '/repo').PORT).toBe('8080');
  expect(loadConfig({ ALLOWED_ORIGINS: 'https://a.example, https://b.example' }, '/repo').ALLOWED_ORIGINS)
    .toEqual(['https://a.example', 'https://b.example']);
});
```

- [ ] **Step 2: Run the configuration factory test and verify it fails**

Run: `bun test tests/unit/lib/config.test.js`

Expected: FAIL because `loadConfig` is not exported.

- [ ] **Step 3: Implement `loadConfig` without changing default behavior**

Refactor `lib/config.js` around this shape, preserving every existing constant:

```js
function loadConfig(env = process.env, cwd = process.cwd()) {
  return {
    PORT: env.PORT || 7071,
    HOST: env.HOST || '127.0.0.1',
    ALLOWED_ORIGINS: (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean),
    AUTH_TOKEN: env.DASHBOARD_AUTH_TOKEN || null,
    PROJECT_ROOT: env.DASHBOARD_PROJECT_ROOT || env.HOME || cwd,
    // Preserve every existing timeout, taskferry, security, and MIME constant here.
  };
}

module.exports = { ...loadConfig(), loadConfig };
```

Refactor `lib/session-discovery.js` so its path constants and search functions close over an explicit dependency object:

```js
function createSessionDiscovery({
  fsImpl = fs,
  osImpl = os,
  pathImpl = path,
  env = process.env,
  config = require('./config')
} = {}) {
  // Build PI_SESSION_BASES and CLAUDE_PROJECTS_ROOT from env and osImpl.
  // Return the existing public finder functions and constants.
}

const discovery = createSessionDiscovery();
module.exports = { ...discovery, createSessionDiscovery };
```

Update session discovery tests to call `createSessionDiscovery({ env, osImpl })` rather than mutating `process.env`, spying on `os.homedir`, and calling `resetModules`.

- [ ] **Step 4: Verify factory behavior and existing callers**

Run: `bun test tests/unit/lib/config.test.js tests/unit/lib/session-discovery.test.js`

Expected: PASS with no `jest.resetModules` calls remaining in either file.

- [ ] **Step 5: Commit explicit environment seams**

```bash
git add lib/config.js lib/session-discovery.js tests/unit/lib/config.test.js tests/unit/lib/session-discovery.test.js
git commit -m "refactor: expose configuration and discovery factories"
```

### Task 3: Make Route And Historical Dependencies Bun-Testable

**Files:**
- Modify: `lib/routes/api.js`
- Modify: `lib/historical-data.js`
- Modify: `tests/unit/lib/routes/api.test.js`
- Modify: `tests/unit/lib/historical.test.js`

**Interfaces:**
- Produces `createInsightsHandler({ execFileImpl, fsImpl, pathImpl, cryptoImpl })`.
- Produces `createTokensHandler({ getTokensDataImpl })`.
- Produces `createHistoricalDataExtractor({ findAllSessionFilesImpl })`.
- Existing exported handlers and `extractHistoricalData` use default production dependencies.

- [ ] **Step 1: Rewrite one route test to request an injected dependency**

Replace the first `jest.resetModules()` / `jest.doMock('child_process')` test with this Bun-native form:

```js
import { describe, expect, mock, test } from 'bun:test';
import { createInsightsHandler } from '../../../../lib/routes/api.js';

test('rejects malformed summaries without invoking taskferry', async () => {
  const execFileImpl = mock();
  const handleInsightsAnalyzeRoute = createInsightsHandler({ execFileImpl });
  const req = createMockReq('/api/insights/analyze');
  const res = createMockRes();

  const pending = handleInsightsAnalyzeRoute(req, res, undefined);
  req.emit('data', Buffer.from(JSON.stringify({ totals: {} })));
  req.emit('end');
  await pending;

  expect(res.statusCode).toBe(400);
  expect(execFileImpl).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the rewritten route test and verify it fails**

Run: `bun test tests/unit/lib/routes/api.test.js`

Expected: FAIL because `createInsightsHandler` does not exist.

- [ ] **Step 3: Implement focused handler factories**

In `lib/routes/api.js`, keep all current production exports and add focused factories instead of a whole-module dependency container:

```js
function createInsightsHandler({
  execFileImpl = execFile,
  fsImpl = fs,
  pathImpl = path,
  cryptoImpl = crypto
} = {}) {
  const execFileP = (file, args, options) => new Promise((resolve, reject) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });

  // Move runTaskferryAnalysis into this closure, replacing fs/path/crypto/execFile
  // references with the injected names. Return only handleInsightsAnalyzeRoute.
}

function createTokensHandler({ getTokensDataImpl = getTokensData } = {}) {
  return async function handleTokensRoute(req, res, requestTimeout) {
    try {
      const data = await getTokensDataImpl();
      clearTimeout(requestTimeout);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (error) {
      console.error('handleTokensRoute error:', error);
      clearTimeout(requestTimeout);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  };
}
```

Export default handlers created with no arguments, plus both factories. In `lib/historical-data.js`, wrap the current extractor so its call to `findAllSessionFiles` comes from `findAllSessionFilesImpl` and export the default extractor plus `createHistoricalDataExtractor`.

- [ ] **Step 4: Convert all incompatible mocks and preserve assertions**

Replace every `jest.doMock`, `jest.dontMock`, `jest.resetModules`, and `jest.requireActual` in `api.test.js` with factory injection and direct Bun `mock`/`spyOn` calls. Replace `historical.test.js`'s session-discovery module mock with:

```js
const extractHistoricalData = createHistoricalDataExtractor({
  findAllSessionFilesImpl: () => [{ path: file, source: 'pi' }]
});
```

Keep the existing assertions for NDJSON contents, taskferry cancellation, error-message redaction, and timestamp bucketing.

- [ ] **Step 5: Verify route and historical parity**

Run: `bun test tests/unit/lib/routes/api.test.js tests/unit/lib/historical.test.js`

Expected: PASS with no Jest module-cache API remaining.

- [ ] **Step 6: Commit the dependency seams**

```bash
git add lib/routes/api.js lib/historical-data.js tests/unit/lib/routes/api.test.js tests/unit/lib/historical.test.js
git commit -m "refactor: inject route and historical test dependencies"
```

### Task 4: Port The Remaining Unit Suite And Preserve Coverage

**Files:**
- Modify: `tests/setup.js` by replacing it with `tests/bun.setup.js`
- Modify: `tests/unit/**/*.test.js`
- Delete: `tests/setup.js`
- Delete: `jest.config.js`
- Delete: `.babelrc`
- Create: `scripts/check-coverage.mjs`

**Interfaces:**
- Produces a Jest-free unit suite using direct `bun:test` imports.
- Produces `bun run coverage:check` that enforces 10% lines, branches, functions, and statements.

- [ ] **Step 1: Add a failing coverage-report parser test**

Create `tests/unit/coverage-check.test.js` that writes this temporary LCOV fixture and invokes the parser's exported `summarizeLcov` function:

```js
import { describe, expect, test } from 'bun:test';
import { summarizeLcov } from '../../scripts/check-coverage.mjs';

test('rejects coverage below the preserved global threshold', () => {
  const summary = summarizeLcov('SF:lib/example.js\nLF:10\nLH:1\nFNF:10\nFNH:1\nBRF:10\nBRH:1\nDA:1,1\nend_of_record\n');
  expect(summary.lines).toBe(10);
  expect(summary.functions).toBe(10);
  expect(summary.branches).toBe(10);
  expect(summary.statements).toBe(10);
});
```

- [ ] **Step 2: Run the coverage parser test and verify it fails**

Run: `bun test tests/unit/coverage-check.test.js`

Expected: FAIL because `scripts/check-coverage.mjs` does not exist.

- [ ] **Step 3: Implement the coverage checker**

Create `scripts/check-coverage.mjs`:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const threshold = 10;

export function summarizeLcov(lcov) {
  const totals = { linesFound: 0, linesHit: 0, functionsFound: 0, functionsHit: 0, branchesFound: 0, branchesHit: 0 };
  for (const line of lcov.split('\n')) {
    const [key, value] = line.split(':', 2);
    if (key === 'LF') totals.linesFound += Number(value);
    if (key === 'LH') totals.linesHit += Number(value);
    if (key === 'FNF') totals.functionsFound += Number(value);
    if (key === 'FNH') totals.functionsHit += Number(value);
    if (key === 'BRF') totals.branchesFound += Number(value);
    if (key === 'BRH') totals.branchesHit += Number(value);
  }
  const percent = (hit, found) => found === 0 ? 100 : (hit / found) * 100;
  return {
    lines: percent(totals.linesHit, totals.linesFound),
    functions: percent(totals.functionsHit, totals.functionsFound),
    branches: percent(totals.branchesHit, totals.branchesFound),
    statements: percent(totals.linesHit, totals.linesFound)
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = summarizeLcov(readFileSync('coverage/lcov.info', 'utf8'));
  const failures = Object.entries(summary).filter(([, value]) => value < threshold);
  if (failures.length) {
    for (const [metric, value] of failures) console.error(`${metric}: ${value.toFixed(2)}% is below ${threshold}%`);
    process.exit(1);
  }
}
```

Add `"coverage:check": "bun scripts/check-coverage.mjs"` to `package.json`.

- [ ] **Step 4: Convert remaining test APIs directly**

For each unit test file, import only the needed APIs from `bun:test`:

```js
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
```

Apply these mechanical conversions:

```js
// Jest mocks
jest.fn(implementation)                 // becomes mock(implementation)
jest.spyOn(object, method)               // becomes spyOn(object, method)
jest.mock('module', factory)             // becomes mock.module('module', factory)

// Browser mocks
Element.prototype.scrollIntoView = jest.fn();
// becomes
Element.prototype.scrollIntoView = mock(() => {});

// Storage assertions
expect(localStorage.setItem).toHaveBeenCalledWith('tokenBurnCache', JSON.stringify(data));
// becomes
expect(localStorage.getItem('tokenBurnCache')).toBe(JSON.stringify(data));
```

Replace timer assertions with Bun-supported timer control or explicit awaited callbacks. Do not retain a global `jest` object, `jest.resetModules`, `jest.dontMock`, `jest.doMock`, or `jest.requireActual` reference anywhere in `tests/unit`.

- [ ] **Step 5: Verify the native suite and coverage contract**

Run: `bun test tests/unit --coverage --coverage-reporter=lcov && bun run coverage:check`

Expected: PASS with all unit tests green and every global coverage metric at least 10%.

- [ ] **Step 6: Commit native test parity**

```bash
git add tests scripts/check-coverage.mjs package.json bunfig.toml jest.config.js .babelrc
git commit -m "test: migrate unit suite to Bun"
```

### Task 5: Add Strict SonarJS Policy And Fail-Closed Warning Baseline

**Files:**
- Modify: `eslint.config.mjs`
- Create: `scripts/lint-baseline.mjs`
- Create: `config/eslint-baseline.json`
- Create: `tests/unit/lint-baseline.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces `bun run lint:baseline` and `bun run lint:baseline:update`.
- Produces a committed baseline keyed by `file|rule` and hashes of lint policy inputs.

- [ ] **Step 1: Write failing tests for fail-closed baseline behavior**

Create `tests/unit/lint-baseline.test.js` with a temporary report fixture and these required cases:

```js
import { describe, expect, test } from 'bun:test';
import { compareReport } from '../../scripts/lint-baseline.mjs';

const baseline = {
  policyHash: 'same',
  warnings: { 'lib/example.js|complexity': 1 }
};

test('rejects a new warning bucket', () => {
  expect(compareReport({ policyHash: 'same', warnings: { 'lib/new.js|complexity': 1 }, errors: 0 }, baseline).ok).toBeFalse();
});

test('allows a warning decrease', () => {
  expect(compareReport({ policyHash: 'same', warnings: {}, errors: 0 }, baseline).ok).toBeTrue();
});

test('rejects lint errors and policy drift', () => {
  expect(compareReport({ policyHash: 'same', warnings: {}, errors: 1 }, baseline).ok).toBeFalse();
  expect(compareReport({ policyHash: 'changed', warnings: {}, errors: 0 }, baseline).ok).toBeFalse();
});
```

- [ ] **Step 2: Run the baseline tests and verify they fail**

Run: `bun test tests/unit/lint-baseline.test.js`

Expected: FAIL because `scripts/lint-baseline.mjs` does not exist.

- [ ] **Step 3: Configure strict warning-only lint policy**

Import `eslint-plugin-sonarjs` and add these structural rules to the non-test JavaScript configuration:

```js
complexity: ['warn', { max: 10 }],
'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
'max-statements': ['warn', { max: 15 }],
'max-depth': ['warn', { max: 4 }],
'max-params': ['warn', { max: 4 }],
'max-nested-callbacks': ['warn', { max: 3 }]
```

Build the SonarJS rule map by transforming every enabled recommended rule to warning severity, preserving options:

```js
const warningRules = Object.fromEntries(
  Object.entries(sonarjs.configs.recommended.rules)
    .filter(([, setting]) => setting !== 'off' && setting !== 0)
    .map(([rule, setting]) => {
      const options = Array.isArray(setting) ? setting.slice(1) : [];
      return [rule, ['warn', ...options]];
    })
);
```

Apply `warningRules` only after registering `plugins: { sonarjs }`. In the test override, disable only `max-lines-per-function`, `max-statements`, `max-nested-callbacks`, `sonarjs/cognitive-complexity`, `sonarjs/no-duplicate-string`, and `sonarjs/no-identical-functions`.

- [ ] **Step 4: Implement the baseline checker**

`scripts/lint-baseline.mjs` must:

```js
// Export compareReport({ policyHash, warnings, errors }, baseline).
// Read ESLint JSON from a file path passed as argv[2].
// Count severity-1 messages by `${relativeFile}|${ruleId}`.
// Count severity-2 and fatal messages as errors.
// Hash eslint.config.mjs and bun.lock together into policyHash.
// On normal runs: reject errors, unreadable JSON, changed policyHash,
// new keys, and increased counts; allow missing baseline keys.
// On --update: write the full current warning map and policyHash to
// config/eslint-baseline.json only after ESLint reported zero errors.
```

Add scripts:

```json
"lint:json": "bunx eslint . --format json --output-file .lint-report.json",
"lint:baseline": "bun run lint:json && bun scripts/lint-baseline.mjs .lint-report.json",
"lint:baseline:update": "bun run lint:json && bun scripts/lint-baseline.mjs --update .lint-report.json"
```

Add `.lint-report.json` to `.gitignore`.

- [ ] **Step 5: Generate and review the initial warning baseline**

Run: `bun run lint:baseline:update && bun run lint:baseline`

Expected: initial command writes `config/eslint-baseline.json`; second command passes with warnings but no errors.

Inspect every generated file/rule entry. The initial baseline is accepted debt, not a suppression list.

- [ ] **Step 6: Verify failure modes**

Run: `bun test tests/unit/lint-baseline.test.js && bun run lint:baseline`

Expected: PASS.

Temporarily add a 51-line function to `lib/engineering.js`, run `bun run lint:baseline`, and verify it exits nonzero naming `max-lines-per-function`. Revert the temporary function immediately after the assertion.

- [ ] **Step 7: Commit lint enforcement**

```bash
git add eslint.config.mjs scripts/lint-baseline.mjs config/eslint-baseline.json tests/unit/lint-baseline.test.js package.json .gitignore
git commit -m "feat: enforce strict warning-only lint baseline"
```

### Task 6: Move CI, Hooks, And Container Runtime To Bun

**Files:**
- Modify: `.github/workflows/check.yml`
- Modify: `.githooks/pre-commit`
- Create: `scripts/install-hooks.mjs`
- Modify: `Dockerfile`
- Modify: `_run.sh`
- Create: `tests/unit/runtime-integration.test.js`

**Interfaces:**
- Produces a Bun-only CI quality gate.
- Produces a non-root Bun image that can run git-blame dependencies.
- Produces a fail-fast Git hook installation path for real checkouts.

- [ ] **Step 1: Add a failing static runtime integration test**

Create `tests/unit/runtime-integration.test.js`:

```js
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test('CI and Docker use Bun with frozen lockfiles', () => {
  const workflow = readFileSync('.github/workflows/check.yml', 'utf8');
  const dockerfile = readFileSync('Dockerfile', 'utf8');

  expect(workflow).toContain('oven-sh/setup-bun@v2');
  expect(workflow).toContain('bun install --frozen-lockfile');
  expect(workflow).toContain('bun run lint:baseline');
  expect(dockerfile).toContain('FROM oven/bun:1.3.11');
  expect(dockerfile).toContain('CMD ["bun", "server.js"]');
  expect(dockerfile).toContain('apt-get install -y --no-install-recommends git');
});
```

- [ ] **Step 2: Run the runtime integration test and verify it fails**

Run: `bun test tests/unit/runtime-integration.test.js`

Expected: FAIL because CI and Docker still use Node and npm.

- [ ] **Step 3: Implement Bun CI, hook installation, and runtime image**

Update `.github/workflows/check.yml` so each matrix leg installs Bun `1.3.11`, runs `bun install --frozen-lockfile`, then uses:

```yaml
run: bun run lint:baseline
```

for lint,

```yaml
run: bun run typecheck
```

for typecheck, and

```yaml
run: bun test tests/unit --coverage --coverage-reporter=lcov && bun run coverage:check
```

for unit tests.

Create `scripts/install-hooks.mjs`:

```js
const result = Bun.spawnSync(['git', 'rev-parse', '--is-inside-work-tree'], { stdout: 'pipe', stderr: 'pipe' });
if (result.exitCode === 0 && new TextDecoder().decode(result.stdout).trim() === 'true') {
  const configure = Bun.spawnSync(['git', 'config', 'core.hooksPath', '.githooks'], { stdout: 'inherit', stderr: 'inherit' });
  if (configure.exitCode !== 0) process.exit(configure.exitCode);
}
```

Update `.githooks/pre-commit` to remove Node syntax checks, run staged `bunx eslint`, run `bunx tsc --noEmit`, and run `bun run lint:baseline` whenever staged JavaScript exists. Preserve its executable mode.

Update `Dockerfile` with Bun base images, `bun.lock` copies, frozen Bun installs, runtime-stage git installation, existing non-root user setup, and `CMD ["bun", "server.js"]`.

Replace every npm invocation in `_run.sh` with its Bun equivalent.

- [ ] **Step 4: Verify CI configuration and local hooks**

Run: `bun test tests/unit/runtime-integration.test.js && bun scripts/install-hooks.mjs && git config --get core.hooksPath`

Expected: PASS and `.githooks`.

- [ ] **Step 5: Verify container behavior**

Run:

```bash
docker build -t token-burn-dashboard:bun-verify .
docker run --rm token-burn-dashboard:bun-verify git --version
docker run --rm -p 7071:7071 token-burn-dashboard:bun-verify
```

Expected: `git --version` succeeds; a second run serves `GET /api/health` with HTTP 200 while running as the existing non-root user.

- [ ] **Step 6: Commit runtime integration**

```bash
git add .github/workflows/check.yml .githooks/pre-commit scripts/install-hooks.mjs Dockerfile _run.sh tests/unit/runtime-integration.test.js
git commit -m "build: run CI and container on Bun"
```

### Task 7: Final Full-Stack Verification

**Files:**
- Modify only if a prior verification exposes a defect in its owning task.

**Interfaces:**
- Consumes all Bun runtime, native test, lint baseline, hook, and container changes.
- Produces a verified migration ready for review.

- [ ] **Step 1: Verify repository quality gates**

Run:

```bash
bun install --frozen-lockfile
bun run lint
bun run lint:baseline
bun run typecheck
bun test tests/unit --coverage --coverage-reporter=lcov
bun run coverage:check
bun run build
bun run build:ui
bun run test:e2e
```

Expected: every command exits 0. `bun run lint` may print only warnings represented in `config/eslint-baseline.json`.

- [ ] **Step 2: Verify Bun server behavior**

Run:

```bash
HOST=127.0.0.1 PORT=7071 bun server.js
curl -fsS http://127.0.0.1:7071/api/health
```

Expected: the server starts and the health response contains `{"status":"ok"`.

- [ ] **Step 3: Inspect migration boundaries**

Run:

```bash
rg 'jest\.|jest.config|babel-jest|@babel/preset-env|npm ci|npm run|npx ' package.json tests lib dashboard .github Dockerfile .githooks _run.sh
```

Expected: no Jest/Babel/npm runtime references remain; Playwright remains reachable through `bunx`.

- [ ] **Step 4: Commit any final verification fixes**

```bash
git add -A
git commit -m "test: verify Bun runtime migration"
```

---

## Plan Self-Review

| Spec requirement | Implementation task |
| --- | --- |
| Bun package, runtime, lockfile, scripts | Tasks 1 and 6 |
| Native Bun unit suite and DOM setup | Tasks 1 through 4 |
| Explicit replacement for Jest cache mocking | Tasks 2 and 3 |
| Existing coverage threshold | Task 4 |
| Warning-only strict structural and SonarJS lint | Task 5 |
| Per-file/per-rule fail-closed lint debt gate | Task 5 |
| Bun CI, hook, local launcher, and Docker runtime | Task 6 |
| Server, Docker, and Playwright verification | Task 7 |

The plan has no deferred implementation placeholders. Test migration and lint baseline behavior have concrete failing-test steps before their implementations.
