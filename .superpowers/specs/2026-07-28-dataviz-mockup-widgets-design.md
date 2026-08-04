# Dataviz mockup widgets — design spec

Status: approved, ready for implementation planning.

## Context

A Lavish mockup (`.lavish/burn-odometer-mockup.html`) explored 7 dataviz/UX
ideas against the dashboard's real stylesheets, gathered from three external
advisor models (sol, kimi-k3, fable) plus two rounds of critique. Two of the
7 ideas were already built out in the mockup with real supporting data before
this spec was written:

- A 1000-entry equivalence-factoid corpus (`factoids-1000.json`), generated
  across 10 domains (100 each), independently arithmetic-checked
  (999/1000 passed re-verification; the 1 confirmed error is already fixed).
- Real vendored Lucide icon SVGs (ISC license) for the weekly title belt,
  normalized to the dashboard's square-cap/miter-join terminal aesthetic.

This spec covers taking all 7 mockup ideas from mockup to shipped feature in
the real app (`dashboard/`, `server.js`, `lib/`).

## Scope

All 7 mockup ideas, in one spec:

1. Equivalence ticker (hero-section)
2. Literal odometer (hero-value digit roll)
3. Cache savings slider
4. Live event feed
5. Daily field report
6. Weekly title belt
7. Weekly field report (paragraph)
8. Timeline dead-air annotation
9. League table (Compare tab reframe)

(Numbered 1–9 here because the mockup's own numbering splits "field report"
into daily/weekly variants as 4/4c and the title belt as 4b — flattened to a
simple list for this spec.)

## Section 1 — Foundations

- `factoids-1000.json` moves from `.lavish/` to `dashboard/data/factoids-1000.json`,
  served as a static asset the same way `dashboard/styles/` already is
  (`lib/routes/static.js` already maps `dashboard/` as the static root in
  dev, `dist-dashboard/` in prod — no route changes needed, just make sure
  the Vite build copies `data/` through to `dist-dashboard/` the same way it
  presumably already copies `styles/`).
- The Lucide `<symbol>` icon sprite (crown / thrift / wine / trending-up)
  moves from the mockup's inline `<svg>` block into `dashboard/index.html`'s
  `<body>`, with the ISC license notice kept in the same HTML comment. Shared
  by both the ticker area (no icon use there) and the new title-belt widget.
- `formatFactoid()` — the placeholder-template evaluator — becomes a shared
  module, `dashboard/js/equiv-format.js`, exporting a single function that
  takes a factoid's `copy` string and a live number, and returns the
  formatted HTML string. Handles all 4 observed placeholder shapes:
  `{n/X:.Nf}`, `{n*A/B:.Nf}`, `{X/n:.Nf}`, and bare `{n}`.

## Section 2 — Dashboard tab widgets (live, per-page-load)

- **Equivalence ticker** — attaches to the existing `#hero-tokens`,
  `#hero-cost`, `#burn-rate` elements. On each SSE update, samples 25
  factoids per category (`tokens`/`cost`/`burnRate`) from the corpus and
  formats them against the live value via `formatFactoid()`. Same
  fade-swap-fade rotation as the mockup; falls back to a small set of
  curated, hand-derived lines (kept inline, not from the corpus) if the
  corpus fetch fails — see Section 5.
- **Literal odometer** — digit-roll mechanic wraps `#hero-tokens`. Fires only
  on real SSE-driven value changes, never on page load or while idle
  (matches the mockup's explicit design note — an earlier draft that rolled
  on load/idle was corrected during mockup review).
- **Cache savings slider** — new section below the hero cards. Uses
  `total_cache_read`/`total_cache_write` and per-tier cost data already
  present in `currentData` (from `getTokensData()`/`lib/token-burn.js`).
  Purely a client-side "what-if" recompute as the user drags the slider from
  the real cache-hit rate toward 0% — no new backend endpoint.
- **Live event feed** — new section, single-latest-event-pill presentation
  (per earlier user "bingo" on this option during mockup review, over the
  market-tape and console-log alternatives). Synthesized from consecutive
  SSE snapshots: each poll, diff `tokens_by_model` against the previous
  snapshot; any model whose total grew emits one synthetic event line
  (model, token delta, cost delta, current cache %). Granularity is capped
  at `SSE_UPDATE_INTERVAL` — two real backend events landing inside the same
  interval merge into a single synthetic line. This is a deliberate,
  documented tradeoff, not a bug: building real per-request event tracking
  server-side was explicitly considered and rejected as out of scope for
  this spec.
- **Daily field report** — new section, one generated paragraph per day.
  Calls the existing taskferry-backed insights pipeline
  (`handleInsightsAnalyzeRoute` → `runTaskferryAnalysis` in
  `lib/routes/api.js`) with a new prompt template. Per the mockup's round-2
  advisor convergence, the prompt should specifically contrast
  token-share vs. cost-share for the day's peak hour, and downgrade any
  spike whose z-score is unremarkable despite a dramatic ratio — avoiding
  the "facts not insights" flatness the mockup's first draft was critiqued
  for.

## Section 3 — Analytics > Insights tab additions (weekly, narrative)

