# Task 10 — Security Review Fix Report

## Scope
Security review of XSS-prone rendering in the analytics view's git-blame and
engineering-KPI surfaces, plus the `extractFileRefs` allowlist in
`lib/engineering.js`.

## Findings addressed

### 1. Unescaped model / session / commit-derived values (analytics.js)
Free-text-derived fields were interpolated directly into `innerHTML` in
`renderCommitDetails` and `renderGitBlameData`, allowing stored XSS if a commit
message, session id, model key, or file name contained markup.

- `renderCommitDetails` (`dashboard/js/views/analytics.js:1063`, `:1088`): commit
  hash, commit message, session id, model names (in `title=` and tag body),
  and per-message model names are now passed through `escapeHtml`.
- `renderInsightsCards` (`analytics.js:659`): icon, title, value, description,
  and detail are escaped.
- Model-intensity heatmap (`analytics.js:1869`, `:1905`, `:1907`): raw `model`
  keys in `title=`, `aria-label=`, and `data-label=` attributes are now escaped.

### 2. Unsafe inline commit-hash interpolation
`renderGitBlameData` emitted
`onclick="showCommitDetails('${commit.hash}')"`, letting an attacker-controlled
hash break out into executable script. Replaced with:

- `data-commit-index="${idx}"` on each `.git-commit-item`, plus a listener wired
  after `innerHTML` is set that calls `showCommitDetails(commit.hash)` on click
  and on `Enter`/`Space` (keyboard accessible). No inline handler remains.
- The same pattern was applied to session headers in `renderCommitDetails`:
  `onclick="toggleSessionMessages(${idx})"` became
  `data-session-toggle="${idx}"` with a click/keydown listener. `idx` is numeric
  (safe) but the conversion keeps the codebase consistent and removes the last
  inline handler carrying a template-derived value.

### 3. `extractFileRefs` allowlist (lib/engineering.js)
The prior implementation kept any absolute path with a known extension, then
filtered to workspace-only, which could surface `/usr/...`/`/home/...` paths
before filtering. Hardened to require BOTH:

- Location allowlist: starts with `/workspace/` or is a `./`/`../` relative path.
- Extension allowlist: ends in a known source extension (`EXTENSIONS`).

Absolute paths outside `/workspace/` (e.g. `/home/...`, `/usr/...`) and
non-source extensions (`.env`, `.txt`, `.pem`) are rejected. The regex no longer
matches bare absolute paths, and the extension check covers relative paths.

## Verification
- `npm test` — 266 passed, 0 failed (incl. new `tests/unit/task-10-xss.test.js`).
- `npm run lint` — clean.
- `tests/unit/lib/engineering.test.js` covers the allowlist: workspace + relative
  paths kept, `/usr/`, `/home/`, `/etc/passwd`, `.env`, `.txt`, `.pem` rejected,
  dedupe + 20-cap enforced.
- New `task-10-xss.test.js` asserts escaping of commit hash/message/session
  id/model keys, absence of injected markup, no inline `onclick` on commit rows,
  keyboard activation without inline handlers, and the session-toggle listener
  wiring.

## Conclusion
All Task 10 findings are resolved: model/session/commit-derived values are
HTML-escaped, inline commit-hash interpolation is removed in favor of data
attributes + event listeners, and the `extractFileRefs` allowlist is correct.
