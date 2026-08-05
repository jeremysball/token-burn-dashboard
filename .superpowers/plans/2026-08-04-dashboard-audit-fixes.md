# Dashboard Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 16 verified dashboard correctness defects across ticker lifecycle, odometer updates, cache what-if pricing, live-event diffing, weekly title-belt scoring, and Timeline dead-air rendering without replacing the existing widget architecture.

**Architecture:** Keep each behavior in its existing module, but make the data contracts explicit at the boundaries Terra identified as load-bearing. Shared numeric/pricing validation lives in `dashboard/js/utils.js`; source provenance and revision identity travel through `dashboard/js/api.js` and `dashboard/js/state.js`; the ticker and live-feed modules consume those contracts without introducing a new state manager. The cache scenario exposes a direct uniform-rate result and a separately computed actual-baseline result instead of hiding a quadratic interpolation inside one number.

**Tech Stack:** Bun 1.3.11, browser ES modules, happy-dom, Bun unit tests, Playwright, Plotly, ESLint, and the existing Node/Bun dashboard server.

## Global Constraints

- Use Bun 1.3.11 and the existing `bun.lock`; do not add dependencies.
- Use `fd` for file discovery and `rg` for text search; never use `find` or `grep`.
- Preserve the existing module boundaries and first-paint/valid-update behavior unless a task below explicitly changes it.
- Treat the approved scope as 16 distinct findings: live-event items 11–12 are one per-dimension/delta-mix fix, live-feed items 13–14 are one baseline/delta-percentage fix, and the remaining items are one each.
- Reject `null`, `undefined`, strings, empty strings, `NaN`, and infinities as missing numeric pricing. Accept a numeric `0` as an explicitly usable free rate.
- A nonzero token dimension with no usable matching rate makes that model/event cost unavailable; never fabricate a zero cost. A zero-token dimension does not require a rate.
- Preserve negative/rollback deltas as non-billable: only positive per-dimension growth contributes to a live event or a period diff.
- Cached data may render the dashboard, but it must never seed the live-event baseline. The first fresh HTTP/SSE snapshot seeds the baseline; a later fresh snapshot may emit an event.
- The dashboard value gate records the newest requested token total. Odometer state owns displayed and queued targets and must eventually settle on the newest request.
- Title-belt windows are calendar-date validated, not array-position validated. Missing days must produce an unavailable/incomplete window rather than a fabricated full week.
- Timeline dead-air detection is valid only for file-backed hourly history. SSE-only samples are not hourly buckets and must not produce dead-air bands.
- Every task ends with focused tests and a Conventional Commit. Never add a `Co-Authored-By` trailer.
- The later implementation dispatch must use the user-approved model `openrouter/deepseek/deepseek-v4-flash-0731`; do not substitute another implementer model without approval.

---

## Preflight: implementation base and source map

The current design commit is on local `main`, while the audited Timeline/title-belt source is present in commit `602eae0` on the remote-tracking line. Before implementation, the feature worktree must contain both the design spec and the audited source. Do not modify local `main` to perform this alignment.

- [ ] Create the feature worktree from the current `main` after this plan is approved.
- [ ] In that feature worktree, verify `git show 602eae0:dashboard/js/dead-air.js`, `git show 602eae0:dashboard/js/title-belt.js`, and `git show 602eae0:dashboard/js/title-belt-render.js` are readable.
- [ ] If the feature worktree does not already contain the commits through `602eae0`, merge the local `origin/main` ref into the feature branch, retaining `.superpowers/specs/2026-08-04-dashboard-audit-fixes-design.md`. Resolve only the expected design-file/base-line merge if needed.
- [ ] Run `git status --short --branch` and `git log --oneline --decorate -5`; the feature worktree must be clean before the first implementation task.
- [ ] Run the existing focused baseline tests:

```bash
bun test tests/unit/equiv-ticker.test.js tests/unit/odometer.test.js tests/unit/cache-scenario.test.js tests/unit/cache-slider.test.js tests/unit/live-event-diff.test.js tests/unit/live-event-feed.test.js tests/unit/title-belt.test.js tests/unit/dead-air.test.js
```

Expected: the current audit reproductions remain visible in the baseline tests or the relevant files are absent until the audited source is aligned; do not call the baseline green until every named test file is present and runs.

---

## File structure and ownership map

These are the files the implementation is expected to touch. Keep new logic in the owner listed here instead of creating a parallel dashboard state layer.

