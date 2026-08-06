### Task 1: Cache slider renders the actual-rate baseline before user interaction

**Files:**
- Modify: `dashboard/js/cache-slider.js:73-138`
- Test: `tests/unit/cache-slider.test.js`

**Interfaces:**
- Consumes: `computeCacheScenario(currentData, hitRatePct)` from `dashboard/js/cache-scenario.js`, already returning `{paid, requestedPaid, actualPaid, savedVsNoCache, actualSavedVsNoCache, paidPct, ...}` — no signature change.
- Produces: `renderReadout(container, hitRatePct, precision)` now reads `container.querySelector('#cacheSlider').dataset.userMoved` to pick which scenario fields to render. No other module calls `renderReadout` directly (it's not exported), so this is a self-contained change.

- [ ] **Step 1: Write the failing test for the untouched-vs-user-moved baseline.**

Add to `tests/unit/cache-slider.test.js`, inside the `describe('renderCacheSlider', ...)` block:

```js
const heterogeneousData = () => ({
    total_input: 500_000,
    total_cache_read: 500_000,
    tokens_by_model: {
        'high-cache/model': { input: 100_000, cache_read: 900_000, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000 },
        'low-cache/model': { input: 900_000, cache_read: 100_000, output: 0, cache_write: 0, reasoning: 0, total: 1_000_000 }
    },
    pricing_by_model: {
        'high-cache/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        'low-cache/model': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }
    }
});

it('renders the actual-rate baseline on an untouched initial render', () => {
    renderCacheSlider(container, heterogeneousData());
    const paidEl = container.querySelector('#cachePaidValue');
    // Actual per-model mix differs from the uniform blended-rate what-if,
    // so actualPaid and requestedPaid render different numbers here.
    const scenario = computeCacheScenario(heterogeneousData(), 50);
    expect(scenario.actualPaid).not.toBeCloseTo(scenario.requestedPaid, 2);
    expect(paidEl.textContent).toBe(fmtCur(scenario.actualPaid));
});

it('renders the requested (what-if) baseline after the user drags the slider', () => {
    renderCacheSlider(container, heterogeneousData());
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    const paidEl = container.querySelector('#cachePaidValue');

    slider.value = '50';
    slider.dispatchEvent(new Event('input'));

    const scenario = computeCacheScenario(heterogeneousData(), 50);
    expect(paidEl.textContent).toBe(fmtCur(scenario.requestedPaid));
});

it('keeps rendering the requested baseline if the user drags back to the real rate', () => {
    renderCacheSlider(container, heterogeneousData());
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    const realRate = getRealCacheHitRatePct(heterogeneousData());
    const paidEl = container.querySelector('#cachePaidValue');

    slider.value = '10';
    slider.dispatchEvent(new Event('input'));
    slider.value = String(realRate);
    slider.dispatchEvent(new Event('input'));

    const scenario = computeCacheScenario(heterogeneousData(), realRate);
    expect(paidEl.textContent).toBe(fmtCur(scenario.requestedPaid));
});
```

Add the two new imports at the top of the file alongside the existing `renderCacheSlider` import:

```js
import { renderCacheSlider, getCacheSliderPrecision, formatCacheRatePct } from '../../dashboard/js/cache-slider.js';
import { computeCacheScenario, getRealCacheHitRatePct } from '../../dashboard/js/cache-scenario.js';
import { fmtCur } from '../../dashboard/js/utils.js';
```

- [ ] **Step 2: Run the tests and verify the new assertions fail.**

Run: `bun test tests/unit/cache-slider.test.js`
Expected: the first new test ("renders the actual-rate baseline on an untouched initial render") FAILS — `renderReadout` currently always renders `scenario.paid` (an alias for `requestedPaid`), never `actualPaid`. The second and third new tests already PASS before the fix, since the current unconditional `requestedPaid` behavior happens to match what they assert for the user-moved case — they exist as regression guards for Step 3, not as failing tests here. If the first test also passes, the fixture didn't produce heterogeneous per-model cache rates; adjust it until `actualPaid` and `requestedPaid` differ.

- [ ] **Step 3: Implement the fix in `renderReadout`.**

In `dashboard/js/cache-slider.js`, change `renderReadout` to branch on the slider's `userMoved` flag:

```js
/**
 * @param {HTMLElement} container
 * @param {number} hitRatePct
 * @param {{step: number, decimals: number}|null} precision
 */
function renderReadout(container, hitRatePct, precision) {
    const scenario = computeCacheScenario(latestData, hitRatePct);
    const savedEl = /** @type {HTMLElement} */ (container.querySelector('#cacheSavedValue'));
    const paidEl = /** @type {HTMLElement} */ (container.querySelector('#cachePaidValue'));
    const readout = /** @type {HTMLElement} */ (container.querySelector('#cacheReadout'));
    const barWrap = /** @type {HTMLElement} */ (container.querySelector('#cacheBarWrap'));
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));

    const userMoved = slider.dataset.userMoved === 'true';
    const savedValue = userMoved ? scenario.savedVsNoCache : scenario.actualSavedVsNoCache;
    const paidValue = userMoved ? scenario.requestedPaid : scenario.actualPaid;

    const decimals = precision ? precision.decimals : 1;
    savedEl.innerHTML = `${fmtCur(savedValue)}<small>at ${formatCacheRatePct(hitRatePct, decimals)}% hit rate</small>`;
    paidEl.textContent = fmtCur(paidValue);
    readout.textContent = `${formatCacheRatePct(hitRatePct, decimals)}% hit rate`;
    barWrap.style.setProperty('--paid-pct', `${scenario.paidPct.toFixed(1)}%`);
}
```

Do not change `applySliderPrecision`, `renderCacheSlider`, `getCacheSliderPrecision`, or `formatCacheRatePct`.

- [ ] **Step 4: Run the tests and verify they pass.**

Run: `bun test tests/unit/cache-slider.test.js`
Expected: PASS, including all pre-existing tests in the file (the untouched-render precision tests still hold since they don't assert on `#cachePaidValue`).

- [ ] **Step 5: Commit.**

```bash
git add dashboard/js/cache-slider.js tests/unit/cache-slider.test.js
git commit -m "fix(dashboard): render actual cache rate before slider interaction"
```

---

