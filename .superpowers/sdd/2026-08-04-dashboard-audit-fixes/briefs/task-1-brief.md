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
