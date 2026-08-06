// ===== FORMATTERS =====
/**
 * @param {number|string} n
 * @returns {string}
 */
export const fmtNum = n => {
    const num = Number(n) || 0;
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
    return Math.round(num).toString();
};

/**
 * @param {number|string} n
 * @returns {string}
 */
export const fmtInt = n => Number(n || 0).toLocaleString();

/**
 * @param {number} n
 * @returns {string}
 */
export const fmtCur = n => {
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(3);
    return '$' + n.toFixed(4);
};

/**
 * @param {string|number|Date} date
 * @returns {string}
 */
export const fmtDate = (date) => {
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/**
 * @param {number|string} n
 * @returns {string}
 */
export const fmtMultiple = n => {
    const num = Number(n) || 0;
    if (num < 10) return num.toFixed(1) + '×';
    return Math.floor(num).toLocaleString() + '×';
};

// ===== MODEL KEY PARSING =====
/**
 * @param {string} key
 * @returns {{provider: string, model: string}}
 */
export const splitModelKey = (key) => {
    const str = String(key || '');
    const idx = str.indexOf('/');
    if (idx === -1) return { provider: '', model: str };
    return { provider: str.slice(0, idx), model: str.slice(idx + 1) };
};

/**
 * @param {string} key
 * @returns {string}
 */
export const displayModel = (key) => {
    const { provider, model } = splitModelKey(key);
    return provider ? `${provider}/${model}` : model;
};

/**
 * @param {string} key
 * @returns {{
 *   routingProvider: string|null,
 *   vendor: string,
 *   modelId: string,
 *   canonical: string,
 *   originalKey: string,
 *   provider: string,
 *   model: string
 * }}
 */
export const parseModelKey = (key) => {
    const routers = new Set(['openrouter', 'openpipe']);
    const { provider, model } = splitModelKey(key);
    let routingProvider = null;
    let vendor;
    let modelId;
    let canonical;

    if (routers.has(provider)) {
        routingProvider = provider;
        const secondIdx = model.indexOf('/');
        if (secondIdx !== -1) {
            vendor = model.slice(0, secondIdx);
            modelId = model.slice(secondIdx + 1);
            canonical = model;
        } else {
            vendor = '';
            modelId = model;
            canonical = model;
        }
    } else if (!provider) {
        vendor = '';
        modelId = model;
        canonical = model;
    } else {
        vendor = provider;
        modelId = model;
        canonical = `${provider}/${model}`;
        if (!model) {
            vendor = '';
            modelId = '';
            canonical = provider;
        }
    }

    return {
        routingProvider,
        vendor,
        modelId,
        canonical,
        originalKey: key,
        provider,
        model
    };
};

// ===== PRICING HELPERS (centralized) =====
/**
 * @param {string} name
 * @param {Record<string, {input: number, output: number}>|null|undefined} pricing_by_model
 * @returns {{input: number, output: number}|null}
 */
export const getPricingForModel = (name, pricing_by_model) => {
    if (pricing_by_model && pricing_by_model[name]) return pricing_by_model[name];
    return null;
};

/**
 * @param {{input?: number, output?: number}|null} pricing
 * @returns {string}
 */
export const formatModelPrice = (pricing) => {
    if (!pricing) return 'Price unavailable';
    const input = pricing.input || 0;
    const output = pricing.output || 0;
    return `${input.toFixed(2)} in / ${output.toFixed(2)} out`;
};

/**
 * @param {string} text
 * @returns {string}
 */
export const escapeHtml = (text) => {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// ===== SPARKLINE (unified DRY) =====
/**
 * @param {number[]} data
 * @param {number} [width=100]
 * @param {number} [height=30]
 * @param {{gradient?: boolean}} [opts]
 * @returns {string}
 */
export const createSparkline = (data, width = 100, height = 30, opts = { gradient: true }) => {
    if (!data || data.length < 2) return '';
    const max = Math.max(...data, 1);
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - (v / max) * height * 0.8 - height * 0.1;
        return `${x},${y}`;
    }).join(' ');

    if (opts && opts.gradient) {
        const gradientId = 'spark' + Math.random().toString(36).slice(2, 7);
        return `<svg width="${width}" height="${height}" class="sparkline"><defs><linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:var(--mono-accent);stop-opacity:0.3"/><stop offset="100%" style="stop-color:var(--mono-accent);stop-opacity:0"/></linearGradient></defs><polygon points="0,${height} ${points} ${width},${height}" fill="url(#${gradientId})"/><polyline points="${points}" fill="none" stroke="var(--mono-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    return `<svg width="${width}" height="${height}" style="opacity:0.7"><polyline points="${points}" fill="none" stroke="var(--mono-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};

// ===== NOTIFICATIONS =====
/**
 * @param {string} msg
 * @param {string} [type='info']
 */
export const notify = (msg, type = 'info') => {
    const container = document.getElementById('notifications');
    if (!container) return;
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = msg;
    container.appendChild(notif);
    setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
};

// ===== DOM HELPERS =====
/**
 * @param {HTMLElement|null} el
 * @param {string} text
 */
export const setText = (el, text) => {
    if (el) el.textContent = text;
};

/**
 * @param {HTMLElement|null} el
 */
export const hide = (el) => {
    if (el) el.style.display = 'none';
};

/**
 * @param {HTMLElement|null} el
 * @param {string} [display='block']
 */
export const show = (el, display = 'block') => {
    if (el) el.style.display = display;
};

// ===== PLOTLY HELPERS =====
export const getPlotlyLayout = (extra = {}) => {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const bg = isDark ? '#141414' : '#ffffff';
    const gridColor = isDark ? '#1e1e1e' : '#e5e5e5';
    const textColor = isDark ? '#737373' : '#525252';
    const lineColor = isDark ? '#2a2a2a' : '#d4d4d4';
    
    return {
        paper_bgcolor: bg,
        plot_bgcolor: bg,
        font: { family: 'IBM Plex Mono, monospace', size: 11, color: textColor },
        margin: { t: 10, r: 10, b: 40, l: 50 },
        xaxis: {
            gridcolor: gridColor,
            linecolor: lineColor,
            zerolinecolor: lineColor,
            tickfont: { size: 10 },
        },
        yaxis: {
            gridcolor: gridColor,
            linecolor: lineColor,
            zerolinecolor: lineColor,
            tickfont: { size: 10 },
        },
        hovermode: 'x unified',
        showlegend: false,
        ...extra
    };
};

export const getPlotlyConfig = () => ({
    displayModeBar: false,
    responsive: true
});

// ===== PLOTLY RESIZE =====
const LIVE_PLOT_CONTAINER_IDS = [
    'dashboard-live-chart',
    'timeline-chart-container',
    'calendar-container',
    'distribution-chart-container'
];

export const resizeVisiblePlots = () => {
    const P = /** @type {any} */ (globalThis).Plotly;
    if (!P || !P.Plots) return;
    LIVE_PLOT_CONTAINER_IDS.forEach((id) => {
        const el = /** @type {HTMLElement & {data: unknown}} */ (document.getElementById(id));
        if (el && el.data) P.Plots.resize(el);
    });
};

// ===== NOTIFICATION POSITIONING =====
export const positionNotifications = () => {
    const header = document.querySelector('.dashboard-header');
    const container = document.getElementById('notifications');
    if (!header || !container) return;

    const bottom = header.getBoundingClientRect().bottom;
    container.style.top = `${Math.round(bottom) + 12}px`;
    container.style.bottom = '';
};

// ===== CACHE / WIDGET HELPERS (shared across dataviz widgets) =====

/**
 * Cache-hit rate as a percentage (0-100), the convention established
 * at insights.js:371 and reused by cache-slider, live-event-feed,
 * league-table, and weekly-report. Returns 0 when no cacheable volume.
 *
 * cacheWrite (Anthropic's cache_creation_input_tokens) must be included in
 * the denominator: it's genuinely fresh, non-cached-read volume billed at
 * full input price, reported separately from input_tokens. Omitting it
 * makes Anthropic usage read as ~100% cache hit rate, since Anthropic's
 * input_tokens only counts the handful of tokens that are neither cached
 * nor newly written to cache.
 * @param {number|null|undefined} input
 * @param {number|null|undefined} cacheRead
 * @param {number|null|undefined} [cacheWrite]
 * @returns {number}
 */
export function cacheHitRatePct(input, cacheRead, cacheWrite) {
    const inTokens = Number(input) || 0;
    const readTokens = Number(cacheRead) || 0;
    const writeTokens = Number(cacheWrite) || 0;
    const total = inTokens + readTokens + writeTokens;
    return total > 0 ? (readTokens / total) * 100 : 0;
}

/**
 * Strict numeric-rate contract shared across dataviz pricing decisions.
 * True only for a JavaScript number that is finite; numeric `0` is a valid
 * rate, while `null`, strings (even "0"), `NaN`, and infinities are not.
 * @param {*} value
 * @returns {boolean}
 */
export function isFiniteNumericRate(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Resolve a single pricing field into a usable rate under the strict contract.
 * Returns a finite numeric field (including an explicit zero). Returns null
 * when the field is missing/invalid, or when an explicit `has<Field>` presence
 * flag says the rate is absent for a nonzero token count. A zero-token
 * dimension never requires a published rate.
 * @param {any|null|undefined} pricing
 * @param {string} field
 * @param {number} [tokenCount]
 * @returns {number|null}
 */
export function getUsablePricingRate(pricing, field, tokenCount = 0) {
    if (!pricing || typeof pricing !== 'object') return null;

    const value = pricing[field];
    if (!isFiniteNumericRate(value)) return null;

    const flagField = `has${field.charAt(0).toUpperCase()}${field.slice(1)}`;
    const presence = pricing[flagField];
    if (presence === false && tokenCount !== 0) return null;

    return value;
}

/**
 * "Skip a model with unusable pricing rather than fabricate a number" —
 * the cache-savings convention shared by cache-slider and live-event-feed.
 * @param {any|null|undefined} pricing
 * @returns {boolean}
 */
export function hasUsableCacheReadPricing(pricing) {
    return getUsablePricingRate(pricing, 'input') !== null
        && getUsablePricingRate(pricing, 'cacheRead') !== null;
}

/**
 * Build-once gate for panels that render on every renderDashboard()/
 * tab-switch but should only construct their DOM the first time. Stores
 * the built flag on container.dataset[flagKey]. Returns true if the
 * build was performed this call.
 * @param {HTMLElement} container
 * @param {string} flagKey
 * @param {(container: HTMLElement) => void} build
 * @returns {boolean}
 */
export function ensureWidgetBuilt(container, flagKey, build) {
    if (container.dataset[flagKey] === 'true') return false;
    build(container);
    container.dataset[flagKey] = 'true';
    return true;
}

// ===== STATISTICS =====
/**
 * Mean and population stddev of a numeric series. Mirrors the formula
 * in computeSeriesStats() (dashboard/js/views/analytics/tabs/spikes.js:52-61)
 * — same n=0 guard, same sum/n mean, same sum-of-squares/n variance, same
 * Math.sqrt. The brief's preferred shape was to import computeSeriesStats
 * directly, but that creates an import cycle (utils → spikes → shared →
 * config → utils) that breaks config.js's formatModelPrice re-export at
 * module-init time, so the formula is inlined here instead. Behavior is
 * identical to computeSeriesStats(values.map(v => ({ total: v }))).mean
 * / .std for the same input shape.
 * @param {number[]} values
 * @returns {{mean: number, stddev: number}}
 */
export const meanStddev = (values) => {
    const arr = (values || []).filter((v) => typeof v === 'number');
    const n = arr.length;
    if (n === 0) return { mean: 0, stddev: 0 };
    const mean = arr.reduce((s, v) => s + v, 0) / n;
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return { mean, stddev: Math.sqrt(variance) };
};

// ===== MARKDOWN HELPERS =====
/**
 * Convert markdown bold to HTML <b> for the taskferry-generated report body.
 * The raw text is treated as untrusted (it originates from a model output)
 * and is HTML-escaped BEFORE the bold-markdown replacement, so only the
 * "star-star" pairs survive as markup. Mirrors the order of operations in
 * renderLLMInsights (dashboard/js/views/analytics/tabs/insights.js):
 * escapeHtml first, then the bold-markdown replace on the escaped string.
 * Callers can safely assign the result via innerHTML.
 * @param {string} text
 * @returns {string}
 */
export function formatMarkdownBoldToHtml(text) {
    return escapeHtml(String(text ?? '')).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
