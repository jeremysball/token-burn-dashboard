# Dashboard Audit Follow-Up Fixes

**Status:** Approved for planning.

## Background

The `worktree-dashboard-audit-fixes` branch (currently at `ebfac58`) implements
the 16 findings in `.superpowers/plans/2026-08-04-dashboard-audit-fixes.md`. A
fresh whole-branch reviewer (`oc_msgrwd1w_2d617228`) ran against the completed
branch and surfaced four additional defects. All four were independently
reproduced against the branch's current source before this spec was written;
none required changing any source or test file to verify.

This spec covers only those four fixes. It does not reopen or modify the
16 findings already implemented.

## Goal

Fix four narrow correctness defects — one each in `cache-slider.js`,
`odometer.js`, `equiv-ticker.js`, and `cache-scenario.js` — without
introducing new modules, abstractions, or behavior beyond the scope below.

## Findings and fixes

### 1. Cache slider shows the what-if rate before any interaction

**File:** `dashboard/js/cache-slider.js` (`renderReadout`, `applySliderPrecision`)

`renderReadout` always renders `computeCacheScenario(...).paid`, which is an
alias for `requestedPaid` — the direct uniform-rate what-if calculation. On an
untouched initial render, the slider sits at the real fleet hit rate, but the
displayed "what you paid" and "caching has saved you" figures should reflect
the fleet's actual observed cache mix (`actualPaid` /
`actualSavedVsNoCache`), not the uniform-rate approximation.

**Fix:** track whether the slider has been user-moved (the existing
`slider.dataset.userMoved` flag, already set by the `input` listener, is
sufficient). `renderReadout` must receive or read that flag:

- Untouched (`userMoved !== 'true'`): render `actualPaid` and
  `actualSavedVsNoCache`.
- After any user interaction, including dragging back to the real rate:
  render `requestedPaid` (`scenario.paid`) and `savedVsNoCache`.

This is the only behavior change in this file. `computeCacheScenario`,
`getCacheSliderPrecision`, and `formatCacheRatePct` are unchanged.

### 2. Odometer drops a same-value rollback mid-transition

**File:** `dashboard/js/odometer.js` (`updateOdometer`, line ~198)

`updateOdometer` returns early whenever the requested `valueStr` equals
`state.valueStr`. But `state.valueStr` only updates once a transition
*settles* inside `drain()` — while a `1,001 → 1,002` roll is still in
flight, `state.valueStr` is still `'1,001'`. A same-value rollback request
(`1,001 → 1,002 → 1,001`) arriving during that window hits the early return
before ever recording the new target, so the in-flight `1,002` wins and the
display never reflects the newest request.

**Fix:** narrow the early-return guard to only fire when nothing is in
flight: `if (valueStr === state.valueStr && state.pendingValueStr == null)
return;`. When a transition is in flight, fall through to the existing
pending/busy-column logic (unchanged) — it already sets `pendingDigit`
correctly to roll a busy column back to an earlier digit once this guard
stops blocking it.

### 3. Equivalence ticker fade class survives invalidation

**File:** `dashboard/js/equiv-ticker.js` (`clearTicker`, line ~179)

`clearTicker` clears the rotation interval, fade timeout, stored lines, and
visible text, but never removes the `.fade` class from `.equiv-text`. If
invalidation (`updateEquivTickers` called with a zero/negative/non-finite
value) lands while a fade transition is active, the element keeps
`opacity: 0` (`dashboard/styles/design-v2.css:299`). A later valid restart
then inherits the hidden class and renders invisibly.

**Fix:** add `textEl.classList.remove('fade')` in `clearTicker`, alongside
the existing `textEl.textContent = ''` line.

### 4. Cache scenario eligibility ignores actual token counts

**File:** `dashboard/js/cache-scenario.js` (`isModelEligible`, line ~44)

`isModelEligible` calls `getUsablePricingRate(pricing, 'input')` and
`getUsablePricingRate(pricing, 'cacheRead')` with no `tokenCount` argument,
so it defaults to `0`. `getUsablePricingRate`'s presence-flag rejection
(`presence === false && tokenCount !== 0`) never fires as a result, so a
model with `hasInput: false` / `hasCacheRead: false` but real nonzero
`input`/`cache_read` counts still passes eligibility and silently
contributes a fabricated zero cost to the scenario.

**Fix:** pass the already-computed `counts.input` and `counts.cacheRead`
(from `getTokenCounts`, called at the top of `isModelEligible`) into those
two calls, matching how `hasUsableFixedRate` already passes counts for
`output`/`cacheWrite`/`reasoning`. A model with genuinely zero
input/cache-read counts remains eligible either way, since a `tokenCount`
of `0` never trips the presence check.

## Testing

One regression test per fix, added to the existing test files already
covering each module — no new test files:

- `tests/unit/cache-slider.test.js`: untouched initial render uses
  `actualPaid`/`actualSavedVsNoCache`; after a simulated `input` event
  (including one that lands back on the real rate), it uses
  `requestedPaid`/`savedVsNoCache`. Use heterogeneous per-model cache rates
  so `actualPaid` and `requestedPaid` are provably different values.
- `tests/unit/odometer.test.js`: `renderOdometer(el, '1,001')`, then
  `updateOdometer(el, '1,002')` immediately followed by
  `updateOdometer(el, '1,001')`; after transitions settle, the display and
  `state.valueStr` equal `'1,001'`.
- `tests/unit/dashboard-equiv-ticker.test.js` (or
  `tests/unit/equiv-ticker.test.js`, whichever already exercises fade
  timing): start a ticker, advance far enough to trigger the fade class,
  call `updateEquivTickers` with an invalidating value mid-fade, assert
  `.equiv-text` no longer has the `.fade` class, then start a new valid
  value and assert it renders visibly.
- `tests/unit/cache-scenario.test.js`: a model with `hasInput: false`,
  `hasCacheRead: false`, and nonzero `input`/`cache_read` counts is excluded
  from `eligibleModels`; a model with the same flags but zero counts for
  those dimensions remains eligible.

## Error handling

None of the four fixes introduce a new failure mode or fallback path — each
narrows or corrects an existing conditional on an existing code path. No new
try/catch, no new default/fallback state, no new external I/O.

## Out of scope

- Any of the 16 findings already covered by
  `.superpowers/plans/2026-08-04-dashboard-audit-fixes.md`.
- Any refactor of `cache-slider.js`, `odometer.js`, `equiv-ticker.js`, or
  `cache-scenario.js` beyond the specific lines named above.

## Completion criteria

1. All four fixes above are implemented with the described regression tests
   passing.
2. The existing focused test suites for the four touched files, plus the
   full unit suite, lint, and typecheck, pass.
3. A fresh code review confirms all four findings are resolved and no new
   defect was introduced, and any reviewer claim is independently
   reproduced before being trusted.
4. The branch goes through the normal PR review workflow before merging to
   `main`.
