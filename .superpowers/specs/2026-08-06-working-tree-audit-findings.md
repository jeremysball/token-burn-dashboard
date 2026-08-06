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

## C. Broad-codebase audit (5 parallel ferried finders + inline, all verified)

The remaining lib/server/frontend surface was audited by five parallel
`taskferry` finder passes (minimax/MiniMax-M3) over a throwaway clone, then
**every claimed finding below was re-verified independently** with `node -e`,
fixture files, or direct source read — several finder claims were refuted or
downgraded in the process (noted inline). The `openrouter.js` round-trip fix
in the diff is the only change; everything in this section is pre-existing.

### Verified findings — severity-ranked

**HIGH — `serveStatic` throws on missing `.html`, crashing the server.**
`lib/utils/static.js:41` calls `fs.readFileSync(filePath)` directly (no
try/catch) for the HTML branch — unlike the cached branch. `safeStaticPath`
validates traversal but not existence, so a request for any non-existent
`.html` path under `/dashboard/` (or a prod deploy missing
`dist-dashboard/index.html`) throws ENOENT synchronously. `server.js:22`'s
request handler has no top-level try/catch, so the throw is uncaught → process
crash. **Verified:** `node -e` calling `serveStatic(res, '.../nope.html')` →
`THREW: ENOENT`. The finder flagged this as a perf issue (`readFileSync`
blocks); the unguarded throw is the more serious problem.

**HIGH — OpenRouter fuzzy lookup over-matches, returning wrong-model pricing.**
`lib/openrouter.js:265-272`: the fuzzy fallback uses `alias.includes(target)`
and `target.includes(alias)`. Looking up `gpt-4o` when the catalog contains
only `gpt-4o-mini` returns the mini's pricing ($0.15/M) instead of falling
back to local ($2.50/M) — a **16× cost underestimate**. **Verified:**
`setOpenRouterPricingSnapshot([{id:'openai/gpt-4o-mini',...}])` then
`getOpenRouterPricingRecord('gpt-4o').input` → `0.15`. The substring match is
too permissive; needs equality or a tighter boundary.

**HIGH — `session-parser` silently drops events with a non-string `model`.**
`lib/session-parser.js:138-140`: `model = data?.message?.model || ...` (no
`String()` coercion), then `model.includes('/')` throws `TypeError` when
`model` is a number/object/array. The outer try/catch in `parseLine` returns
`null`, losing the event's tokens. **Verified:** `parseLine` on an event with
`model:42` and `input_tokens:100` → `null` (tokens lost). One malformed
`model` field in one session file silently drops that event's accounting.

**HIGH — spike detector misses the two most important spike classes.**
`lib/spike-detective.js:250-272` `findSpikes`:
1. `avg > 0 ? current/avg : 0` (line 262) forces ratio=0 when the baseline is
   0 → **a burst from idle is never flagged.** **Verified:**
   `[0,0,15000]` → `[]`.
2. The rolling average includes the prior spike value, so **sustained elevated
   usage after the first spike is suppressed.** **Verified:**
   `[100,100,50000,50000]` flags only t2, not t3.

**HIGH — `git-blame getCostByFile` is O(N²).**
`lib/git-blame.js:570`: `commits.findIndex(c => c.fullHash === commit.fullHash)`
inside `for (const commit of commits)`. Pointless — the loop already has the
element; `generateGitBlameReport` (line 501) already uses index-based
iteration. Trivial fix, real cost at scale.

**HIGH — `git-blame` does 3× redundant git-log + full-session walks per scan.**
`lib/git-blame.js:269-276` `computeGitBlameRouteData` invokes `getGitCommits`
three times (lines 442, 498, 564), each independently walking all session files
via `getSessionFilesInRange` with no per-file time-window caching — despite
`session-parser.js:411` exporting `getCachedTimeWindow` explicitly "for git-blame
and spike detective" (stale comment: neither caller uses it). Per-worker cost
≈ 3·N·M file reads + 3 git-log invocations.

**MEDIUM — graceful shutdown stalls on open SSE connections.**
`server.js:193`: `server.close(() => process.exit(0))` waits for all
connections; SSE connections live up to `SSE_MAX_CONNECTION_TIME` (300s). No
`server.closeAllConnections()` or force-exit timer (only a second SIGINT
force-exits). A single open dashboard tab stalls clean shutdown by up to 5 min.
**Verified** against source.

**MEDIUM — no bound on concurrent SSE connections.**
`lib/routes/sse.js`: no per-IP or global cap. Each connection adds 2 intervals
+ 1 timeout; `req.on('close')` cleanup fires correctly (no per-connection leak),
but nothing limits the *count* of connections. Also the `SSE_MAX_CONNECTION_TIME`
`setTimeout` (line 62) is not stored/cleared in `cleanup()` — fires uselessly
on early disconnect. Trivial unauthenticated DoS via connection flood.

**MEDIUM — `?days=` has no lower/upper bound (git-log DoS).**
`lib/routes/api.js:464`: `parseInt(...) || 30` accepts negative and arbitrarily
large values (no `Math.max(1, …)` clamp). `cwd` is path-validated; `days` is
not. `?days=9999999` triggers an unbounded git-log + session scan in the worker
(result is cached, so one-shot per distinct value). **Verified:** no guard at
line 464.

