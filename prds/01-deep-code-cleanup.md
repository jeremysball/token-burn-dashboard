# Token Burn Dashboard: Deep Cleanup & Stability PRD

## 1. Context & Goals
The token burn dashboard was experiencing several stability and structural issues:
- `EADDRINUSE` failures when trying to run the server or testing suites.
- Brittle tests failing due to missing API configurations for chart dependencies.
- Runtime `TypeError` crashes on the front end when missing historical keys existed in older buckets.
- **Critical metrics bug**: Daily and historical logic falsely aggregated max-running total tokens across sessions instead of correct deltas, resulting in users appearing to spend their total all-time history balance every single day.

The goal of this cleanup was to fix the architectural data flow so metrics are truthful, ensure tests reliably pass, and improve local developer flow.

## 2. Requirements & Acceptance Criteria
- [x] Configure configurable server ports (Target: 7071) globally.
- [x] Background data warmup on startup for Python `.jsonl` parsing to ensure immediate TTI (Time to Interactive).
- [x] Safely type-check data in UI loops to eliminate undefined references.
- [x] Mock Playwright test suites correctly to cover chart edge cases.
- [x] Verify total token calculations reflect correct time-series daily usage logic, using deltas over cumulative maximums.
- [x] Ensure CI automation rules out connection refused errors.

## 3. Implementation Details
- `server.js` was refactored with a `startBackgroundUpdater` to cache the Python CLI results on startup.
- `index.html` was refactored significantly to:
  - Generate delta values (`data.total_tokens - currentData.total_tokens`) for `historyData` and `byDay` intervals.
  - Utilize `+=` instead of `Math.max()` for daily bucket aggregations.
- Test suites (`test-dashboard.spec.js` and `mobile-test.spec.js`) utilize dynamic ports (`process.env.PORT || 7071`).
- Used tmux safely detached for full test suite verifications locally.

## 4. Status
**Closed.** All 18 E2E and Unit Playwright tests are passing securely across mobile and desktop. Port binding and caching mechanisms are tested and merged. Daily token bugs have been permanently fixed.