- Modify `dashboard/js/utils.js`: strict finite-number/rate helpers shared by cache, live-event, and title-belt calculations.
- Modify `dashboard/js/equiv-ticker.js`: corpus validation, mounted ticker value/timer ownership, async refresh, and invalid-value cleanup.
- Modify `dashboard/js/main.js`: await/observe the corpus refresh contract and mark cached data with its source provenance.
- Modify `dashboard/js/state.js`: data source and monotonic data revision state used to process each fresh snapshot exactly once.
- Modify `dashboard/js/api.js`: source-aware `updateData`, fresh HTTP/SSE provenance, and safe normalization of reasoning fields.
- Modify `dashboard/js/odometer.js`: locale digit codec and newest-target replay state.
- Modify `dashboard/js/views/dashboard.js`: requested-value odometer gate and provenance-aware live-feed render call.
- Modify `dashboard/js/cache-scenario.js`: eligible-cohort calculation, direct uniform-rate scenario, and separate actual-rate baseline.
- Modify `dashboard/js/cache-slider.js`: shared precision/step/formatter for small nonzero rates.
- Modify `dashboard/js/live-event-diff.js`: five-dimensional positive deltas, delta cache percentage, and dimension-matched cost.
- Modify `dashboard/js/live-event-feed.js`: cache suppression, revision deduplication, and fresh-baseline lifecycle.
- Modify `dashboard/js/dead-air.js`: strict hourly validation, one-bucket support, and optional chart-end trailing band.
- Modify `dashboard/js/views/analytics/tabs/timeline.js`: file-history-only dead-air detection, chart-end calculation, and Plotly shapes/annotations.
- Modify `dashboard/js/views/analytics/tabs/shared.js` only if the timeline needs a shared UTC completed-hour/range-end helper; keep that helper pure and reusable.
- Modify `dashboard/js/title-belt.js`: reasoning-aware diffs/pricing and calendar-date week windows.
- Modify `dashboard/js/title-belt-render.js` only if unavailable/incomplete week status needs an explicit UI distinction.
- Modify `dashboard/js/config.js` and `dashboard/js/api.js`: retain at least 15 daily snapshots for the two-week comparison window.
- Modify or add focused unit tests under `tests/unit/` for every finding.
- Add `tests/dashboard-audit-live.spec.js` (or the repository’s established equivalent Playwright path) for the real server/browser exercise; do not replace the existing mocked chart tests.

---

### Task 1: Establish strict numeric and pricing contracts

**Files:**
- Modify: `dashboard/js/utils.js:294-321`
- Modify: `dashboard/js/modelsdev-pricing.js:47-93,135-198` if the shared contract needs to preserve presence flags through normalization
- Modify: `lib/pricing.js:78-133` only if server pricing records need the same explicit-zero/presence semantics
- Test: `tests/unit/utils.test.js`
- Test: `tests/unit/modelsdev-pricing.test.js`
- Test: `tests/unit/server-pricing.test.js`

**Interfaces:**
- Produce `isFiniteNumericRate(value) -> boolean`: true only for a JavaScript number that is finite; numeric `0` is true, `null` and numeric-looking strings are false.
- Produce `getUsablePricingRate(pricing, field, tokenCount = 0) -> number|null`: return a finite numeric field, including zero; return `null` when the field is missing/invalid or when an explicit `has<Field>` flag says the rate is absent for a nonzero token count.
- Preserve `hasInput`, `hasOutput`, `hasReasoning`, `hasCacheRead`, and `hasCacheWrite` when a source already supplies presence flags. Do not infer that `null` or `''` means an explicit free rate.
- Update `hasUsableCacheReadPricing()` to call the shared contract and accept `{input: 0, cacheRead: 0}` while rejecting `{input: null}` and `{cacheRead: null}`.

- [ ] **Step 1: Add failing tests for strict rates and explicit zero.**

```js
it('rejects null, strings, NaN, and infinity but accepts numeric zero', () => {
  expect(isFiniteNumericRate(0)).toBe(true);
  expect(isFiniteNumericRate(null)).toBe(false);
  expect(isFiniteNumericRate('0')).toBe(false);
  expect(isFiniteNumericRate(Number.NaN)).toBe(false);
  expect(isFiniteNumericRate(Number.POSITIVE_INFINITY)).toBe(false);
});

it('requires a published rate only for a nonzero token dimension', () => {
  const pricing = { input: 3, reasoning: 0, hasReasoning: true };
  expect(getUsablePricingRate(pricing, 'reasoning', 1_000_000)).toBe(0);
  expect(getUsablePricingRate({ input: 3, reasoning: null }, 'reasoning', 1)).toBeNull();
  expect(getUsablePricingRate({}, 'reasoning', 0)).toBeNull();
});

it('does not treat null cache pricing as free', () => {
  expect(hasUsableCacheReadPricing({ input: 3, cacheRead: null })).toBe(false);
  expect(hasUsableCacheReadPricing({ input: 0, cacheRead: 0 })).toBe(true);
});
```

- [ ] **Step 2: Run the focused tests and verify the new assertions fail against `Number(null)` coercion.**

Run:

```bash
bun test tests/unit/utils.test.js tests/unit/modelsdev-pricing.test.js tests/unit/server-pricing.test.js
```

Expected: the new strict-rate assertions fail before implementation.

- [ ] **Step 3: Implement the shared helper without changing token-volume coercion.**

Use strict type checks for pricing fields. Keep token counters tolerant of absent data where existing UI behavior depends on zero defaults, but route every pricing decision through the new helper. Preserve explicit zero presence flags in Models.dev normalization and ensure server pricing objects expose finite `reasoning` along with the four existing rates when the source can provide it.

- [ ] **Step 4: Run the focused tests and the existing pricing parity tests.**

Run:

