# Bun Runtime And Strict Lint Design

**Status:** Approved design, pending implementation plan

## Goals

- Use Bun `1.3.11` as the package manager, application runtime, CI runtime, and container runtime.
- Replace Jest, Babel, and Jest's DOM environment with native `bun:test` plus an explicit DOM preload.
- Add strict structural ESLint and SonarJS enforcement, with every added rule at warning severity during cleanup.
- Prevent net-new lint-warning debt without blocking work on existing debt.
- Preserve the current CommonJS server, ESM dashboard, and separate Playwright runner.

## Verified Baseline

- `npm test` passes 34 suites and 369 tests.
- Existing ESLint emits eight `max-lines` warnings, which CI currently accepts.
- `bun test tests/unit --coverage` fails before migration because it lacks DOM setup and does not support Jest's `resetModules` and `dontMock` APIs.
- `server.js` and `lib/**` use CommonJS while `dashboard/js/**` uses ESM. Bun runs the server successfully without changing either module style.
- `.githooks/pre-commit` is tracked and executable. It currently runs Node syntax checks, `npx eslint`, and `npx tsc`.

## Runtime Migration

`package.json` becomes the single declaration of the supported runtime:

- Add `"packageManager": "bun@1.3.11"`.
- Replace `package-lock.json` with committed text `bun.lock`.
- Remove Jest, `jest-environment-jsdom`, `@babel/core`, and `@babel/preset-env` after the native test suite reaches parity.
- Add the compatible `eslint-plugin-sonarjs`, `happy-dom`, and `@happy-dom/global-registrator` versions through Bun.
- Run server, build, Vite, lint, typecheck, unit-test, and Playwright scripts through `bun`, `bun run`, or `bunx` as appropriate.

`Dockerfile` changes all three stages to the supported `oven/bun:1.3.11` image family. Dependency and build stages run `bun install --frozen-lockfile`; the runtime stage runs `bun server.js`. The runtime stage retains the non-root `app` user and installs `git` there because git-blame shells out at request time.

`_run.sh` replaces npm invocations with Bun equivalents while preserving its current Tailnet binding, health check, and dev/prod behavior.

`check.yml` pins Bun with `oven-sh/setup-bun@v2`, runs `bun install --frozen-lockfile`, and uses Bun commands for lint, typecheck, and unit-test legs. `build.yml` remains structurally unchanged because it verifies the updated Dockerfile.

## Native Unit Tests

The unit command becomes `bun test tests/unit`, which excludes Playwright `.spec.js` files. `test:e2e` continues to call Playwright through `bunx playwright`.

Add two Bun preloads:

- `tests/bun.preload.js` registers happy-dom globals before test modules load.
- `tests/bun.setup.js` installs resettable Bun mocks for Plotly, EventSource, fetch, animation frame behavior, and any browser API absent from happy-dom.

The migration ports tests to explicit `bun:test` imports. It does not add a permanent Jest-compatibility layer.

The current Jest module-cache tests require deliberate seams:

- `lib/config.js` exposes `loadConfig(env)` and preserves its current default export by initializing it with `process.env`.
- `lib/session-discovery.js` exposes a discovery factory that accepts its environment and home-directory dependencies instead of capturing them only at module load.
- `lib/routes/api.js` separates the taskferry execution dependency from request validation and handler behavior. Tests supply an `execFile` fake directly rather than reloading the module with `jest.doMock`.
- Tests using mocked `fs`, `child_process`, `worker_threads`, or session discovery migrate to `mock.module` only where module-level substitution remains necessary.
- `state.test.js` asserts happy-dom localStorage state instead of Jest mock call history. Its quota-error case temporarily replaces the real storage method and restores it in `finally`.
- Timer tests use Bun timer controls or explicit async synchronization. Tests that only toggled Jest fake timers without asserting timing behavior drop those calls.

Coverage stays a required gate. The Bun test command and configuration must preserve the current unit-test scope, source include/exclude list, and global threshold values from `jest.config.js`. If Bun cannot express those controls directly, add a small Bun-run coverage checker over its generated report before deleting Jest.

## Strict Warning Policy

All newly introduced structural and SonarJS rules are warnings. No new lint rule is elevated to error in this migration.

Application and tooling JavaScript receives these structural limits:

| Rule | Limit |
| --- | --- |
| `complexity` | 10 |
| `max-lines` | 300 nonblank, noncomment lines |
| `max-lines-per-function` | 50 nonblank, noncomment lines |
| `max-statements` | 15 |
| `max-depth` | 4 |
| `max-params` | 4 |
| `max-nested-callbacks` | 3 |

SonarJS uses its compatible recommended maintainability rules, but the configuration explicitly maps every enabled SonarJS rule to warning severity. The implementation verifies the resolved ESLint configuration so a recommended preset cannot silently introduce an error-level rule.

Tests remain subject to file length, cyclomatic complexity, depth, parameter count, and correctness-oriented SonarJS rules. The test override disables only body-shape rules that would be noise in test fixtures: function length, statement count, nested callbacks, cognitive complexity, duplicate strings, and identical functions.

## Lint Debt Gate

Add `scripts/lint-baseline.mjs` and committed `config/eslint-baseline.json`.

The checker runs under Bun and consumes ESLint JSON output. It fails closed when:

- ESLint reports an error or fatal parser failure.
- The report cannot be parsed or the checker cannot run.
- A warning appears in a new file/rule bucket.
- A file/rule warning count exceeds the committed baseline.
- The lint-policy identity differs from the recorded baseline.

The baseline identity includes hashes of `eslint.config.mjs` and `bun.lock`. This detects rule-configuration changes and dependency upgrades that could alter SonarJS or ESLint behavior.

Warning decreases are always accepted without a baseline edit. Renamed files, new rules, changed severities, and dependency changes require an explicit baseline update reviewed in the same change. The initial baseline records existing warnings after all strict rules are enabled.

CI runs ESLint first, writes its JSON report to a temporary file, and then runs the Bun checker. A nonzero ESLint exit status stops the job before the checker reads the report.

## Hook Behavior

The hook remains installed through the package lifecycle, but its installation script distinguishes a real Git checkout from environments such as a Docker build. It fails when hook installation fails inside a checkout and skips only when no Git worktree exists.

The executable `.githooks/pre-commit` uses Bun tooling for staged-file linting, typechecking, and the full-repository lint-baseline gate. ESLint provides the staged JavaScript parser check, so the Node-only syntax preflight is removed rather than replaced with an unverified Bun flag.

## Verification

Implementation is complete only when all of the following pass:

1. `bun install --frozen-lockfile`
2. `bun run lint` with warnings but zero errors
3. `bun run lint:baseline`
4. A negative lint-budget fixture proving that a new file/rule warning fails
5. A negative lint-policy fixture proving config or lockfile drift fails
6. `bun run typecheck`
7. `bun test tests/unit --coverage` with the preserved coverage requirements
8. `bun run test:e2e`
9. `bun run build` and `bun run build:ui`
10. A Bun server health check
11. A Docker smoke test that verifies the non-root Bun container, `git --version`, health endpoint, and git-blame route fixture
12. A hook smoke test that confirms executable mode and Bun-based checks

## Review Outcome

`openai/gpt-5.6-sol` at low effort reviewed this design in an isolated worktree. Its valid findings on dependency injection, coverage parity, fail-closed lint accounting, DOM preload, and runtime git verification are incorporated above. Its claim that the repository lacks a hook was rejected: `.githooks/pre-commit` exists and is executable.
