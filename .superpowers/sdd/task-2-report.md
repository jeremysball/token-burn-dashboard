# Task 2 Report

Base commit: `3e86e2c262faeaae70ac74eeb01289b3e65e5a6c`

## Changes

- Anchored Minimax M3 and Kimi K2 family patterns to model boundaries.
- Removed broad O1 matching and preserved `o1-mini`, `o3-mini`, and `o1` matches.
- Normalized missing OpenRouter price fields from `null` to `undefined` so local rates remain fallback values.
- Added regression coverage for embed-m3, minimax-m3, unrelated k2 text, and missing cache prices.

## Review Finding Fix

The earlier `normalizePricing` change used `priceToPerMillion(value) ?? undefined`, but `priceToPerMillion(null)` converts `null` to the number `0` (since `Number(null) === 0`), which then overrides the local fallback in `mergePricing` (`0 ?? local === 0`).

Fix: `normalizePrice` now short-circuits `null`, `undefined`, and empty-string values to `undefined` before conversion, so openrouter records carry `undefined` for absent pricing and `mergePricing` keeps local rates. Legitimate numeric zero (e.g. `0` or `'0'`) is preserved because `priceToPerMillion(0)` returns `0`. The anchored regex changes were left untouched.

Added regression test `preserves local pricing when OpenRouter supplies explicit null aliases` that sets `input_cache_read`/`input_cache_write`/`cache_read`/`cache_write` to explicit `null` and verifies `getPricing` still returns local `cacheRead: 1.25` and `cacheWrite: 0`.

Added two focused regression tests asserting a legitimate numeric zero is preserved and does not fall through to local/default pricing. `keeps legitimate numeric zero and does not fall through to local pricing` sets `prompt`/`completion`/`input_cache_read`/`input_cache_write` to the string `'0'` and verifies `getPricing` returns `source: 'openrouter'` with `input`/`output`/`cacheRead`/`cacheWrite` all exactly `0` (and not the local `2.5`/`10`). `keeps numeric zero supplied as a number and does not fall through to local pricing` passes numeric `0` through `buildOpenRouterPricingRecord` and verifies the same fields stay `0` and not `undefined`. These guard the `priceToPerMillion(0) === 0` path in `normalizePrice`, complementing the null-to-`undefined` short-circuit.

## RED

Command:

```text
npm test -- tests/unit/server-pricing.test.js
```

Result: failed as expected. The focused suite reported 2 failed and 5 passed tests:

- Missing Minimax M3 pricing returned the fallback input rate `2.5` instead of `0.5`.
- Missing OpenRouter cache write pricing returned `null` instead of `undefined`.

The command also reported the repository's global coverage thresholds because it ran only one suite.

## GREEN

Command:

```text
npx jest tests/unit/server-pricing.test.js --coverage=false
```

Result: exit code 0. One suite passed with 7 tests passed.

## Verification

- `npm run lint`: exit code 0.
- `npm run lint:fix`: exit code 0.
- `npm run lint`: exit code 0 after auto-fix.
- `npm test`: exit code 0, 10 suites passed, 122 tests passed.
- `git diff --check`: exit code 0.
