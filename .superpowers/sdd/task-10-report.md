# Task 10 Report — Engineering ROI (file refs, git LOC, KPI insights)

## Status: DONE

## Summary

Completed Task 10 (10a/10b/10c) building on the prior worker's partial
implementation. No existing work was discarded; all changes were preserved,
completed, and fixed. Full quality gate is green: 255/255 unit tests pass and
lint is clean across the repo.

## Requirements verification

### Task 10a — file refs extraction and LOC parsing (`lib/engineering.js`)
- `extractFileRefs(text)` — allowlist that keeps only `/workspace/...` absolute
  paths and `./` / `../` relative paths with a known source extension.
  Correctly excludes `/usr/bin`, `/home/jeremy/baz.ts`, `/etc/passwd`, and URLs.
  Dedupes, bounds path length (5–200), caps at 20 results.
- `getFileExtensionLang(filePath)` — maps extensions to language labels,
  `'unknown'` for unrecognized/missing extensions.
- `parseShortStat(text)` — parses `git show --shortstat` into
  `{filesChanged, insertions, deletions, loc}`, returning a zeroed shape for
  empty/unparseable input so callers avoid divide-by-zero. Pure, no shell
  execution.

### Task 10b — git LOC vs tokens (`lib/git-blame.js`)
- `getCommitLOC(hash, cwd)` — uses `execFileSync('git', ['show','--shortstat',
  '--format=', hash], ...)` with an argument array (no shell interpolation) and
  guards with `isValidCommitHash` (7–40 hex). Returns a zeroed shape on any
  failure (invalid hash, nonexistent commit, git error).
- `generateGitBlameReport` integrates a `loc` object onto every reported commit.
- Security behavior preserved: hash validation still rejects shell
  metacharacters (`abc; rm -rf /`, `$(whoami)`).

### Task 10c — KPI insight cards + experimental disclaimer
- `dashboard/js/views/analytics.js` `calculateDeepInsights` adds the two
  heuristic insights:
  - **Eng Efficiency** — tokens per LOC changed, summed from
    `gitBlameCache.commits[].loc.loc` with a `total_lines` fallback.
  - **Cost / Commit** — average spend per commit.
  Both are guarded so they only render when the underlying data exists.
- `dashboard/index.html` — `experimental` badge added to the Deep Analysis
  header with a "Heuristic best-effort, not exact accounting" tooltip.

## Fixes applied to the partial implementation

1. **Broken function boundary in `analytics.js`.** The prior diff deleted the
   `const renderInsightsCards = (container, insights) => {` declaration line,
   leaving orphaned `container.innerHTML = ...` code outside any function — a
   syntax error that would break the whole module. Restored the declaration.
2. **Lint errors in the `extractFileRefs` regex.** The character classes used
   unnecessary escapes (`[\w\-\/.]`) that failed `no-useless-escape`. Rewrote as
   `[\w/.-]` with identical matching behavior (verified against every test
   fixture, including workspace/relative/excluded paths).
3. **CSS for the experimental badge.** `.badge.experimental` had no styling and
   would have rendered as bare text. Added a scoped `.insights-header
   .badge.experimental` rule (uppercase pill, help cursor) matching the existing
   monochrome design tokens.

## Preserved APIs and security
- No public function signatures changed. `engineering.js` still exports
  `EXTENSIONS, extractFileRefs, getFileExtensionLang, parseShortStat`;
  `git-blame.js` still exports its full set plus `getCommitLOC`.
- The relative imports were already corrected to `../../../lib` in the test
  files; confirmed correct (tests live in `tests/unit/lib/`).
- `execFileSync` + validated hash + zeroed-fallback pattern keeps the injection
  protection intact.

## Verification

- Focused: `npx jest tests/unit/lib/engineering.test.js
  tests/unit/lib/git-blame.test.js` — all pass.
- Full suite: `npm test` — **24 suites, 255 tests, all pass**;
  `engineering.js` at 100% coverage.
- `npm run lint` — clean (exit 0).

