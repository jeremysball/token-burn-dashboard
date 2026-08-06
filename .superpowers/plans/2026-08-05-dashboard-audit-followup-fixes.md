# Dashboard Audit Follow-Up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four narrow correctness defects found by a fresh whole-branch review of the completed `worktree-dashboard-audit-fixes` branch — one each in `cache-slider.js`, `odometer.js`, `equiv-ticker.js`, and `cache-scenario.js` — with no new modules or unrelated refactoring.

**Architecture:** Each fix is a small, targeted change to an existing conditional in the file that already owns the behavior. No new state, no new files, no new abstractions.

**Tech Stack:** Bun 1.3.11, browser ES modules, happy-dom, Bun unit tests (`bun:test`).

## Global Constraints

- Use `fd` for file discovery and `rg` for text search; never use `find` or `grep`.
- Every task ends with focused tests and a Conventional Commit. Never add a `Co-Authored-By` trailer.
- Do not touch any of the 16 findings already implemented under `.superpowers/plans/2026-08-04-dashboard-audit-fixes.md`.
- Do not refactor `cache-slider.js`, `odometer.js`, `equiv-ticker.js`, or `cache-scenario.js` beyond the specific lines named in each task.
- Preserve zero-token-dimension behavior: a token count of `0` must never trip a `has<Field>: false` presence rejection.

---

### Task 1: Cache slider renders the actual-rate baseline before user interaction

**Files:**
- Modify: `dashboard/js/cache-slider.js:73-138`
- Test: `tests/unit/cache-slider.test.js`

