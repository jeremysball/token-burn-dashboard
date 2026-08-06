### Task 4: Cache scenario eligibility checks actual input/cache-read token counts

**Files:**
- Modify: `dashboard/js/cache-scenario.js:38-46`
- Test: `tests/unit/cache-scenario.test.js`

**Interfaces:**
- Consumes: `getUsablePricingRate(pricing, field, tokenCount = 0)` from `dashboard/js/utils.js` — no signature change, `isModelEligible` now passes the `tokenCount` argument it was previously omitting.
- Produces: `isModelEligible(pricing, stats)` — same exported behavior contract, now correctly enforcing presence flags for `input`/`cacheRead` at nonzero token counts.

- [ ] **Step 1: Write the failing test.**

Add to `tests/unit/cache-scenario.test.js`, inside the `describe('computeCacheScenario', ...)` block (matching the style of the existing "excludes a model with null input pricing" test), after the "includes a model with all-zero token dimensions and finite rates" test:

```js
it('excludes a model whose presence flags say input/cacheRead pricing is absent, despite nonzero numeric fields', () => {
    const data = {
        total_input: 1_000_000,
        total_cache_read: 99_000_000,
        tokens_by_model: {
            'flagged-absent/model': { input: 1_000_000, cache_read: 99_000_000, output: 0, cache_write: 0, reasoning: 0, total: 100_000_000 }
        },
        pricing_by_model: {
            'flagged-absent/model': { input: 0, cacheRead: 0, hasInput: false, hasCacheRead: false, output: 15, cacheWrite: 3.75 }
        }
    };
    const result = computeCacheScenario(data, 50);
    expect(result.eligibleModels).not.toContain('flagged-absent/model');
});

it('keeps a model eligible when input/cacheRead presence flags are false but the token counts are zero', () => {
    const data = {
        total_input: 0,
        total_cache_read: 0,
        tokens_by_model: {
            'flagged-absent-zero-usage/model': { input: 0, cache_read: 0, output: 0, cache_write: 0, reasoning: 0, total: 0 }
        },
        pricing_by_model: {
            'flagged-absent-zero-usage/model': { input: 0, cacheRead: 0, hasInput: false, hasCacheRead: false, output: 15, cacheWrite: 3.75 }
        }
    };
    const result = computeCacheScenario(data, 50);
    expect(result.eligibleModels).toContain('flagged-absent-zero-usage/model');
});
```

- [ ] **Step 2: Run the tests and verify the first one fails.**

Run: `bun test tests/unit/cache-scenario.test.js`
Expected: the first new test FAILS (`flagged-absent/model` is currently included in `eligibleModels`); the second new test already PASSes (zero token counts never trip the presence check even without the fix), confirming it as a true regression guard rather than a false positive.

- [ ] **Step 3: Implement the fix.**

In `dashboard/js/cache-scenario.js`, change `isModelEligible`:

```js
function isModelEligible(pricing, stats) {
    const counts = getTokenCounts(stats);
    return getUsablePricingRate(pricing, 'input', counts.input) !== null
        && getUsablePricingRate(pricing, 'cacheRead', counts.cacheRead) !== null
        && hasUsableFixedRate(pricing, 'output', counts.output)
        && hasUsableFixedRate(pricing, 'cacheWrite', counts.cacheWrite)
        && hasUsableFixedRate(pricing, 'reasoning', counts.reasoning);
}
```

`computeModelScenario` already calls `getUsablePricingRate(pricing, 'input')` and `(pricing, 'cacheRead')` without a token count when reading the rate value for cost math (line ~65-66) — leave those two calls as-is; they run only after `isModelEligible` has already confirmed the rate is usable, so they're safe reads of an already-validated field, not eligibility checks.

- [ ] **Step 4: Run the tests and verify they pass.**

Run: `bun test tests/unit/cache-scenario.test.js`
Expected: PASS for both new tests and every pre-existing test in the file (the existing "excludes a model with null input pricing" and "null cacheRead pricing" tests use `input: null`/`cacheRead: null`, which `getUsablePricingRate` already rejects regardless of `tokenCount` via the `isFiniteNumericRate` check, so they're unaffected by this change).

- [ ] **Step 5: Commit.**

```bash
git add dashboard/js/cache-scenario.js tests/unit/cache-scenario.test.js
git commit -m "fix(dashboard): check actual token counts for cache eligibility"
```

---