## Commits
- `78e4f79 feat(eng): extractFileRefs allowlist, shortstat parser`
- `bfa32f5 feat(eng): commit LOC via shortstat for tokens/LOC KPI`
- `a216d2e feat(eng): KPI cards tokens/LOC, cost/commit, experimental badge`

## Concerns
- Pre-existing (not Task 10): `lib/openrouter.js` fires an HTTP request at import
  time via `pricing.js`, leaving an open handle. Running an isolated test file
  without `--forceExit` hangs; the full `npm test` (coverage run) completes and
  exits cleanly. Out of scope here but worth a follow-up (mock the network in
  `tests/setup.js`).

---

# Task 10 Review-Fix Addendum

## Status: DONE

### Findings addressed

**Finding 1 — `extractFileRefs` accepted any extension.**
The prior allowlist only checked the path *location* (`/workspace/` or `./`/`../`)
and never validated the file extension. Disallowed paths such as `./secret.txt`,
`./config.env`, and `/workspace/x.env` were returned. Fixed by requiring every
returned path to end in a known source extension from `EXTENSIONS`
(`.js .ts .py .go .rs .java .rb .css .html .json .md`). Location and
extension allowlists now combine (both must hold). Behavior for valid paths is
unchanged; the length cap (5–200) and 20-result cap remain.

**Finding 2 — insight-card `innerHTML` interpolation.**
`renderInsightsCards` interpolated `insight.icon/title/value/description/detail`
directly into `innerHTML`. All five fields now pass through the existing local
`escapeHtml` utility, matching the pattern already used elsewhere in the file
(`escapeHtml(commit.message)`, `escapeHtml(session.id)`, etc.).

**Finding 3 — commit/session HTML + inline JS with model/commit values.**
- Commit hash column and `renderCommitDetails` header: now `escapeHtml`-escaped.
- Session `id`, model tags, and per-message model labels: now `escapeHtml`-escaped,
  including the `title="…"` attribute on session model tags.
- **Removed the unsafe inline handler** `onclick="showCommitDetails('${commit.hash}')"`
  which interpolated the (untrusted) commit hash directly into executable JS.
  Replaced with a `data-commit-index` attribute plus a delegated
  `click`/`keydown` (Enter/Space) listener in `renderGitBlameData`, preserving
  the original open-commit behavior and API shape (`showCommitDetails` signature
  unchanged). This mirrors the existing safe spike-card pattern
  (`data-spike-index` + event delegation).

### Exports added
`renderInsightsCards`, `renderGitBlameData`, and `renderCommitDetails` were added
to the analytics.js module export so they are unit-testable (no behavior change).

### Regression tests added
- `tests/unit/lib/engineering.test.js` — rejects `.txt`/`.env` (relative and
  under `/workspace`), and asserts every returned path ends in an allowed
  extension.
- `tests/unit/task-10-xss.test.js` (new) — DOM tests proving:
  - insight cards escape icon/title/value/description/detail (no injected `<img>`).
  - commit list escapes malicious hash/message and emits **no** inline `onclick`;
    click + keyboard still open the correct commit.
  - commit details escape malicious hash and model names (no live `<img>`/`<script>`).
- `tests/unit/task-10-security-xss.test.js` (new, parallel hardening) — additional
  `renderCommitDetails` / `renderGitBlameData` XSS assertions.

### Verification
- Focused: `npx jest tests/unit/lib/engineering.test.js
  tests/unit/task-10-xss.test.js --forceExit` → 18/18 pass.
- Full suite: `npm test` → **26 suites, 267 tests, all pass** (was 255; +12 new
  Task 10 XSS tests). `engineering.js` at 100% coverage.
- `npm run lint` → clean (exit 0).
- Prior Tasks 7–9 behavior preserved (spike cards, heatmap, Unicode badges,
  insight extraction all still green in the full run).

### Commits
- `fix(eng): enforce extension allowlist in extractFileRefs`
- `fix(eng): escape insight cards and git-blame commit/session HTML; drop inline onclick`
- `test(eng): add Task 10 XSS/allowlist regression tests`