```bash
bun test tests/unit/utils.test.js tests/unit/modelsdev-pricing.test.js tests/unit/server-pricing.test.js tests/unit/pricing-parity.test.js
```

Expected: PASS with null rejected, explicit zero accepted, and existing local/OpenRouter parity retained.

- [ ] **Step 5: Commit the shared contract.**

```bash
git add dashboard/js/utils.js dashboard/js/modelsdev-pricing.js lib/pricing.js tests/unit/utils.test.js tests/unit/modelsdev-pricing.test.js tests/unit/server-pricing.test.js
git commit -m "fix(pricing): distinguish missing rates from free rates"
```

---

### Task 2: Make equivalence ticker loading and lifecycle deterministic

**Files:**
- Modify: `dashboard/js/equiv-ticker.js:29-142`
- Modify: `dashboard/js/main.js:287-295`
- Test: `tests/unit/equiv-ticker.test.js`
- Test: `tests/unit/dashboard-equiv-ticker.test.js`

**Interfaces:**
- `initEquivTickers() -> Promise<void>` starts one corpus request and resolves after either a valid corpus is installed or the curated fallback remains active after a fetch/parse failure.
- A valid corpus must be a non-empty array containing nonblank string `copy` values in every supported category (`tokens`, `cost`, and `burnRate`). Unknown categories may be ignored; missing supported categories invalidate the whole response. Assignment is atomic.
- Each mounted ticker stores `_equivLastValue`, `_equivFadeTimeout`, `_equivRotationIndex`, `_equivLines`, and `_equivIntervalId`. These are implementation-owned DOM properties, not global state.
- `updateEquivTickers(values)` stores each positive finite value, refreshes lines without replacing a running interval, and fully clears interval, fade timeout, lines, rotation index, and visible text for zero, negative, non-finite, or missing values.

- [ ] **Step 1: Replace the permissive corpus fixtures with explicit malformed, empty, unknown-category, and missing-category cases.**

Add tests that mock `fetch()` with each response and assert that the visible ticker uses curated text rather than throwing or becoming blank. Include a valid fixture with all three categories and a partial fixture with only `tokens`; the partial fixture must stay on curated lines.

- [ ] **Step 2: Add failing lifecycle tests for invalidation and asynchronous refresh.**

The invalidation test must start a positive ticker, advance far enough to schedule the fade callback, call `updateEquivTickers({tokens: 0})`, and assert:

```js
expect(ticker._equivIntervalId).toBeNull();
expect(ticker._equivFadeTimeout).toBeNull();
expect(ticker._equivLines).toEqual([]);
expect(ticker.querySelector('.equiv-text').textContent).toBe('');
```

The refresh test must mount fallback lines, leave the value unchanged, resolve a delayed valid corpus, await `initEquivTickers()`, and assert that the mounted lines now contain corpus text while the original interval identity remains unchanged.

- [ ] **Step 3: Implement atomic validation and cache invalidation.**

Add a `normalizeCorpus(data)` helper that filters only supported categories and nonblank string copies, then requires one or more usable entries for every supported category. In the success handler, install the normalized corpus, clear `_buildLinesCache`, and call a `refreshMountedTickers()` helper that uses each element’s stored last value. On fetch failure or malformed success, leave `corpus` null and keep curated lines; log the fetch failure once using the existing warning convention.

Store the rotation index and fade timeout on the element so an async refresh can replace `el._equivLines` without restarting its interval. The fade callback must verify that its timeout is still current before mutating text.

- [ ] **Step 4: Run ticker tests and dashboard-level ticker tests.**

Run:

```bash
bun test tests/unit/equiv-ticker.test.js tests/unit/dashboard-equiv-ticker.test.js
```

Expected: PASS for malformed/partial fallback, positive rotation, invalid cleanup, valid restart after invalidation, and fallback-to-corpus refresh without a new dashboard render.

- [ ] **Step 5: Commit ticker lifecycle changes.**

```bash
git add dashboard/js/equiv-ticker.js dashboard/js/main.js tests/unit/equiv-ticker.test.js tests/unit/dashboard-equiv-ticker.test.js
git commit -m "fix(dashboard): harden equivalence ticker lifecycle"
```

---

### Task 3: Queue odometer targets and make locale digits animatable

**Files:**
- Modify: `dashboard/js/odometer.js:1-95`
- Modify: `dashboard/js/views/dashboard.js:42-55`
- Test: `tests/unit/odometer.test.js`
- Test: `tests/unit/dashboard-odometer.test.js`

**Interfaces:**
- `renderOdometer(el, valueStr)` builds columns using a locale digit codec and stores the currently displayed string plus a nullable newest pending target.
- `updateOdometer(el, valueStr)` records the newest requested string even when one or more columns are busy, animates eligible columns, and drains the latest pending target after each transition settles. It may rebuild immediately for a layout change (digit count or static separator layout).
- The codec must recognize the glyphs produced by the active `Intl.NumberFormat` locale and emit the same glyph for the next row. Iterate formatted strings by code point (`Array.from`), not by ASCII range comparison.
- `heroTokens.dataset.value` is the newest requested numeric total. The dashboard may skip submitting the same requested value twice, but it must not use the dataset as proof that the DOM has already settled.

