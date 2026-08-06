import { formatMarkdownBoldToHtml, ensureWidgetBuilt, escapeHtml } from './utils.js';

/**
 * @typedef {object} ReportWidgetOptions
 * @property {string} endpoint
 * @property {string} cacheKeyField           'date' or 'weekEndDay' — which summary field
 *                                            identifies the cached bucket
 * @property {string} bodyId
 * @property {string} dateLabelId
 * @property {string} retryId
 * @property {string} containerId
 * @property {string} loadingText
 * @property {(cacheKeyValue: string) => string} headingFor
 * @property {(summary: any) => string|null} notEnoughText    returns null if summary is acceptable,
 *                                                             returns a message string if not enough
 * @property {string} buildFlag                                 e.g. 'dailyReportBuilt'
 */

/**
 * Derive the wrapper element id the widget's `build()` writes into the
 * container. Exposed as a module-level helper so the "not enough data"
 * placeholder branch (and any other consumer that needs the same id) can
 * share the exact same derivation — keeping the two DOM shapes from
 * drifting (which previously caused the daily-report placeholder to
 * render with id `dailyFieldReport` while build() produced `daily-field-report`).
 * @param {ReportWidgetOptions} opts
 * @returns {string}
 */
function widgetWrapperId(opts) {
    return opts.containerId.replace(/-container$/, '');
}

/**
 * @param {ReportWidgetOptions} opts
 * @returns {{
 *   render: (container: HTMLElement, summary: any) => void,
 *   renderPlaceholder: (container: HTMLElement, message: string) => void,
 *   resetForTest: () => void
 * }}
 */
export function createTaskferryReportWidget(opts) {
    /** @type {{[k: string]: any, text: string}|null} */
    let cached = null;
    /** @type {any} */
    let inFlight = null;
    // C19-3 (race fix): monotonically increasing generation counter for
    // overlapping fetchAndRender calls. A new render() bumps the counter;
    // when a previous fetch's response resolves, it checks its captured
    // generation and bails out if a newer fetch has been started in the
    // meantime. Without this, an older request that resolves AFTER a newer
    // one would overwrite `cached` and the visible report with the older
    // (stale) day's content. Also guards the inFlight cleanup so the older
    // request's `finally` doesn't clobber the newer request's inFlight marker.
    let generation = 0;

    /** @param {HTMLElement} container */
    function build(container) {
        container.innerHTML = `
            <div class="field-report" id="${widgetWrapperId(opts)}">
                <div class="fr-date" id="${opts.dateLabelId}"></div>
                <div id="${opts.bodyId}">${opts.loadingText}</div>
            </div>
        `;
    }

    /**
     * Render a minimal "not enough data yet" placeholder using the same
     * wrapper/body ids the widget's `build()` writes. Both the widget's own
     * `notEnoughText` no-data path and external callers (e.g. the daily
     * report's pre-build data check) use this so the placeholder DOM can't
     * drift from the full build's DOM and leave a stale `buildFlag` that
     * would crash the next render.
     * @param {HTMLElement} container
     * @param {string} message
     */
    function renderPlaceholder(container, message) {
        delete container.dataset[opts.buildFlag];
        container.innerHTML = `<div class="field-report" id="${widgetWrapperId(opts)}">`
            + `<div id="${opts.bodyId}">${escapeHtml(message)}</div></div>`;
    }

    /** @param {HTMLElement} container @param {any} summary */
    async function fetchAndRender(container, summary) {
        const cacheKeyValue = summary[opts.cacheKeyField];
        const myGeneration = ++generation;
        inFlight = cacheKeyValue;
        const bodyEl = /** @type {HTMLElement} */ (container.querySelector(`#${opts.bodyId}`));
        bodyEl.textContent = opts.loadingText;
        try {
            const res = await fetch(opts.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(summary)
            });
            if (myGeneration !== generation) return;
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Server error: ${res.status}`);
            }
            const data = await res.json();
            if (myGeneration !== generation) return;
            cached = { [opts.cacheKeyField]: cacheKeyValue, text: data.insights };
            renderCached(container);
        } catch (err) {
            if (myGeneration !== generation) return;
            const message = err instanceof Error ? err.message : String(err);
            // C19-3 (XSS fix): escape the server-supplied error message
            // before interpolating it into the innerHTML template. The
            // message originates from res.json().error (or the synthesized
            // "Server error: NNN" string), so it is untrusted HTML.
            bodyEl.innerHTML = `<span style="color: var(--mono-danger, #ef4444);">Report generation failed: ${escapeHtml(message)}</span> `
                + `<button type="button" class="retry-btn" id="${opts.retryId}">↻ Retry</button>`;
            container.querySelector(`#${opts.retryId}`)?.addEventListener('click', () => fetchAndRender(container, summary));
        } finally {
            if (myGeneration === generation) {
                inFlight = null;
            }
        }
    }

    /** @param {HTMLElement} container */
    function renderCached(container) {
        if (!cached) return;
        const cacheKeyValue = cached[opts.cacheKeyField];
        /** @type {HTMLElement} */ (container.querySelector(`#${opts.dateLabelId}`)).textContent = opts.headingFor(cacheKeyValue);
        /** @type {HTMLElement} */ (container.querySelector(`#${opts.bodyId}`)).innerHTML = formatMarkdownBoldToHtml(cached.text);
    }

    /** @param {HTMLElement} container @param {any} summary */
    function render(container, summary) {
        ensureWidgetBuilt(container, opts.buildFlag, build);

        const noData = opts.notEnoughText(summary);
        if (noData !== null) {
            /** @type {HTMLElement} */ (container.querySelector(`#${opts.bodyId}`)).textContent = noData;
            return;
        }

        const cacheKeyValue = summary[opts.cacheKeyField];
        if (cached?.[opts.cacheKeyField] === cacheKeyValue) {
            renderCached(container);
            return;
        }
        if (inFlight === cacheKeyValue) return;
        fetchAndRender(container, summary);
    }

    function resetForTest() {
        cached = null;
        inFlight = null;
        generation = 0;
    }

    return { render, renderPlaceholder, resetForTest };
}
