# Final review fix report — daily-field-report plan

## Summary

Both Important findings from the final whole-branch review (over
`fb5956f..ab92bd1`, on `lib/routes/api.js`) have been fixed, with
regression tests covering each. The full unit suite passes (631/631, up
from 618 in the prior round) and `tsc --noEmit` is clean.

- **Finding 1** (blank taskferry result returned as a successful
  report): fixed at the shared `runTaskferryAnalysis` layer so both
  `/api/insights/analyze` and `/api/insights/daily-report` are
  protected, not just the daily-report route.
- **Finding 2** (`validateDailyReportSummary` only checks `typeof`):
  tightened with `Number.isFinite` on every numeric field, range
  checks on the hour fields, and non-negativity on the count/sum
  fields.

## Finding 1 — fix details

### Where the fix lives

The fix is placed inside `runTaskferryAnalysis` (the shared
infrastructure function both insight endpoints use), not inside
`handleDailyReportRoute` alone. Rationale:

- The brief explicitly identifies the bug as affecting the shared
  layer: "an empty/blank taskferry result is returned as a successful
  report" via `res.end(JSON.stringify({ insights, source: 'taskferry'
  }))`. Both the deep-insights handler (`lib/routes/api.js:492-493`)
  and the daily-report handler (`lib/routes/api.js:543-544`) build
  that response shape, so the same "200 with empty insights" bug
  existed on the deep-insights route as well — fixing it at the
  shared layer closes both holes with one change.
- The route handler's existing `try/catch` (around the `runTaskferryAnalysis`
  await) is already wired to convert any throw into a 503 with the
  endpoint-appropriate message ("AI analysis service unavailable" /
  "AI report generation unavailable"). Throwing the new error lets us
  surface 503 with zero new error-handling code in the route
  handlers.

### What the fix does

After the existing TOON message parse in `runTaskferryAnalysis`
(`lib/routes/api.js:209-212`), the returned value is now checked:

```js
if (typeof result !== 'string' || result.trim() === '') {
  throw new Error(`taskferry result for task ${taskId} had a blank or non-string message`);
}
```

This catches both:
- a `status: done` task that returned `""` or whitespace-only text
  (e.g. a model refusal / no-content), and
- a non-string payload (defensive — shouldn't happen given the
  current TOON parser, but cheap to guard).

The throw propagates out of `runTaskferryAnalysis`, is caught by
the route handler's existing `catch` block, and surfaces as 503
with the appropriate "AI report generation unavailable" message —
which the dashboard widget already knows how to handle via its
existing `catch` branch (renders an error + Retry button instead of
`formatMarkdownBoldToHtml('')` which would silently produce a blank
body with no error and no Retry control).

### Regression tests

Three new tests in `tests/unit/lib/routes/api.test.js`:

1. `handleDailyReportRoute` → `returns 503 (not 200 with empty insights)
   when taskferry result message is an empty string`: mocks the
   `result` call to emit `message: ""`, asserts 503 + body equals
   `{ error: 'AI report generation unavailable' }` + no `"insights"`
   field in the body. The `expect(res.body).not.toMatch(/"insights"/)`
   line is the explicit lock-in for "not a 200 with empty insights".
2. `handleDailyReportRoute` → `returns 503 when taskferry result
   message is whitespace-only`: same shape, with `message: "   \n\t  "`
   to cover the `.trim() === ''` case.
3. `createInsightsHandler taskferry analysis` → `returns 503 (not 200
   with empty insights) when taskferry result message is an empty
   string`: parallel test on the deep-insights route, locking in the
   same shared-infrastructure guarantee there as well.

## Finding 2 — fix details

### What the fix does

`validateDailyReportSummary` (`lib/routes/api.js:312-336`) now:

- For every `typeof x === 'number'` check, additionally requires
  `Number.isFinite(x)`. This rejects `NaN`, `Infinity`, and
  `-Infinity`, which all satisfy `typeof === 'number'`.
- Range-checks `peakHour.hour` to `0 <= hour <= 23`.
- Range-checks each `hourlyBuckets[i].hour` to `0 <= hour <= 23`.
- Rejects negative values for the count/sum fields: `totalTokensToday`,
  `totalCostToday`, `peakHour.totalTokens`,
  `baseline.meanHourlyTokens`, `baseline.stddevHourlyTokens`, and each
  `hourlyBuckets[i].totalTokens`.
- Leaves `tokenShareByModel`/`costShareByModel`'s per-entry values
  unvalidated (dynamic model-name keys, not a fixed schema) — the
  object-shape check on the maps themselves is unchanged.

The docstring was updated to make the lightweight-schema rationale
explicit: it's about not requiring EXTRA fields the prompt never
reads, not about skipping finiteness/range checks on required ones.

### Regression tests

A new `describe('handleDailyReportRoute request validation tightening')`
block in `tests/unit/lib/routes/api.test.js` with a small
`rejection()` helper that clones the valid summary, mutates one
field, submits it, and asserts the response is 400 with
`execFileImpl` never called. Nine cases cover all the new
rejections:

- `NaN` `totalTokensToday` rejected.
- `Infinity` `baseline.meanHourlyTokens` rejected.
- `-Infinity` `baseline.stddevHourlyTokens` rejected.
- `peakHour.hour = 24` rejected.
- `peakHour.hour = -1` rejected.
- `hourlyBuckets[0].hour = 25` rejected.
- `hourlyBuckets[0].totalTokens = -1` rejected.
- `totalTokensToday = -1` rejected.
- `totalCostToday = -0.01` rejected.
- `peakHour.totalTokens = -100` rejected.

Each test asserts both the 400 response AND that `execFileImpl` was
never called, which is the operationally important property: a
malformed/hostile request must not reach the taskferry dispatch chain
(an expensive, unattended background LLM call).

## Verification — real output

### `bun test tests/unit/lib/routes/api.test.js` (the touched test file)

```
bun test v1.3.11 (af24e281)

 32 pass
 0 fail
 98 expect() calls
Ran 32 tests across 1 file. [233.00ms]
```

19 prior tests + 13 new tests = 32 total, all passing.

### `bun run test` (full unit suite)

```
 631 pass
 0 fail
 1448 expect() calls
Ran 631 tests across 59 files. [14.01s]
```

Up from 618/618 in the prior round, exactly matching the 13 new
tests added. The `ENOENT: /secret/internal/path` line visible in the
full output is a `console.error` from the SSE error-leak test
(`tests/unit/lib/routes/sse.test.js:28`) — the test intentionally
triggers that error to verify the SSE error path does NOT leak the
raw message to clients; the suite's own pass/fail tally
("631 pass, 0 fail") is authoritative.

### `bunx tsc --noEmit`

```
EXIT=0
```

Clean — no diagnostics.

## Files changed

- `lib/routes/api.js`: blank-result rejection in `runTaskferryAnalysis`;
  tightened `validateDailyReportSummary` with `Number.isFinite`,
  hour-range, and non-negativity checks; updated docstring.
- `tests/unit/lib/routes/api.test.js`: 3 new tests for Finding 1
  (1 in deep-insights, 2 in daily-report), 10 new tests for
  Finding 2.

## Deferred / non-blocking (from prior review)

The 1 deferred Minor from the reviewer's report — `playwright-fixtures.js`'s
mock uses `models` not `tokens_by_model`, so the e2e daily report gets
empty shares — is left untouched per the brief's scope (Important
findings only, this final-review-fix wave).

Status: DONE
