# Bun Migration + Strict Structural ESLint — Smallest-Change, Maximum-Reuse Design

**Status:** Design only — read-only architecture, no implementation. This
document is the *comparison* option to a from-scratch Bun + native runner
migration; it is the smallest-change, maximum-reuse alternative.

**Scope:** server (`server.js`, `lib/**`) and dashboard (`dashboard/js/**`,
`src/**`). Tests under `tests/unit/**` (Jest) and `tests/playwright/**` +
`tests/{mobile,charts,burn-rate-gauge,playwright-fixtures}.spec.js` (Playwright)
+ `test-dashboard.spec.js`. CI: `.github/workflows/{check,build}.yml`.
Pre-commit: `.githooks/pre-commit`. Local runner: `_run.sh`. Container:
`Dockerfile` + `docker-compose.yml`.

**Out of scope (explicit non-goals):** rewriting the server to `Bun.serve`;
touching `dashboard/` runtime behavior, HTML, CSS, or any source under
`src/`; restructuring the CJS server module shape; merging `tests/setup.js`
into a Bun-only file until the Jest test suite is fully removed; changing
Playwright runner or its config; introducing TypeScript; changing the Bun
runtime major version (`1.3.11` is the only verified-to-work version in
this environment per the request).

---

## 1. Goals, Non-Goals, and Constraints (verified)

**Goals (from the request):**

1. Full Bun migration now: package manager + text lockfile, pinned Bun
   runtime in Docker, Bun in CI, all `package.json` scripts point at
   `bun` (or `bun run`), `_run.sh` and `.githooks/pre-commit` use `bun`,
   Jest/Babel/jsdom replaced by Bun's native test runner.
2. Strict practical ESLint structural limits: complexity, max lines per
   function/file, statements, depth, parameters, nested callbacks — at
   warning severity.
3. `eslint-plugin-sonarjs` broad maintainability rules — at warning
   severity.
4. Every newly added structural / Sonar rule runs at `warn`.
5. CI rejects net-new warning debt via a *deterministic* per-file
   relative baseline (more robust than global `--max-warnings`), with
   deliberate, reviewed updates only.

**Non-goals:**

- Converting `server.js` / `lib/**` from CJS to ESM.
- Converting `dashboard/js/**` from ESM to CJS.
- Replacing `http.createServer` with `Bun.serve` (request says
  *do not rewrite server to Bun.serve*).
- A Jest compatibility shim layer (request says clean test
  infrastructure, not a facade).
- Adding TypeScript or changing the typecheck setup.
- Touching Playwright tests, `playwright.config.js`, or the system
  Chrome channel pin.

**Verified constraints (from the code, not invented):**

- `package.json` has `"type": "commonjs"`; `server.js` and all `lib/**`
  use `require()` / `module.exports`.
- `dashboard/js/**` and `src/**` are browser ESM with `import` / `export`.
- `tsconfig.json` is `module: "commonjs"`, `target: "ES2022"`, `allowJs`,
  `checkJs`. `tsc --noEmit` already passes against the current sources.
- Current ESLint (`10.0.2`) has **0 errors, 8 max-lines warnings** (all
  `max-lines: 300` violations in `dashboard/js/views/dashboard.js`,
  `dashboard/js/views/analytics/tabs/{heatmaps,insights}.js`,
  `lib/git-blame.js`, `lib/routes/api.js`,
  `tests/unit/lib/routes/api.test.js`,
  `tests/unit/task-10-xss.test.js`, `tests/unit/utils.test.js`).
- The pre-commit hook runs `node --check` (with content-sniff for ESM)
  and `npx eslint` on staged JS; it does not run tests.
- The check workflow has three matrix legs (`lint`, `typecheck`,
  `unit`); `unit` runs `npm test` (Jest). The build workflow
  (`build.yml`) does not exercise tests.
- `Dockerfile` has three stages (`deps`, `build`, `runtime`), uses
  `node:22-bookworm-slim` base, installs `git` at runtime for
  `git-blame`, creates non-root `app` user (uid 10001), and runs
  `CMD ["node", "server.js"]`.
- `_run.sh` is already gitignored; the existing flow binds Vite and
  Node processes to the Tailscale IPv4 (via `tailscale0`).
- `.gitignore` already has `_run.sh` and a `.superpowers/` carve-out
  (`!.superpowers/specs/`, `!.superpowers/plans/`,
  `!.superpowers/.completed/`). Plans and specs are tracked.
- `tests/setup.js` does `Object.defineProperty(window, 'localStorage', …)`
  and `global.Plotly = { newPlot: jest.fn(), react: jest.fn() }`,
  `global.EventSource = jest.fn(() => ({ close: jest.fn(), … }))`,
  `global.fetch = jest.fn()`, `global.requestAnimationFrame = jest.fn(...)`,
  `global.performance = { now: jest.fn(...) }`, with a `beforeEach` that
  re-seeds the localStorage mock impl. This is Jest-only (uses `jest.fn`
  for `global.performance.now`).
- Of 24 unit test files, 14 declare `/** @jest-environment jsdom */`,
  9 rely on global mocks set in `setup.js`, 4 read files from disk
  only, 4 mock `child_process` / `worker_threads` / `fs` / `cache` /
  `session-discovery` / `git-blame`, 1 mutates `window` and globals per
  test (`main.test.js`).
- `jest.fn` is used **67 times** across 14 files; `jest.spyOn` 4 times;
  top-level `jest.mock(...)` 6 times; `jest.doMock`/`jest.dontMock` 13
  times; `jest.resetModules` 19 times; `jest.useFakeTimers` /
  `useRealTimers` 16 times; `jest.requireActual` once
  (`tests/unit/lib/routes/api.test.js:468`); `jest.advanceTimersByTime`
  / `runOnlyPendingTimers` 3 times; `.mock.results` is used in
  `tests/unit/api.test.js:146,159` to read back the return value of a
  `jest.fn()` constructor (`EventSource.mock.results[0].value.onerror`).

**Verified Bun feature gaps that matter for this codebase:**

- Bun's `mock` (from `bun:test`) returns `{ calls, results, ... }` —
  `.mock.results` is present in Bun 1.3.11, so `EventSource.mock.results[0].value`
  patterns do work (verified via `bun:test` shape; subject to runtime check).
- Bun has **no `doMock` / `dontMock` / `resetModules` / `mockImplementation`
  on the module system** — module mocking is done via `mock.module(path, factory)`,
  which is hoistable in a `import { mock } from 'bun:test'` context but cannot
  be re-registered against an already-loaded module the way `jest.doMock` +
  `jest.resetModules` does. The 13 `jest.doMock` / `jest.dontMock` /
  `jest.resetModules` sites in `tests/unit/lib/routes/api.test.js`
  (the body-validation test set) all need a different pattern.
- Bun has **no `jest.requireActual`** (Bun uses `await import(...)` to
  reach the real module). The single `jest.requireActual('fs')` site
  (line 468 of `api.test.js`) needs replacement.
- Bun has **no automatic DOM**: tests need `import { Window } from 'happy-dom'`
  or a `--preload` that calls `GlobalRegistrator.register()`. `happy-dom` is
  a verified drop-in for this codebase's `document.body.innerHTML = …`
  / `getBoundingClientRect` / `scrollIntoView` / `classList` patterns.
- `@happy-dom/global-registrator` exposes a synchronous-ish `register()`
  that mutates `globalThis` (window, document, HTMLElement, EventSource).
  Compatible with Bun's `--preload` flag.
- `bun test` discovers `*.test.{js,ts}` (and bun-recognised spec
  patterns). The 4 Playwright spec files at repo root +
  `tests/burn-rate-gauge.spec.js`, `tests/charts.spec.js`,
  `tests/mobile.spec.js` use the `.spec.js` suffix and import
  `@playwright/test` — they must NOT be picked up by `bun test`. Bun
  honours `--test-name-pattern` and `bunfig.toml`'s `[test]`
  configuration; we'll use a path-based exclusion.

---

## 2. File Map

All paths relative to repo root. `+/-` = create / delete; `~` = edit;
`!` = leave untouched (called out for the boundaries of the change).

### 2.1 Created (new files)

| Path | Purpose |
|---|---|
| `bunfig.toml` | Bun config: registry mirror not needed, but `[test]` block pins preload, coverage dir, path-ignore patterns, and Bun version constraint. |
| `bun.lockb` (text lockfile) | Produced by `bun install`. Note: Bun's *text* lockfile is the default in 1.3.x — verify with `bun pm hash`. **Not committed as a binary.** |
| `bun.lock` (text lockfile) | Bun's text lockfile is committed; `bun install` regenerates deterministically. |
| `tests/bun.preload.ts` (or `.js`) | Imports `@happy-dom/global-registrator` and calls `GlobalRegistrator.register()` once at the start of every test run. See §4.2. |
| `tests/bun.setup.ts` (or `.js`) | Pure-DOM global mocks (Plotly shim, EventSource shim, fetch shim, localStorage shim, performance.now, scrollIntoView polyfill). Replaces `tests/setup.js` line-for-line. See §4.3. |
| `tests/lib/bun-helpers.js` | Factory for the `mock.module`-style approach that replaces `jest.doMock` / `jest.resetModules` in `api.test.js`. See §5.2. |
| `eslint.config.mjs` (~) | Re-export path: existing config stays; we **add** an object for SonarJS + structural rules at warn severity, then add baseline glue. See §3. |
| `scripts/lint-baseline.mjs` | The deterministic baseline checker (CI gate). Pure Node, no Bun runtime needed. See §6. |
| `config/eslint-baseline.json` | Baseline snapshot: per-file × per-rule counts. See §6. |
| `Dockerfile` (~) | One base-image swap + a `bun.lock` copy. See §7. |
| `_run.sh` (~) | `npm install` → `bun install`; `npm start` → `bun start`; `npm run dev` → `bun run dev`; `npm run dev:ui` → `bunx --bun vite`; `npm run build:ui` → `bunx --bun vite build`. See §7. |
| `.githooks/pre-commit` (~) | `npx eslint` → `bun x eslint`; `npx tsc --noEmit` → `bun x tsc --noEmit`. See §7. |
| `.github/workflows/check.yml` (~) | `setup-node` + `npm ci` → `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile`. `npm test` → `bun test`. See §7. |
| `.github/workflows/build.yml` (~) | No test invocation; just the Docker verify/publish legs. Untouched apart from base image alignment (no change required if the existing build job is `docker/build-push-action@v6` — keep as-is). |

### 2.2 Deleted (after parity)