- [ ] **Step 1: Add locale and queue regression tests.**

Use an Arabic locale formatter in the test setup (or temporarily stub `Intl.NumberFormat`) and assert that `renderOdometer(el, '١٬٢٣٤')` creates four `.odo-digit` columns, preserves `٬` as a static separator, and that a subsequent `١٬٢٣٥` update appends the Arabic `٥` glyph.

Add a rapid-update test:

```js
renderOdometer(el, '1,001');
updateOdometer(el, '1,002');
updateOdometer(el, '1,003');
await settleTransitions();
expect(el.textContent).toContain('1,003');
```

`settleTransitions()` must use the existing 650 ms fallback timing or fake timers, not a production-only delay.

- [ ] **Step 2: Add a dashboard gate test for three rapid totals.**

Render `1001`, then call `renderDashboard(false)` with `1002` and immediately with `1003` while the last column is busy. After the transition fallback settles, assert that the hero displays `1,003`, `dataset.value` is `1003`, and a repeated render of `1003` does not append another transition row.

- [ ] **Step 3: Implement the shared locale digit codec.**

Create a small module-local codec that maps each digit value to the glyph returned by `Intl.NumberFormat(undefined, {useGrouping: false}).format(digit)` and maps those glyphs back to numeric values. Keep non-digit code points as static spans. When a digit changes, append the target glyph rather than `String(digit)`.

- [ ] **Step 4: Implement newest-target replay.**

Store `pendingValueStr` at the odometer level and `pendingGlyph`/`pendingDigit` as needed per busy column. A settle callback must atomically set the displayed row, clear the busy flag, and call a drain function that compares the displayed string with the newest pending target. A later update replaces an older pending target rather than queuing an unbounded sequence. Handle `999 -> 1,000` by rebuilding because the static layout changes.

- [ ] **Step 5: Keep the dashboard gate request-based.**

Set `dataset.value` only as the newest requested total, then call `updateOdometer`. Do not reintroduce a gate that marks a value as settled before `updateOdometer` has accepted/queued it. The odometer’s replay state, not `dataset.value`, guarantees eventual display.

- [ ] **Step 6: Run focused odometer tests.**

Run:

```bash
bun test tests/unit/odometer.test.js tests/unit/dashboard-odometer.test.js
```

Expected: PASS for first paint, same-value no-op, separator preservation, Arabic glyphs, digit-count rebuild, and rapid newest-target settlement.

- [ ] **Step 7: Commit odometer changes.**

```bash
git add dashboard/js/odometer.js dashboard/js/views/dashboard.js tests/unit/odometer.test.js tests/unit/dashboard-odometer.test.js
git commit -m "fix(dashboard): queue locale-aware odometer updates"
```

---

### Task 4: Correct cache scenarios and preserve sub-tenth-percent slider rates

**Files:**
- Modify: `dashboard/js/cache-scenario.js:1-81`
- Modify: `dashboard/js/cache-slider.js:1-90`
- Modify: `dashboard/js/utils.js` only for the shared pricing helper from Task 1
- Test: `tests/unit/cache-scenario.test.js`
- Test: `tests/unit/cache-slider.test.js`

**Interfaces:**
- `computeCacheScenario(currentData, hitRatePct) -> {paid, requestedPaid, actualPaid, paidAtZeroPct, savedVsNoCache, actualSavedVsNoCache, paidPct, eligibleModels}`.
- `requestedPaid` is a direct uniform-target calculation: for each eligible model, `(cacheableTokens * (1 - h) * inputRate + cacheableTokens * h * cacheReadRate + fixed dimensions) / 1e6`. No quadratic interpolation or hidden weighting is permitted.
- `actualPaid` uses each eligible model’s own observed `cache_read / (input + cache_read)` mix. It is the actual-rate baseline and must match the model mix even when models have different observed cache rates.
- `paid` remains an alias of `requestedPaid` for slider what-if calculations. The UI may intentionally choose `actualPaid` for the initial real-rate baseline, but it must not conflate the two values.
- An eligible model has finite input/cache-read rates and finite rates for every nonzero fixed dimension (`output`, `cache_write`, `reasoning`). Numeric zero is valid. Models outside the eligible cohort are reported through `eligibleModels` exclusion metadata or omitted exactly as the existing no-coverage behavior specifies.
- Export `getCacheSliderPrecision(realRatePct) -> {step: number, decimals: number}` and `formatCacheRatePct(value, decimals) -> string`. For `0.04`, the result must preserve a nonzero max/value and format at least two decimal places (the reference implementation may use a three-decimal step such as `0.001`). Use the same precision for `input.step`, `input.max`, `input.value`, readout, and scenario input.

- [ ] **Step 1: Replace the quadratic scenario assertions with heterogeneous-model fixtures.**

Create two priced models with different actual cache mixes and one model with `cacheRead: null`. Assert that:

```js
const result = computeCacheScenario(data, 80);
expect(result.requestedPaid).toBeCloseTo(directUniformCostAt80Pct, 8);
expect(result.paid).toBe(result.requestedPaid);
expect(result.actualPaid).toBeCloseTo(perModelActualCost, 8);
expect(result.eligibleModels).not.toContain('unpriced/model');
```

