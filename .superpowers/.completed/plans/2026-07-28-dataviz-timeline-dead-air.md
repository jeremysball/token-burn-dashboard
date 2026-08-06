# Timeline Dead-Air Annotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shade any run of ≥3 consecutive missing hourly buckets on the Analytics > Timeline chart with an "— operator offline —" band, so a real usage gap reads as a gap rather than a flat, ambiguous zero line.

**Architecture:** A pure calculation module (`dashboard/js/dead-air.js`) detects gaps directly from the sorted hourly-bucket array already computed for the Timeline chart (`filtered` in `dashboard/js/views/analytics/tabs/timeline.js`); the render function turns each detected gap into a Plotly shaded `rect` shape plus a centered label annotation.

**Tech Stack:** Vanilla ES modules, `bun:test`.

## Global Constraints

- Source spec: `.superpowers/specs/2026-07-28-dataviz-mockup-widgets-design.md`, Section 4 ("Timeline dead-air annotation") and Section 5 ("Insufficient data — league table / dead-air / cache slider").
- **Gap detection is over missing hourly buckets, not zero-valued ones.** `lib/historical-data.js`'s `buckets` Map only ever creates an entry for an hour that had ≥1 real event (`extractHistoricalData`, `lib/historical-data.js:41-59`) — a bucket's `total` is never actually `0` once it exists. The spec's "hourly buckets with zero total tokens" therefore means hours with *no bucket at all* in the array the Timeline tab already renders (`dashboard/js/views/analytics/tabs/timeline.js`'s `sourceData`/`filtered`, sourced from `fileHistoricalData`/`historyData`). Detection works by comparing consecutive real buckets' timestamps and counting the whole hourly slots strictly between them.
- The 3-hour threshold is a tunable default per the spec ("not a hard requirement") — expose it as a parameter with `3` as the default, not a hardcoded literal inside the detection loop.
- No new backend/API work — `buckets` is already hourly-aggregated and already reaches the frontend via the existing `/api/tokens/historical` → `fileHistoricalData`/`historyData` path.
- Per spec Section 5, an empty or short `historyData`/`fileHistoricalData` array degrades gracefully with zero gap bands (no gaps to detect below 2 data points) — this plan's detection function already returns `[]` for that case without special-casing it, since the existing Timeline empty-state (`filtered.length < 2` in `timeline.js`) short-circuits before gap detection would even run.
- Plotly rendering itself has no existing unit-test coverage in this repo (`compare.js`/`timeline.js`'s own render functions early-return when `globalThis.Plotly` is undefined, which is always true in the `bun:test` + `happy-dom` environment) — this plan follows that same precedent and unit-tests only the pure `detectDeadAirBands()` function, not the Plotly wiring itself.
- **An ongoing gap at the very end of the series (operator currently offline, no newer bucket has landed yet) is out of scope for this plan and intentionally not detected.** `detectDeadAirBands()` only bounds a gap between two real buckets, so a trailing gap with no later bucket to close it produces no band. The mockup this spec is based on only depicts an internally-bounded gap, and closing a trailing gap would require comparing the last bucket's timestamp against "now" (`Date.now()`) rather than against another data point — a materially different, impure calculation this plan doesn't attempt. Revisit as a follow-up if a currently-ongoing outage turns out to be a case worth surfacing live.

---

### Task 1: Add gap detection and shade the Timeline chart

**Files:**
- Create: `dashboard/js/dead-air.js`
- Modify: `dashboard/js/views/analytics/tabs/timeline.js`
- Test: `tests/unit/dead-air.test.js`

**Interfaces:**
- Produces: `detectDeadAirBands(buckets: Array<{time: number}>, thresholdHours = 3): Array<{start: number, end: number}>` from `dashboard/js/dead-air.js` — `buckets` must be sorted ascending by `time` (already true of `filtered` in `timeline.js`, which derives from data sorted by `extractHistoricalData`). Each returned band's `start`/`end` are epoch-ms boundaries: `start` is the first missing hourly slot after the earlier real bucket, `end` is the timestamp of the next real bucket (exclusive of the gap, i.e. where real data resumes).
- Consumes (Task 1, wiring step): `filtered` (the same array `renderTimelineTab` already builds) from `dashboard/js/views/analytics/tabs/timeline.js`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/dead-air.test.js
import { describe, expect, it } from 'bun:test';
import { detectDeadAirBands } from '../../dashboard/js/dead-air.js';

const HOUR = 3600 * 1000;
/** @param {number} startHour @param {number[]} presentOffsets hour offsets (from startHour) that have a real bucket */
function fixtureBuckets(startHour, presentOffsets) {
    return presentOffsets.map((offset) => ({ time: startHour + offset * HOUR, total: 100 }));
}

describe('detectDeadAirBands', () => {
    it('returns no bands for fewer than 2 buckets', () => {
        expect(detectDeadAirBands([])).toEqual([]);
        expect(detectDeadAirBands([{ time: 0 }])).toEqual([]);
    });

    it('returns no bands for perfectly consecutive hourly buckets', () => {
        const buckets = fixtureBuckets(0, [0, 1, 2, 3, 4]);
        expect(detectDeadAirBands(buckets)).toEqual([]);
    });

    it('ignores gaps below the threshold (2 missing hours)', () => {
        const buckets = fixtureBuckets(0, [0, 3]); // hours 1, 2 missing = 2-hour gap
        expect(detectDeadAirBands(buckets, 3)).toEqual([]);
    });

    it('flags a gap exactly at the threshold (3 missing hours)', () => {
        const buckets = fixtureBuckets(0, [0, 4]); // hours 1, 2, 3 missing = 3-hour gap
        const bands = detectDeadAirBands(buckets, 3);
        expect(bands).toEqual([{ start: HOUR, end: 4 * HOUR }]);
    });

    it('flags multiple independent gaps in one series', () => {
        const buckets = fixtureBuckets(0, [0, 5, 10]); // two 4-hour gaps
        const bands = detectDeadAirBands(buckets, 3);
        expect(bands).toEqual([
            { start: HOUR, end: 5 * HOUR },
            { start: 6 * HOUR, end: 10 * HOUR }
        ]);
    });

    it('respects a custom threshold', () => {
        const buckets = fixtureBuckets(0, [0, 3]); // 2-hour gap
        expect(detectDeadAirBands(buckets, 2)).toEqual([{ start: HOUR, end: 3 * HOUR }]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/dead-air.test.js`
Expected: FAIL — `Cannot find module '../../dashboard/js/dead-air.js'`

- [ ] **Step 3: Write the module**

```js
// dashboard/js/dead-air.js
const HOUR_MS = 3600 * 1000;

/**
 * Detects runs of missing hourly buckets in an already hour-aggregated,
 * ascending-by-time series, e.g. the Timeline tab's `filtered` array.
 * @param {Array<{time: number}>} buckets sorted ascending by `time`
 * @param {number} [thresholdHours=3]
 * @returns {Array<{start: number, end: number}>}
 */
export function detectDeadAirBands(buckets, thresholdHours = 3) {
    if (!buckets || buckets.length < 2) return [];

    /** @type {Array<{start: number, end: number}>} */
    const bands = [];
    for (let i = 1; i < buckets.length; i++) {
        const prevTime = buckets[i - 1].time;
        const currTime = buckets[i].time;
        const missingHours = Math.round((currTime - prevTime) / HOUR_MS) - 1;
        if (missingHours >= thresholdHours) {
            bands.push({ start: prevTime + HOUR_MS, end: currTime });
        }
    }
    return bands;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/dead-air.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire the bands into the Timeline chart**

In `dashboard/js/views/analytics/tabs/timeline.js`, add the import (`dashboard/js/views/analytics/tabs/timeline.js:1`):

```js
import { CHART_COLORS, historyData, fileHistoricalData, isCompactViewport, getPlotlyLayout, getCutoffTime, analyticsRange, setAnalyticsRange, resolveAvailableRange } from './shared.js';
import { detectDeadAirBands } from '../../../dead-air.js';
```

After the existing `const mobile = isCompactViewport();` line, add the band computation and translate each band into a Plotly shape + centered annotation:

```js
    const deadAirBands = detectDeadAirBands(filtered);
    const deadAirShapes = deadAirBands.map((band) => ({
        type: 'rect',
        xref: 'x',
        yref: 'paper',
        x0: new Date(band.start),
        x1: new Date(band.end),
        y0: 0,
        y1: 1,
        fillcolor: 'rgba(163, 163, 163, 0.12)',
        line: { width: 0 }
    }));
    const deadAirAnnotations = deadAirBands.map((band) => ({
        x: new Date((band.start + band.end) / 2),
        y: 1,
        yref: 'paper',
        yanchor: 'top',
        text: '— operator offline —',
        showarrow: false,
        font: { size: 9, color: 'rgba(163, 163, 163, 0.9)' }
    }));
```

Then merge them into the existing `Plotly.newPlot` layout call (`dashboard/js/views/analytics/tabs/timeline.js`'s final block), changing:

```js
    Plotly.newPlot('timeline-chart-container', traces, {
        ...getPlotlyLayout(),
        margin: mobile ? { t: 16, r: 16, b: 40, l: 52 } : { t: 20, r: 20, b: 40, l: 60 },
        yaxis: { title: 'Tokens', automargin: true }
    }, { displayModeBar: false });
```

to:

```js
    Plotly.newPlot('timeline-chart-container', traces, {
        ...getPlotlyLayout(),
        margin: mobile ? { t: 16, r: 16, b: 40, l: 52 } : { t: 20, r: 20, b: 40, l: 60 },
        yaxis: { title: 'Tokens', automargin: true },
        shapes: deadAirShapes,
        annotations: deadAirAnnotations
    }, { displayModeBar: false });
```

- [ ] **Step 6: Run the full unit suite to catch regressions**

Run: `bun run test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add dashboard/js/dead-air.js dashboard/js/views/analytics/tabs/timeline.js tests/unit/dead-air.test.js
git commit -m "feat(dashboard): shade dead-air gaps on the Timeline chart"
```
