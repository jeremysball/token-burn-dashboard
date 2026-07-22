# Token Burn Dashboard — Automated Red-Team Findings (2026-07-19)

Repo: token-burn-dashboard-model-faceoff (main branch, local working tree)
Scope: main app only (server.js, api/, lib/, src/, dashboard/, dist/) — the
`gemini-3.1-pro/`, `gpt-5.2-codex/`, `k2p5/` folders are separate one-off
model-faceoff submissions, not the maintained app, and are excluded from
this pass.

Model requested: "deepseek v4 flash". Tried `opencode-go/deepseek-v4-flash`
and `opencode/deepseek-v4-flash-free` first — both crashed all 3 dispatches
with `no_output_timeout` (0 bytes logged, killed after 256s), a provider
outage, not a fluke (see lessons.md entry). A trivial ping confirmed
`openrouter/deepseek/deepseek-v4-flash` works cleanly, so all three review
passes were redispatched on that provider/model.

Modes dispatched (all three apply — real-time SSE dashboard, cost-calc
logic, and a network-bound server):
- Correctness
- Security
- Simplicity / Reduction

## Task IDs

| Mode | Task ID (final, openrouter/deepseek/deepseek-v4-flash) |
|---|---|
| Correctness | oc_mrrf2run_5c8d650b |
| Security | oc_mrrev6op_b62c846d (settled clean) |
| Simplicity | oc_mrrf2rzu_8a966469 |

Superseded/crashed attempts (opencode-go): oc_mrrei8u2_371ea606,
oc_mrrei955_14b5b2b8, oc_mrrei9el_eb85b987. Superseded/crashed attempt
(opencode free): oc_mrreo7af_0e86e74c. Correctness/Simplicity's first
openrouter attempts (oc_mrrev6g2_5b8d5b1e, oc_mrrev6xd_4e2d254c) crashed
with exitCode 1 after producing 500KB+ of log — session-resume attempt
silently switched model to openai/gpt-5.6-luna (taskferry doesn't preserve
the original model on `--session-id` resume), so both were cancelled and
redispatched fresh instead, to keep the requested model honest.

## Correctness / Simplicity: model switched twice, then completed

First redispatch attempt (`oc_mrrf2run_5c8d650b` Correctness,
`oc_mrrf2rzu_8a966469` Simplicity) crashed a second time with `exitCode: 1`
and OpenRouter `402` "insufficient credits" errors — billing exhaustion on
the OpenRouter key, not an outage. Flagged to the user rather than silently
switching providers.

User then asked to retry with "new understanding," explicitly ruling out
`openrouter` and `opencode-go`. Ping-tested `opencode/deepseek-v4-flash-free`
(the correct, only valid opencode model string for that model) — it also
crashed with `no_output_timeout` (0 bytes, SIGTERM), confirming a real
model-level outage on plain `opencode` too, not just `opencode-go`. A
guessed alternate string `opencode/deepseek-v4-flash:free` (OpenRouter-style
slug syntax) doesn't exist in opencode's model list and 500'd immediately.
Switched to `opencode/north-mini-code-free` (a coding-focused free opencode
model) per user direction — ping-tested clean, then both review passes
dispatched on it and completed:

| Mode | Task ID (final, opencode/north-mini-code-free) |
|---|---|
| Correctness | oc_mrrfx0bf_0ddfd0bb (DONE_WITH_CONCERNS, verdict "AI slop not trustworthy") |
| Simplicity | oc_mrrfx2or_a4d288de (DONE_WITH_CONCERNS) |

**Correctness review verification: every concrete citation was false or
fabricated.** Re-reading each cited file:line against current source:
- SSE "zombie interval" / "no `res.end()`" / "no `writableEnded` check"
  claims (`lib/routes/sse.js`) — all contradicted by the actual code:
  `cleanup()` clears both intervals on `close`/`error`/`timeout`, and
  `res.writableEnded` is checked before every `res.write()`.
- "`test/js/server-pricing.test.js:0` — Empty file, no substantive
  assertions" — wrong path (`test/js/` doesn't exist); the real file
  (`tests/unit/server-pricing.test.js`) is 119 lines with real assertions.
