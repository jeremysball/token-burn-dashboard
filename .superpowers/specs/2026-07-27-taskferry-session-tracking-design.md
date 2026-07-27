# Taskferry session tracking (issue #44)

## Problem

The dashboard tracks token/cost usage from Pi and Claude Code sessions
(`lib/session-discovery.js`, `lib/session-parser.js`), but not from taskferry
dispatches. Taskferry work is a real, growing source of usage on this
account and doesn't show up anywhere in the dashboard today.

## Prerequisite

This design assumes `jeremysball/taskferry#201` is fixed first
(`result()` was overwriting `tokens`/`cost` on every `step_finish` instead of
summing them, silently undercounting multi-step opencode tasks down to just
the final step's usage). Fixed in `taskferry` PR #202. Building this
integration on the old buggy behavior would have baked the undercount into
the dashboard from day one.

## Architecture

A new `lib/taskferry-discovery.js`, following the same dependency-injection
pattern as `session-discovery.js`/`session-parser.js` (constructor-injected
`execFileImpl`/`fsImpl`, no hidden globals) so it's testable without a real
`taskferry` binary. It owns two responsibilities:

1. Enumerate task IDs via `taskferry list --all`.
2. Resolve token/cost/model data for any ID not already in a persistent
   local cache.

Two existing consumers, `lib/token-burn.js` and `lib/historical-data.js`,
each get one new call folding taskferry's normalized events into the same
per-model aggregation loops they already run over Pi/Claude session events.
No changes to `session-discovery.js`/`session-parser.js` themselves.

**Scope: global, not per-project.** Matches the existing convention —
`session-discovery.js` already walks every `PI_SESSION_BASES` directory and
all of `~/.claude/projects` regardless of which repo the dashboard is
serving. Uses `taskferry list --all`, not `--directory <path>`.

## Components & data flow

`taskferry-discovery.js` exposes `findAllTaskferryEvents()`, mirroring
`findAllSessionFiles()` + `parseJsonlFile()`'s combined job in one call:

1. Run `taskferry list --all` (execFile, injectable, timeout-guarded like
   the existing `TASKFERRY_*_TIMEOUT_MS` constants in `lib/config.js`).
2. Load a persisted id-to-event cache from
   `path.join(env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'token-burn-dashboard', 'taskferry-token-cache.json')`
   — same convention `TASKFERRY_SCRATCH_DIR` already uses, with an
   env-var override.
3. For any `done` task ID not already in the cache, run
   `taskferry result <id> --fields tokens,cost,model,timestamp` and decode
   its TOON output with the real `@toon-format/toon` package's `decode()`
   (see "Dependency" below) into
   `{source: 'taskferry', provider, model, modelKey, input, output,
   cacheRead, cacheWrite, reasoning, total, timestamp, cost}` — matching the
   shape `session-parser.js` already produces per line. Since a `done`
   task's result is immutable, write it to the cache and never re-fetch.
4. Non-`done` statuses (`crashed`, `cancelled`, `unknown`, `running`) are
   skipped — no billable usage to attribute.
5. Return the full list of cached plus newly-fetched events.

**Scale note:** `taskferry list --all` currently returns ~3489 `done` tasks
on this account. There is no batch `result` command; each uncached ID costs
one `taskferry result` subprocess call. The id-keyed, never-expiring cache
(step 2-3 above) is what keeps this from re-spawning thousands of processes
on every dashboard poll — only genuinely new task IDs since the last run
pay that cost.

### Dependency: `@toon-format/toon`

`taskferry result`'s nested fields (`tokens:` / `cache:`) are structured
TOON, not a flat single-line value — the regex the existing
`runTaskferryAnalysis()` in `lib/routes/api.js` uses for the flat `message`
field doesn't generalize to a nested block. Rather than hand-roll a
parser for this, add `@toon-format/toon` (the real package taskferry
itself uses to encode TOON, already in `taskferry`'s own
`package.json`) as a dependency and use its `decode()` function.

Verified directly against this dashboard's actual runtime (`bun@1.3.11`,
`"type": "commonjs"`): `require('@toon-format/toon')` works under Bun and
`decode()` correctly reconstructs real `taskferry result --fields tokens`
output, including the nested `cache` object, even though the package ships
ESM-only (no `require` condition in its `exports` map) — Bun's module
resolution handles that transparently.

While making this change, also switch the existing flat `message`-field
regex parse in `lib/routes/api.js`'s `runTaskferryAnalysis()` onto the same
`decode()` call, so there's one TOON-reading strategy in the codebase, not
two.

### Cost handling

Taskferry-sourced model buckets use the real, summed `cost` value pulled
from `taskferry result`, not `calculateCost()` from `lib/pricing.js`.

`lib/pricing.js` has no concept of a `-free` model suffix — confirmed
directly: `getPricing('opencode/deepseek-v4-flash-free')` and
`getPricing('opencode/mimo-v2.5-free')` both fall through to the generic
default pattern ($2.50/$10 per 1M tokens) rather than $0. Most taskferry
dispatches on this account use exactly these free-tier models, so
recomputing cost via the shared pricing table would fabricate a nonzero
cost for usage that was actually free. Taskferry's own `cost` field comes
from the executor's real step_finish/provider billing data and already
reflects this correctly.

In `token-burn.js`/`historical-data.js`, this means one carve-out in the
existing per-model cost loop: a model bucket sourced from taskferry sums
real `cost` values directly instead of calling `calculateCost(modelData,
modelKey)`.

Assumption made explicit: this carve-out is keyed per model bucket, on the
premise that taskferry's model namespace (`opencode-go/*`,
`xiaomi-tknplan/*`, `openrouter/*`, `minimax/*`, etc.) doesn't overlap with
whatever modelKey strings Pi/Claude Code sessions produce. If a future
model string genuinely collides across sources, that bucket would need a
finer split (real cost for its taskferry-sourced portion, `calculateCost()`
for the rest) — not handled here since no current overlap exists.

## Error handling

| Scenario | Handling |
|---|---|
| `taskferry` binary not on PATH | Treated as "integration unavailable" — log once, return an empty event list. Same posture `session-discovery.js` already takes toward a missing session directory (skip, don't crash `/api/tokens`). |
| `taskferry list --all` fails or times out | Log the real error, return whatever's already in the persisted cache rather than nothing. |
| A single `taskferry result <id>` call fails (corrupt log, unexpected error) | Skip that one task ID, log it, keep processing the rest. |
| Cache file missing or corrupt JSON | Treated as an empty cache and rebuilt from scratch. |
| A task is `running` in `list --all` but finishes between that call and the `result` call | Fine either way — only cache once `result` itself reports a terminal status. |

## Testing

Follows the existing `session-discovery.test.js` convention: `bun:test`,
dependency-injected `execFileImpl`/`fsImpl` (no real `taskferry` process or
real disk in unit tests). Covers: cache hit/miss per task ID, skip-on-non-done
status, `decode()` output mapped into the normalized event shape correctly,
and the cost carve-out (taskferry-sourced buckets use summed real `cost`,
not `calculateCost()`).

## Open, deferred to the UI-layer design pass

How the frontend distinguishes a taskferry series from a Pi/Claude one
(separate chart series, a tag/filter, etc.) is not decided here. The
models tab (`dashboard/js/views/analytics/tabs/models.js`) has no existing
per-source visual pattern to extend today — every normalized event already
carries a `source` field (`'pi'` / `'claude'` / now `'taskferry'`)
regardless of how the UI eventually chooses to present it, so this doesn't
block the backend architecture above. Revisit when designing that specific
UI section.