**MEDIUM — auth token comparison is not constant-time.**
`lib/security.js:18`: `match[1] === authToken` short-circuits; should use
`crypto.timingSafeEqual`. Low practical severity (local-network default), but a
known token-leak vector.

**MEDIUM — `kimi-k2p5` (no provider prefix) misses local pricing.**
`lib/pricing.js:33`: the `k2p5` alternation requires `kimi-k2.5` prefix shape;
bare `kimi-k2p5` → default 2.5/10 instead of 1.5/6. **Verified.** Refined from
finder's "critical": only affects the no-provider-prefix spelling
(`kimi-coding/k2p5` matches correctly after `stripProviderPrefix`), and only
the local fallback (OpenRouter overrides when available).

**MEDIUM — double `getPricing` call per model per scan.**
`lib/token-burn.js:88-90`: calls `getPricing(modelKey)` for
`pricing_by_model`, then `calculateCost(modelData, modelKey)` (pricing.js:113)
calls `getPricing` again internally. Doubles the lookup (and the O(N) fuzzy
fallback on cache misses). **Verified.**

**MEDIUM — `getTokensData` returns null until next interval tick after a failed warmup.**
`lib/cache.js:151-158`: after the initial worker scan fails, `tokensData` stays
null and the resolved `tokensDataPromise` short-circuits `getTokensData` to
return null until the next `setInterval(updateTokens)` succeeds — emitting
`data: null` over SSE in the window. (Finder over-claimed "indefinitely"; it
self-heals on the next successful tick.)

**MEDIUM — frontend SSE reconnect churn.**
`dashboard/js/api.js:229-232`: `es.onerror` schedules
`setTimeout(connectSSE, 5000)` *in addition to* the browser's native EventSource
auto-reconnect. Under a sustained outage this stacks pending timers and churns
`EventSource` instances (line 217 closes the stored ref, not the `es` whose
handler fired). **Verified** against source.

**LOW / DRY / dead-code** (verified, abbreviated):
- `pricing.js:62-70` `findLocalPricing` fallback block is unreachable (`/.*/`
  at line 40 matches everything). Dead code.
- `pricing.js:14` `gpt-4o` anchored `^gpt-4o$` while `gpt-4o-mini` (line 15)
  isn't — `gpt-4o-2024-08-06` falls through to default (correct rate today,
  wrong `source` label).
- `token-burn-worker.js:16` posts `error.message` only — loses stack/type.
- `cache.js:114-120` historical-update `setInterval` has no overlap guard
  (inconsistent with the other two updaters).
- `git-blame.js:450/503/571` comment "Earlier commit" is wrong (commits are
  reverse-chron).
- `spike-detective.js` vs `git-blame.js:394-399`: same session yields different
  cost (reasoning field included in one path, omitted in the other — ~27% Δ).
- `session-discovery.js`: no symlink-cycle protection on directory recursion
  (bounded by `CLAUDE_MAX_DEPTH`); hardlink dedup gap (two hardlinks → double
  counting); mixed flat-files + subdirs at a Pi base drops the flat files.
- `dashboard/js/main.js:75-77` no-op `mousemove` listener runs for page
  lifetime ("reserved" for unbuilt feature).
- `dashboard/js/state.js:33-48` several exported `_historyTimelineData` etc.
  setters never imported — dead code.
- `heatmaps.js:337-338` (inline): `maxVal` computed over all model usage but
  columns sliced to last 24 → off-screen peak understates visible cell
  intensities; line 316 `timeSlots.includes()` is O(n²) accumulation.
- `dashboard.js:129-132` (inline): cost sparkline uses hardcoded
  `total × 0.000002` because `toChartItem` (api.js:41) drops cost from history
  points — the hero shows real cost, the sparkline shows a fabricated curve.

### Refuted / downgraded finder claims (kept here so they aren't re-litigated)

- **`session-parser` "timestamp 0 silently dropped" (finder: HIGH).**
  Downgraded to LOW and qualified: only a top-level `timestamp:0` *without*
  `message.timestamp` hits the falsy branch at line 175 and gets `ts:null`;
  the event is still parsed. `message.timestamp:0` is handled correctly by the
  `typeof === 'number'` guard at line 173. Epoch-0 as a real timestamp is
  never legitimate. **Verified** both paths with `node -e`.
- **Negative `?days=-5` "returns all commits" (finder: HIGH).** Refined: in
  this repo `--since="-5 days ago"` returned 17/123 commits, not all. The
  validation gap (no clamp) is real; the "returns everything" characterization
  was imprecise.

### Verified clean (no action)

Path traversal in static serving (all 12 attack vectors resolve safely via
`safeStaticPath`); ReDoS (every regex is linear, no nested quantifiers);
JSON.parse prototype pollution; command injection in `taskferry` execFile calls
(all static argv, no shell); CORS config; per-connection SSE `req.on('close')`
cleanup; body-size cap on `/api/insights/analyze`; worker-thread termination
(no leak surface); `timeline.js` and `compare.js` view modules.

### Method note

Findings were generated by 5 parallel `taskferry` finder passes
(minimax/MiniMax-M3, ~$1.32 total, zero session tokens) over a throwaway clone
at `/tmp/tbd-audit-20260806`, then every checkable claim was re-verified inline
before being recorded here — per the standing rule that a reviewer's specific
technical claim is not itself evidence. Two HIGH claims were refuted/downgraded
in that pass; the rest held.