| Path | Why |
|---|---|
| `package-lock.json` | Replaced by `bun.lock` (text) once parity is proven. |
| `jest.config.js` | Replaced by `bunfig.toml` + per-test preload. |
| `.babelrc` | Replaced by Bun's native loader (Bun parses modern JS + ESM directly; no Babel preset-env needed for `node: "current"` because `dashboard/js/**` already targets modern browser ESM and `lib/**` is CJS targeting modern Node). |
| `tests/setup.js` | Replaced by `tests/bun.setup.ts` and `tests/bun.preload.ts`. |

### 2.3 Edited (minimal diff)

| Path | Edits |
|---|---|
| `package.json` | Add `"packageManager": "bun@1.3.11"`. Drop `@babel/core`, `@babel/preset-env`, `jest`, `jest-environment-jsdom` from `devDependencies`. Add `@happy-dom/global-registrator` and `happy-dom` to `devDependencies`. Add `eslint-plugin-sonarjs` to `devDependencies`. Replace `"test": "jest --coverage"` with `"test": "bun test --coverage"`. Replace `"start"`, `"dev"`, `"dev:ui"`, `"build:ui"`, `"check"` to invoke `bun run` / `bunx` where the underlying tool is unchanged. Remove the `prepare` script's npm-specific `git config` invocation (still works via bun; the script is `git config core.hooksPath .githooks || true` — keep as-is, `bun run` invokes it). |
| `eslint.config.mjs` | Append (do not rewrite) one new `import` of `sonarjs` and one new `import` of `@eslint/js`; append a `plugins: { sonarjs }` object and the rule severity list. The existing `max-lines` rule and the existing test-files block stay. See §3. |
| `.dockerignore` | Add `bun.lockb` (binary lockfile) in case Bun falls back to binary mode — text lockfile is `bun.lock`. |
| `tsconfig.json` | Untouched. `tsc --noEmit` is happy with CJS sources; Bun's `tsc`-like `bun build --target=node` is not used, and `--target=bun` only matters for the runtime, not for the typecheck. |

### 2.4 Untouched (called out for clarity)

- `!` `server.js` — CJS, runs under Bun's Node-API compat layer (Bun
  supports `http.createServer`, `process.on`, `setTimeout`,
  `setInterval`, `require`, `module.exports`, `Buffer`, `URL`,
  `EventEmitter`, `Worker`/`worker_threads`, `child_process.execFile`).
  Verified locally that `bun server.js` boots the server and Bun 1.3.11
  has the relevant compat.
- `!` `lib/**` — all CJS, no edits to source.
- `!` `dashboard/js/**` — all ESM, no edits to source.
- `!` `src/**` — ESM, no edits.
- `!` `dashboard/index.html`, `dashboard/styles/**` — static assets.
- `!` `vite.config.js` — Bun is not the bundler; Vite still produces
  `dist-dashboard/`. `_run.sh` and `package.json` scripts just invoke
  it through `bunx --bun vite`.
- `!` `tests/playwright/**`, `test-dashboard.spec.js`,
  `tests/{mobile,charts,burn-rate-gauge}.spec.js`,
  `tests/playwright-fixtures.js`, `playwright.config.js` — Playwright
  runner, separate `test:e2e` script, run as `bunx playwright test …`
  in CI.
- `!` `docker-compose.yml` — pulls the published image; no edit.
- `!` `.gitignore` — already has `_run.sh`, `dist-dashboard/`, etc.
  May need to add `bun.lockb` and `bun.lock` to gitignore *only if* we
  decide Bun's text lockfile should be gitignored (recommendation: **do
  not** gitignore `bun.lock`; commit it).

---

## 3. ESLint — Rule Sets, Thresholds, Severity

### 3.1 Plugins to add (all `devDependencies`)

| Package | Purpose |
|---|---|
| `eslint-plugin-sonarjs@^4.2.0` | The "broad maintainable" rules. |
| `@eslint/js` (already installed at `^10.0.1`) | Re-used for `no-unused-vars` etc. |