- "`README.md:13` claims 'Security: OpenRouter prices only fetched when
  local models unavailable'" — fabricated; that sentence does not appear
  anywhere in `README.md` (grepped for "OpenRouter" in the file — zero
  hits at all).
- "`handleSpikeDetectiveRoute` accepts any query param without validation"
  — false; it has a required-`timestamp` check that returns 400 if missing.
- "Pricing calc unit mismatch" — the reviewer's own text admits "correct
  implementation" in the same sentence; not an actual bug.

**Nothing from the Correctness pass survived verification. No issues
filed from it.** The "AI slop not trustworthy" verdict is itself
unsupported — every specific claim backing it was wrong. See the
lessons.md entry for this run.

**Simplicity review verification:** two real, confirmed findings after
dropping false positives:
- `createTopModelCard` "unused, in `dashboard/js/main.js`" — wrong file
  (it's in `dashboard/js/views/dashboard.js:253`) and it IS used (called
  at `dashboard.js:207`). False positive, dropped.
- `getPlotlyLayout` "duplicated inline in analytics.js" — false;
  `analytics.js` already imports and reuses the shared `getPlotlyLayout`
  in 4 places. False positive, dropped.
- `src/`, `dist/`, `build.js` "unused/dead" — false; `build.js` actively
  reads `src/` and writes `dist/`, and is wired to `npm run build`. False
  positive, dropped.
- Pricing table duplicated between `lib/pricing.js` and
  `dashboard/js/config.js` — **confirmed** (both files read directly;
  `config.js` has an explicit "Keep in sync with lib/pricing.js" comment
  acknowledging it). The reviewer's "~100KB" size claim was wrong
  (actual duplicated content is a few KB), corrected in the filed issue.
  Filed as issue #7 (https://github.com/jeremysball/token-burn-dashboard/issues/7).
- `api/server.js` dead/unreferenced alternate server + malformed
  `.gitignore` pattern for `fix_ports.js` — **confirmed** (grepped the
  whole repo for references to `api/server`, found none outside itself;
  confirmed `.gitignore`'s `fix_ports.js.worktrees/` line doesn't match
  `fix_ports.js`, confirmed via `git status` showing it untracked). Filed
  as issue #8 (https://github.com/jeremysball/token-burn-dashboard/issues/8).

## Findings (Security review only)

Source: `oc_mrrev6op_b62c846d` (openrouter/deepseek/deepseek-v4-flash),
settled clean. Each finding below is independently re-verified against
current source / live server behavior, not taken from reviewer text as-is.

1. **Path traversal via `/dashboard/` static route (reviewer: CRITICAL)**
   — **FALSE POSITIVE, not filed.** `lib/routes/static.js:27-28` checks
   `url.pathname.startsWith('/dashboard/')` before `path.join`. Node's
   WHATWG `URL` normalizes dot-segments (including `%2e%2e`) before
   `.pathname` is ever read and cannot resolve above the URL's own root.
   Live-tested against a local instance (`PORT=18234 node server.js`) with
   `../`, `%2e%2e`, `%252e%252e`, and `....//` payloads — every one 404'd.
   Not filed as an issue.

2. **Shell injection via git commit hash query param (reviewer: HIGH)** —
   **FALSE POSITIVE, not filed.** `lib/routes/api.js`'s
   `handleGitBlameRoute` passes the user-supplied `commit` param only to
   `getCommitSessionDetails` (`lib/git-blame.js:355-403`), which does a
   strict-equality `.find()` against real `git log` output and returns 404
   before ever reaching the vulnerable `execSync` call in
   `getCommitFiles` (`lib/git-blame.js:119-122`). Grep confirms
   `getCommitFiles` is only ever called elsewhere with `commit.fullHash`
   sourced from git's own trusted output. Live-tested with
   `?commit=;touch /tmp/pwned_test;` — 404 "Commit not found", no file
   created. Not filed as an issue.

3. **Unrestricted `cwd` param on `/api/git/blame` (reviewer: HIGH, framed
   as "shell injection")** — **CONFIRMED, reframed, filed.** Real bug, but
   it's arbitrary directory listing / information disclosure via
   `execSync`'s `cwd:` option (`lib/git-blame.js:51-86`
   `getAvailableDirectories`, sink for `fs.readdirSync(baseDir)`), not
   shell string injection — the shell command string itself isn't
   attacker-controlled. Live-tested `GET /api/git/blame?cwd=/etc` → HTTP
   200 with a full `/etc` directory listing in the response body.
   Filed as issue #2 (https://github.com/jeremysball/token-burn-dashboard/issues/2).