**Interfaces:**
- Consumes: `computeCacheScenario(currentData, hitRatePct)` from `dashboard/js/cache-scenario.js`, already returning `{paid, requestedPaid, actualPaid, savedVsNoCache, actualSavedVsNoCache, paidPct, ...}` — no signature change.
- Produces: `renderReadout(container, hitRatePct, precision)` now reads `container.querySelector('#cacheSlider').dataset.userMoved` to pick which scenario fields to render. No other module calls `renderReadout` directly (it's not exported), so this is a self-contained change.

- [ ] **Step 1: Write the failing test for the untouched-vs-user-moved baseline.**

Add to `tests/unit/cache-slider.test.js`, inside the `describe('renderCacheSlider', ...)` block:

```js
const heterogeneousData = () => ({
    total_input: 500_000,
    total_cache_read: 500_000,
    tokens_by_model: {
        'high-cache/model': { input: 100_000, cache_read: 900_000, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000 },
        'low-cache/model': { input: 900_000, cache_read: 100_000, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000 }
    },
    pricing_by_model: {
        'high-cache/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        'low-cache/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
    }
});

it('renders the actual-rate baseline on an untouched initial render', () => {
    renderCacheSlider(container, heterogeneousData());
    const paidEl = container.querySelector('#cachePaidValue');
    // Actual per-model mix differs from the uniform blended-rate what-if,
    // so actualPaid and requestedPaid render different numbers here.
    const scenario = computeCacheScenario(heterogeneousData(), 50);
    expect(scenario.actualPaid).not.toBeCloseTo(scenario.requestedPaid, 2);
    expect(paidEl.textContent).toBe(fmtCur(scenario.actualPaid));
});

it('renders the requested (what-if) baseline after the user drags the slider', () => {
    renderCacheSlider(container, heterogeneousData());
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    const paidEl = container.querySelector('#cachePaidValue');

    slider.value = '50';
    slider.dispatchEvent(new Event('input'));

    const scenario = computeCacheScenario(heterogeneousData(), 50);
    expect(paidEl.textContent).toBe(fmtCur(scenario.requestedPaid));
});

it('keeps rendering the requested baseline if the user drags back to the real rate', () => {
    renderCacheSlider(container, heterogeneousData());
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    const realRate = getRealCacheHitRatePct(heterogeneousData());
    const paidEl = container.querySelector('#cachePaidValue');

    slider.value = '10';
    slider.dispatchEvent(new Event('input'));
    slider.value = String(realRate);
    slider.dispatchEvent(new Event('input'));

    const scenario = computeCacheScenario(heterogeneousData(), realRate);
    expect(paidEl.textContent).toBe(fmtCur(scenario.requestedPaid));
});
```

Add the two new imports at the top of the file alongside the existing `renderCacheSlider` import:

```js
import { renderCacheSlider, getCacheSliderPrecision, formatCacheRatePct } from '../../dashboard/js/cache-slider.js';
import { computeCacheScenario, getRealCacheHitRatePct } from '../../dashboard/js/cache-scenario.js';
import { fmtCur } from '../../dashboard/js/utils.js';
```

- [ ] **Step 2: Run the tests and verify the new assertions fail.**

Run: `bun test tests/unit/cache-slider.test.js`
Expected: the first new test ("renders the actual-rate baseline on an untouched initial render") FAILS — `renderReadout` currently always renders `scenario.paid` (an alias for `requestedPaid`), never `actualPaid`. The second and third new tests already PASS before the fix, since the current unconditional `requestedPaid` behavior happens to match what they assert for the user-moved case — they exist as regression guards for Step 3, not as failing tests here. If the first test also passes, the fixture didn't produce heterogeneous per-model cache rates; adjust it until `actualPaid` and `requestedPaid` differ.

- [ ] **Step 3: Implement the fix in `renderReadout`.**

In `dashboard/js/cache-slider.js`, change `renderReadout` to branch on the slider's `userMoved` flag:

```js
/**
 * @param {HTMLElement} container
 * @param {number} hitRatePct
 * @param {{step: number, decimals: number}|null} precision
 */
function renderReadout(container, hitRatePct, precision) {
    const scenario = computeCacheScenario(latestData, hitRatePct);
    const savedEl = /** @type {HTMLElement} */ (container.querySelector('#cacheSavedValue'));
    const paidEl = /** @type {HTMLElement} */ (container.querySelector('#cachePaidValue'));
    const readout = /** @type {HTMLElement} */ (container.querySelector('#cacheReadout'));
    const barWrap = /** @type {HTMLElement} */ (container.querySelector('#cacheBarWrap'));
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));

    const userMoved = slider.dataset.userMoved === 'true';
    const savedValue = userMoved ? scenario.savedVsNoCache : scenario.actualSavedVsNoCache;
    const paidValue = userMoved ? scenario.requestedPaid : scenario.actualPaid;

    const decimals = precision ? precision.decimals : 1;
    savedEl.innerHTML = `${fmtCur(savedValue)}<small>at ${formatCacheRatePct(hitRatePct, decimals)}% hit rate</small>`;
    paidEl.textContent = fmtCur(paidValue);
    readout.textContent = `${formatCacheRatePct(hitRatePct, decimals)}% hit rate`;
    barWrap.style.setProperty('--paid-pct', `${scenario.paidPct.toFixed(1)}%`);
}
```

Do not change `applySliderPrecision`, `renderCacheSlider`, `getCacheSliderPrecision`, or `formatCacheRatePct`.

- [ ] **Step 4: Run the tests and verify they pass.**

Run: `bun test tests/unit/cache-slider.test.js`
Expected: PASS, including all pre-existing tests in the file (the untouched-render precision tests still hold since they don't assert on `#cachePaidValue`).

- [ ] **Step 5: Commit.**

```bash
git add dashboard/js/cache-slider.js tests/unit/cache-slider.test.js
git commit -m "fix(dashboard): render actual cache rate before slider interaction"
```

---

### Task 2: Odometer keeps the newest requested value during a same-value rollback

**Files:**
- Modify: `dashboard/js/odometer.js:192-198`
- Test: `tests/unit/odometer.test.js`

**Interfaces:**
- Consumes: `state.pendingValueStr` (already defined on the `OdoState` returned by `renderOdometer`, set in `drain()` at line 100/165 — no new field).
- Produces: `updateOdometer(el, valueStr)` — same exported signature, no callers elsewhere need to change.

- [ ] **Step 1: Write the failing test.**

Add to `tests/unit/odometer.test.js`, inside `describe('odometer', ...)`, after the existing "settles the newest of rapid updates" test:

```js
it('settles a same-value rollback requested while a transition is still in flight', () => {
    const timers = captureTimers();
    try {
      renderOdometer(el, '1,001');
      updateOdometer(el, '1,002');
      updateOdometer(el, '1,001');
      timers.runAll();
      expect(el.textContent).toContain('1,001');
    } finally {
      timers.restore();
    }
});
```

- [ ] **Step 2: Run the test and verify it fails.**

Run: `bun test tests/unit/odometer.test.js`
Expected: FAIL — `el.textContent` contains `1,002` instead of `1,001`, because the second `updateOdometer` call returns early without recording the rollback.

- [ ] **Step 3: Implement the fix.**

In `dashboard/js/odometer.js`, change the early-return guard in `updateOdometer`:

```js
export function updateOdometer(el, valueStr) {
    const state = odometerState.get(el);
    if (!state) {
        renderOdometer(el, valueStr);
        return;
    }
    if (valueStr === state.valueStr && state.pendingValueStr == null) return;
    // ... rest of the function is unchanged
```

No other line in `updateOdometer` or `drain` changes — the existing busy-column `pendingDigit` and non-busy `startRoll` branches already handle rolling a column back to an earlier digit once this guard stops blocking the call.

- [ ] **Step 4: Run the tests and verify they pass.**

Run: `bun test tests/unit/odometer.test.js tests/unit/dashboard-odometer.test.js`
Expected: PASS, including the pre-existing "ignores a call with an unchanged value (no-op...)" test — that test calls `updateOdometer(el, '1,234')` right after `renderOdometer(el, '1,234')` with no transition in flight, so `state.pendingValueStr` is `null` and the no-op path still applies.

- [ ] **Step 5: Commit.**

```bash
git add dashboard/js/odometer.js tests/unit/odometer.test.js
git commit -m "fix(dashboard): settle odometer rollback requested mid-transition"
```

---

### Task 3: Equivalence ticker clears the fade class on invalidation

**Files:**
- Modify: `dashboard/js/equiv-ticker.js:179-188`
- Test: `tests/unit/dashboard-equiv-ticker.test.js`

**Interfaces:**
- Consumes: nothing new — `clearTicker(el)` already receives the mounted ticker element.
- Produces: `clearTicker(el)` — same signature, called from the same two sites (`updateEquivTickers`'s `else` branch, `resetEquivTickersForTest`'s equivalent inline cleanup does not call `clearTicker` and is unaffected).

- [ ] **Step 1: Write the failing test.**

Add to `tests/unit/dashboard-equiv-ticker.test.js`, after the existing "clears interval, fade timeout, lines, and visible text when the value goes invalid" test:

```js
it('removes a stuck fade class when invalidated mid-fade, so a later restart is visible', () => {
    setCurrentData({
      total_tokens: 100,
      total_cost: { total: 5 },
      total_cache_read: 0,
      total_input: 0,
      tokens_by_model: { 'm': { total: 100 } },
      files_processed: 1,
      total_lines: 10
    });

    const timers = captureTimers();
    try {
      renderDashboard(true);

      const ticker = document.querySelector('[data-equiv-category="tokens"]');
      const textEl = ticker.querySelector('.equiv-text');

      timers.fireRotation();
      expect(textEl.classList.contains('fade')).toBe(true);

      updateEquivTickers({ tokens: 0, cost: 0, burnRate: 0 });
      expect(textEl.classList.contains('fade')).toBe(false);

      updateEquivTickers({ tokens: 100, cost: 5, burnRate: 1 });
      expect(textEl.classList.contains('fade')).toBe(false);
      expect(textEl.textContent).not.toBe('');
    } finally {
      timers.restore();
    }
});
```

- [ ] **Step 2: Run the test and verify it fails.**

Run: `bun test tests/unit/dashboard-equiv-ticker.test.js`
Expected: FAIL on `expect(textEl.classList.contains('fade')).toBe(false)` right after `updateEquivTickers({ tokens: 0, ... })` — the class is still present because `clearTicker` never removes it.

- [ ] **Step 3: Implement the fix.**

In `dashboard/js/equiv-ticker.js`, add one line to `clearTicker`:

```js
function clearTicker(el) {
    el._equivLastValue = undefined;
    if (el._equivIntervalId) clearInterval(el._equivIntervalId);
    el._equivIntervalId = null;
    if (el._equivFadeTimeout) clearTimeout(el._equivFadeTimeout);
    el._equivFadeTimeout = null;
    el._equivLines = [];
    el._equivRotationIndex = 0;
    const textEl = el.querySelector('.equiv-text');
    if (textEl) {
        textEl.textContent = '';
        textEl.classList.remove('fade');
    }
}
```

- [ ] **Step 4: Run the tests and verify they pass.**

Run: `bun test tests/unit/dashboard-equiv-ticker.test.js tests/unit/equiv-ticker.test.js`
Expected: PASS, including the pre-existing invalidation and restart tests in both files.

- [ ] **Step 5: Commit.**

```bash
git add dashboard/js/equiv-ticker.js tests/unit/dashboard-equiv-ticker.test.js
git commit -m "fix(dashboard): clear stuck fade class on ticker invalidation"
```

---

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

### Task 5: Full verification and review handoff

**Files:**
- Modify: none unless a lint/typecheck issue from Tasks 1-4 requires a focused fix
- Test: full unit suite, lint, typecheck

- [ ] **Step 1: Run the four touched focused test files together.**

```bash
bun test tests/unit/cache-slider.test.js tests/unit/odometer.test.js tests/unit/dashboard-equiv-ticker.test.js tests/unit/equiv-ticker.test.js tests/unit/cache-scenario.test.js tests/unit/dashboard-odometer.test.js
```

Expected: PASS, zero failures.

- [ ] **Step 2: Run the full unit suite.**

```bash
bun test tests/unit
```

Expected: PASS, zero failures, no regressions in unrelated files.

- [ ] **Step 3: Run lint and typecheck.**

```bash
bun run lint:baseline
bun run typecheck
```

Expected: zero new lint-baseline violations and a clean typecheck.

- [ ] **Step 4: Inspect the final changeset.**

```bash
git status --short --branch
git log --oneline --decorate -6
```

Expected: exactly four fix commits plus this task's own commit (if any), all Conventional Commits, no unrelated files staged.

- [ ] **Step 5: Request code review.**

Use the repository's code-review workflow at an effort level appropriate for four independent, well-scoped, low-risk correctness fixes (a lighter effort level than the original 16-finding branch review is appropriate — no security or data-integrity surface is touched). Any reviewer claim must be independently reproduced before changing code or reporting it. Do not merge to `main` before review completes.

- [ ] **Step 6: Commit any review-driven fix, then finish the branch.**

If review finds a defect, fix it in this worktree, rerun the affected focused tests plus Steps 1-3 above, and request review again. Once clean, use `superpowers:finishing-a-development-branch` to open the PR, and only merge after PR review. Run `orient-quick` after the finish/merge action.

---

## Coverage matrix

| Finding | Fix | Focused regression |
|---|---|---|
| Cache slider shows what-if rate before interaction | `cache-slider.js` `renderReadout` branches on `userMoved` | `cache-slider.test.js`: untouched actual-baseline, post-drag requested, drag-back-to-real-rate requested |
| Odometer drops a same-value rollback mid-transition | `odometer.js` `updateOdometer` guard checks `pendingValueStr` too | `odometer.test.js`: `1,001 → 1,002 → 1,001` settles at `1,001` |
| Ticker fade class survives invalidation | `equiv-ticker.js` `clearTicker` removes `.fade` | `dashboard-equiv-ticker.test.js`: mid-fade invalidation clears class, later restart is visible |
| Cache eligibility ignores actual token counts | `cache-scenario.js` `isModelEligible` passes `counts.input`/`counts.cacheRead` | `cache-scenario.test.js`: flagged-absent-with-usage excluded, flagged-absent-with-zero-usage still eligible |

## Completion criteria

1. All four fixes above are implemented with the described regression tests passing.
2. The full unit suite, lint, and typecheck pass with no new failures.
3. A fresh code review confirms all four findings are resolved and no new defect was introduced; every reviewer claim is independently reproduced before being trusted.
4. The branch goes through the normal PR review workflow before merging to `main`.