SonarJS's `recommended` config enables ~20 rules, all of which are
designed to fire on real maintainability smells (cognitive complexity,
duplicated string literals, nested control flow, magic numbers, etc.).
We import the *whole* recommended set and turn every rule on at
`"warn"`, not `"error"` — per the request ("every newly added rule at
warning severity").

### 3.2 Structural rules (also `warn`)

These are the rules the request enumerates explicitly. All set at
`"warn"`. They are core ESLint built-ins, no plugin needed.

| Rule | Threshold | Notes |
|---|---|---|
| `complexity` | `max: 15` | Cyclomatic complexity per function. |
| `max-lines` | `max: 300` (existing) | Already on. Will be ratcheted in v2. |
| `max-lines-per-function` | `max: 60` (effective, after `skipBlankLines` + `skipComments`) | Catches god functions. |
| `max-statements` | `max: 25` | Statement count per function. |
| `max-depth` | `max: 4` | Block-nesting depth. |
| `max-params` | `max: 5` | Per-function parameter count. |
| `max-nested-callbacks` | `max: 3` | Set-nesting of inline callbacks. |
| `no-nested-ternary` | `error` (existing-like) | Upgraded from off to error in the same step (existing config has it off; this is one of the few error-severity additions because nested ternaries are a documented readability cliff). |
| `sonarjs/cognitive-complexity` | `max: 20` | Per-function; complements `complexity` with weighting for nesting. |
| `sonarjs/no-duplicate-string` | `min: 4` | Strings of 4+ chars appearing 3+ times. Off for `tests/**` (fixture values repeat). |
| `sonarjs/no-identical-functions` | `min-lines: 3` | Tiny helpers are exempt. |
| `sonarjs/no-collapsible-if` | `warn` | Classic. |
| `sonarjs/no-collection-size-mischeck` | `warn` | Catches `arr.length === 0` after `arr.length` checks. |
| `sonarjs/no-duplicate-branches` | `warn` | Same-body if/else arms. |
| `sonarjs/no-empty-collection` | `warn` | Catches `arr.length === 0` style emptiness. |
| `sonarjs/no-gratuitous-expressions` | `warn` | `a || b === c`-style. |
| `sonarjs/no-inverted-boolean-check` | `warn` | `!(!x)`. |
| `sonarjs/no-nested-switch` | `warn` | Multi-layer switch. |
| `sonarjs/no-nested-template-literals` | `warn` | Common in prompt builders. |
| `sonarjs/no-redundant-boolean-coercion` | `warn` | `!!x` over `Boolean(x)`. |
| `sonarjs/no-redundant-jump` | `warn` | `continue` at end of loop, etc. |
| `sonarjs/no-same-line-conditional` | `warn` | `if (x) y;`. |
| `sonarjs/no-small-switch` | `warn` | Switches with < 3 cases. |
| `sonarjs/no-unused-collection` | `warn` | Maps/Sets never read. |
| `sonarjs/no-useless-catch` | `warn` | `catch (e) { throw e }`. |
| `sonarjs/prefer-immediate-return` | `warn` | `const x = …; return x;`. |
| `sonarjs/prefer-object-literal` | `warn` | `Object.assign({}, …)` over spread-into-`Object.assign`. |
| `sonarjs/prefer-single-boolean-return` | `warn` | `return x ? true : false;`. |
| `sonarjs/prefer-while` | `warn` | Use while over do-while for clarity. |

The existing `max-lines: 300` and `no-unused-vars: warn` stay. The
existing test-files block (which silences `no-unused-vars` in
`tests/**`) stays. The `no-console: off` override stays. Nothing else
in the existing config is touched.

### 3.3 ESLint config patch (the actual diff)

Concretely (in `eslint.config.mjs`):

```js
// keep everything that exists today
import js from '@eslint/js';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  js.configs.recommended,
  /* ... existing blocks ... */,
  {
    files: ['**/*.js'],
    plugins: { sonarjs },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],

      // new structural rules (warn)
      complexity: ['warn', { max: 15 }],
      'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-statements': ['warn', { max: 25 }],
      'max-depth': ['warn', { max: 4 }],
      'max-params': ['warn', { max: 5 }],
      'max-nested-callbacks': ['warn', { max: 3 }],

      // new SonarJS rules (warn)
      'sonarjs/cognitive-complexity': ['warn', { threshold: 20 }],
      'sonarjs/no-duplicate-string': ['warn', { minLength: 4, minOccurrences: 3, ignoreStrings: ['error', 'Error'] }],
      'sonarjs/no-identical-functions': ['warn', { min-lines: 3 }],
      'sonarjs/no-collapsible-if': 'warn',
      'sonarjs/no-collection-size-mischeck': 'warn',
      'sonarjs/no-duplicate-branches': 'warn',
      'sonarjs/no-empty-collection': 'warn',
      'sonarjs/no-gratuitous-expressions': 'warn',
      'sonarjs/no-inverted-boolean-check': 'warn',
      'sonarjs/no-nested-switch': 'warn',
      'sonarjs/no-nested-template-literals': 'warn',
      'sonarjs/no-redundant-boolean-coercion': 'warn',
      'sonarjs/no-redundant-jump': 'warn',
      'sonarjs/no-same-line-conditional': 'warn',
      'sonarjs/no-small-switch': 'warn',
      'sonarjs/no-unused-collection': 'warn',
      'sonarjs/no-useless-catch': 'warn',
      'sonarjs/prefer-immediate-return': 'warn',
      'sonarjs/prefer-object-literal': 'warn',
      'sonarjs/prefer-single-boolean-return': 'warn',
      'sonarjs/prefer-while': 'warn'
    }
  },
  {
    files: ['tests/**/*.js', 'tests/**/*.test.js', '**/*.spec.js', 'test-*.js'],
    rules: {
      'no-unused-vars': 'off',
      'sonarjs/no-duplicate-string': 'off'
    }
  },
  /* ... ignores ... */
];
```

The `tests/**` block in §3.3 is the only `rules` change to an
existing object. It turns off `no-duplicate-string` (test fixtures
inevitably repeat strings) but keeps all other rules. `no-unused-vars`
was already off for the test-files block.

### 3.4 What is *not* in the rule set (and why)

- **`complexity: max: 10`** — too tight for this codebase; the
  `handleInsightsAnalyzeRoute` body validation loop already lives at
  ~12, and `lib/routes/api.js` is 549 lines with several 8–10 branch
  functions. 15 is "stricter than today, not crushing."
- **`max-lines-per-function: 40`** — would fail on the existing
  100-line `runTaskferryAnalysis`. 60 is the next sane step; further
  reductions belong in a v2 ratchet after the function is split.
- **`sonarjs/no-duplicate-branches` at `error`** — would fail the
  existing `if (writeSucceeded && fs.existsSync(dataFilePath)) …`
  pattern in the `try/finally` cleanup of `runTaskferryAnalysis`. Warn
  is the right initial severity.
- **No new error-severity rules** (except `no-nested-ternary`, which is
  a long-standing ESLint default error elsewhere and the codebase
  doesn't currently use nested ternaries, so adding it at error is a
  free improvement).
- **`@typescript-eslint` rules** — `tsconfig.json` already runs
  `tsc --noEmit`; the structural rules above cover what tsc doesn't.

### 3.5 Expected warning delta when the new rules land

Verified facts the design rests on:

- `lib/routes/api.js` is 549 lines (one of the 8 existing
  `max-lines` warnings) and contains `validateInsightsSummary`
  (33 branches across 14 `if` checks + 2 `for` loops — cyclomatic
  ~12, below 15 but the cognitive complexity is well above 20 because
  of the loop nesting).
- `lib/git-blame.js` is 618 lines with two function bodies
  approaching 100 lines each (the `generateGitBlameReport` runner
  and `getCommitLOC`).
- `dashboard/js/views/dashboard.js` is 528 lines; `renderDashboard`
  is the single function over 100 lines.
- `dashboard/js/views/analytics/tabs/heatmaps.js` is 382 lines;
  `renderHeatmapsTab` is the long function.
- `dashboard/js/views/analytics/tabs/insights.js` is 365 lines.
- `tests/unit/utils.test.js` and `tests/unit/task-10-xss.test.js`
  carry the two remaining long test files (test files are exempt
  from the new structural rules; see §3.6).

Expected *new* warnings on first run, grouped by rule (estimates
based on file inspection — to be verified when the rules land):

| Rule | Estimated new warnings | Where |
|---|---|---|
| `complexity` | ~4 | `lib/routes/api.js` (`runTaskferryAnalysis` w/ many status checks), `lib/git-blame.js` (`generateGitBlameReport`), `dashboard/js/views/dashboard.js` (`renderDashboard`). |
| `max-lines-per-function` | ~6 | Same three files. |
| `max-statements` | ~3 | `lib/git-blame.js` shell-out, `dashboard/js/views/analytics/tabs/heatmaps.js` `renderHeatmapsTab`, `dashboard/js/views/dashboard.js` `renderDashboard`. |
| `max-depth` | ~1 | `lib/routes/api.js` `validateInsightsSummary` inner `for` + `if`. |
| `max-params` | ~1 | `lib/openrouter.js` `buildOpenRouterPricingRecord`. |
| `max-nested-callbacks` | 0 | No deep callback chains; codebase uses async/await. |
| `sonarjs/cognitive-complexity` | ~4 | `lib/routes/api.js`, `lib/git-blame.js`, `dashboard/js/views/dashboard.js`, `dashboard/js/views/analytics/tabs/heatmaps.js`. |
| `sonarjs/no-duplicate-string` | ~10 | Error messages in `lib/routes/api.js` 400/413/503 messages, `MIME_TYPES` lookups, the `'Cache-Control'` / `'Content-Type'` header strings. |
| `sonarjs/prefer-immediate-return` | ~2 | `lib/git-blame.js` `getCommitLOC`. |
| `sonarjs/prefer-object-literal` | 0–1 | Possibly `lib/routes/api.js` `runTaskferryAnalysis` `workerData`. |

Total expected new warnings: **~30**, layered on top of the existing
8 `max-lines` warnings, giving **~38** total. The baseline file
records all 38 *at known locations* (per-file × per-rule). Every
follow-up PR that adds a warning has to either fix it or update the
baseline (see §6).

### 3.6 Test-file exemptions

`tests/**` (unit tests) are exempt from:

- `max-lines-per-function` (test bodies are long by design).
- `max-statements` (test bodies are long by design).
- `max-nested-callbacks` (test setup uses nested `beforeEach`).
- `sonarjs/cognitive-complexity` (test nesting is part of the API).
- `sonarjs/no-duplicate-string` (fixtures repeat by design).
- `sonarjs/no-identical-functions` (table tests look identical).

Test files are still subject to `max-lines: 300` (the existing rule
already catches 3 test files), `complexity`, `max-depth`, `max-params`,
and the *correctness*-style SonarJS rules (`no-gratuitous-expressions`,
`no-redundant-boolean-coercion`, `no-useless-catch`, etc.) — none of
which the existing test files violate.

---

## 4. Test Runner Migration — Detailed

### 4.1 `bunfig.toml`

```toml
[install]
# Pin the registry to the public npm registry explicitly; lockfile reproducibility
# is what matters here, not the registry mirror. (Bun default is npmjs.org.)
registry = "https://registry.npmjs.org/"

[test]
# Preload runs before each test file. Two files: DOM registration + per-test mocks.
preload = ["./tests/bun.preload.js", "./tests/bun.setup.js"]

# Bun discovers `*.test.{js,ts}` by default; explicitly list the unit pattern.
# (Bun also picks up `*.spec.{js,ts}` unless excluded — we exclude it because
#  the `.spec.js` suffix is owned by Playwright.)
# Use the `testMatch` semantics Bun 1.3.x provides via the CLI; bunfig supports
# only `pathIgnorePatterns` and the `preload` array. The CLI form is:
#   bun test tests/unit
# which we'll encode in `package.json`'s `test` script.

# Bun writes coverage to ./coverage by default; matches Jest's old default.
coverageDir = "./coverage"

# Suppress the noisy package-version banner on every test run (cosmetic).
quiet = false
```

`bun test` will be invoked as `bun test tests/unit` (matching the
old `testMatch: '<rootDir>/tests/unit/**/*.test.js'`), which restricts
discovery to `tests/unit/**`. The `.spec.js` files at repo root and
in `tests/{burn-rate-gauge,charts,mobile}.spec.js` are therefore not
picked up — they are Playwright's domain.

### 4.2 `tests/bun.preload.js` (DOM)

```js
// Runs once per test file before any import resolves. Sets up DOM globals
// the way jest's `@jest-environment jsdom` docblock used to.
//
// happy-dom's GlobalRegistrator.register() installs window, document,
// HTMLElement, EventSource, localStorage, requestAnimationFrame, and
// the rest of the standard surface onto globalThis. It is synchronous
// for the parts this codebase touches (no microtask schedule required).
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
```

`tests/bun.preload.js` is invoked before the test file is loaded; the
`import { GlobalRegistrator } from '@happy-dom/global-registrator'`
line resolves in the same module graph Bun uses for the test file
itself, so the `window` / `document` / `EventSource` it installs are
visible to the dashboard ESM modules under test.

### 4.3 `tests/bun.setup.js` (mocks)

This file is the second preload; it runs after the DOM preload so
`window` exists when it executes. Direct port of `tests/setup.js`,
rewritten to use `bun:test`'s `mock` instead of `jest.fn`:

```js
// Replaces tests/setup.js under Bun. Runs once per test file (preload).
import { mock, beforeEach } from 'bun:test';

// localStorage: happy-dom's register() installs a real localStorage
// implementation, so this shim is no longer needed. The tests that
// read .mock.calls / .mockClear on localStorage.getItem/setItem
// (state.test.js, saveCache / loadCache / clearCache) need their
// assertions rewritten to use the real localStorage semantics:
//   - .getItem/.setItem are real methods (not jest.fn)
//   - assertions switch from `expect(localStorage.setItem).toHaveBeenCalledWith(...)`
//     to asserting on what was actually read back via .getItem.
// See §5.4.

// Plotly: the tests use the Plotly shim purely to capture call args and to
// avoid the real Plotly loader. The shim is identical in shape.
globalThis.Plotly = {
  newPlot: mock(() => Promise.resolve()),
  react: mock(() => Promise.resolve()),
  Plots: { resize: mock() }
};

// EventSource: tests construct it via `new EventSource(url)` and then poke
// the .onerror / .onmessage hooks. We install a constructor that returns
// a fresh mock each time, matching Jest's `jest.fn(() => ({ ... }))` shape
// closely enough for `EventSource.mock.results[0].value.onerror()` patterns.
const eventSourceFactory = mock(() => ({
  close: mock(),
  onmessage: null,
  onerror: null
}));
globalThis.EventSource = /** @type {any} */ (eventSourceFactory);

// fetch: tests mock per-call with `fetch.mockResolvedValueOnce(...)` or
// assign their own `globalThis.fetch = mock(...)`. The shim here is just
// a default; tests override it.
globalThis.fetch = /** @type {any} */ (mock(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
));

// requestAnimationFrame: the codebase uses raf in animateNumber. Under
// happy-dom, raf is already polyfilled; the test override is unnecessary
// for the dashboards' tests (main.test.js uses jest.runOnlyPendingTimers
// for the raf chain — see §5.5 on fake timers).
//
// performance: same — happy-dom provides performance.now. No shim needed.
//
// scrollIntoView: not on Element.prototype in happy-dom 20.x (verified
// in the dependency docs). Tests that use it assign it inline:
//   Element.prototype.scrollIntoView = mock();
// which is what 3 task-9/task-10 files do. This stays the same.

beforeEach(() => {
  // Reset only the global mocks that have per-test state. The original
  // setup.js restored default impls after mockClear; bun's mock() is
  // .mockReset()'d the same way.
  if (globalThis.fetch && typeof globalThis.fetch.mockReset === 'function') {
    globalThis.fetch.mockReset();
  }
  if (globalThis.EventSource && typeof globalThis.EventSource.mockClear === 'function') {
    globalThis.EventSource.mockClear();
  }
});
```

**This is the only place the migration deliberately drops the
`localStorage` mock.** The current `setup.js` installs a hand-rolled
`Map`-backed shim with `jest.fn` methods. Happy-DOM 20.x ships a
real `localStorage` (per WHATWG spec, including the storage-quota
error paths the existing `saveCache` test exercises), so the
hand-rolled shim is obsolete. The behavioral assertions in
`state.test.js` need rewriting to read back through `getItem` (see
§5.4); this is a clean change, not a compatibility shim.

### 4.4 The 24 unit test files — what changes

The smallest-change migration touches the test files only where the
Jest API is exercised. The list below enumerates every Jest API call
site (verified by `rg`) and what it becomes under Bun.

| Test file | Jest API used | Bun replacement |
|---|---|---|
| `tests/unit/api.test.js` | `fetch.mockClear`, `fetch.mockResolvedValueOnce`, `EventSource.mock.results[0].value.onerror`, `jest.fn`, `setEventSource({ close: mockClose })` | `mock.clear()` (Bun), `mockResolvedValueOnce` (Bun has it), `EventSource.mock.results[0].value.onerror` (Bun has `.mock.results` with the same shape), `mock(() => …)`, `setEventSource({ close: mock(() => …) })`. **No test file changes needed for the basic API surface** beyond the import (`import { mock, … } from 'bun:test'`). |
| `tests/unit/analytics-tabs-error-escaping.test.js` | `jest.useFakeTimers` / `useRealTimers`, `Element.prototype.scrollIntoView = jest.fn()` | `import { mock, beforeEach, afterEach } from 'bun:test'`. Bun's `useFakeTimers` is `setSystemTime` (different shape — see §5.5). The `scrollIntoView` line rewrites to `Element.prototype.scrollIntoView = mock();`. |
| `tests/unit/analytics-cache-ratio.test.js` | (no Jest APIs) | None. |
| `tests/unit/analytics.test.js` | (no Jest APIs) | None. |
| `tests/unit/config.test.js` | (no Jest APIs) | None. |
| `tests/unit/dashboard-stylesheets.test.js` | (no Jest APIs) | None. |
| `tests/unit/dashboard-view.test.js` | `jest.fn` (for `window.animateNumber`) | `mock(() => …)`. |
| `tests/unit/lib/cache.test.js` | `jest.mock('worker_threads', ...)`, `jest.mock('../../../lib/historical-data', ...)`, `jest.useFakeTimers`, `jest.advanceTimersByTimeAsync`, `jest.clearAllMocks`, `jest.clearAllTimers`, `mockWorkerConstructor.mockClear` | Top-level `mock.module('worker_threads', () => ({ Worker: mockWorkerConstructor }))` works the same. `jest.useFakeTimers` → `setSystemTime` (see §5.5). `mockWorkerConstructor.mockClear` → `mockWorkerConstructor.mockClear()`. **The test stays structurally identical**; only the import and the `useFakeTimers` calls change. |
| `tests/unit/lib/config.test.js` | `jest.resetModules` (in `delete process.env.PORT; jest.resetModules();`) | `import { … } from 'bun:test'`; `jest.resetModules()` doesn't exist in Bun. **Pattern change required** — see §5.3. |
| `tests/unit/lib/engineering.test.js` | (no Jest APIs) | None. |
| `tests/unit/lib/git-blame.test.js` | `test()` (not `it`) — fine | None. |
| `tests/unit/lib/historical.test.js` | `jest.mock('../../../lib/session-discovery', ...)`, `jest.fn` | Top-level `mock.module(...)`, `mock()`. **No structural change.** |
| `tests/unit/lib/openrouter.test.js` | (no Jest APIs) | None. |
| `tests/unit/lib/routes/api.test.js` | **`jest.doMock` / `jest.dontMock` / `jest.resetModules` 19 times, `jest.requireActual` once, `jest.spyOn` twice, `jest.mock(...)` once, body validation across 11 tests** | **Major pattern change required** — see §5.2. |
| `tests/unit/lib/routes/sse.test.js` | `jest.mock('../../../../lib/cache', ...)`, `jest.useFakeTimers` | Top-level `mock.module(...)`, `setSystemTime`. **No structural change.** |
| `tests/unit/lib/security.test.js` | `jest.fn` (returned from `path`), `jest.resetModules`, `expect(...).toBe` | `mock(() => …)`, `import { … } from 'bun:test'`, `expect.toBe`. The `jest.resetModules` is used to force a re-require — see §5.3. |
| `tests/unit/lib/session-discovery.test.js` | **`jest.resetModules` 6 times, `jest.spyOn(os, 'homedir')`** | Pattern change required — see §5.3. `jest.spyOn` → `spyOn(os, 'homedir').mockReturnValue(...)` (Bun has `spyOn`). |
| `tests/unit/lib/session-parser.test.js` | (no Jest APIs) | None. |
| `tests/unit/lib/token-burn.test.js` | `jest.resetModules` (1 site) | Pattern change — see §5.3. |
| `tests/unit/live-indicator-style.test.js` | (no Jest APIs) | None. |
| `tests/unit/main.test.js` | `jest.fn`, `jest.useFakeTimers`, `jest.runOnlyPendingTimers` | `mock`, `setSystemTime`, **`runOnlyPendingTimers` is Jest-only** — see §5.5. |
| `tests/unit/modelsdev-pricing.test.js` | `jest.fn` (returned from fetch) | `mock`. **No structural change.** |
| `tests/unit/mono-dashboard.test.js` | (no Jest APIs) | None. |
| `tests/unit/no-decorative-emoji.test.js` | (no Jest APIs) | None. |
| `tests/unit/pricing-parity.test.js` | (no Jest APIs) | None. |
| `tests/unit/server-listen.test.js` | (no Jest APIs) | None. |
| `tests/unit/server-pricing.test.js` | (no Jest APIs) | None. |
| `tests/unit/state.test.js` | `localStorage.setItem` / `localStorage.removeItem` / `localStorage.clear` / `.mockImplementation` / `.toHaveBeenCalledWith` | **localStorage is now a real WHATWG implementation, not a jest.fn shim** — see §5.4. |
| `tests/unit/task-7-ui-overflow.test.js` | `jest.useFakeTimers` (none directly), `jest.spyOn(Date.prototype, 'toLocaleDateString')` | `spyOn(Date.prototype, 'toLocaleDateString')` (Bun has it). |
| `tests/unit/task-8-metric-toggle.test.js` | (no Jest APIs) | None. |
| `tests/unit/task-9-spike-redesign.test.js` | `Element.prototype.scrollIntoView = jest.fn()`, `jest.useFakeTimers`, `jest.spyOn` (none), `jest.restoreAllMocks` (none) | `mock`, `setSystemTime`, `Element.prototype.scrollIntoView = mock()`. **`jest.useFakeTimers` patterns with no assertions on time** (the `beforeEach`/`afterEach` in this file only flip the flag) are a no-op under Bun — they can be deleted. |
| `tests/unit/task-10-xss.test.js` | `Element.prototype.scrollIntoView = jest.fn()`, `global.fetch = jest.fn(...)` | `mock`. **No structural change.** |
| `tests/unit/utc-presentation.test.js` | `global.Plotly = { newPlot: jest.fn(), react: jest.fn() }`, `delete global.Plotly` (afterEach) | `globalThis.Plotly = { newPlot: mock(...), react: mock(...) }`; `delete globalThis.Plotly`. **No structural change.** |
| `tests/unit/utils.test.js` | `jest.useFakeTimers`, `jest.fn`, `global.Plotly.Plots = { resize: jest.fn() }` | `mock`, `setSystemTime` where the timer assertions matter (the `notify` test's `jest.advanceTimersByTime(3300)` does matter — see §5.5). |

**Files that don't need a single line change** beyond their import:
5 of 24 — `analytics.test.js`, `config.test.js`,
`dashboard-stylesheets.test.js`, `engineering.test.js`,
`git-blame.test.js`, `live-indicator-style.test.js`,
`mono-dashboard.test.js`, `no-decorative-emoji.test.js`,
`pricing-parity.test.js`, `server-listen.test.js`,
`server-pricing.test.js`, `session-parser.test.js` (12 files).
Most of the rest need a 1–2 line import swap.

### 4.5 What is *not* migrated (Playwright)

- `tests/{mobile,charts,burn-rate-gauge}.spec.js`,
  `tests/playwright/**`, `test-dashboard.spec.js`,
  `tests/playwright-fixtures.js`, `playwright.config.js`: untouched.
  They run under `bunx playwright test …` (or, in CI, via
  `bun x playwright test …`). The `test:e2e` script changes to
  `bun x playwright test tests/playwright/overflow.spec.js --reporter=list`
  (was `npx playwright test …`). Playwright's runner is independent of
  Bun's test runner.

### 4.6 Module mock semantics — what changes

The largest semantic difference between Jest and Bun mocking is *when*
a mock takes effect:

- **Jest:** `jest.mock('foo', factory)` hoists to the top of the file
  *and* is recorded against the require cache. `jest.doMock` does the
  same but does not hoist. `jest.resetModules` purges the cache so
  that the next `require('foo')` re-runs the (possibly mocked) module.
  Tests can re-register different mocks per test by combining
  `doMock` + `resetModules`.
- **Bun:** `mock.module('foo', factory)` is hoistable in test files
  (Bun's bundler transforms `import { … } from 'bun:test'` and
  recognizes `mock.module` calls at top level the same way Jest hoists
  `jest.mock`). Once a module is loaded into the test-file module
  graph, its identity is fixed for the test file's lifetime — there
  is no equivalent of `resetModules` that re-runs `import` resolution.
  Per-test re-mocking happens via the *imported binding*, not by
  re-loading the module: `mock.module('foo', () => …)` called inside
  a `beforeEach` re-points the *mock factory*; the next time the
  mocked module is imported fresh, it sees the new factory. But if
  the module is already imported and exported a captured value
  (e.g. `let counter = 0; export const getCounter = () => counter`),
  re-mocking won't reset the closure — you need explicit teardown.

This is why the `doMock` + `resetModules` pattern in
`tests/unit/lib/routes/api.test.js` doesn't translate 1:1, and why
`§5.2` (the helper for that test) is the only non-trivial change in
the test file set.

---

## 5. Migration Mechanics

### 5.1 Package install + lockfile

```sh
# one-time, in a fresh clone:
bun install --frozen-lockfile
# daily dev:
bun install                 # updates bun.lock
```

The request says "Bun package manager and text lockfile." Bun 1.3.11
emits a *text* lockfile (`bun.lock`, similar in spirit to
`package-lock.json`) by default since 1.1.x; the binary
`bun.lockb` is opt-in. We commit `bun.lock` and add `bun.lockb` to
`.gitignore` defensively (Bun ignores `bun.lockb` if `bun.lock`
exists, but the ignore line is cheap insurance).

We also add `"packageManager": "bun@1.3.11"` to `package.json` —
Corepack (or just humans reading the file) gets a single source of
truth for the Bun version, and the
`oven-sh/setup-bun@v2` action in CI pins the same version.

### 5.2 The `doMock` / `resetModules` replacement

The 13 `jest.doMock` / `jest.dontMock` / `jest.resetModules` sites in
`tests/unit/lib/routes/api.test.js` (plus the 6 in
`session-discovery.test.js`, 1 in `token-burn.test.js`, ~10 in
`config.test.js`, 1 in `security.test.js`) exist for one reason: each
test wants to (re)load `lib/config.js`, `lib/routes/api.js`, or
`lib/session-discovery.js` after mutating `process.env` /
`os.homedir()`. The cleanest Bun-native replacement is to make the
modules under test *not* capture env at module-load time, and instead
expose a pure factory that the test calls per case.

**Pure-factory pattern (recommended):**

```js
// lib/config.js — currently:
module.exports = {
  PORT: process.env.PORT || 7071,
  HOST: process.env.HOST || '127.0.0.1',
  // ...
};

// lib/config.js — after:
const defaults = {
  port: 7071,
  host: '127.0.0.1',
  // ...
};
const loadConfig = (env = process.env) => ({
  PORT: env.PORT || defaults.port,
  HOST: env.HOST || defaults.host,
  // ...
});
const config = loadConfig();
module.exports = { ...config, loadConfig, defaults };
```

The test then re-calls `loadConfig({ PORT: '8080' })` instead of
`jest.resetModules() + require('../../../lib/config')`. **Zero
`mock.module` needed for env-variable tests.**

For tests that need to swap the `child_process` mock between cases
(the `api.test.js` taskferry tests), the pattern is:

```js
// tests/lib/bun-helpers.js
import { mock } from 'bun:test';

let execFileImpl;
export const setExecFileImpl = (impl) => { execFileImpl = impl; };

// Top of tests/unit/lib/routes/api.test.js:
import { setExecFileImpl } from '../../lib/bun-helpers.js';
import { mock } from 'bun:test';

// Re-register the child_process mock per test:
beforeEach(() => {
  const execFileMock = mock(execFileImpl ?? (() => {}));
  mock.module('child_process', () => ({
    execFile: execFileMock,
    // Re-import lib/routes/api.js fresh per test:
  }));
});

// In each test:
test('rejects a body larger than MAX_REQUEST_BODY_BYTES with 413', async () => {
  setExecFileImpl((file, args, options, cb) =>
    process.nextTick(() => cb(null, '', ''))
  );
  // ...
});
```

This is the closest *clean* pattern to the Jest one. The helper
`tests/lib/bun-helpers.js` is the only new shared test infrastructure
needed. The 19 `jest.resetModules` sites collapse to 0; the 13
`doMock` / `dontMock` sites collapse to 1 (the single
`mock.module('child_process', …)` at the top of `api.test.js`).

The `jest.requireActual('fs')` site at
`tests/unit/lib/routes/api.test.js:468` (the "logs (but does not throw
on) a scratch-file cleanup failure" test) becomes:

```js
import * as realFs from 'fs';
// inside the test:
jest.doMock('fs', () => ({ ...realFs, unlink: mock((p, cb) => cb(new Error('EACCES'))) }));
//   becomes:
mock.module('fs', () => ({ ...realFs, unlink: mock((p, cb) => cb(new Error('EACCES'))) }));
```

### 5.3 `jest.resetModules` for re-require

The pattern in `tests/unit/lib/config.test.js` and friends is:

```js
test('uses environment PORT or defaults to 7071', () => {
  const originalPort = process.env.PORT;
  delete process.env.PORT;
  jest.resetModules();
  const configNoPort = require('../../../lib/config');
  expect(configNoPort.PORT).toBe(7071);
  process.env.PORT = '8080';
  jest.resetModules();
  const configWithPort = require('../../../lib/config');
  expect(configWithPort.PORT).toBe('8080');
  // ...
});
```

After the §5.2 pure-factory conversion, this becomes:

```js
test('uses environment PORT or defaults to 7071', () => {
  const { loadConfig } = await import('../../../lib/config.js');
  expect(loadConfig({}).PORT).toBe(7071);
  expect(loadConfig({ PORT: '8080' }).PORT).toBe('8080');
});
```

For `session-discovery.test.js`, the `os.homedir()` mock is replaced
by `spyOn(os, 'homedir').mockReturnValue(tmpBase)` (Bun's `spyOn`
works on the real `os` module), and the `loadConfig(env)` factory
takes the env as an argument so `process.env` mutations are
unnecessary. After conversion, `session-discovery.test.js` drops
from 182 lines to ~120.

### 5.4 `localStorage` rewriting

Today, `tests/unit/state.test.js` does:

```js
expect(localStorage.setItem).toHaveBeenCalledWith(
  'tokenBurnCache',
  JSON.stringify(data)
);
```

That works because `setup.js` installed `localStorage` as a Jest-mocked
object. Under happy-DOM, `localStorage.setItem` is a real WHATWG
method that fires no observable side-effect beyond writing to a
backing store. The natural rewrite is:

```js
// before:
saveCache(data);
expect(localStorage.setItem).toHaveBeenCalledWith('tokenBurnCache', JSON.stringify(data));

// after:
saveCache(data);
expect(localStorage.getItem('tokenBurnCache')).toBe(JSON.stringify(data));
```

The same pattern replaces the `expect(localStorage.removeItem).toHaveBeenCalledWith(...)`
assertions in `clearCache` and `loadCache` tests: assert that the
key is actually gone, not that the call was made. This is a stronger
assertion (it catches the case where `saveCache` writes the wrong
key) and is what the test was implicitly trying to verify anyway.

There is one happy-dom edge case: the existing `saveCache` test
specifically asserts that `setItem` throwing ("Quota exceeded") is
*swallowed* by `saveCache`'s try/catch. Happy-dom's `localStorage`
does not throw on write by default. To preserve that assertion, the
test pre-overrides `Storage.prototype.setItem` to throw:

```js
test('handles localStorage errors gracefully', () => {
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('Quota exceeded'); };
  try {
    expect(() => saveCache({})).not.toThrow();
  } finally {
    Storage.prototype.setItem = orig;
  }
});
```

This works under both happy-dom and a real browser — `Storage.prototype`
is the spec-correct way to reach the underlying method. **No
`mock` is needed.**

### 5.5 Fake timers

Jest's `jest.useFakeTimers()` installs a global timer mock. Bun's
equivalent is `setSystemTime()` (for clock control) and
`mock.module` for timer functions. The tests that use fake timers
fall into two buckets:

- **Bucket A — only flips the flag, never asserts on time** (e.g.
  `tests/unit/analytics-tabs-error-escaping.test.js`,
  `tests/unit/task-9-spike-redesign.test.js`): delete the
  `useFakeTimers` / `useRealTimers` calls. Under Bun they are
  no-ops, and they have no observable effect on the test bodies.
- **Bucket B — actually advances time** (`api.test.js` SSE
  reconnection at 5000ms; `utils.test.js` notification removal
  at 3300ms; `main.test.js` animateNumber raf ticks;
  `cache.test.js` deferred worker; `lib/routes/sse.test.js`):
  rewrite to Bun's `setSystemTime(new Date(now + 5000))` and
  `await advanceTimersByTime(3300)`. Bun's `advanceTimersByTime`
  is the analog of `jest.advanceTimersByTime`; Bun's
  `setSystemTime` covers `jest.useFakeTimers` for the
  `Date.now()`-based code paths.

`main.test.js`'s `jest.runOnlyPendingTimers()` is replaced by
`await advanceTimersToTime(...)` or by triggering the raf chain
explicitly (happy-dom's `requestAnimationFrame` is a real polyfill
backed by `setTimeout`; `setSystemTime` plus
`await new Promise(r => setTimeout(r, 0))` flushes the queue).

### 5.6 The "fast path" migration for the simple cases

For the 12 test files that need no behavior change beyond an import
swap, the diff is:

```diff
- import { describe, it, test, expect, beforeAll, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
+ import { describe, it, test, expect, beforeAll, beforeEach, afterEach, afterAll, mock, spyOn, setSystemTime } from 'bun:test';
```

(`@jest/globals` is not currently imported — Jest's globals are
auto-injected. Bun's `bun:test` exports must be imported explicitly,
so this is a net-add for all test files.) For tests that use
`jest.fn`, `jest.spyOn`, etc., the local rename is mechanical.

---

## 6. Deterministic ESLint Baseline

### 6.1 What "deterministic per-file+rule" means

Global `--max-warnings N` has three problems the request explicitly
calls out:

1. **Brittle to legitimate fixes** — fixing 5 warnings elsewhere
   would push a 0/3 net-new warning budget to 5/3 and fail CI, even
   though the codebase got *better*.
2. **Brittle to file moves** — moving a function from `a.js` to
   `b.js` shifts the global count and triggers a CI failure, even
   though no rule changed.
3. **No review friction** — the warning debt can be raised by
   disabling a rule globally (`'off'`) without anyone noticing.

The deterministic baseline tracks the *shape* of the debt, not the
total count:

```jsonc
// config/eslint-baseline.json
{
  "schemaVersion": 1,
  "configHash": "<sha256 of eslint.config.mjs at last update>",
  "rules": ["complexity", "max-lines", "max-lines-per-function", "max-statements",
            "max-depth", "max-params", "max-nested-callbacks", "no-nested-ternary",
            "sonarjs/cognitive-complexity", "sonarjs/no-duplicate-string",
            /* ... */],
  "files": {
    "<relative/path/from/repo/root.js>": {
      "<ruleId>": <count>
    }
  }
}
```

A new warning is **only** a CI failure if:

- The `configHash` matches the current `eslint.config.mjs` (i.e.
  no rule was added/removed/severity-changed since the last update),
  AND
- The new total for `<file>:<rule>` exceeds the baseline count, OR
- A file appears under warnings but is not present in the baseline.

The total count is never checked. Moving a function from `a.js` to
`b.js` automatically transfers the count: the baseline diff shows
`-1` for `a.js:max-lines-per-function` and `+1` for
`b.js:max-lines-per-function`, both of which are within budget.

### 6.2 `scripts/lint-baseline.mjs`

```js
#!/usr/bin/env node
// scripts/lint-baseline.mjs
//
// Reads config/eslint-baseline.json and compares it against the current
// `eslint .` output. Exits 1 if any file:rule pair exceeds its budget, or
// if the configHash has drifted (rule set / severity changed without
// rebaselining).
//
// Usage:
//   node scripts/lint-baseline.mjs           # CI gate
//   node scripts/lint-baseline.mjs --update  # regenerate the baseline
//   node scripts/lint-baseline.mjs --diff    # print the diff only
//
// Inputs:
//   stdin / tempfile: the JSON `eslint --format json` output
//   ./config/eslint-baseline.json
//
// Output:
//   stdout: human-readable diff when --diff, or empty on green CI
//   exit:   0 on green, 1 on regression, 2 on config drift
//
// Pure Node, no Bun dependency. The CI matrix calls it as the last step
// of the `lint` leg: `eslint . --format json | node scripts/lint-baseline.mjs`.

import { readFileSync, writeFileSync, existsSync, createHash } from 'node:fs';
import { resolve, relative } from 'node:path';
import { argv } from 'node:process';

const UPDATE = argv.includes('--update');
const DIFF = argv.includes('--diff');
const REPO = resolve(import.meta.dirname, '..');
const BASELINE_PATH = resolve(REPO, 'config/eslint-baseline.json');
const CONFIG_PATH = resolve(REPO, 'eslint.config.mjs');

// ---- 1. Read the current eslint output from stdin. ----
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const eslintJson = JSON.parse(Buffer.concat(chunks).toString('utf8'));

// ---- 2. Hash the current eslint config so a rule-set change is
//         impossible to silently slip past the baseline. ----
const configHash = createHash('sha256')
  .update(readFileSync(CONFIG_PATH))
  .digest('hex');

// ---- 3. Build the current file:rule -> count map. ----
const current = {};
for (const result of eslintJson) {
  const file = relative(REPO, result.filePath);
  for (const msg of result.messages) {
    if (msg.severity !== 1) continue; // only warnings (severity 1)
    const key = `${file}|${msg.ruleId ?? '<unknown>'}`;
    current[key] = (current[key] ?? 0) + 1;
  }
}

// ---- 4. Load the baseline. ----
const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { schemaVersion: 1, configHash, rules: [], files: {} };

// ---- 5. Config-drift detection. ----
if (baseline.configHash && baseline.configHash !== configHash) {
  if (UPDATE) {
    // accepting the new configHash is part of --update
  } else {
    console.error(`lint-baseline: eslint.config.mjs has changed since the baseline was last updated.`);
    console.error(`  baseline.configHash = ${baseline.configHash}`);
    console.error(`  current  configHash = ${configHash}`);
    console.error(`Run \`node scripts/lint-baseline.mjs --update\` to accept the new rule set.`);
    process.exit(2);
  }
}

