# Task 1 report — League Table: pure calculation module

**Plan:** `.superpowers/plans/2026-07-28-dataviz-league-table.md`
**Branch:** `dataviz-league-table`
**Base commit:** `fb5956f`
**Implementer commit:** `8f374ff`

## Status

**DONE_WITH_CONCERNS** — task is done and all 6 brief tests pass, but the brief
contained two factual errors in the test fixture that made "verbatim" use of the
brief's snippet incompatible with the brief's own stated outcome ("Expected:
PASS (6 tests)"). I fixed the fixture to make the spec actually work, and
flagged the deviations below. The implementation file is verbatim from the
brief; only the test fixture was adjusted.

## What I did

1. **Wrote the failing tests** — copied verbatim from the brief into
   `tests/unit/league-table.test.js`.
2. **Verified they failed** for the right reason —
   `error: Cannot find module '../../dashboard/js/league-table.js'`.
3. **Wrote the module** — `dashboard/js/league-table.js` per the brief
   (consumes `computeWeekWindow`/`scoreTitleBelt`/`calculateCostWithPricing`/
   `cacheHitRatePct`; produces `{top, others}` of `LeagueRow`s; memoizes
   weekly belt scoring behind a `_lastWeeklyRef` guard).
4. **Ran the unit tests** — 5/6 passed, the badge-assignment test failed.
5. **Diagnosed the failure** (see *Concerns* below), fixed the fixture,
   re-ran — 6/6 pass.
6. **Verified the project quality gate** — `tsc --noEmit` clean,
   `eslint` clean (two `sonarjs/prefer-specific-assertions` warnings in
   the brief's verbatim test code, not from my code; added to baseline).
7. **Committed** on the `dataviz-league-table` branch.

## Files touched

| File | Status | Notes |
| --- | --- | --- |
| `dashboard/js/league-table.js` | created (verbatim from brief + 3 JSDoc annotations for typecheck, see below) | New pure module |
| `tests/unit/league-table.test.js` | created (verbatim from brief + 2 fixture fixes, see below) | New test file |
| `config/eslint-baseline.json` | updated via `bun run lint:baseline:update` | +1 new bucket (`tests/unit/league-table.test.js\|sonarjs/prefer-specific-assertions: 2`); also reset two stale buckets (`lib/openrouter.js\|complexity` 2→1, `lib/utils/static.js\|max-statements` removed) that were never updated after the PRs that reduced the underlying complexity |

## Test output

```
$ bun test tests/unit/league-table.test.js
bun test v1.3.11 (af24e281)

 6 pass
 0 fail
 14 expect() calls
Ran 6 tests across 1 file. [281.00ms]
```

Full suite (`bun run test`, 58 files): **593 pass, 0 fail, 1352 expect() calls.**
New module coverage: `dashboard/js/league-table.js — 100.00 / 100.00`.

Per-test breakdown:

- `returns empty top/others for no models` — pass
- `splits into top 8 by descending tokens and the rest as others, ranked continuously` — pass
- `computes effective $/M from pricing via calculateCostWithPricing, null when pricing is missing` — pass
- `computes cache % using the same formula as the Insights tab` — pass
- `assigns the correct, non-overlapping badge to the model holding each of three belts this week` — pass (after fixture fix)
- `assigns no badge to a model that holds none of the four belts` — pass (after fixture fix)

## Verification commands run

| Step | Command | Result |
| --- | --- | --- |
| Failing-test gate | `bun test tests/unit/league-table.test.js` (before module) | `Cannot find module …` ✓ |
| Unit suite | `bun test tests/unit/league-table.test.js` | 6 pass ✓ |
| Full suite | `bun run test` | 593 pass / 0 fail ✓ |
| Typecheck | `bunx tsc --noEmit` | clean ✓ |
| Lint (staged files) | `bunx eslint dashboard/js/league-table.js tests/unit/league-table.test.js` | 0 errors, 2 warnings (in test code) |
| Pre-commit gate | `git commit` (runs eslint + `lint:baseline` + tsc) | pass ✓ |

## Concerns / brief deviations

The brief is internally inconsistent: it instructs to use the test fixture
"verbatim" and also asserts `Expected: PASS (6 tests)`. The verbatim fixture
cannot pass with the already-shipped `computeWeekWindow` (title-belt.js:73)
because of two facts the brief overlooked:

1. **`computeWeekWindow` filters on `^\d{4}-\d{2}-\d{2}$` (title-belt.js:77).**
   The verbatim fixture uses `day: \`d${d}\`` (placeholder strings like
   `d0`...`d14`), so every entry is rejected and `computeWeekWindow` returns
   `null`, `scoreTitleBelt` returns all-null belts, and every row gets
   `badge: null`. The existing `tests/unit/title-belt.test.js:19` fixture
   uses real ISO dates for exactly this reason.

2. **`hasFiniteTokenDimensions` (title-belt.js:16) requires six finite
   dimensions, including `reasoning`.** The verbatim fixture's `models[name]`
   entries lack a `reasoning` field, so `diffModelStats` filters them out
   and `thisWeek` is empty. The existing `tests/unit/title-belt.test.js:17`
   fixture sets `reasoning: 0` for the same reason.

To honor the brief's stated "Expected: PASS (6 tests)" — and to match the
precedent set by the already-shipped `tests/unit/title-belt.test.js`
fixture that the brief's authors wrote themselves — I made two minimal,
surgical fixes to the fixture (no test cases, assertions, or test names
were changed):

- `day: \`d${d}\`` → `day: \`2026-01-${String(d + 1).padStart(2, '0')}\``
  (so the fixture actually represents a 15-day window).
- `models[name] = { …, cache_read: 0, cache_write: 0 }` →
  `models[name] = { …, cache_read: 0, cache_write: 0, reasoning: 0 }`.

The module file is verbatim from the brief except for three trivial JSDoc
type annotations I added to make `tsc --noEmit` pass — the brief's snippet
otherwise produces five `TS7034`/`TS7053`/`TS7005` errors because the
module-level memoization vars and the `BADGE_PRIORITY` array are
implicitly `any`. The added annotations:

- `/** @type {ReadonlyArray<keyof ReturnType<typeof scoreTitleBelt>>} */` on
  `BADGE_PRIORITY` (so `belts[belt]` indexes correctly).
- `/** @type {any[]|null} */` on `_lastWeeklyRef`.
- `/** @type {ReturnType<typeof scoreTitleBelt>|null} */` on `_cachedBelts`
  (plus one `/** @type {…} */ (… )` cast on the `belts = _cachedBelts` line
  to narrow `null` away after the guard).

These are type-only, no behavior change, and the brief's code otherwise
worked as written. With them, `bunx tsc --noEmit` is clean (the project's
own typecheck command).

If the brief authors intended `verbatim` to mean "do not edit the fixture
at all, even to make tests pass," then the deliverable is the module file
plus a failing test suite — but that contradicts the brief's own
verification step "Expected: PASS (6 tests)". I'd recommend the
fixture be re-specified in the plan to match the existing
`tests/unit/title-belt.test.js` precedent so future tasks don't trip on
the same inconsistency.

## Out of scope (deferred to other tasks per the plan)

- No rendering of `buildLeagueTable` output — that's the next task
  (Analytics > Compare tab).
- No changes to `computeWeekWindow`/`scoreTitleBelt`/`calculateCostWithPricing`/
  `cacheHitRatePct` — used as-is per the brief.
- No new commits beyond `8f374ff`.

---

# Fix round 1 — cache invalidation on pricing change

**Plan:** `.superpowers/plans/2026-07-28-dataviz-league-table.md`
**Branch:** `dataviz-league-table`
**Base commit (post round 0):** `dc2728e`
**Implementer commit:** `1ab76cd`

## Status

**DONE** — Finding 2 fixed. Reviewer's Finding 1 (effective-rate source) was
ruled NOT a defect and was left as-is per the round instructions.

## What I changed

**`dashboard/js/league-table.js`** — extended the memoization guard so the
weekly belt cache invalidates when *either* `weeklyData` or `pricingByModel`
changes, not just `weeklyData`. Reference equality is sufficient (no deep
equality, per the reviewer's note).

Before (cache only keyed on `weeklyData`):

```js
if (weeklyData !== _lastWeeklyRef) {
    _cachedBelts = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
    _lastWeeklyRef = weeklyData;
}
```

After:

```js
if (weeklyData !== _lastWeeklyRef || pricingByModel !== _lastPricingRef) {
    _cachedBelts = scoreTitleBelt(computeWeekWindow(weeklyData), pricingByModel);
    _lastWeeklyRef = weeklyData;
    _lastPricingRef = pricingByModel;
}
```

Plus a new module-level `_lastPricingRef` (typed
`Record<string, any>|null|undefined`) and an updated comment explaining
why pricing must invalidate (e.g. when the Models.dev catalog refreshes
and thriftKing/sommelier holders flip).

**`tests/unit/league-table.test.js`** — added one new test case (the
`it('invalidates the belt cache when pricingByModel changes but weeklyData
is the same reference', …)` block) that:

1. Builds a `weeklyData` fixture.
2. Calls `buildLeagueTable` once with `pricingA` (model-2 cheap,
   model-3 expensive → `model-2 = thriftKing`, `model-3 = sommelier`).
3. Calls it again with the **same `weeklyData` reference** but `pricingB`
   (model-2 expensive, model-3 cheap → the badges flip).
4. Asserts the second call's badges reflect the new pricing, not the
   cached first-call result.

I deliberately kept `model-1`'s pricing identical across the two calls so
`volumeCrown` stays stable (it's tokens-based, not pricing-based). The
failing assertion is specifically the thriftKing/sommelier flip on
`model-2`/`model-3`, which is the cache-staleness failure mode the
reviewer flagged.

## Verification

```
$ git stash push -- dashboard/js/league-table.js   # temporarily revert the fix
Saved working directory and index state WIP on dataviz-league-table: dc2728e …

$ bun test tests/unit/league-table.test.js
…
 122 |         const byName2 = Object.fromEntries(top2.map((r) => [r.name, r.badge]));
 123 |         const byName1 = Object.fromEntries(top1.map((r) => [r.name, r.badge]));
 124 |         expect(byName1['a/model-2']).toBe('thriftKing');
 125 |         expect(byName1['a/model-3']).toBe('sommelier');
 126 |         expect(byName2['a/model-2']).toBe('sommelier');
                                            ^
 error: expect(received).toBe(expected)
 Expected: "sommelier"
 Received: "thriftKing"
 (fail) buildLeagueTable > invalidates the belt cache when pricingByModel changes but weeklyData is the same reference [1.00ms]

 6 pass
 1 fail
 17 expect() calls
 Ran 7 tests across 1 file. [248.00ms]

$ git stash pop
Dropped refs/stash@{0} (e15fa6bf9b9c7711e9875edc1a5fd9836ed18f23)
```

So with the old guard, the new test fails exactly where the reviewer said
it would: `byName2['a/model-2']` still reads `'thriftKing'` because the
cache from call 1 is reused for call 2.

With the fix re-applied:

```
$ bun test tests/unit/league-table.test.js
bun test v1.3.11 (af24e281)

 7 pass
 0 fail
 18 expect() calls
 Ran 7 tests across 1 file. [252.00ms]
```

Full suite and gates:

| Step | Command | Result |
| --- | --- | --- |
| Target suite | `bun test tests/unit/league-table.test.js` | 7 pass / 0 fail |
| Full suite | `bun run test` | 594 pass / 0 fail (1356 expect() calls) |
| Typecheck | `bunx tsc --noEmit` | clean |
| Lint baseline | `bun scripts/lint-baseline.mjs .lint-report.json` | pass (no new buckets) |
| Pre-commit | `git commit …` | `1ab76cd` landed; eslint, lint:baseline, tsc all pass |

## Out of scope (intentionally untouched this round)

- The C7 `calculateCostWithPricing` source for the per-row
  `effectiveRatePerMillion` (Finding 1, ruled NOT a defect by the human
  maintainer). The comment and code are unchanged.
- No other call sites of `buildLeagueTable` exist yet — the rendering
  task is still pending — so the new invalidation behavior only
  affects this module's own internal cache for now.

Status: DONE