Include output, cache-write, and reasoning tokens with distinct rates, plus `{reasoning: 0, reasoningRate: missing}` to prove zero-token dimensions do not invalidate a model.

- [ ] **Step 2: Add null/zero pricing tests.**

Assert `{input: null}` and `{cacheRead: null}` exclude a model, while `{input: 0, cacheRead: 0, output: 0, cacheWrite: 0, reasoning: 0}` is eligible and contributes zero cost. Assert a nonzero reasoning dimension with a missing reasoning rate excludes that model rather than fabricating zero.

- [ ] **Step 3: Add small-rate slider DOM tests.**

Render data whose `total_input = 99_960` and `total_cache_read = 40` (`0.04%`). Assert:

```js
expect(slider.max).not.toBe('0.0');
expect(Number(slider.max)).toBeCloseTo(0.04, 8);
expect(Number(slider.value)).toBeGreaterThan(0);
expect(Number(slider.step)).toBeGreaterThan(0);
expect(readout.textContent).toContain('0.04');
```

Also test a smaller nonzero rate and a normal rate to ensure the precision rule does not make the ordinary slider unusable.

- [ ] **Step 4: Implement direct cohort and baseline calculations.**

Remove `actualRate`, `w`, and the blended `paidAtUniform * (1 - w) + paidAtActual * w` path. Compute the eligible cohort once, calculate fixed costs including reasoning, and return both direct requested and actual-baseline totals. Use the Task 1 helper for every rate and token-count combination.

- [ ] **Step 5: Implement shared slider precision.**

Choose a deterministic scale-aware step from the maximum real rate. The rule must produce enough decimal places for any positive rate below `0.1%`, never round a positive rate to zero, and remain stable between renders. Set `min='0'`, `max`, `step`, and `value` from the same formatter; render the readout with that formatter instead of a hard-coded `.toFixed(1)`.

- [ ] **Step 6: Run cache tests.**

Run:

```bash
bun test tests/unit/cache-scenario.test.js tests/unit/cache-slider.test.js tests/unit/utils.test.js
```

Expected: PASS for direct requested rates, actual heterogeneous baseline, reasoning cost, null/zero rates, model exclusion, bar clamping, and `0.04%` DOM precision.

- [ ] **Step 7: Commit cache fixes.**

```bash
git add dashboard/js/cache-scenario.js dashboard/js/cache-slider.js tests/unit/cache-scenario.test.js tests/unit/cache-slider.test.js
git commit -m "fix(dashboard): calculate cache scenarios from direct rates"
```

---

### Task 5: Make live-event costs dimensional and source-aware

**Files:**
- Modify: `dashboard/js/live-event-diff.js:1-45`
- Modify: `dashboard/js/live-event-feed.js:1-55`
- Modify: `dashboard/js/api.js:1-200`
- Modify: `dashboard/js/state.js:1-177`
- Modify: `dashboard/js/main.js:291-295`
- Modify: `dashboard/js/views/dashboard.js:90-100`
- Test: `tests/unit/live-event-diff.test.js`
- Test: `tests/unit/live-event-feed.test.js`
- Test: `tests/unit/api.test.js`

**Interfaces:**
- `updateData(data, {source = 'fresh-http'} = {})` accepts `source` values `cache`, `fresh-http`, and `live-sse`; it normalizes `total_reasoning` and per-model `reasoning` without changing the existing JSON field names.
- State exports `dataRevision` (monotonically increasing for each `updateData` call) and `dataSource`, with setters used only by `api.js`. A render may consume a revision once.
- `computeGrowthEvents(prevTokensByModel, currTokensByModel) -> Array<{model, delta, inputDelta, outputDelta, cacheReadDelta, cacheWriteDelta, reasoningDelta}>` computes positive deltas independently for all five dimensions and carries the positive total delta for event ordering/display.
- `pickLatestEvent(events, pricingByModel) -> {model, delta, cachePct, cost}|null` uses `cacheReadDelta / (inputDelta + cacheReadDelta)` for `cachePct`; prices each positive dimension with its matching rate; returns `cost: null` if any nonzero dimension lacks a usable rate.
- `renderLiveEventFeed(container, currentData, {source, revision})` ignores cache snapshots, seeds on the first fresh revision, processes each later fresh revision once, and leaves the last event visible on a no-growth revision.

- [ ] **Step 1: Rewrite live-diff tests around five dimensions.**

Use previous/current fixtures where input, output, cache-read, cache-write, and reasoning all grow by different amounts. Assert the exact delta object and verify mixed negative deltas clamp only the affected dimension to zero. Add a total/component mismatch fixture and document that `delta` is the positive total for display while cost uses the five dimensional deltas.

- [ ] **Step 2: Add a delta-mix pricing test.**

With previous `{input: 50, cache_read: 50}` and current `{input: 50, cache_read: 150}`, assert `cachePct` is `100`, not the cumulative `75`, and assert the cost uses only the cache-read rate for the 100-token positive input/cache delta. Add an output-only and reasoning-only event with distinct rates.