Placed in Analytics > Insights rather than the Dashboard tab, since this is
retrospective/generated content rather than a live stat tied to the hero
numbers.

- **Weekly title belt** — new widget in the Insights tab, computed from
  `weeklyData` (already tracked in `dashboard/js/state.js`).

  **Eligibility floor:** a model must account for ≥1% of that week's total
  tokens to qualify for *any* belt. This prevents a near-zero-usage model
  from winning "Most Improved" via a division-by-near-zero blowup, or
  "Thrift King"/"Sommelier" off a single unrepresentative call.

  **Scoring:**
  - *Volume Crown* — highest token share among eligible models.
  - *Thrift King* — lowest effective $/M among eligible models.
  - *The Sommelier* — highest effective $/M among eligible models.
  - *Most Improved* — largest week-over-week token growth % among eligible
    models that also have prior-week data. A model with no prior week is
    ineligible for this belt specifically, even if it clears the volume
    floor for the current week (see Section 5 for the empty-state UI).

  Icons reuse the Lucide sprite from Section 1 (crown / thrift / wine /
  trending-up, one per belt).

- **Weekly field report (paragraph)** — sits alongside the belt in the
  Insights tab. Same taskferry-backed generation approach as the daily
  report, but with a distinct prompt requiring genuine multi-week trend
  reasoning: week-over-week growth-rate acceleration/deceleration,
  cache-efficiency drift against a multi-week baseline, and anomaly
  recurrence at the same calendar position across weeks. This directly
  addresses the mockup review's critique that an earlier draft was "too
  daily-shaped" — a longer version of the daily report rather than genuine
  weekly-scale reasoning.

## Section 4 — Analytics tab changes (Timeline, Compare)

- **Timeline dead-air annotation** — client-side gap detection over the
  existing hourly-bucketed historical data (`lib/historical-data.js`'s
  `buckets` structure, already aggregated by hour). Any run of ≥3
  consecutive hourly buckets with zero total tokens gets a shaded
  "— operator offline —" band rendered on the Timeline tab's chart,
  matching the mockup. The 3-hour threshold is a starting default, not a
  hard requirement — easy to tune post-launch if it proves too
  sensitive/insensitive in practice.
- **League table** — reframes the Compare tab's existing top-8-by-volume
  model list (already computed in `dashboard/js/views/analytics/tabs/compare.js`,
  same `.slice(0, 8)` cutoff the donut chart already uses — no new threshold
  invented) into a table: rank, model, badge, effective $/M, cache %. The
  badge column reuses the title-belt scoring logic from Section 3, so a
  model holding "Volume Crown" that week shows the same badge here for
  consistency. Models beyond the top 8 collapse into a single clickable
  "+N others" long-tail row, expandable on click.

## Section 5 — Error handling

- **Corpus fetch failure** — if `dashboard/data/factoids-1000.json` 404s or
  fails to parse, the ticker silently falls back to its small set of
  curated, hand-derived lines (kept inline in the ticker's markup, not
  sourced from the corpus) rather than showing a blank ticker or throwing.
- **Taskferry dispatch failure** (daily/weekly field reports) — per the
  existing `handleInsightsAnalyzeRoute` pattern in `lib/routes/api.js`, no
  silent fallback: surface a real, visible error state in the report widget
  ("report generation failed") rather than fabricating placeholder
  narrative text. This matches the codebase's existing fail-fast convention
  for this exact pipeline.
- **Insufficient data — weekly title belt:** with fewer than 2 weeks of
  history, show the 3 belts that don't need prior-week data (Volume Crown,
  Thrift King, Sommelier) and replace the Most Improved row with an explicit
  "not enough history yet" note, rather than hiding the whole widget or
  showing a broken/undefined badge.
- **Insufficient data — league table / dead-air / cache slider:** all three
  already degrade gracefully off existing code paths (Compare tab's
  `if (models.length === 0)` empty state, an empty historical-data array
  simply producing zero gap bands, and the cache slider defaulting to
  whatever `currentData` reports, including 0% cache hit rate) — no new
  empty-state work needed beyond what those paths already do.

## Testing

- **Unit test** for `formatFactoid()` covering all 4 placeholder shapes
  (`{n/X:.Nf}`, `{n*A/B:.Nf}`, `{X/n:.Nf}`, bare `{n}`), plus a malformed/
  unexpected-expression case confirming it refuses to `eval` anything
  outside the allowed character set rather than throwing or executing
  arbitrary code.
- **Unit test** for the weekly title-belt scoring/eligibility logic: the 1%
  floor correctly excludes a near-zero-usage model from all belts, and
  "Most Improved" correctly excludes a model with no prior-week data even
  when it separately clears the volume floor for the current week.
- **Playwright smoke test** confirming the ticker and title belt render
  without layout overflow or clipped content, extending the same class of
  check already used during the mockup's Lavish review loop (real
  `layout_warnings` audit, not just a screenshot diff).

## Out of scope (explicitly deferred, not silently dropped)

- Real per-request event tracking server-side for the live event feed (a
  genuine backend feature, considered and rejected for this spec — see
  Section 2).
- Tuning the dead-air gap threshold or long-tail cutoff beyond the defaults
  stated above — ship with the defaults, revisit only if real usage shows
  they're wrong.
