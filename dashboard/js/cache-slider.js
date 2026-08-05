// dashboard/js/cache-slider.js
import { fmtCur, ensureWidgetBuilt } from './utils.js';
import { getRealCacheHitRatePct, computeCacheScenario } from './cache-scenario.js';

/** @type {any} */
let latestData = null;
/** @type {number|null} */
let lastRenderedSliderValue = null;
/** @type {any} */
let lastRenderedData = null;
/** @type {{step: number, decimals: number}|null} */
let lastRenderedPrecision = null;

/**
 * Determine a deterministic slider step and decimal count from the
 * maximum real hit-rate percentage. Produces enough decimal places
 * for any positive rate below 0.1%, never rounds a positive rate to
 * zero, and stays stable between renders.
 * @param {number} realRatePct
 * @returns {{step: number, decimals: number}}
 */
export function getCacheSliderPrecision(realRatePct) {
    if (realRatePct <= 0) return { step: 0.1, decimals: 1 };
    const decimals = Math.max(2, Math.ceil(-Math.log10(realRatePct)) + 1);
    const step = Math.pow(10, -decimals);
    return { step, decimals };
}

/**
 * Format a hit-rate percentage value with a fixed number of decimal
 * places so that slider max, step, value, and readout stay consistent.
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
export function formatCacheRatePct(value, decimals) {
    return value.toFixed(decimals);
}

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
        renderReadout(container, parseFloat(slider.value), lastRenderedPrecision);
    });
}

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

    const decimals = precision ? precision.decimals : 1;
    savedEl.innerHTML = `${fmtCur(scenario.savedVsNoCache)}<small>at ${formatCacheRatePct(hitRatePct, decimals)}% hit rate</small>`;
    paidEl.textContent = fmtCur(scenario.paid);
    readout.textContent = `${formatCacheRatePct(hitRatePct, decimals)}% hit rate`;
    barWrap.style.setProperty('--paid-pct', `${scenario.paidPct.toFixed(1)}%`);
}

/**
 * @param {HTMLElement} container
 * @param {any} currentData
 */
/**
 * @param {HTMLInputElement} slider
 * @param {number} realRate
 * @param {{step: number, decimals: number}} precision
 */
function applySliderPrecision(slider, realRate, precision) {
    slider.max = formatCacheRatePct(realRate, precision.decimals);
    slider.step = formatCacheRatePct(precision.step, precision.decimals);
    if (slider.dataset.userMoved !== 'true') {
        slider.value = formatCacheRatePct(realRate, precision.decimals);
    } else {
        slider.value = parseFloat(slider.value) > realRate
            ? formatCacheRatePct(realRate, precision.decimals)
            : slider.value;
    }
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
    const precision = getCacheSliderPrecision(realRate);
    lastRenderedPrecision = precision;

    applySliderPrecision(slider, realRate, precision);

    // C19: skip renderReadout when neither slider position nor data changed
    const currentSliderValue = parseFloat(slider.value);
    if (currentSliderValue === lastRenderedSliderValue && currentData === lastRenderedData) return;
    lastRenderedSliderValue = currentSliderValue;
    lastRenderedData = currentData;
    renderReadout(container, currentSliderValue, precision);
}