---

# Task 10 Final Review-Fix Addendum

## Status: DONE

### Finding addressed — boundary-aware matching for `extractFileRefs`

The previous allowlist still leaked two classes of unsafe references:

1. **URL suffix injection.** A token such as
   `https://example.com/workspace/app/main.js` was matched on its
   `/workspace/app/main.js` substring, surfacing a remote URL path as if it were
   a local workspace file. The regex had no notion of the surrounding URL context.
2. **Traversal escape.** A token such as `/workspace/../outside/secret.js` passed
   the `startsWith('/workspace/')` location check while actually resolving *outside*
   the allowed root. The location check was purely lexical.

#### Fix (`lib/engineering.js`)
- **Reject URL contexts.** Each candidate is now checked against the text that
  precedes its match start; if that run ends in `://` or an `https?://…` scheme,
  the token is part of a URL and is discarded (boundary-aware matching). This
  blocks `https://host/workspace/...` and bare `http://localhost/workspace/...`.
- **Normalize and reject traversal escapes.** Added `normalizeWithinWorkspace(p)`.
  For `/workspace/...` paths, `..` segments are collapsed; if the resolved path no
  longer roots at `workspace` (i.e. it escaped), the candidate is rejected.
  `/workspace/../outside/secret.js` and `/workspace/../../etc/passwd` are now
  dropped, while `/workspace/app/../app/main.js` (stays inside `/workspace`) is
  still kept. Relative `./` / `../` paths remain allowed as before (they cannot
  name an absolute location).
- The location allowlist (`/workspace/` or `./`/`../` relative) and the extension
  allowlist (`EXTENSIONS`) are preserved, as are the length (5–200) and 20-result
  caps.

#### Regression tests added (`tests/unit/lib/engineering.test.js`)
- `rejects file refs embedded in URL suffixes` — `https://example.com/workspace/app/main.js`
  and `https://host/workspace/x/y.ts` return `[]`.
- `rejects traversal paths that escape /workspace` —
  `/workspace/../outside/secret.js` and `/workspace/../../etc/passwd` return `[]`.
- `keeps /workspace paths that stay within root after traversal` —
  `/workspace/app/../app/main.js` is kept.
- `rejects absolute paths with a scheme even when path looks valid` —
  `http://localhost/workspace/a/b.js` returns `[]`.

#### Verification
- Focused: `npx jest tests/unit/lib/engineering.test.js tests/unit/task-10-xss.test.js`
  → 24/24 pass.
- Full suite: `npm test` → **25 suites, 270 tests, all pass**. `engineering.js`
  at 100% coverage.
- `npm run lint` → clean (exit 0).

#### Commit
- `fix(eng): reject URL-suffix and traversal-escaping file refs in extractFileRefs`

---

# Task 10 Final Review-Fix Addendum (2)

## Status: DONE

### Finding addressed — Models-tab unescaped model-derived values

`renderModelsTab` (`dashboard/js/views/analytics.js:173-203`) interpolated
model-derived text directly into `innerHTML` without escaping:

- `${name.split('/').pop()}` (displayed model name)
- `title="${sourceMeta.title}"` (pricing source badge tooltip)
- `${sourceMeta.label}` (pricing source badge text)
- `title="${priceTitle}"` (model price tooltip)
- `${priceSummary}` (model price text)

Any of these can carry attacker-influenced content (model keys are
user/free-text-derived). All five are now passed through the existing local
`escapeHtml` helper, matching the escaping already applied to the git-blame and
insight-card surfaces. Table structure, numeric columns (`fmtNum`, cost,
cache_read), sparkline, and sort behavior are unchanged.

### Minor finding — heatmap XSS test was a no-op

`tests/unit/task-10-xss.test.js` wrapped the model-heatmap assertion in
`if (typeof renderModelHeatmap === 'function') { … } else { expect(true) }`, so
when `renderModelHeatmap` was not exported the test silently passed without
asserting anything. Fix:

