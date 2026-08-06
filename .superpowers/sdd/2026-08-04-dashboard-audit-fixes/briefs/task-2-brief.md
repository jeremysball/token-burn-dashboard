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
