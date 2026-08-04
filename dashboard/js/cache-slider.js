// dashboard/js/cache-slider.js
import { fmtCur, ensureWidgetBuilt } from './utils.js';
import { getRealCacheHitRatePct, computeCacheScenario } from './cache-scenario.js';

/** @type {any} */
let latestData = null;
/** @type {number|null} */
let lastRenderedSliderValue = null;
/** @type {any} */
let lastRenderedData = null;

/**
 * @param {HTMLElement} container
 */
function buildSection(container) {
    container.innerHTML = `
        <div class="cache-hero">
            <div class="cache-hero-top">
                <div>
                    <div class="cache-hero-label">caching has saved you</div>
                    <div class="cache-hero-value" id="cacheSavedValue">$0<small></small></div>
                </div>
                <div style="text-align:right;">
                    <div class="cache-hero-label">what you paid</div>
                    <div style="font-size:1.1rem; font-weight:700; color:var(--mono-text);" id="cachePaidValue">$0</div>
                </div>
            </div>
            <div class="cache-bar-wrap" id="cacheBarWrap">
                <div class="cache-bar-paid"></div>
                <div class="cache-bar-avoided"></div>
            </div>
            <div class="cache-bar-labels">
                <span><b>solid</b> = paid</span>
                <span><b>hatched</b> = avoided by caching</span>
            </div>
            <div class="cache-slider-row">
                <span>DRAG →</span>
                <input type="range" min="0" max="0" step="0.1" value="0" id="cacheSlider">
                <span class="cache-slider-readout" id="cacheReadout">0% hit rate</span>
            </div>
        </div>
    `;
    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    slider.addEventListener('input', () => {
        slider.dataset.userMoved = 'true';
        renderReadout(container, parseFloat(slider.value));
    });
}

/**
 * @param {HTMLElement} container
 * @param {number} hitRatePct
 */
function renderReadout(container, hitRatePct) {
    const scenario = computeCacheScenario(latestData, hitRatePct);
    const savedEl = /** @type {HTMLElement} */ (container.querySelector('#cacheSavedValue'));
    const paidEl = /** @type {HTMLElement} */ (container.querySelector('#cachePaidValue'));
    const readout = /** @type {HTMLElement} */ (container.querySelector('#cacheReadout'));
    const barWrap = /** @type {HTMLElement} */ (container.querySelector('#cacheBarWrap'));

    savedEl.innerHTML = `${fmtCur(scenario.savedVsNoCache)}<small>at ${hitRatePct.toFixed(1)}% hit rate</small>`;
    paidEl.textContent = fmtCur(scenario.paid);
    readout.textContent = `${hitRatePct.toFixed(1)}% hit rate`;
    barWrap.style.setProperty('--paid-pct', `${scenario.paidPct.toFixed(1)}%`);
}

/**
 * @param {HTMLElement} container
 * @param {any} currentData
 */
export function renderCacheSlider(container, currentData) {
    latestData = currentData;
    ensureWidgetBuilt(container, 'cacheSliderBuilt', buildSection);

    const slider = /** @type {HTMLInputElement} */ (container.querySelector('#cacheSlider'));
    const realRate = getRealCacheHitRatePct(currentData);
    slider.max = realRate.toFixed(1);
    if (slider.dataset.userMoved !== 'true') {
        slider.value = realRate.toFixed(1);
    } else if (parseFloat(slider.value) > realRate) {
        slider.value = realRate.toFixed(1);
    }

    // C19: skip renderReadout when neither slider position nor data changed
    const currentSliderValue = parseFloat(slider.value);
    if (currentSliderValue === lastRenderedSliderValue && currentData === lastRenderedData) return;
    lastRenderedSliderValue = currentSliderValue;
    lastRenderedData = currentData;
    renderReadout(container, currentSliderValue);
}