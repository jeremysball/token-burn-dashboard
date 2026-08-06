# SDD ledger — plan: .superpowers/plans/2026-07-28-dataviz-league-table.md

Task 1: dispatched implementer oc_mshu8mh0_6938bee7 (opencode-go/minimax-m3, --executor opencode) at BASE fb5956f
Task 1: implementer DONE_WITH_CONCERNS (justified fixture fix, verified), accepted, committed dc2728e
Task 1: dispatched task reviewer oc_mshukneg_becc326a (openai/gpt-5.6-luna, max effort)
Task 1: review verdict = Needs fixes. 2 Important findings, both on plan-verbatim code (C7/C19 comments), escalated to human:
  - Finding 1 (dashboard/js/league-table.js:50-57, effective-rate source uses pricingByModel not costsByModel): RULING (human) — keep pricingByModel/calculateCostWithPricing as-is; plan's own Step 3 code + C7 rationale governs over imprecise Global Constraints prose. NOT a defect. No fix needed.
  - Finding 2 (dashboard/js/league-table.js:41-47, memoization only keys on weeklyData, not pricingByModel -> stale badges on pricing-only change): RULING (human) — fix now. Extend the cache-invalidation guard to also key on pricingByModel reference.
  - Minor "Extra" finding (config/eslint-baseline.json unrelated cleanup) — deferred to final whole-branch review triage, not blocking.
Task 1: NEXT ACTION — dispatch fix round 1/5, RESUME implementer session ses_027b4d450ffe1M5NewOQ6rrdm6 (opencode-go/minimax-m3, --executor opencode, --session-id ses_027b4d450ffe1M5NewOQ6rrdm6) with Finding 2 only (Finding 1 explicitly not a defect per ruling above — tell the implementer this explicitly so it doesn't "fix" it). After fix lands: bun test tests/unit/league-table.test.js for real, commit, sdd-review-package over the fix range, scoped re-review on openai/gpt-5.6-luna --executor opencode --variant max.
Task 1: fix round 1/5 (1 addressed, 0 open — Finding 2 badge-cache staleness on pricing change fixed via _lastPricingRef guard; Finding 1 confirmed untouched per ruling; commits dc2728e..35c82cf). Real verification: bun test tests/unit/league-table.test.js 7/7 pass, bun run test 594/594 pass. NEXT ACTION: sdd-review-package over dc2728e..35c82cf, dispatch scoped re-review on openai/gpt-5.6-luna --executor opencode --variant max.
