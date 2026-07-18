# Task 2 Report: Pricing regex breadth anchored + null/zero merge regression coverage

## Scope

Task 2 originally anchored the `MODEL_PRICING` regex patterns in `lib/pricing.js`
so broad matchers (minimax-m3, k2, o1) no longer collide with unrelated model
names. This report records the regression-coverage improvements added on top of
that fix, focused on the OpenRouter/local pricing merge path.

## What was already correctly handled

- `normalizePrice` (lib/openrouter.js:42) maps `null`/`undefined`/`''` to
  `undefined`, so an OpenRouter record with explicit null alias fields yields
  `undefined` rather than `null`.
- `mergePricing` (lib/pricing.js:78) uses `??`, so `undefined` OpenRouter values
  fall through to the local record while a real `0` (falsy-but-defined) is kept.
- Regex anchoring keeps `task-embed-m3-model`, `task2`, etc. off the Minimax/Kimi
  matchers.

## New focused regression tests (tests/unit/server-pricing.test.js)

Both new tests drive the **exported production merge path** (`getPricing`, which
internally calls `mergePricing`). No unexported API was invented for tests, and
the regex definitions were left untouched.

1. `merge keeps local values when OpenRouter record carries explicit null aliases`
   - Builds a local record via `findLocalPricing('openai/gpt-4o')` (input 2.5,
     cacheRead 1.25, cacheWrite 0).
   - Seeds an OpenRouter snapshot with explicit `null` aliases
     (`input_cache_read`, `input_cache_write`, `cache_read`, `cache_write`).
   - Asserts the merged `getPricing` result keeps the local `cacheRead: 1.25` and
     `cacheWrite: 0` and that neither is `null`.

2. `keeps legitimate numeric zero through the production merge path (no fallthrough)`
   - Seeds an OpenRouter snapshot where prompt/completion/cache fields are the
     string `'0'`.
   - Asserts the merged result keeps `0` for input/output/cacheRead/cacheWrite and
     does NOT fall back to the local `2.5`/`10` rates, and is not `undefined`.

## Verification

- `npm test -- tests/unit/server-pricing.test.js` -> 12 passed
- `npm run lint` -> clean
- `npm test` -> 126 passed, 126 total (pre-existing global coverage threshold
  failure is unrelated to this change; it reflects overall suite coverage, not
  the pricing tests)

## Files changed

- `tests/unit/server-pricing.test.js` (2 new focused tests)
