### Task 6: Make title-belt scoring reasoning-aware and calendar-valid

**Files:**
- Modify: `dashboard/js/title-belt.js:1-132`
- Modify: `dashboard/js/title-belt-render.js` only for incomplete/unavailable status copy
- Modify: `dashboard/js/api.js:150-167`
- Modify: `dashboard/js/config.js`
- Test: `tests/unit/title-belt.test.js`
- Test: `tests/unit/api-weekly-retention.test.js`
- Test: `tests/unit/modelsdev-pricing.test.js` if pricing normalization is changed

**Interfaces:**
- `diffModelStats(currModels, baseModels)` carries `total`, `input`, `output`, `cache_read`, `cache_write`, and `reasoning` positive deltas.
- `computeWeekWindow(weeklyData) -> {thisWeek, lastWeek, weekEndDay}|null` sorts valid ISO `YYYY-MM-DD` keys, deduplicates by day, and uses calendar dates rather than array positions. The current window is the latest complete seven-day interval represented by eight cumulative snapshots (baseline day plus seven days). `lastWeek` is returned only when its own eight required calendar keys are present.
- Missing dates never become an implicit full week. If the current window is incomplete, return `null`; if only the prior window is incomplete, return a window with `lastWeek: null` so the UI can still score current-week belts and suppress only Most Improved.
- `hasUsableFullPricing(pricing, stats)` requires finite numeric input/output/cache-read/cache-write/reasoning rates; an explicit zero is valid, and a missing rate required by a nonzero dimension makes the model unpriced.
- `effectiveRatePerMillion(stats, pricing)` calls `calculateCostWithPricing` and divides by `stats.total`, which already includes reasoning tokens. Never replace the denominator with the sum of only four fields.
- `WEEKLY_HISTORY_DAYS` is 15, and `updateData` retains at least the most recent 15 unique UTC day snapshots, sorted by day, so both current and prior windows can be checked.

- [ ] **Step 1: Replace position-based fixtures with real ISO dates.**

Build a fixture covering 15 consecutive dates and cumulative model totals. Assert current and prior windows both contain seven-day deltas. Add out-of-order and duplicate entries; after normalization, the result must use one entry per date and the latest cumulative value for that date.

- [ ] **Step 2: Add missing-day and rollover tests.**

Remove one required date from the current interval and assert `computeWeekWindow()` returns `null`. Remove only a prior-week date and assert `lastWeek` is `null` while `thisWeek` remains available. Add a month/year rollover fixture (for example `2026-01-29` through `2026-02-12`) to prove date arithmetic, not string slicing, identifies the windows.

- [ ] **Step 3: Add reasoning-aware cost tests.**

Use a reasoning-heavy model whose `reasoning` delta has a distinct rate and assert its effective rate includes that cost. Add an explicit zero reasoning rate and assert it remains priced. Add missing reasoning pricing with nonzero reasoning tokens and assert `thriftKing`/`sommelier` exclude that model rather than reporting a fabricated rate.

- [ ] **Step 4: Implement date-key normalization and window selection.**

Parse only valid UTC ISO day keys, sort ascending, deduplicate by day, and require the exact date-key set for each interval. Use a UTC date helper to subtract calendar days. Keep current-window and prior-window completeness separate. Do not use `weeklyData.length - 8` or `weeklyData.length - 15` as the source of truth.

- [ ] **Step 5: Carry reasoning through diffs and pricing.**

Add `reasoning` to the diff object and use the strict rate helper with token counts. Update the pricing contract/documentation in the JSDoc so all five fields are explicit. Preserve existing eligibility-floor and Most Improved behavior once the window is valid.

- [ ] **Step 6: Retain enough weekly history.**

Add/export `WEEKLY_HISTORY_DAYS = 15` if it is not already present in the aligned audited source. In `updateData`, update an existing UTC day in place, insert new days in date order, deduplicate, and trim only after retaining the most recent 15 days. Add API tests proving a 16th day removes only the oldest day and a missing middle day is not silently synthesized.

- [ ] **Step 7: Update incomplete-week rendering.**

If `computeWeekWindow` returns `null`, keep the existing “not enough history” state. If `lastWeek` is null but `thisWeek` exists, render current belts and keep Most Improved empty with copy that distinguishes “prior calendar week incomplete” from “no current week.” Do not show a title winner for an unavailable window.

- [ ] **Step 8: Run title-belt and retention tests.**

Run:

```bash
bun test tests/unit/title-belt.test.js tests/unit/api-weekly-retention.test.js tests/unit/modelsdev-pricing.test.js
```

Expected: PASS for reasoning costs, explicit zero/missing rates, ISO calendar windows, missing days, duplicates, out-of-order data, rollover, current/prior availability, and 15-day retention.

- [ ] **Step 9: Commit title-belt changes.**

```bash
git add dashboard/js/title-belt.js dashboard/js/title-belt-render.js dashboard/js/api.js dashboard/js/config.js tests/unit/title-belt.test.js tests/unit/api-weekly-retention.test.js tests/unit/modelsdev-pricing.test.js
git commit -m "fix(dashboard): score weekly belts from calendar windows"
```
