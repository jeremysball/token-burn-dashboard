# Working-Tree Audit Findings — Token Burn Dashboard

Source: Claude Code session, 2026-08-06. Review of the uncommitted working-tree
diff plus the surrounding code the diff exposed. Every finding below was
verified empirically (`node -e` round-trips, `rg` across the dashboard tree,
affected unit-test run); none rely on filename/title inference.

Scope of this doc: the 5 changed files (`dashboard/js/views/analytics/tabs/models.js`,
`dashboard/js/views/dashboard.js`, `dashboard/styles/design-v2.css`,
`lib/openrouter.js`, `tests/unit/dashboard-view.test.js`) **and** the broader
pricing-helper layer the diff touched. A second, parallel pass (this session,
dispatched separately) covers the unaudited lib/server surface
(`pricing.js`, `token-burn.js`, `historical-data.js`, `git-blame.js`,
`routes/*`, `session-*`, `spike-detective.js`, `engineering.js`); findings from
that pass will be appended or filed alongside.

## Verified clean (the substantive win)

`lib/openrouter.js` — the `rawModels` round-trip fix is **correct and
important**. Confirmed directly: before the change, a
`setOpenRouterPricingSnapshot` → `getOpenRouterPricingSnapshot` →
`setOpenRouterPricingSnapshot` cycle (the path every token-burn worker takes
when seeded from the main thread's warm cache) returned records with
`input/output: undefined`, because `getOpenRouterPricingSnapshot` handed back
already-built pricing records and `buildOpenRouterPricingRecord` then re-parsed
them as raw API data and found no `.pricing` sub-object. After the fix the
round-trip preserves pricing (`input: 2.5, output: 10`). Net effect without the
fix: every worker scan after the first silently fell back to local pricing.

This invariant is now recorded as project memory
(`openrouter-rawmodels-roundtrip-invariant`): `getOpenRouterPricingSnapshot`
MUST return `cache.rawModels`, not `cache.models`.

## A. In the working-tree diff

| # | Location | Severity | Finding |
|---|----------|----------|---------|
| 1 | `dashboard.js:350` | low / DRY | `const display = model` is a dead alias used once. Inline. |
| 2 | `dashboard.js:349-354` | low / correctness | `modelNameEl.title = displayModel(name)` sits inside the `textContent !== model` guard, so the tooltip won't refresh when a routing-provider change leaves `model` identical. Hoist it out of the guard. |
| 3 | `dashboard.js:328-334` | low / robustness | Price element is now a two-element contract: title on `.top-model-price`, text on `.top-model-price-text`. Omitting the child silently no-ops in-place price updates. Undocumented coupling. |
| 4 | `models.js:58` | low / dead CSS | `.model-price` keeps `overflow: hidden; text-overflow: ellipsis` but as an unconstrained baseline flex child it can never truncate. |
| 5 | `design-v2.css:545` | low / over-spec | `background: none !important` — the `!important` fights nothing now that the per-source `background` lines were deleted; plain `background: none` suffices and won't resist future themed variants. |
| 6 | `dashboard.js` ×2, `shared.js:84` | med / DRY | `sourceLabel`/`sourceClass`/`sourceTitle`/`sourceText` derived by hand in two dashboard sites while `shared.js:getPricingSourceMeta(pricing)` already does the same. Consolidate cards onto `getPricingSourceMeta`. |

## B. What the diff exposed (pricing-helper layer)

These are the more serious ones — drift and triplication with real behavioral
divergence, latent traps for any future work.

| # | Location | Severity | Finding |
|---|----------|----------|---------|
| 7 | `utils.js:133` vs `config.js:116` vs `shared.js:57` | **med / correctness+DRY** | **`getPricingForModel` is defined 3× with different behavior.** `config.js` and `shared.js` fall back to the static `getPricing(name)` table on a miss; `utils.js:133` returns `null` with **no fallback**. The `utils.js` copy is dead/unused but its comment header literally says "centralized" — a trap. |
| 8 | `utils.js:142` vs `shared.js:62` | **med / correctness+DRY** | **`formatModelPrice` diverges.** `utils.js` does `input.toFixed(2)` → `2.50 in / 10.00 out` (no `$`, wrong for sub-cent prices). `shared.js` and the inlined dashboard copy use `fmtCur` → `$2.50 in / $10.00 out` (correct). `config.js:122` re-exports the **wrong** utils.js version, and that re-export is itself dead. |
| 9 | `design-v2.css:601-605` | low / dead CSS | `.top-model-price` sets `font-size/color` with `!important` while `createTopModelCard` sets the same inline on the same element. The `!important` is load-bearing against nothing; pure redundancy now that the element is a flex container. |
| 10 | `models.js:61` ↔ CSS `text-transform: lowercase` | info | Badge text emitted title-case in JS (`via OpenRouter`), lowercased by CSS. Works; CSS-off degrades to title-case. Noting the JS/CSS split. |

Recorded as project memory `dashboard-pricing-helpers-triplicated`. Highest-
value items to act on are **#7 + #8**; consolidating them makes #6 fall out
for free.

## C. Out of scope for this pass (see appended / sibling doc)

`lib/pricing.js`, `lib/token-burn.js`, `lib/historical-data.js`,
`lib/git-blame.js`, `lib/routes/*`, `lib/session-*`, `lib/spike-detective.js`,
`lib/engineering.js`, `lib/security.js`, plus dashboard JS beyond the view
layer touched here (`title-belt.js`, `dead-air.js`, `live-event-*.js`,
`odometer.js`, `equiv-*.js`, `cache-slider.js`, `modelsdev-pricing.js`,
`api.js`).
