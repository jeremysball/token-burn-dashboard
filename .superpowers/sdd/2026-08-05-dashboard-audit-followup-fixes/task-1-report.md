# Task 1 report: Cache slider renders the actual-rate baseline before user interaction

**Status:** DONE
**Original commit:** `133b7e6` (rewritten as `e031c5e` on this branch) — `fix(dashboard): render actual cache rate before slider interaction`
**Reviewer-fix commit:** appended below (this dispatch)

## What I did

1. **Step 1 — Failing tests.** Added two imports (`computeCacheScenario, getRealCacheHitRatePct` from `cache-scenario.js`, `fmtCur` from `utils.js`) and a `heterogeneousData()` fixture plus three tests inside `describe('renderCacheSlider', ...)` in `tests/unit/cache-slider.test.js`:
   - untouched initial render shows the **actual**-rate baseline (`#cachePaidValue` === `fmtCur(scenario.actualPaid)`),
   - after the user drags, shows the **requested** (what-if) baseline,
   - keeps showing the **requested** baseline if the user drags back to the real rate (regression guard).

2. **Step 2 — Verified the failure.** `bun test tests/unit/cache-slider.test.js` → **14 pass / 1 fail**. The untouched-render test failed exactly as predicted (`Expected: "$3.03", Received: "$3.30"` — the old `renderReadout` rendered `scenario.paid`, the `requestedPaid` alias). The two user-moved regression-guard tests already passed pre-fix, as the brief expected.

3. **Step 3 — Fix.** `renderReadout` in `dashboard/js/cache-slider.js` now reads `container.querySelector('#cacheSlider').dataset.userMoved` and picks `savedVsNoCache`/`requestedPaid` when the user has moved the slider, `actualSavedVsNoCache`/`actualPaid` otherwise. No changes to `applySliderPrecision`, `renderCacheSlider`, `getCacheSliderPrecision`, or `formatCacheRatePct`.

4. **Step 4 — Verified the fix.** `bun test tests/unit/cache-slider.test.js` → **15 pass / 0 fail**. Full suite `bun test tests/unit` → **569 pass / 0 fail** across 54 files. `bunx eslint` and `bunx tsc --noEmit` both clean.

5. **Step 5 — Committed** with the brief's exact message.

## Deviation from the brief (and why)

The brief supplied the fixture verbatim plus the note "if the first test also passes, ... adjust it until `actualPaid` and `requestedPaid` differ." The **verbatim fixture could not satisfy the first test even after the fix**, so I adjusted it:

- Verbatim `low-cache/model` had `input: 900_000, cache_read: 100_000` (10% actual rate), mirroring `high-cache/model` at 90%. The two per-model actual rates are symmetric around the blended real rate (50%), so for the fixed-cost-free, rate-linear cost model the aggregate `actualPaid` equals the aggregate `requestedPaid` exactly (both $3.30) at hitRate 50 — the untouched render's slider position. With equal numbers, `#cachePaidValue` would match `actualPaid` regardless of the fix, and the `not.toBeCloseTo(...)` assertion would fail permanently.
- Minimal change: `low-cache/model` now uses `input: 800_000, cache_read: 200_000` (20% actual rate), keeping the models asymmetric so `actualPaid` ($3.03) ≠ `requestedPaid` ($3.30) at the untouched render. This deviation was flagged as a concern in the original report.

Everything else (interfaces, exact test bodies except that one numeric line, exact `renderReadout` implementation, commit message) was used verbatim.

## Reviewer finding fix (this dispatch)

**Finding:** after the fixture change above, the fixture's top-level `total_input: 500_000, total_cache_read: 500_000` no longer matched the sum of the two models' own `input`/`cache_read` fields (`900_000` / `1_100_000`, a 55% aggregate rate). A real dashboard snapshot's top-level totals always equal the sum of its per-model tokens, so the fixture no longer represented coherent data, even though the tests still passed.

**Fix:** updated the fixture's top-level totals to equal the actual per-model sum — `total_input: 900_000`, `total_cache_read: 1_100_000` (the smaller of the two allowed options; the model split was left untouched). This makes `getRealCacheHitRatePct` report the coherent 55% aggregate rate, matching the per-model data.

The three fixture tests still pass with the coherent totals:
- The untouched-render test still asserts `actualPaid !== requestedPaid` at hitRate 50 — the per-model rates (90% / 20%) remain asymmetric, so the symmetric-mix bug is not reintroduced.
- `actualPaid` is hitRate-independent (it uses per-model actual rates), so the untouched-render assertion still holds at the 55% slider position.

**Verification:** `bun test tests/unit/cache-slider.test.js` → **15 pass / 0 fail** (30 expect() calls). `bunx eslint tests/unit/cache-slider.test.js dashboard/js/cache-slider.js` → clean.

## Concerns

- The reviewer-fix commit below touches only `tests/unit/cache-slider.test.js` (the fixture totals) plus this report; `dashboard/js/cache-slider.js` is unchanged.
- The pre-commit hook logs `error: Unable to create '/workspace/.../.git/packed-refs.lock': Read-only file system` during its housekeeping step in this sandbox; the commit lands cleanly and the hook's own lint + typecheck steps pass.
