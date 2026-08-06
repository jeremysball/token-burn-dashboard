### Task 5: Make live-event costs dimensional and source-aware

**Files:**
- Modify: `dashboard/js/live-event-diff.js:1-45`
- Modify: `dashboard/js/live-event-feed.js:1-55`
- Modify: `dashboard/js/api.js:1-200`
- Modify: `dashboard/js/state.js:1-177`
- Modify: `dashboard/js/main.js:291-295`
- Modify: `dashboard/js/views/dashboard.js:90-100`
- Test: `tests/unit/live-event-diff.test.js`
- Test: `tests/unit/live-event-feed.test.js`
- Test: `tests/unit/api.test.js`

**Interfaces:**
- `updateData(data, {source = 'fresh-http'} = {})` accepts `source` values `cache`, `fresh-http`, and `live-sse`; it normalizes `total_reasoning` and per-model `reasoning` without changing existing JSON field names.
- State exports `dataRevision` (monotonically increasing for each `updateData` call) and `dataSource`, with setters used only by `api.js`. A render may consume a revision once.
- `computeGrowthEvents(prevTokensByModel, currTokensByModel) -> Array<{model, delta, inputDelta, outputDelta, cacheReadDelta, cacheWriteDelta, reasoningDelta}>` computes positive deltas independently for all five dimensions and carries the positive total delta for event ordering/display.
- `pickLatestEvent(events, pricingByModel) -> {model, delta, cachePct, cost}|null` uses `cacheReadDelta / (inputDelta + cacheReadDelta)` for `cachePct`; prices each positive dimension with its matching rate; returns `cost: null` if any nonzero dimension lacks a usable rate.
- `renderLiveEventFeed(container, currentData, {source, revision})` ignores cache snapshots, seeds on the first fresh revision, processes each later fresh revision once, and leaves the last event visible on a no-growth revision.

- [ ] **Step 1: Rewrite live-diff tests around five dimensions.**

Use previous/current fixtures where input, output, cache-read, cache-write, and reasoning all grow by different amounts. Assert the exact delta object and verify mixed negative deltas clamp only the affected dimension to zero. Add a total/component mismatch fixture and document that `delta` is the positive total for display while cost uses the five dimensional deltas.

- [ ] **Step 2: Add a delta-mix pricing test.**

With previous `{input: 50, cache_read: 50}` and current `{input: 50, cache_read: 150}`, assert `cachePct` is `100`, not the cumulative `75`, and assert the cost uses only the cache-read rate for the 100-token positive input/cache delta. Add an output-only and reasoning-only event with distinct rates.

- [ ] **Step 3: Add missing-rate tests.**

Assert that a positive output/reasoning/cache-write delta with a missing corresponding rate returns `cost: null`, while a zero delta for that dimension does not require a rate. Assert numeric zero rates calculate a finite cost.

- [ ] **Step 4: Add source-aware feed lifecycle tests through the API path.**

Test this sequence with a real container and the exported `updateData`:

```js
updateData(snapshotA, { source: 'cache' });
updateData(snapshotB, { source: 'fresh-http' }); // baseline only
updateData(snapshotC, { source: 'live-sse' });  // exactly one event
updateData(snapshotC, { source: 'live-sse' });  // same revision path cannot duplicate
```

Assert that `snapshotA` never creates a historical event, `snapshotB` seeds without showing one, `snapshotC` shows the delta event, and a repeated dashboard render does not reprocess the same revision.

- [ ] **Step 5: Implement explicit provenance and revision state.**

Change `main.js` to call `updateData(cached, {source: 'cache'})`. Change `refreshData()` to use `fresh-http` and the SSE handler to use `live-sse`. Increment the revision in `updateData`, set the source before triggering `window.renderAll`, and preserve the source/revision while the render tree runs. Do not put orchestration metadata into the persisted API payload.

- [ ] **Step 6: Implement dimensional diffing and feed processing.**

Make the event object carry all positive dimension deltas. Remove cumulative cache-mix allocation. Use `getUsablePricingRate` with each dimension’s token count. In the feed, keep `prevTokensByModel`, `lastProcessedRevision`, and `baselineReady` module state; cache sources update the visible UI only, fresh sources establish or diff the baseline, and repeated renders with the same revision do nothing.

- [ ] **Step 7: Run live-event and API tests.**

Run:

```bash
bun test tests/unit/live-event-diff.test.js tests/unit/live-event-feed.test.js tests/unit/api.test.js tests/unit/state.test.js
```

Expected: PASS for dimensional costs, delta cache percentage, missing/zero rate semantics, cached-baseline suppression, first-fresh baseline, second-fresh event, and revision deduplication.

- [ ] **Step 8: Commit live-event changes.**

```bash
git add dashboard/js/live-event-diff.js dashboard/js/live-event-feed.js dashboard/js/api.js dashboard/js/state.js dashboard/js/main.js dashboard/js/views/dashboard.js tests/unit/live-event-diff.test.js tests/unit/live-event-feed.test.js tests/unit/api.test.js tests/unit/state.test.js
git commit -m "fix(dashboard): diff live events from fresh snapshots"
```
