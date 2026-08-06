# Dashboard Audit Fixes Design

## Context

The merged dashboard audit verified 16 correctness defects across the equivalence ticker, odometer, cache widgets, live-event feed, weekly title belt, and Timeline chart. This change fixes all 16 findings from the audit report and its six-item follow-up draft.

The patch keeps the existing module boundaries. Each behavior remains owned by the module that already stores its state, and each finding gets a focused regression test.

## Design

### 1. Equivalence ticker lifecycle

`equiv-ticker.js` will validate the fetched corpus before storing it. The corpus must be a non-empty array of factoids with usable `category` and `copy` fields. A malformed, empty, or partial response keeps the curated fallback active.

When a ticker value becomes zero, negative, or non-finite, the module will clear its interval, remove its stored lines, and clear the visible text. A later valid value can start the ticker again.

When the corpus succeeds after fallback lines have mounted, the module will invalidate sampled-line caches and refresh mounted tickers. The refresh will update the lines without restarting an existing rotation unnecessarily.

### 2. Odometer updates

`odometer.js` will recognize the digit glyphs used by the active locale instead of treating only ASCII characters as digits. It will preserve the locale's separators and displayed glyphs while still tracking each numeric column by value.

Each odometer state will retain the newest requested value. If an update arrives while a column is animating, the state will queue the newest target and replay it after the current transition settles. The dashboard render gate will not mark a value as fully displayed until the odometer has accepted it, so a rapid update cannot become permanently invisible.

### 3. Cache scenario and slider

`computeCacheScenario()` will interpret the requested hit rate directly. It will calculate each model's cacheable-token cost as the requested uncached fraction at the input rate plus the requested cached fraction at the cache-read rate. It will keep output, cache-write, and reasoning costs fixed and include all three dimensions in every scenario total.

The real-rate scenario will match the actual per-model token mix without a quadratic interpolation. Models without usable input or cache-read pricing will remain excluded.

`cache-slider.js` will retain small nonzero real rates instead of rounding them to zero. It will choose a precision and step that preserve the data's meaningful scale, while keeping the displayed readout aligned with the slider value.

### 4. Live-event diffing and feed state

`live-event-diff.js` will accept previous and current model statistics and compute deltas for input, output, cache-read, cache-write, and reasoning tokens. Event cost will price each positive delta with its matching rate. If a nonzero dimension lacks a usable rate, the event cost will be unavailable rather than fabricated.

The event cache percentage will use delta input and delta cache-read tokens. The feed will ignore the cached snapshot as a live baseline after reload. The first fresh snapshot establishes the baseline; only subsequent fresh snapshots produce an event.

### 5. Weekly title belt

`title-belt.js` will carry reasoning tokens through model diffs and include reasoning pricing in effective-rate calculations.

`computeWeekWindow()` will use the stored ISO day values to identify consecutive seven-day windows. It will require the expected calendar boundaries instead of treating arbitrary array positions as week boundaries. Missing days will not silently become a full week.

### 6. Timeline dead-air detection

The Timeline tab will run dead-air detection only on file-backed historical data, which contains hourly buckets. When only live SSE history exists, it will not interpret arbitrary sample timestamps as hourly bucket boundaries.

`detectDeadAirBands()` will accept an optional chart-end boundary and check the gap after the final observed bucket. The Timeline tab will pass the end of the selected chart range, allowing an ongoing trailing offline period to render with the same shape and annotation as an internal gap.

## Error handling

The patch will preserve the current fail-safe behavior at each boundary:

- Malformed corpus data falls back to curated ticker lines.
- Unusable pricing produces no estimated cost or excludes the affected scenario model.
- Missing or invalid history produces the existing empty-state UI.
- Odometer transitions use their existing timeout fallback when `transitionend` does not fire.

No new catch-and-continue paths will hide errors from valid data. The ticker will log a corpus fetch failure and continue with curated lines, while malformed successful responses will follow the same explicit fallback path.

## Tests

Add focused unit coverage for all 16 reproductions:

- Malformed and empty factoid corpora.
- Ticker cleanup on invalid values and refresh after corpus resolution.
- Locale-formatted odometer digits.
- Odometer replay during an in-flight roll and dashboard-level rapid updates.
- Null pricing rejection.
- Direct cache-rate calculation, reasoning cost, and small-rate slider precision.
- Per-dimension live-event pricing and delta-based cache percentages.
- Cached live-feed baseline suppression.
- Reasoning-aware title-belt costs and calendar-based week boundaries.
- Live-history timestamp protection and trailing dead-air bands.

Run the full Bun unit suite and lint after implementation. Perform one real dashboard exercise that loads the corpus, updates the odometer rapidly, renders a sub-0.1% cache rate, and draws a trailing Timeline gap.

## Scope boundaries

This patch does not introduce new dashboard state managers, replace the widget architecture, or redesign the visual system. It fixes the verified correctness defects with the smallest changes that preserve existing first-paint, valid-update, slider, chart, and fallback behavior.
