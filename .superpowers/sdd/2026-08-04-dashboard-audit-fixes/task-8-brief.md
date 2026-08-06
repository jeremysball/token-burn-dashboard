### Task 8: Exercise the integrated dashboard in a real browser

**Files:**
- Create: `tests/dashboard-audit-live.spec.js` (or the established Playwright test directory if the project runner requires it)
- Modify: `tests/playwright-fixtures.js` only for reusable server lifecycle helpers, not API interception for the audit assertions
- Modify: `package.json` only if a dedicated `test:e2e:audit` script is needed

**Interfaces:**
- The exercise must start the real Bun server and load the real dashboard page without routing `/api/tokens`, `/api/tokens/stream`, or `/data/factoids-1000.json` to mocked responses.
- The browser must observe a successful corpus request and an open SSE request, and the test must assert visible DOM/Plotly results rather than only checking that an SVG exists.
- Synthetic state transitions may be driven through the public module functions in a browser-side test harness only after the real page/network checks; do not add production-only global test hooks.

- [ ] **Step 1: Add a real-server Playwright fixture.**

Start `bun server.js` on an ephemeral port with the repository’s normal environment and wait for the actual HTTP listener. Use `page.goto()` against that server. Do not use `routeDashboardApis()` in this test. Capture network responses for `/data/factoids-1000.json`, `/api/tokens`, `/api/tokens/historical`, and the SSE stream.

- [ ] **Step 2: Assert real corpus/SSE startup.**

Wait for the dashboard to render, assert the corpus response is 200 with all three categories, assert the SSE request remains open or receives a message, and assert the visible ticker text is nonempty. This proves the browser exercised the static corpus and live transport rather than only a mocked render.

- [ ] **Step 3: Exercise the four integrated correctness paths in the browser.**

Use browser-imported production modules and a temporary DOM fixture inside `page.evaluate()` to drive deterministic transitions after startup:

1. Mount fallback ticker text, resolve the real corpus promise, and assert the mounted ticker changes without another dashboard render.
2. Render a localized Arabic-formatted odometer, submit three rapid totals, wait for the transition fallback, and assert the newest glyph/value is visible.
3. Render the cache slider with a `99_960` input / `40` cache-read fixture and assert the live `max`, `value`, `step`, and readout preserve `0.04%`.
4. Render file-backed hourly Timeline data ending at 09:00 with a chart end of 13:00 and assert Plotly receives a trailing band; render the same samples through SSE history and assert no band.

The exercise must also call the source-aware live-feed path with cache → first fresh → second fresh snapshots and assert only the second fresh snapshot changes the pill text.

- [ ] **Step 4: Run the real browser test.**

Run:

```bash
bunx playwright test tests/dashboard-audit-live.spec.js --reporter=list
```

Expected: PASS with explicit network and DOM assertions for the corpus, SSE, ticker replacement, odometer settlement, `0.04%` slider, cache-baseline suppression, and trailing Timeline shape bounds.

- [ ] **Step 5: Commit the integrated exercise.**

```bash
git add tests/dashboard-audit-live.spec.js tests/playwright-fixtures.js package.json
git commit -m "test(dashboard): exercise audit fixes in the browser"
```

---