4. **`err.message` rendered raw via `innerHTML` on fetch failures
   (reviewer: HIGH)** — **CONFIRMED, filed.** 5 call sites in
   `dashboard/js/views/analytics.js`, all `innerHTML =` sinks with raw
   `${err.message}`: lines 687, 872, 974, 1080, 1134. `err.message` for a
   fetch/JSON-parse failure is normally not attacker-steerable client-side,
   but any upstream API response whose error text an attacker can
   influence (e.g. via the `cwd`/`commit` params reaching an error path)
   would render unescaped. Filed as issue #3
   (https://github.com/jeremysball/token-burn-dashboard/issues/3, bundled
   with Finding 5, same root cause class: unescaped content into
   `innerHTML`).

5. **`renderLLMInsights` inserts raw model-generated markdown into
   `innerHTML` (reviewer: HIGH)** — **CONFIRMED, filed.**
   `dashboard/js/views/analytics.js:697-708` `renderLLMInsights` does
   `p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')` then assigns the
   result via `innerHTML`, with no HTML-escaping pass on the source text
   first — any other HTML in the LLM's response (which is externally
   generated content, from the Kimi API) passes through unescaped. Same
   issue class as Finding 4. Filed as issue #3 (bundled,
   https://github.com/jeremysball/token-burn-dashboard/issues/3).