- [ ] **Step 3: Add missing-rate tests.**

Assert that a positive output/reasoning/cache-write delta with a missing corresponding rate returns `cost: null`, while a zero delta for that dimension does not require a rate. Assert numeric zero rates calculate a finite cost.

- [ ] **Step 4: Add source-aware feed lifecycle tests through the API path.**

Test this sequence with a real container and the exported `updateData`:

```js
updateData(snapshotA, { source: 'cache' });
updateData(snapshotB, { source: 'fresh-http' }); // baseline only
updateData(snapshotC, { source: 'live-sse' });  // exactly one event
updateData(snapshotC, { source: 'live-sse' });  // same revision path cannot duplicate
```

Assert that `snapshotA` never creates a historical event, `snapshotB` seeds without showing one, `snapshotC` shows the delta event, and a repeated dashboard render does not reprocess the same revision.

- [ ] **Step 5: Implement explicit provenance and revision state.**

Change `main.js` to call `updateData(cached, {source: 'cache'})`. Change `refreshData()` to use `fresh-http` and the SSE handler to use `live-sse`. Increment the revision in `updateData`, set the source before triggering `window.renderAll`, and preserve the source/revision while the render tree runs. Do not put orchestration metadata into the persisted API payload.

- [ ] **Step 6: Implement dimensional diffing and feed processing.**

Make the event object carry all positive dimension deltas. Remove cumulative cache-mix allocation. Use `getUsablePricingRate` with each dimension’s token count. In the feed, keep `prevTokensByModel`, `lastProcessedRevision`, and `baselineReady` module state; cache sources update the visible UI only, fresh sources establish or diff the baseline, and repeated renders with the same revision do nothing.

- [ ] **Step 7: Run live-event and API tests.**

Run:

```bash
bun test tests/unit/live-event-diff.test.js tests/unit/live-event-feed.test.js tests/unit/api.test.js tests/unit/state.test.js
```

Expected: PASS for dimensional costs, delta cache percentage, missing/zero rate semantics, cached-baseline suppression, first-fresh baseline, second-fresh event, and revision deduplication.

- [ ] **Step 8: Commit live-event changes.**

```bash
git add dashboard/js/live-event-diff.js dashboard/js/live-event-feed.js dashboard/js/api.js dashboard/js/state.js dashboard/js/main.js dashboard/js/views/dashboard.js tests/unit/live-event-diff.test.js tests/unit/live-event-feed.test.js tests/unit/api.test.js tests/unit/state.test.js
git commit -m "fix(dashboard): diff live events from fresh snapshots"
```

---

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

---

### Task 7: Protect Timeline dead-air detection and close trailing gaps

**Files:**
- Modify: `dashboard/js/dead-air.js:1-30`
- Modify: `dashboard/js/views/analytics/tabs/timeline.js:1-56`
- Modify: `dashboard/js/views/analytics/tabs/shared.js` only if a pure chart-end helper is needed
- Test: `tests/unit/dead-air.test.js`
- Test: `tests/unit/timeline.test.js` (create if absent)

**Interfaces:**
- `detectDeadAirBands(buckets, thresholdHours = 3, chartEnd = undefined) -> Array<{start, end}>` accepts ascending UTC hour buckets. It ignores/returns no bands for invalid non-hour-aligned or unsorted input rather than guessing. It supports one valid bucket when `chartEnd` is supplied, checks internal gaps, and checks the trailing gap through `chartEnd`.
- `chartEnd` is the UTC start of the last completed hour, calculated as `Math.floor(Date.now() / HOUR_MS) * HOUR_MS`. A trailing band from a last bucket at 09:00 with chart end 13:00 covers `[10:00, 13:00]` and has three missing hours. With chart end 12:00 it has only two missing hours and is omitted for a threshold of three.
- `renderTimelineTab` uses `fileHistoricalData` as the only dead-air source. When the chart falls back to `historyData` (SSE), it may render the series but passes no bands to Plotly.
- The selected range’s x-axis ends at `chartEnd`; for `all`, an end before the final observed bucket is clamped so no negative trailing gap is created. Plotly receives shapes and annotations for each band.

- [ ] **Step 1: Expand dead-air unit tests.**

Keep existing internal-gap tests and add:

```js
expect(detectDeadAirBands([{time: h(9)}], 3, h(13))).toEqual([{start: h(10), end: h(13)}]);
expect(detectDeadAirBands([{time: h(9)}], 3, h(12))).toEqual([]);
expect(detectDeadAirBands([{time: h(9)}], 3, h(8))).toEqual([]);
expect(detectDeadAirBands([{time: h(9) + 5 * 60_000}, {time: h(13)}], 3, h(16))).toEqual([]);
```

Add a test that an invalid one-bucket/no-end input remains empty and that duplicate or descending buckets do not produce a fabricated band.

- [ ] **Step 2: Add Timeline source-provenance tests.**

Stub Plotly and state setters. Render with the same `09:00`/`13:00` gap once in `fileHistoricalData` and once in `historyData` only. Assert the file-backed call includes a Plotly rectangle/annotation and the SSE-only call includes no dead-air shape. Add a one-bucket file-backed case and assert the chart still renders through the trailing boundary.

