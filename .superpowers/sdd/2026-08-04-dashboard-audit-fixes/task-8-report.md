# Task 8 implementation report

Status: DONE_WITH_CONCERNS

## Changed files

- `tests/playwright/real-server-fixtures.js`
- `tests/playwright/dashboard-audit-live.spec.js`
- `package.json`
- `config/eslint-baseline.json`

## Verification

Command:

```bash
bunx playwright test tests/playwright/dashboard-audit-live.spec.js --reporter=list
```

Result: 6 passed, 0 failed.

The real-server exercise verified:

- HTTP 200 for the real factoid corpus, including `tokens`, `cost`, and `burnRate` categories.
- HTTP 200 for the real SSE endpoint.
- Non-empty ticker text after startup.
- Fallback ticker replacement after corpus loading.
- Arabic-formatted odometer settlement after rapid updates.
- Cache slider precision for the `99_960` input and `40` cache-read fixture.
- File-backed Timeline trailing dead-air shape and SSE-only shape suppression.
- Source-aware live-feed behavior where cache and first-fresh snapshots do not update the pill, while the second fresh snapshot does.

## Concerns

The Arabic test overrides `Intl.NumberFormat` in page context instead of setting the browser locale. Plotly is stubbed for layout capture, so the test checks the production layout arguments but does not visually render the chart. The server fixture starts Bun on a dynamically reserved loopback port.
