# Task 6 implementation report

## Scope

Task 6 makes title-belt scoring reasoning-aware and calendar-valid. The accepted implementation spans the calendar-window and weekly-retention changes in `0f5713c` and the strict token-dimension validation changes in `fe552e5`, with the direct scoring-boundary fix in `a568e44`.

## Root cause and fix

`scoreTitleBelt()` accepts already-diffed `thisWeek` stats. Before `a568e44`, `effectiveRatePerMillion()` delegated missing token-dimension handling to `hasUsableFullPricing()`, whose zero-token exception treated an omitted or null dimension as absent zero usage. A directly supplied malformed model could therefore receive a fabricated effective rate and win `thriftKing` or `sommelier`.

The scoring boundary now rejects stats unless all six token dimensions (`total`, `input`, `output`, `cache_read`, `cache_write`, and `reasoning`) are finite. `diffModelStats()` applies the same strict validation to current and existing base snapshots. Valid finite stats retain the existing volume eligibility behavior, including the separate contract that an otherwise valid but unpriced model may remain `volumeCrown` while receiving no priced belt.

The API normalization preserves missing and non-finite per-model dimensions for strict consumers instead of coercing them to zero. Calendar-window selection validates UTC ISO dates, deduplicates by day, requires complete current windows, and suppresses only `lastWeek` when the prior interval is incomplete. Weekly retention keeps the latest 15 unique valid UTC days.

## Files changed

- `dashboard/js/title-belt.js`
- `dashboard/js/title-belt-render.js`
- `dashboard/js/api.js`
- `tests/unit/title-belt.test.js`
- `tests/unit/title-belt-render.test.js`
- `tests/unit/api.test.js`
- `tests/unit/api-weekly-retention.test.js`

## Verification

- `bun test tests/unit/api.test.js tests/unit/title-belt.test.js tests/unit/api-weekly-retention.test.js tests/unit/title-belt-render.test.js tests/unit/utils.test.js`
  - 132 pass, 0 fail, 250 expect() calls.
- Repository commit hooks ran ESLint baseline and typecheck on both Task 6 commits.
  - ESLint reported 0 errors and existing warning-level complexity/max-statements findings.
  - Typecheck completed cleanly.
- `git diff --check` completed cleanly after the accepted changes were committed.

## Review note

The first fixer changeset contained the already-dirty six-file Task 6 baseline and could not be applied atomically to the lower worktree. It was rejected without discarding the work. The baseline was checkpointed as `fe552e5`, then the fixer was resumed against that clean checkpoint. The accepted incremental changeset was only the one-line scoring guard and its direct null-dimension regression, committed as `a568e44`.

No concerns remain from the fixer. The ignored worker report did not survive Taskferry settlement, so this durable report records the returned worker contract and controller-observed verification.