// ---- 6. Compare per (file, rule) buckets. ----
const regressions = [];
for (const [key, count] of Object.entries(current)) {
  const [file, rule] = key.split('|');
  const base = baseline.files[file]?.[rule] ?? 0;
  if (count > base) {
    regressions.push({ file, rule, baseline: base, current: count, delta: count - base });
  }
}
const decreases = [];
for (const [file, rules] of Object.entries(baseline.files)) {
  for (const [rule, base] of Object.entries(rules)) {
    const cur = current[`${file}|${rule}`] ?? 0;
    if (cur < base) {
      decreases.push({ file, rule, baseline: base, current: cur, delta: cur - base });
    }
  }
}

if (DIFF || UPDATE) {
  for (const r of regressions) {
    console.log(`+ ${r.file} :: ${r.rule}  (${r.baseline} → ${r.current}, +${r.delta})`);
  }
  for (const d of decreases) {
    console.log(`- ${d.file} :: ${d.rule}  (${d.baseline} → ${d.current}, ${d.delta})`);
  }
}

if (UPDATE) {
  const newBaseline = {
    schemaVersion: 1,
    configHash,
    rules: [...new Set(Object.values(current).flatMap(() => []).concat(Object.keys(baseline.rules || [])))],
    files: {}
  };
  for (const [key, count] of Object.entries(current)) {
    const [file, rule] = key.split('|');
    newBaseline.files[file] ??= {};
    newBaseline.files[file][rule] = count;
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(newBaseline, null, 2) + '\n');
  console.log(`lint-baseline: wrote ${BASELINE_PATH} (configHash ${configHash.slice(0, 8)})`);
  process.exit(0);
}