- [ ] **Step 3: Implement strict hourly dead-air detection.**

Validate finite timestamps, ascending order, and exact hour alignment before calculating missing hours. Keep internal bands unchanged. When `chartEnd` is a valid completed-hour boundary greater than the final bucket, calculate the number of absent hourly buckets between the final bucket and end and add a band when it reaches the threshold.

- [ ] **Step 4: Integrate source-aware Timeline rendering.**

Import `detectDeadAirBands`, choose `fileHistoricalData` versus `historyData` as today, and only invoke the detector for the file branch. Allow one file bucket to render a valid point plus x-axis range rather than treating it as a dead-air detector failure. Build Plotly `shapes` and `annotations` from returned bands and set the x-axis end to the completed-hour chart end, clamped to the selected source range.

- [ ] **Step 5: Run Timeline tests and existing chart-adjacent unit tests.**

Run:

```bash
bun test tests/unit/dead-air.test.js tests/unit/timeline.test.js tests/unit/utils.test.js
```

Expected: PASS for internal gaps, one-bucket trailing gaps, exact completed-hour boundaries, invalid/unsorted data, SSE-only protection, and file-history Plotly shapes.

- [ ] **Step 6: Commit Timeline changes.**

```bash
git add dashboard/js/dead-air.js dashboard/js/views/analytics/tabs/timeline.js dashboard/js/views/analytics/tabs/shared.js tests/unit/dead-air.test.js tests/unit/timeline.test.js
git commit -m "fix(dashboard): close and scope Timeline dead-air bands"
```

---

### Task 8: Exercise the integrated dashboard in a real browser

**Files:**
- Create: `tests/dashboard-audit-live.spec.js` (or the established Playwright test directory if the project runner requires it)
- Modify: `tests/playwright-fixtures.js` only for reusable server lifecycle helpers, not API interception for the audit assertions
- Modify: `package.json` only if a dedicated `test:e2e:audit` script is needed

**Interfaces:**
- The exercise must start the real Bun server and load the real dashboard page without routing `/api/tokens`, `/api/tokens/stream`, or `/data/factoids-1000.json` to mocked responses.
- The browser must observe a successful corpus request and an open SSE request, and the test must assert visible DOM/Plotly results rather than only checking that an SVG exists.
- Synthetic state transitions may be driven through the public module functions in a browser-side test harness only after the real page/network checks; do not add production-only global test hooks.

- [ ] **Step 1: Add a real-server Playwright fixture.**

Start `bun server.js` on an ephemeral port with the repository’s normal environment and wait for the actual HTTP listener. Use `page.goto()` against that server. Do not use `routeDashboardApis()` in this test. Capture network responses for `/data/factoids-1000.json`, `/api/tokens`, `/api/tokens/historical`, and the SSE stream.

- [ ] **Step 2: Assert real corpus/SSE startup.**

Wait for the dashboard to render, assert the corpus response is 200 with all three categories, assert the SSE request remains open or receives a message, and assert the visible ticker text is nonempty. This proves the browser exercised the static corpus and live transport rather than only a mocked render.

- [ ] **Step 3: Exercise the four integrated correctness paths in the browser.**

Use browser-imported production modules and a temporary DOM fixture inside `page.evaluate()` to drive deterministic transitions after startup:

1. Mount fallback ticker text, resolve the real corpus promise, and assert the mounted ticker changes without another dashboard render.
2. Render a localized Arabic-formatted odometer, submit three rapid totals, wait for the transition fallback, and assert the newest glyph/value is visible.
3. Render the cache slider with a `99_960` input / `40` cache-read fixture and assert the live `max`, `value`, `step`, and readout preserve `0.04%`.
4. Render file-backed hourly Timeline data ending at 09:00 with a chart end of 13:00 and assert Plotly receives a trailing band; render the same samples through SSE history and assert no band.

The exercise must also call the source-aware live-feed path with cache → first fresh → second fresh snapshots and assert only the second fresh snapshot changes the pill text.

- [ ] **Step 4: Run the real browser test.**

Run:

```bash
bunx playwright test tests/dashboard-audit-live.spec.js --reporter=list
```

Expected: PASS with explicit network and DOM assertions for the corpus, SSE, ticker replacement, odometer settlement, `0.04%` slider, cache-baseline suppression, and trailing Timeline shape bounds.

- [ ] **Step 5: Commit the integrated exercise.**

```bash
git add tests/dashboard-audit-live.spec.js tests/playwright-fixtures.js package.json
git commit -m "test(dashboard): exercise audit fixes in the browser"
```

---

### Task 9: Full verification and branch handoff

**Files:**
- Modify: none unless a test or lint issue from the completed tasks requires a focused fix
- Test: all existing unit, lint, typecheck, and Playwright checks

- [ ] **Step 1: Run the complete Bun unit suite with coverage.**

```bash
bun test tests/unit --coverage --coverage-reporter=lcov
bun run coverage:check
```

Expected: zero test failures and the repository’s coverage gate passes.

- [ ] **Step 2: Run lint and typecheck.**