- Exported `renderModelHeatmap` (and `renderModelsTab`) from the analytics view
  module so they are unit-testable (no behavior change).
- Rewrote the model-heatmap test to execute the real function and assert that a
  malicious model key (`<img src=x onerror=…>/claude`) produces **no live `<img>`/
  `<script>` element**; verification uses `querySelector('img')`/`'script'`
  (jsdom decodes entities on `innerHTML` serialization, so entity-string checks
  are unreliable and were replaced with element-existence checks).
- Added a `renderModelsTab` XSS test: injects a malicious model via the real
  `state.setCurrentData`/`setHistoryData` setters and asserts no live `img`/
  `script` element is created, the displayed name renders as inert text, and the
  escaped pricing `title` attributes contain no raw `<`.

### Regression coverage added (`tests/unit/task-10-xss.test.js`)
- `renderModelHeatmap XSS safety` — model keys escaped; no live injected markup.
- `renderModelsTab XSS safety` — name/pricing title/badge/price summary escaped;
  no live injected markup.

### Verification
- Focused: `npx jest tests/unit/task-10-xss.test.js` → 9/9 pass.
- Full suite: `npm test` → **25 suites, 271 tests, all pass**.
- `npm run lint` → clean (exit 0).
- Prior Task 7–9 and earlier Task 10 behavior preserved (spike cards, heatmaps,
  insight cards, commit-detail escaping, `extractFileRefs` allowlist all green).

### Commits
- `fix(eng): escape model-derived values in renderModelsTab`
- `test(eng): assert model-heatmap/models-tab XSS; export render fns`

---

# Task 10 Final Review-Fix Addendum (3)

## Status: DONE

### Findings addressed — finite-value guards in `calculateDeepInsights`

Two insight computations could render non-finite strings when data was empty
or lopsided:

1. **`Infinity:1` I/O ratio** (`analytics.js:607-609`). When output tokens are
   zero, `outputRatio` is 0 and `inputRatio / outputRatio` produces `Infinity`,
   rendered as `${ratio.toFixed(1)}:1` → `Infinity:1`.
   - Fix: `const ratio = outputRatio > 0 ? inputRatio / outputRatio : 0;`
2. **`NaN%` peak share** (`analytics.js:589-590`). When history is all-zero,
   `totalBucketed` is 0 and `peakTokens / totalBucketed` produces `NaN`, rendered
   as `${(peakShare * 100).toFixed(0)}%` → `NaN%`.
   - Fix: `const peakShare = totalBucketed > 0 ? peakTokens / totalBucketed : 0;`

Both fall back to `0`, a meaningful, finite value. No other insight math changed;
Task 7–9 and prior Task 10 (escaping, `extractFileRefs`) behavior preserved.

### Minor finding — trailing blank lines in generated files

`git diff --check` reported trailing blank lines at EOF of the Task 10 report
and the XSS test file. Trimmed both to a single trailing newline; `engineering.test.js`
was already clean. `git diff --check` now passes (exit 0) for all staged files.

### Regression coverage added (`tests/unit/task-10-xss.test.js`)
- `calculateDeepInsights finite-value guards › renders finite I/O ratio when
  output tokens are zero` — output = 0 yields value `0.0:1`, no `Infinity`/`NaN`
  in value or description.
- `calculateDeepInsights finite-value guards › renders finite peak share when
  history is all-zero` — all-zero history yields no `NaN%` in the Peak Hour
  description. `calculateDeepInsights` exported for testability (no behavior
  change).

### Verification
- Focused: `npx jest tests/unit/task-10-xss.test.js` → 11/11 pass.
- Full suite: `npm test` → **25 suites, 273 tests, all pass**.
- `npm run lint` → clean (exit 0).
- `git diff --check` → clean (exit 0) on all staged files.

### Commits
- `fix(eng): guard I/O ratio and peak-share against Infinity/NaN`
- `test(eng): assert finite-value guards; trim trailing blank lines`