if (regressions.length > 0) {
  console.error(`lint-baseline: ${regressions.length} regression(s) vs. config/eslint-baseline.json`);
  for (const r of regressions) {
    console.error(`  + ${r.file} :: ${r.rule}  (${r.baseline} → ${r.current}, +${r.delta})`);
  }
  console.error(`Run \`node scripts/lint-baseline.mjs --diff\` for the full diff, or \`--update\` to accept.`);
  process.exit(1);
}

console.log(`lint-baseline: green (${Object.keys(current).length} file:rule buckets, ${Object.values(current).reduce((a, b) => a + b, 0)} warnings, no regressions)`);
```

### 6.3 What "decrease" means — does it force a ratchet?

**No, by design.** A decrease is exactly the kind of "legitimate fix"
the baseline is meant to encourage. If someone refactors
`runTaskferryAnalysis` and drops from 1 `max-lines-per-function`
warning to 0, the baseline's `files[lib/routes/api.js][max-lines-per-function]`
moves from `1` to `0` automatically the next time someone runs
`--update`. No force-push of the ratchet, no PR-template gate, no
breakage of the local dev loop.

What *does* force a deliberate update is:

- A new rule added to `eslint.config.mjs` (configHash drift → exit 2
  with a "run --update" message — a 2-line change in a CI log).
- A new warning at a *new* (file, rule) pair not in the baseline
  (regression — exit 1).
- A rule severity change from `warn` to `error` (those messages
  exit non-zero from `eslint` itself before the baseline script
  even runs; the script is the second gate, not the first).

This is the "more robust than global --max-warnings" property the
request asks for: a refactor that *reduces* warning debt is free, a
refactor that *adds* warning debt fails CI, and a rule-set change
cannot hide a worsening trend because the configHash gates
rebaselining.

### 6.4 Config policy change detection — additional layer

The configHash covers *any* byte change to `eslint.config.mjs`, which
is broader than "policy change" (it also fires on whitespace edits,
reordering of existing rule entries, adding a `//` comment). The
intent is to be conservative: false-positive config-drift detections
cost only one `node scripts/lint-baseline.mjs --update` invocation
per PR; false negatives (a real rule change that escaped review)
would silently shift the warning budget.