6. **Unescaped session IDs and model names via `innerHTML` (reviewer:
   MEDIUM)** — **CONFIRMED, filed.** `dashboard/js/views/analytics.js:1008`
   (`renderCommitDetails`, inside a `content.innerHTML =` template) puts
   raw `${session.id}` in; `session.id` originates from directory names
   under `~/.pi/sessions` (`lib/git-blame.js` `SESSIONS_PATHS` /
   `entry.name`), i.e. filesystem-controlled rather than a live remote
   attacker, but still unsanitized. Same pattern in
   `dashboard/js/views/dashboard.js:267` (`createTopModelCard`, called from
   `dashboard.js:207`'s `container.innerHTML = models.map(...)`) which puts
   raw `${name.split('/').pop()}` (a model name) into the template. Notably
   `analytics.js` has an `escapeHtml()` helper already in use nearby (lines
   917, 924, 942, 984) for comparable values — these two call sites are the
   inconsistent ones that skip it. Filed as issue #4
   (https://github.com/jeremysball/token-burn-dashboard/issues/4).

7. **No auth on any API route (reviewer: MEDIUM)** — **CONFIRMED, filed.**
   `server.js`'s route dispatch has no auth/session check anywhere; every
   `/api/*` route including git-blame (which now discloses arbitrary
   directory listings per Finding 3) and cost/token data is reachable by
   anyone who can reach the port. Filed as issue #5
   (https://github.com/jeremysball/token-burn-dashboard/issues/5, bundled
   with Finding 10, since both are about the server's default network
   exposure).

8. **Wildcard CORS (`Access-Control-Allow-Origin: '*'`) (reviewer:
   MEDIUM)** — **CONFIRMED, filed.** Set in `server.js:30` and again in
   `lib/utils/static.js:42`. Combined with Finding 7 (no auth), any origin
   can read the JSON API responses cross-origin. Filed as issue #5
   (bundled, https://github.com/jeremysball/token-burn-dashboard/issues/5).

9. **Unbounded request body read on `/api/insights/analyze` (reviewer:
   MEDIUM)** — **CONFIRMED, filed.** `lib/routes/api.js:132`,
   `handleInsightsAnalyzeRoute` accumulates `body += chunk` with no size
   cap before parsing — a large/slow POST body can exhaust memory (a DoS
   vector, not exploited/tested live since that would be a live DoS
   attempt against this environment). Filed as issue #6
   (https://github.com/jeremysball/token-burn-dashboard/issues/6).

10. **Server binds all interfaces by default, no `HOST` override (reviewer:
    LOW/MEDIUM)** — **CONFIRMED, filed.** `lib/config.js` defines `PORT`
    from `process.env.PORT` but no equivalent `HOST` variable;
    `server.js`'s `server.listen(currentPort)` call binds `0.0.0.0`/`::` by
    default (corroborated live: `ss -ltnp` showed the test instance bound
    to `*:18234`). Combined with Findings 7/8/9, this means the
    unauthenticated, CORS-open API with a DoS-able body reader is reachable
    from any host on the network by default, not just localhost. Filed as
    issue #5 (bundled with 7/8,
    https://github.com/jeremysball/token-burn-dashboard/issues/5).

11. **Raw `err.message` returned in `/api/tokens` HTTP error response
    (reviewer: LOW)** — **CONFIRMED, filed.** `lib/routes/api.js:24`,
    `handleTokensRoute` returns `err.message` directly in the response body
    on failure — minor info-disclosure (stack/path details in error
    messages), low severity on its own. Filed as issue #6 (bundled with
    Finding 9, same "insufficiently defensive API route" theme,
    https://github.com/jeremysball/token-burn-dashboard/issues/6).

12. **API keys sourced from env vars, not hardcoded (reviewer: checked,
    pass)** — **PASS, not filed.** `lib/routes/api.js:9-10`,
    `KIMI_API_KEY`/`KIMI_BASE_URL` are both `process.env.*`. No hardcoded
    secret found.

13. **No `eval`/unsafe deserialization found (reviewer: checked, pass)** —
    **PASS, not filed.**

## Correctness / Simplicity, round 2: opencode/hy3-free (2026-07-19)

User asked to try "hy3" on plain opencode after north-mini-code-free's
Correctness pass turned out to be almost entirely fabricated. Found via
`opencode models | grep -i hy3`: `opencode/hy3-free`. Ping-tested clean,
then re-ran both Correctness and Simplicity fresh (independent of the
north-mini-code-free run) on this model.

| Mode | Task ID |
|---|---|
| Correctness | oc_mrrgges8_547c9aa3 (DONE_WITH_CONCERNS, verdict "usable-with-caveats") |
| Simplicity | oc_mrrggfso_9f826107 (DONE_WITH_CONCERNS, verdict "usable-with-caveats") |

**This pass's citations held up dramatically better on verification** —
concrete file:line quotes, live-tested numbers (real `npm test --coverage`
run reproduced exactly, real corpus stats), and correct cross-references to
already-known findings (independently re-derived the api/server.js and
pricing-table duplication findings from round 1, correctly not re-filed as
duplicates). One claim did not survive verification and was dropped:

- "`server.js:129` port-retry math re-probes already-failed ports (7070
  appears again)" — **false**, dropped. Ran the actual formula for attempts
  1-10: `7072, 7070, 7073, 7069, 7074, 7068, 7075, 7067, 7076, 7066` — every
  port is distinct, no repeats. The formula is unusual-looking but correct;
  not filed.

Six new, verified findings filed (all independently confirmed: read the
cited source, reran `npm test -- --coverage`, grepped for real callers,
ran the port-retry formula in `node -e`):

- **#9** — `lib/historical-data.js:108,137,143`: falls back to an ISO-string
  `data.timestamp` when `message.timestamp` is missing, which NaN-corrupts
  the sort and hourly bucketing. Currently latent (real corpus always has
  numeric `message.timestamp`) but a real bug waiting for a schema change.
  https://github.com/jeremysball/token-burn-dashboard/issues/9
- **#10** — `dashboard/js/views/analytics.js:668-674` has a dead
  `data.source === 'local'` branch the server can never actually emit
  (confirmed by reading `handleInsightsAnalyzeRoute` end to end); bundled
  with README.md:19 overstating "10+ providers" when `lib/pricing.js` has
  exactly 6. https://github.com/jeremysball/token-burn-dashboard/issues/10
- **#11** — `lib/session-parser.js`, `session-discovery.js`,
  `opencode-discovery.js` (842 lines, commit `ea375cb`) are never
  `require`d anywhere in real code, confirmed via grep.
  https://github.com/jeremysball/token-burn-dashboard/issues/11
- **#12** — 0% test coverage on the entire server-side data pipeline
  (`token-burn.js`, `historical-data.js`, `git-blame.js`,
  `spike-detective.js`, `cache.js`, all route handlers) — reproduced
  directly with `npm test -- --coverage` (13.98% stmts overall, 77 tests
  all in client-side/pricing modules).
  https://github.com/jeremysball/token-burn-dashboard/issues/12
- **#13** — `stripProviderPrefix` duplicated identically in
  `lib/pricing.js:42-45` and `lib/openrouter.js:30-33` despite `pricing.js`
  already importing from `openrouter.js`; 4 near-identical hardcoded
  session-path-root lists across `historical-data.js`, `token-burn.js`,
  `session-discovery.js`, `spike-detective.js`; `getAllPricing`
  (`lib/pricing.js:144`) confirmed dead via grep, zero callers.
  https://github.com/jeremysball/token-burn-dashboard/issues/13
- **#14** — `lib/spike-detective.js:71-151` hardcodes its own crude pricing
  table instead of calling `calculateCost` from `lib/pricing.js`, so
  "spike" cost figures will diverge from the dashboard's cost figures for
  the same session. https://github.com/jeremysball/token-burn-dashboard/issues/14

Findings that independently re-derived round-1's already-filed issues
(correctly not re-filed): api/server.js dead+orphaned (matches #8),
client/server pricing-table duplication (matches #7).

## Issues filed

| Issue | Title | Findings bundled |
|---|---|---|
| [#2](https://github.com/jeremysball/token-burn-dashboard/issues/2) | Unrestricted cwd param on /api/git/blame exposes arbitrary directory listings | 3 |
| [#3](https://github.com/jeremysball/token-burn-dashboard/issues/3) | Unescaped err.message and LLM insight markdown rendered via innerHTML | 4, 5 |
| [#4](https://github.com/jeremysball/token-burn-dashboard/issues/4) | Unescaped session ID and model name interpolated into innerHTML | 6 |
| [#5](https://github.com/jeremysball/token-burn-dashboard/issues/5) | No auth, wildcard CORS, and unrestricted bind expose the API to any network caller | 7, 8, 10 |
| [#6](https://github.com/jeremysball/token-burn-dashboard/issues/6) | Unbounded request body read and raw error message leak in api routes | 9, 11 |
| [#7](https://github.com/jeremysball/token-burn-dashboard/issues/7) | Model pricing table duplicated between lib/pricing.js and dashboard/js/config.js | Simplicity |
| [#8](https://github.com/jeremysball/token-burn-dashboard/issues/8) | Dead unreferenced api/server.js and a malformed .gitignore pattern for fix_ports.js | Simplicity |
| [#9](https://github.com/jeremysball/token-burn-dashboard/issues/9) | Historical data pipeline NaN-corrupts sort/bucketing when message.timestamp is absent | Correctness (hy3-free) |
| [#10](https://github.com/jeremysball/token-burn-dashboard/issues/10) | Dead 'local' AI-insights fallback branch and README overstates provider count | Correctness (hy3-free) |
| [#11](https://github.com/jeremysball/token-burn-dashboard/issues/11) | 842 lines of unreferenced session-parsing modules committed but never wired in | Correctness (hy3-free) |
| [#12](https://github.com/jeremysball/token-burn-dashboard/issues/12) | Zero test coverage on the entire server-side data pipeline | Correctness (hy3-free) |
| [#13](https://github.com/jeremysball/token-burn-dashboard/issues/13) | Duplicated stripProviderPrefix, 4x session-path lists, and dead getAllPricing | Simplicity (hy3-free) |
| [#14](https://github.com/jeremysball/token-burn-dashboard/issues/14) | spike-detective hardcodes its own pricing table, diverging from lib/pricing.js | Simplicity (hy3-free) |

Not filed: Security Findings 1, 2 (false positives, disproven live),
Findings 12, 13 (pass, nothing to file). Every north-mini-code-free
Correctness-review finding (false/fabricated on verification — see above).
Two north-mini-code-free Simplicity-review findings (unused-function claim,
Plotly-duplication claim, src/dist/build.js "dead code" claim — all false
on verification). One hy3-free Correctness finding (server.js port-retry
"re-probes ports" claim — false, formula verified correct).
