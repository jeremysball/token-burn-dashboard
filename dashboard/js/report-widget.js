import { formatMarkdownBoldToHtml, ensureWidgetBuilt } from './utils.js';

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
 * @param {ReportWidgetOptions} opts
 * @returns {{
 *   render: (container: HTMLElement, summary: any) => void,
 *   resetForTest: () => void
 * }}
 */
export function createTaskferryReportWidget(opts) {
    /** @type {{[k: string]: any, text: string}|null} */
    let cached = null;
    /** @type {any} */
    let inFlight = null;

    /** @param {HTMLElement} container */
    function build(container) {
        container.innerHTML = `
            <div class="field-report" id="${opts.containerId.replace(/-container$/, '')}">
                <div class="fr-date" id="${opts.dateLabelId}"></div>
                <div id="${opts.bodyId}">${opts.loadingText}</div>
            </div>
        `;
    }

    /** @param {HTMLElement} container @param {any} summary */
    async function fetchAndRender(container, summary) {
        const cacheKeyValue = summary[opts.cacheKeyField];
        inFlight = cacheKeyValue;
        const bodyEl = /** @type {HTMLElement} */ (container.querySelector(`#${opts.bodyId}`));
        bodyEl.textContent = opts.loadingText;
        try {
            const res = await fetch(opts.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(summary)
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || `Server error: ${res.status}`);
            }
            const data = await res.json();
            cached = { [opts.cacheKeyField]: cacheKeyValue, text: data.insights };
            renderCached(container);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            bodyEl.innerHTML = `<span style="color: var(--mono-danger, #ef4444);">Report generation failed: ${message}</span> `
                + `<button type="button" class="retry-btn" id="${opts.retryId}">↻ Retry</button>`;
            container.querySelector(`#${opts.retryId}`)?.addEventListener('click', () => fetchAndRender(container, summary));
        } finally {
            inFlight = null;
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
    }

    return { render, resetForTest };
}