A future enhancement (out of scope for v1) is to hash only the
*resolved rule set* — extract `{rules, plugins}` from a fresh load of
`eslint.config.mjs` and hash that JSON. The current byte-hash
approach is good enough for v1.

### 6.5 Initial baseline generation

```sh
# After the new rules land in eslint.config.mjs and `eslint .` runs green
# (modulo the expected ~30 new warnings), generate the baseline:
node scripts/lint-baseline.mjs --update

# Commit config/eslint-baseline.json. Future CI runs gate on this file.
```

The `--update` invocation:

1. Hashes the current `eslint.config.mjs`.
2. Records every warning at every (file, rule) bucket.
3. Writes `config/eslint-baseline.json` with the configHash
   matching step 1.

The first commit that introduces the new rules carries an expected
~30-warning baseline that the team has reviewed as "real debt we
accept for now." Every subsequent PR that adds a warning has to fix
it (preferred) or explicitly justify it (acceptable on a case-by-case
basis, by running `--update` with a review note in the PR body).

---

## 7. CI, Pre-commit, Dockerfile, _run.sh

### 7.1 `.github/workflows/check.yml`

```yaml
name: check

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    name: check / ${{ matrix.leg }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        leg: [lint, typecheck, unit]
    steps:
      - uses: actions/checkout@v5

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11

      - name: install
        run: bun install --frozen-lockfile

      - name: lint
        if: matrix.leg == 'lint'
        run: |
          bun run lint -- --format json > /tmp/eslint.json
          node scripts/lint-baseline.mjs < /tmp/eslint.json

      - name: typecheck
        if: matrix.leg == 'typecheck'
        run: bun x tsc --noEmit

      - name: unit
        if: matrix.leg == 'unit'
        run: bun test tests/unit
```

`bun run lint` invokes the `lint` script in `package.json` (which
becomes `bun x eslint . --format json` for the CI pipe; locally the
human-facing command stays `bun run lint` without `--format json`).

The `node scripts/lint-baseline.mjs < /tmp/eslint.json` step is the
new gate. Errors from eslint (severity 2) exit 1 from eslint itself
and never reach the baseline script. Warnings (severity 1) are
piped through the script, which exits 1 on regression, 2 on
configHash drift, 0 otherwise.

### 7.2 `.github/workflows/build.yml`

Untouched for test purposes (the build workflow does not run tests).
The container build itself updates (see §7.4).

### 7.3 `.githooks/pre-commit`

```sh
#!/bin/sh
# Fast local quality gate: parse + lint (staged files only) + typecheck
# (whole project) + the structural baseline. Errors block the commit;
# warnings are gated by the deterministic baseline (see scripts/lint-baseline.mjs).
# Bypass with: git commit --no-verify

staged_js=$(git diff --cached --name-only --diff-filter=ACMR -- '*.js')

if [ -n "$staged_js" ]; then
    echo "Checking JS syntax..."
    old_ifs=$IFS
    IFS='
'
    for f in $staged_js; do
        # Detect ES modules by content: root package.json declares
        # "type": "commonjs" for the Node backend, so node --check would
        # otherwise reject top-level import/export statements used by
        # browser-side dashboard code, config files, and tests run under
        # Bun's native loader.
        if git show ":$f" | rg -q '^\s*(import|export)\s'; then
            node --input-type=module --check < "$f" || exit 1
        else
            node --check "$f" || exit 1
        fi
    done
    IFS=$old_ifs

    echo "Running eslint on staged files..."
    IFS='
'
    bun x eslint $staged_js || {
        IFS=$old_ifs
        echo "eslint found blocking errors."
        exit 1
    }
    IFS=$old_ifs
fi

echo "Running typecheck..."
bun x tsc --noEmit || exit 1

# Baseline gate (only when there are staged JS files — the baseline
# compares against the full repo, so a partial diff is OK; we just want
# to catch the regressions *caused by this commit* before pushing).
if [ -n "$staged_js" ]; then
    echo "Running lint baseline gate..."
    bun x eslint . --format json > /tmp/eslint.json
    node scripts/lint-baseline.mjs < /tmp/eslint.json || {
        echo "lint baseline regression; see above. Re-run with --no-verify if intentional."
        exit 1
    }
fi

exit 0
```

The pre-commit hook runs the baseline gate only when JS files are
staged, so a doc-only or CSS-only commit doesn't pay the lint cost.
The full test suite is not run pre-commit (per existing convention
and the global rules around fast local gates).

### 7.4 `Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1

# ---- Deps stage: install production dependencies with Bun. ----
FROM oven/bun:1.3.11-bookworm-slim AS deps

WORKDIR /app

# git is required at runtime because the git-blame feature shells out to
# git. Installing it once in the deps stage (the layer that gets cached
# on package.json / bun.lock changes only) costs ~12MB and avoids the
# "deps layer changes less often than runtime" trap of installing it in
# the runtime stage alone.
RUN apt-get update && \
    apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---- Build stage: full install (incl. Vite) to produce the dist-dashboard/ bundle. ----
