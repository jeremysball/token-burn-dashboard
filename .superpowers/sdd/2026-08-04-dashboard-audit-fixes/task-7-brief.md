### Task 7: Protect Timeline dead-air detection and close trailing gaps

**Files:**
- Modify: `dashboard/js/dead-air.js:1-30`
- Modify: `dashboard/js/views/analytics/tabs/timeline.js:1-56`
- Modify: `dashboard/js/views/analytics/tabs/shared.js` only if a pure chart-end helper is needed
- Test: `tests/unit/dead-air.test.js`
- Test: `tests/unit/timeline.test.js` (create if absent)

**Interfaces:**
- `detectDeadAirBands(buckets, thresholdHours = 3, chartEnd = undefined) -> Array<{start, end}>` accepts ascending UTC hour buckets. It ignores/returns no bands for invalid non-hour-aligned or unsorted input rather than guessing. It supports one valid bucket when `chartEnd` is supplied, checks internal gaps, and checks the trailing gap through `chartEnd`.
- `chartEnd` is the UTC start of the last completed hour, calculated as `Math.floor(Date.now() / HOUR_MS) * HOUR_MS`. A trailing band from a last bucket at 09:00 with chart end 13:00 covers `[10:00, 13:00]` and has three missing hours. With chart end 12:00 it has only two missing hours and is omitted for a threshold of three.
- `renderTimelineTab` uses `fileHistoricalData` as the only dead-air source. When the chart falls back to `historyData` (SSE), it may render the series but passes no bands to Plotly.
- The selected range’s x-axis ends at `chartEnd`; for `all`, an end before the final observed bucket is clamped so no negative trailing gap is created. Plotly receives shapes and annotations for each band.

- [ ] **Step 1: Expand dead-air unit tests.**

Keep existing internal-gap tests and add:

```js
expect(detectDeadAirBands([{time: h(9)}], 3, h(13))).toEqual([{start: h(10), end: h(13)}]);
expect(detectDeadAirBands([{time: h(9)}], 3, h(12))).toEqual([]);
expect(detectDeadAirBands([{time: h(9)}], 3, h(8))).toEqual([]);
expect(detectDeadAirBands([{time: h(9) + 5 * 60_000}, {time: h(13)}], 3, h(16))).toEqual([]);
```

Add a test that an invalid one-bucket/no-end input remains empty and that duplicate or descending buckets do not produce a fabricated band.

- [ ] **Step 2: Add Timeline source-provenance tests.**

Stub Plotly and state setters. Render with the same `09:00`/`13:00` gap once in `fileHistoricalData` and once in `historyData` only. Assert the file-backed call includes a Plotly rectangle/annotation and the SSE-only call includes no dead-air shape. Add a one-bucket file-backed case and assert the chart still renders through the trailing boundary.

- [ ] **Step 3: Implement strict hourly dead-air detection.**

Validate finite timestamps, ascending order, and exact hour alignment before calculating missing hours. Keep internal bands unchanged. When `chartEnd` is a valid completed-hour boundary greater than the final bucket, calculate the number of absent hourly buckets between the final bucket and end and add a band when it reaches the threshold.

- [ ] **Step 4: Integrate source-aware Timeline rendering.**

Import `detectDeadAirBands`, choose `fileHistoricalData` versus `historyData` as today, and only invoke the detector for the file branch. Allow one file bucket to render a valid point plus x-axis range rather than treating it as a dead-air detector failure. Build Plotly `shapes` and `annotations` from returned bands and set the x-axis end to the completed-hour chart end, clamped to the selected source range.

- [ ] **Step 5: Run Timeline tests and existing chart-adjacent unit tests.**

Run:

```bash
bun test tests/unit/dead-air.test.js tests/unit/timeline.test.js tests/unit/utils.test.js
```

Expected: PASS for internal gaps, one-bucket trailing gaps, exact completed-hour boundaries, invalid/unsorted data, SSE-only protection, and file-history Plotly shapes.

- [ ] **Step 6: Commit Timeline changes.**

```bash
git add dashboard/js/dead-air.js dashboard/js/views/analytics/tabs/timeline.js dashboard/js/views/analytics/tabs/shared.js tests/unit/dead-air.test.js tests/unit/timeline.test.js
git commit -m "fix(dashboard): close and scope Timeline dead-air bands"
```

---