```bash
bun run lint:baseline
bun run typecheck
```

Expected: zero new lint-baseline violations and a clean typecheck.

- [ ] **Step 3: Run the existing chart/overflow browser checks plus the audit exercise.**

```bash
bunx playwright test tests/charts.spec.js tests/burn-rate-gauge.spec.js tests/mobile.spec.js tests/playwright/overflow.spec.js tests/dashboard-audit-live.spec.js --reporter=list
```

Expected: all existing browser checks and the new real-server audit exercise pass.

- [ ] **Step 4: Perform the direct boundary exercise if Playwright cannot keep the SSE process alive.**

Start the real app with `bun run start`, use a browser against the printed port, and verify the same network/DOM assertions manually. Record the exact command and observed results in the implementation report; do not claim the mocked unit suite proves the server/SSE boundary.

- [ ] **Step 5: Inspect the final changeset.**

```bash
git status --short --branch
git diff --check
git log --oneline --decorate origin/main..HEAD
```

Expected: only the approved audit fixes and tests are present, no generated coverage/lint artifacts are staged, and every commit uses Conventional Commits.

- [ ] **Step 6: Request code review before merging.**

Use the repository’s code-review workflow at an effort level appropriate for this multi-module correctness change. Do not merge or enable the feature on `main` before review. If the review identifies a defect, fix it in the feature worktree, rerun the affected focused tests plus the full verification gates, and request review again.

---

## Coverage matrix

| Distinct finding | Design area | Production files | Focused regression |
|---|---|---|---|
| 1. Malformed/empty/partial corpus bypasses fallback | Ticker loading | `equiv-ticker.js` | `equiv-ticker.test.js`: null, object, empty, unknown, missing category |
| 2. Invalid ticker values leave stale interval/text | Ticker cleanup | `equiv-ticker.js` | `dashboard-equiv-ticker.test.js`: valid → fade pending → invalid → valid |
| 3. Resolved corpus does not refresh mounted fallback lines | Ticker async refresh | `equiv-ticker.js`, `main.js` | delayed fetch resolution with no new dashboard render |
| 4. ASCII-only odometer digit detection | Locale codec | `odometer.js` | Arabic glyphs and grouping separator through a roll |
| 5. Busy odometer digit drops the newest target | Queue/replay | `odometer.js` | three rapid updates and transition settlement |
| 6. Dashboard gate permanently loses rapid update | Request-based gate | `views/dashboard.js` | repeated `renderDashboard(false)` with 1001 → 1002 → 1003 |
| 7. Null pricing coerces to zero | Shared pricing contract | `utils.js`, pricing normalizers | null rejected, numeric zero accepted |
| 8. Quadratic cache blend misses requested rate | Direct uniform scenario | `cache-scenario.js` | heterogeneous models at requested 80% |
| 9. Cache scenario omits reasoning cost | Fixed-dimension scenario cost | `cache-scenario.js` | distinct reasoning tokens/rate and missing-rate policy |
| 10. Slider rounds `0.04%` to zero | Scale-aware slider | `cache-slider.js` | DOM max/value/step/readout at `0.04%` and smaller |
| 11. Live event prices all growth as input/cache | Five-dimensional event cost | `live-event-diff.js` | output/cache-write/reasoning-only deltas with distinct rates |
| 12. Live event uses cumulative rather than delta mix | Delta cache percentage | `live-event-diff.js` | previous/current 50/50 → 50/150 produces 100% delta cache |
| 13. Cached snapshot seeds live baseline | Provenance lifecycle | `api.js`, `state.js`, `live-event-feed.js` | cache → first fresh baseline only |
| 14. Feed cache percentage uses cumulative totals | Revision-aware feed diff | `live-event-feed.js` | second fresh snapshot shows delta percentage and no duplicate redraw event |
| 15. SSE sample timestamps create hourly dead-air bands | Source guard | `timeline.js` | identical SSE-only and file-history gaps, only file data bands |
| 16. Trailing dead-air is never detected | Chart-end detector | `dead-air.js`, `timeline.js` | one bucket at 09:00 with completed-hour end 13:00 |
| 17. Title-belt cost omits reasoning | Reasoning-aware belt scoring | `title-belt.js` | reasoning-heavy winner, explicit zero, missing reasoning rate |
| 18. Week boundaries use array position | Calendar window validation | `title-belt.js`, `api.js`, `config.js` | missing day, duplicate/out-of-order, rollover, 15-day retention |

The matrix has 18 source-level bullets because the audit report grouped two pairs; the implementation still has 16 distinct behavior changes as stated in the approved design.

## Completion criteria

The feature branch is complete only when:

1. All 16 approved behaviors have focused regression coverage.
2. The direct cache scenario, actual baseline, pricing presence semantics, source-aware live feed, odometer queue, calendar week windows, and completed-hour Timeline boundary are explicit in code and tests.
3. The full Bun unit suite, coverage check, lint baseline, typecheck, existing Playwright checks, and real-server audit exercise pass.
4. The feature branch has received code review through the normal PR workflow before any merge to `main`.
5. The implementation report names any unavailable external boundary exercise instead of treating mocked tests as proof.