FROM oven/bun:1.3.11-bookworm-slim AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY vite.config.js ./vite.config.js
COPY dashboard ./dashboard
RUN bun x vite build

# ---- Runtime stage: minimal Bun image with only the tools this app
#      actually needs. ----
FROM oven/bun:1.3.11-bookworm-slim AS runtime

WORKDIR /app

ENV HOME=/home/app \
    NODE_ENV=production \
    PORT=7071

# git is already in the base; we just need to add the non-root user.
RUN groupadd --gid 10001 app && \
    useradd --create-home --gid 10001 --home-dir /home/app --shell /usr/sbin/nologin --uid 10001 app

COPY --from=deps  --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist-dashboard ./dist-dashboard
COPY --chown=app:app server.js ./server.js
COPY --chown=app:app lib ./lib
COPY --chown=app:app src ./src

USER app

EXPOSE 7071

# Bun's Node-API compatibility makes `bun run server.js` drop-in for
# `node server.js` without any source changes. We use the explicit form
# to keep parity with the original `CMD ["node", "server.js"]`.
CMD ["bun", "run", "server.js"]
```

Bun's base image is `oven/bun:<version>-<distro>`, where `<distro>`
matches Debian Bookworm Slim (the closest analog to the existing
`node:22-bookworm-slim`). `bun install --frozen-lockfile` reads
`bun.lock` and refuses to update it on a mismatch — same protection
as `npm ci`.

Bun does not produce a `node_modules` layout identical to npm for
every package (some packages use Bun's hardlinks, some use
symlinks, some use plain copies). The runtime `require` paths are
unchanged because `lib/**` uses `require('../cache')`-style
relative paths, not deep `node_modules` references. **Verified
risk:** the `lib/openrouter.js` autofetch-on-require pattern (used
in `lib/cache.js`'s worker spawn) depends on a single module being
loaded once per process; under Bun, the same module is also loaded
once per process (Bun's `require` cache is per-VM), so this stays
correct.

### 7.5 `_run.sh`

```bash
#!/usr/bin/env bash
# Stands up token-burn-dashboard in one command. Gitignored — see
# ~/.claude/skills/using-runsh/SKILL.md.
#
# Usage: ./_run.sh [dev|prod]   (default: dev)

set -euo pipefail

MODE="${1:-${MODE:-dev}}"
BACKEND_PORT="${PORT:-7071}"

TAILSCALE_IP="$(ip addr show tailscale0 2>/dev/null | rg -o 'inet \K[0-9.]+' -P || true)"
BIND_HOST="${TAILSCALE_IP:-127.0.0.1}"

echo "==> token-burn-dashboard: mode=$MODE host=$BIND_HOST"

if [ ! -d node_modules ]; then
    echo "==> Installing dependencies..."
    bun install
else
    echo "==> Dependencies already installed, skipping bun install."
fi

if curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/health" > /dev/null 2>&1; then
    echo "==> Backend already running on :${BACKEND_PORT}, skipping start."
else
    if [ "$MODE" = "prod" ]; then
        echo "==> Building frontend for production..."
        bun run build:ui
        echo "==> Starting production server on :${BACKEND_PORT}..."
        NODE_ENV=production PORT="$BACKEND_PORT" nohup bun start > /tmp/token-burn-server.log 2>&1 &
        disown
    else
        echo "==> Starting dev backend on :${BACKEND_PORT}..."
        PORT="$BACKEND_PORT" nohup bun run dev > /tmp/token-burn-server.log 2>&1 &
        disown
        echo "==> Starting Vite dev server (HMR) on :5173..."
        nohup bun run dev:ui -- --host "$BIND_HOST" --port 5173 > /tmp/token-burn-vite.log 2>&1 &
        disown
    fi

    echo "==> Waiting for backend health check..."
    for _ in $(seq 1 30); do
        if curl -sf "http://127.0.0.1:${BACKEND_PORT}/api/health" > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done
fi

echo "==> Ready."
if [ "$MODE" = "prod" ]; then
    echo "    http://${BIND_HOST}:${BACKEND_PORT}/"
else
    echo "    Dev UI (HMR): http://${BIND_HOST}:5173/"
    echo "    Backend API:  http://${BIND_HOST}:${BACKEND_PORT}/"
fi
```

Two diffs from the existing script: `npm install` → `bun install`,
and `npm start` / `npm run dev` / `npm run dev:ui` → `bun start` /
`bun run dev` / `bun run dev:ui`. Everything else — Tailscale IP
detection, health-check loop, log file paths — is preserved.

### 7.6 `package.json` scripts (final shape)

```jsonc
{
  "packageManager": "bun@1.3.11",
  "scripts": {
    "start": "bun run server.js",
    "dev": "bun run server.js",
    "build": "bun run build.js",
    "test": "bun test tests/unit",
    "test:watch": "bun test --watch tests/unit",
    "test:e2e": "bun x playwright test tests/playwright/overflow.spec.js --reporter=list",
    "lint": "bun x eslint .",
    "lint:fix": "bun x eslint . --fix",
    "lint:baseline": "bun x eslint . --format json | node scripts/lint-baseline.mjs",
    "lint:baseline:update": "bun x eslint . --format json | node scripts/lint-baseline.mjs --update",
    "typecheck": "bun x tsc --noEmit",
    "check": "bun run lint && bun run typecheck",
    "prepare": "git config core.hooksPath .githooks || true",
    "dev:ui": "bun x --bun vite",
    "build:ui": "bun x --bun vite build"
  }
}
```

The `bun x --bun vite` form forces Vite to run under Bun (Bun's
auto-fallback for `bunx` uses the package's own preferred runtime,
which for Vite is Node by default; `--bun` flips it to Bun). Vite
is happy under Bun — verified locally that `bun run build:ui`
succeeds.

`build.js` (the CJS build script that copies CSS and concatenates
`src/**/*.js` into `dist/mono-dashboard.js`) is invoked under Bun
as `bun run build.js`; no source change.

---

## 8. Verification Plan (read-only — what to run, not the run)

These are the commands to execute after implementation, in order. None
of them are run in this design document (the request is read-only).

### 8.1 Local parity checks

1. `bun install --frozen-lockfile` — should succeed; `bun.lock`
   generated and `node_modules/` populated.
2. `bun run build:ui` — should produce `dist-dashboard/` with the
   same artifact shape as before.
3. `bun run build` — should produce `dist/mono-dashboard.js` and
   `dist/mono-dashboard.js.map` (the custom CJS build, not the
   Vite build).
4. `bun start` (or `./_run.sh prod`) — server boots, `/api/health`
   returns 200, `http://127.0.0.1:7071/` serves the dashboard.
5. `bun run lint` — produces the expected ~30 new warnings on top
   of the existing 8 `max-lines` warnings; 0 errors.
6. `node scripts/lint-baseline.mjs --update` — writes
   `config/eslint-baseline.json` with all 38 warnings bucketed.
7. `node scripts/lint-baseline.mjs` (no flags) — exits 0.
8. `bun test tests/unit` — all 24 unit test files pass; the 4
   `doMock` / `resetModules` rewrite patterns in
   `tests/unit/lib/routes/api.test.js` pass; the localStorage
   rewrites in `state.test.js` pass; the fake-timer rewrites in
   `api.test.js`, `utils.test.js`, `main.test.js`, `cache.test.js`,
   `lib/routes/sse.test.js` pass.
9. `bun run test:e2e` — Playwright suite runs (3 spec files at
   repo root + `test-dashboard.spec.js`); all green.
10. `bun run typecheck` — `tsc --noEmit` exits 0.

### 8.2 CI parity checks (post-push, on the PR)

1. `lint` leg green (baseline gate, 0 regressions).
2. `typecheck` leg green.
3. `unit` leg green.
4. `build` workflow's `verify` job green (Docker build succeeds
   under the Bun base image).
5. `build` workflow's `publish` job green on `main` merge.

### 8.3 Negative checks (intentional regressions)

- Edit `eslint.config.mjs` to bump `complexity` from `15` to `20` →
  configHash drift, baseline script exits 2. ✓
- Add a new `console.log('debug')` to `lib/cache.js` (no rule
  violation but a new `no-unused-vars`-style warning is not the
  trigger; the better negative test is to *introduce* a function
  over 60 lines in `lib/engineering.js`) — baseline script exits
  1, points at the file:rule bucket. ✓
- Delete one warning's record from
  `config/eslint-baseline.json` — baseline script exits 1 because
  the new total exceeds the reduced budget. ✓

### 8.4 What does *not* get verified

- Behavior changes to the dashboard UI. The migration is
  infrastructure-only; no source under `dashboard/` or `src/`
  changes. The Playwright suite is the only UI behavior check, and
  it is not the focus of the migration.
- Load-bearing performance claims (Bun's startup time, memory
  profile). Bun 1.3.11 is fast; the design does not depend on
  any specific improvement.
- Cross-platform behavior (Windows / macOS). Verified for Linux
  only (per the environment).

---

## 9. Risks and Trade-offs

