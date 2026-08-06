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
