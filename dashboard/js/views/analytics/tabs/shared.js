import { CHART_COLORS, getPricing } from '../../../config.js';
import { fmtNum, fmtInt, fmtCur, fmtMultiple, getPlotlyLayout, notify, splitModelKey, displayModel } from '../../../utils.js';
import { currentData, historyData, fileHistoricalData, analyticsRange, searchTerm, sortCol, sortAsc } from '../../../state.js';

const isCompactViewport = () => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false);

const bindPlotlyClick = (container, handler) => {
    if (!container || typeof container.on !== 'function') return;
    if (typeof container.removeAllListeners === 'function') {
        container.removeAllListeners('plotly_click');
    }
    container.on('plotly_click', handler);
};

const notifyHeatmapCell = (message, type = 'info') => {
    notify(message, type);
};

const bindHeatmapInteractions = (container) => {
    if (!container || container.dataset.boundHeatmap === 'true') return;
    container.dataset.boundHeatmap = 'true';

    const onActivate = (event) => {
        const cell = event.target.closest('[data-heatmap-cell="true"]');
        if (!cell || !container.contains(cell)) return;
        const label = cell.dataset.label || 'Value';
        const value = cell.dataset.value || '0';
        const suffix = cell.dataset.suffix || '';
        const detail = cell.dataset.detail || '';
        const suffixText = suffix ? ` ${suffix}` : '';
        notifyHeatmapCell(`${label}: ${value}${suffixText}${detail ? ` • ${detail}` : ''}`.trim(), cell.dataset.type || 'info');
    };

    container.addEventListener('click', onActivate);
    container.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const cell = event.target.closest('[data-heatmap-cell="true"]');
        if (cell) {
            event.preventDefault();
            cell.click();
        }
    });
};

const getPricingForModel = (name) => {
    return currentData?.pricing_by_model?.[name] || getPricing(name);
};

const formatModelPrice = (pricing) => {
    if (!pricing) return 'Price unavailable';

    const input = fmtCur(pricing.input || 0);
    const output = fmtCur(pricing.output || 0);

    return `${input} in / ${output} out`;
};

const formatModelPriceDetails = (pricing) => {
    if (!pricing) return 'Price unavailable';

    const input = fmtCur(pricing.input || 0);
    const output = fmtCur(pricing.output || 0);
    const cacheRead = fmtCur(pricing.cacheRead || 0);
    const cacheWrite = fmtCur(pricing.cacheWrite || 0);

    return `${input} in / ${output} out · cache ${cacheRead} read / ${cacheWrite} write`;
};

const getPricingSourceMeta = (pricing) => {
    const source = pricing?.source === 'openrouter' ? 'openrouter' : 'local';
    return {
        source,
        label: source === 'openrouter' ? 'OpenRouter' : 'Local',
        title: source === 'openrouter' ? 'Pricing sourced from OpenRouter' : 'Using local fallback pricing'
    };
};

/**
 * Derive the cache discount ratio (cacheRead / input) from model pricing.
 * A valid numeric cacheRead of 0 yields a 0 ratio. The 0.1 fallback is used
 * only when pricing is missing or not a valid number.
 */
export const cacheDiscountRatioFromPricing = (pricing) => {
    const hasPricing = typeof pricing?.cacheRead === 'number' && !isNaN(pricing.cacheRead)
        && typeof pricing?.input === 'number' && !isNaN(pricing.input);
    if (!hasPricing) return 0.1;
    return pricing.input > 0 ? pricing.cacheRead / pricing.input : 0;
};

const getCutoffTime = () => {
    const now = Date.now();
    const ranges = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000,
        'all': Infinity
    };
    return now - (ranges[analyticsRange] || ranges['24h']);
};

const createSparkline = (data, width, height) => {
    if (!data || data.length < 2) return '';
    const max = Math.max(...data, 1);
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - (v / max) * height * 0.8 - height * 0.1;
        return `${x},${y}`;
    }).join(' ');

    return `
        <svg width="${width}" height="${height}" style="opacity: 0.7">
            <polyline points="${points}" fill="none" stroke="var(--mono-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;
};

const escapeHtml = (text) => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

// Shared mutable state for cross-tab coordination. Declared once here so the
// git-blame tab and the insights tab read/write the same cache without
// duplicating state across modules.
let gitBlameCache = null;
let gitBlameCwd = '';
let spikesCache = null;

export const getGitBlameCache = () => gitBlameCache;
export const setGitBlameCache = (v) => { gitBlameCache = v; };
export const getGitBlameCwd = () => gitBlameCwd;
export const setGitBlameCwd = (v) => { gitBlameCwd = v; };
export const getSpikesCache = () => spikesCache;
export const setSpikesCache = (v) => { spikesCache = v; };

export {
    CHART_COLORS,
    fmtNum,
    fmtInt,
    fmtCur,
    fmtMultiple,
    getPlotlyLayout,
    notify,
    splitModelKey,
    displayModel,
    currentData,
    historyData,
    fileHistoricalData,
    analyticsRange,
    searchTerm,
    sortCol,
    sortAsc,
    isCompactViewport,
    bindPlotlyClick,
    notifyHeatmapCell,
    bindHeatmapInteractions,
    getPricingForModel,
    getPricing,
    formatModelPrice,
    formatModelPriceDetails,
    getPricingSourceMeta,
    getCutoffTime,
    createSparkline,
    escapeHtml
};