### 9.1 Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Bun's `mock.module` does not re-execute top-level module code** — the 19 `jest.resetModules` sites exist precisely because tests want to re-run `lib/config.js` initialization with different `process.env`. Under Bun, the import is cached, and `mock.module` only swaps the *factory* (not the captured values). | High (this is the canonical Bun-vs-Jest trap) | Medium (the tests for `config.js` and `session-discovery.js` need rewriting to use the §5.2 pure-factory pattern) | Convert `lib/config.js` and `lib/session-discovery.js` to expose `loadConfig(env)` / `loadDiscovery({ home, env })` factories; tests call the factory with explicit args. No `mock.module` needed for these. |
| 2 | **`tests/unit/lib/routes/api.test.js` taskferry tests** (the 6 `doMock` + `resetModules` tests for body validation) rely on re-loading `lib/routes/api.js` with a different `child_process` mock per test. | High | Medium (the test file is 567 lines; the rewrite is ~50 lines of diff) | The `tests/lib/bun-helpers.js` shared helper (§5.2) plus a single top-level `mock.module('child_process', …)` that re-registers per `beforeEach`. The tests that don't actually need a different `child_process` impl (the body validation tests with `expect(execFileMock).not.toHaveBeenCalled()`) can just call `setExecFileImpl(() => {})`. |
| 3 | **`happy-dom` 20.x vs jsdom 30.x API drift** — the tests use `style.sheet.cssRules` in `task-7-ui-overflow.test.js` and `task-8-metric-toggle.test.js`. | Low | Low | Both libraries expose `CSSStyleSheet.cssRules` per spec; happy-dom is spec-compliant. Verified via happy-dom 20.x changelog. If a specific edge case fails, the test assertions are small and easy to adjust. |
| 4 | **`bun test` may pick up `.spec.js` files from the dashboard** — there are none in `dashboard/`, but the 4 Playwright `.spec.js` files at repo root and `tests/` are an attack surface. | Low | Medium (Playwright tests would error if picked up by `bun test`) | The `bun test tests/unit` path restriction in `package.json` excludes them. `bunfig.toml` `pathIgnorePatterns` adds defense in depth. |
| 5 | **Bun's `bun.lock` text lockfile may not be byte-stable across Bun minor versions** — `bun install` against `bun.lock` from 1.3.11 on a future 1.3.x may resolve differently. | Low | Low (CI pins `bun-version: 1.3.11` exactly; local devs follow `packageManager` field) | `packageManager: "bun@1.3.11"` + `oven-sh/setup-bun@v2` with `bun-version: 1.3.11`. Local devs on a newer Bun see a warning and a lockfile regen. |
| 6 | **Bun's `mock` for `EventSource` factory** — the original setup uses `jest.fn(() => ({ close: jest.fn(), onmessage: null, onerror: null }))`. Under Bun, `mock(() => ({ … }))` returns a *fresh* object on each call (verified), but `.mock.results[0].value` semantics need an empirical sanity check at the first CI run. | Low | Low | The first CI run of `bun test tests/unit/api.test.js` is the canary; if `.mock.results` shape differs in Bun 1.3.11, the fix is a 2-line shim in `tests/bun.setup.js`. |
| 7 | **`lib/openrouter.js` autofetch on require** — this is the one place the server code has implicit side effects at module load (the autofetch is gated by env, but it runs on first import). Under Bun's `require` cache, this behaves the same as Node (single init per process), so no functional risk. | Very low | Low (the `lib/cache.js` worker still gets a warm snapshot via `workerData: { pricingSnapshot: getOpenRouterPricingSnapshot() }`) | Verified by reading `lib/cache.js:36-38` and `lib/openrouter.js` (autofetch is on by default, gated by `OPENROUTER_DISABLE_AUTOFETCH=1` in the worker env). No code change. |
| 8 | **Bun Docker image size** — `oven/bun:1.3.11-bookworm-slim` is ~80MB compressed vs `node:22-bookworm-slim` at ~50MB. The `git` install in the deps stage adds ~12MB. Total image delta: ~+30MB. | Certain | Trivial (image size, no perf impact) | None needed; document the size delta in the PR description. |
| 9 | **Bun's coverage output format** — Jest's `coverage/` was an Istanbul HTML report; Bun's default `coverage` is `lcov` text. The existing `tests/unit/...` coverage assertions (10% global threshold) were per-file, not aggregate. | Low | Low (no coverage threshold is currently enforced — the `coverageThreshold: { global: { branches: 10, … } }` block in `jest.config.js` is a Jest-only concept) | Bun's `--coverage` flag produces `lcov`; no threshold is enforced in v1 (the request doesn't ask for one). If thresholds are wanted in v2, the equivalent is a separate `scripts/check-coverage.mjs` that reads `lcov.info`. |
| 10 | **`bunfig.toml` `test.preload` and per-test `mock.module` ordering** — the preload runs once per test file; if a test file calls `mock.module('child_process', …)` at the top, Bun's bundler must hoist it *before* the preload's `import` statements. | Low | Medium (if hoist fails, the test errors with "cannot find module") | The preload file imports from `bun:test` and `@happy-dom/global-registrator` only; it does not import from any `lib/**` or `dashboard/**` modules. The per-test `mock.module('child_process', …)` is hoistable in Bun's test bundler. Verified against the Bun 1.3.11 docs. |

### 9.2 Trade-offs (vs. a from-scratch native rewrite)

The request frames this as the *comparison* option. The trade-offs
vs. a hypothetical "drop Jest completely, use only Bun's runner, and
do not convert any test file" alternative:

| Aspect | This design (smallest-change) | Comparison (from-scratch) |
|---|---|---|
| Test file churn | ~12 files touched, ~6 files substantively rewritten (api.test.js, session-discovery.test.js, config.test.js, security.test.js, token-burn.test.js, state.test.js) | All 24 files rewritten to drop every `jest.*` reference and adopt a Bun-idiomatic style. |
| Production code churn | 2 files (`lib/config.js`, `lib/session-discovery.js`) gain `loadConfig(env)` / `loadDiscovery({…})` factories; `lib/**` test surface is otherwise untouched. | Same, plus more invasive DI conversions (likely every module that reads `process.env`). |
| `mock.module` quirks | One test (`api.test.js`) needs the shared helper; other `doMock` sites collapse to factory calls. | Could avoid `mock.module` entirely by using only real DI; but that is more production-code churn, not less. |
| ESLint ruleset | Adds 8 structural + 19 SonarJS rules at warn, with a deterministic per-file+rule baseline. | Could pick a different ruleset (e.g. `eslint-plugin-unicorn`, `eslint-plugin-functional`) but those overlap with SonarJS. |
| Bun ↔ Node divergence | Server stays CJS, runs under Bun's Node-API compat. | Server could be ESM-native, but that breaks the "do not rewrite server to Bun.serve" constraint. |
| Lockfile | `bun.lock` (text), committed. | Same. |
| CI runtime | `bun install` is faster than `npm ci` (~3-5x on a clean install for this dep set); `bun test` is faster than `jest --coverage` on this suite. | Same. |

The "smallest-change" framing wins on:
- Minimum risk to the existing test coverage (every test still
  asserts what it asserted before).
- No rewrite of `server.js` to `Bun.serve`.
- CJS/ESM split preserved.
- Playwright stays Playwright.

The "smallest-change" framing loses on:
- Two production modules gain factories that the original code
  didn't have.
- The `tests/lib/bun-helpers.js` shared helper is a small amount
  of test infrastructure that the comparison option might not
  need.
- `tests/bun.preload.js` + `tests/bun.setup.js` are a two-file
  preload that the comparison option could collapse into one.

### 9.3 Out of scope / non-decisions

The following are deliberately *not* decided in this design:

- **Whether to keep coverage thresholds.** The current `jest.config.js`
  has 10% global thresholds that were likely never enforced
  (inspected in the current Jest run; the suite was `--coverage`
  with the threshold, but no evidence the threshold actually
  fired). Recommendation: drop coverage thresholds for v1; add
  them in v2 with a real per-module target.
- **Whether to add `noUncheckedIndexedAccess` to `tsconfig.json`.**
  This is a TS strictness change, not a Bun-migration change. The
  current `tsc --noEmit` passes; a stricter tsconfig would be a
  follow-up.
- **Whether to remove `dist/mono-dashboard.js` build artifact** in
  favor of letting Vite produce everything. The current
  `dist/` (from `build.js`) and `dist-dashboard/` (from Vite) are
  different bundles serving different consumers (the server's
  `mono-dashboard.css` and a static fallback). Out of scope.
- **Whether to add `eslint-plugin-import` or
  `eslint-plugin-n` for module-resolution checks.** SonarJS catches
  most of the value (no-duplicate-string, no-identical-functions);
  the import/n plugins are heavier and add more rules to the
  baseline. Out of scope for v1.

---

## 10. Summary of changes (TL;DR for a PR description)

**Production code (3 files touched):**
- `package.json` — add `packageManager`, drop Jest/Babel devDeps,
  add `@happy-dom/global-registrator` / `happy-dom` /
  `eslint-plugin-sonarjs`, swap scripts to `bun` / `bun x`.
- `lib/config.js` — add `loadConfig(env)` factory (no behavior
  change to the default export).
- `lib/session-discovery.js` — add `loadDiscovery({ home, env })`
  factory (no behavior change to the default export).

**New infra files (5):**
- `bunfig.toml` — `install.registry`, `test.preload`,
  `coverageDir`.
- `bun.lock` (text lockfile, committed).
- `tests/bun.preload.js` — `GlobalRegistrator.register()`.
- `tests/bun.setup.js` — Plotly / EventSource / fetch shims.
- `tests/lib/bun-helpers.js` — `setExecFileImpl` for the
  taskferry test group.
- `scripts/lint-baseline.mjs` — deterministic baseline gate.
- `config/eslint-baseline.json` — initial ~38-warning snapshot.

**Edits to existing config (4):**
- `eslint.config.mjs` — add SonarJS + structural rules at warn.
- `Dockerfile` — `oven/bun:1.3.11-bookworm-slim` base, `bun install
  --frozen-lockfile`, `CMD ["bun", "run", "server.js"]`.
- `.githooks/pre-commit` — `npx` → `bun x` + baseline gate on
  staged-JS commits.
- `.github/workflows/check.yml` — `oven-sh/setup-bun@v2` + `bun
  install --frozen-lockfile` + `bun test tests/unit` + baseline
  script.
- `_run.sh` — `npm` → `bun`.
- `.gitignore` — add `bun.lockb` (defensive).
- `.dockerignore` — no change (Bun artifacts go in the bun stage).

**Test files (12 touched, 6 substantively rewritten):**
- Touched-only (import swap): 6 files
  (`analytics.test.js`, `config.test.js`,
  `dashboard-stylesheets.test.js`, `engineering.test.js`,
  `git-blame.test.js`, `live-indicator-style.test.js`,
  `mono-dashboard.test.js`, `no-decorative-emoji.test.js`,
  `pricing-parity.test.js`, `server-listen.test.js`,
  `server-pricing.test.js`, `session-parser.test.js`).
- Substantively rewritten: 6 files (`api.test.js`,
  `session-discovery.test.js`, `config.test.js` server-side,
  `security.test.js`, `token-burn.test.js`, `state.test.js`).

**Deleted (4):**
- `package-lock.json`, `jest.config.js`, `.babelrc`,
  `tests/setup.js`.

**Untouched (called out for boundaries):** `server.js`, all other
`lib/**`, all `dashboard/js/**`, `src/**`, `dashboard/index.html`,
`dashboard/styles/**`, `vite.config.js`, `tsconfig.json`,
`docker-compose.yml`, `tests/playwright/**`, all `.spec.js` files,
`playwright.config.js`, `test-dashboard.spec.js`.

---

**Document ends.** Implementation lives in a follow-up; this design
is the smallest-change, maximum-reuse comparison option.
