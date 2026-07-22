import { CACHE_KEY, HISTORY_KEY, WEEKLY_KEY, CACHE_VERSION, VERSION_KEY } from './config.js';

// ===== STATE =====
/** @type {Record<string, *>|null} */
export let currentData = null;
/** @type {any[]} */
export let historyData = [];
/** @type {any[]} */
export let weeklyData = [];
/** @type {any[]} */
export let fileHistoricalData = [];
export let sortCol = 'tokens';
export let sortAsc = false;
export let searchTerm = '';
export let eventSource = null;
export let isStale = false;
/** @type {string|null} */
export let selectedModel = null;
export let analyticsRange = '24h';
export let analyticsTab = 'summary';
export let currentView = 'overview';
/** @type {string|null} */
export let overviewDetailType = null;
/** @type {string|null} */
export let lastDataSignature = null;

// Plotly chart data stores
/** @type {any[]} */
export let _historyTimelineData = [];
/** @type {any[]} */
export let _historyBarsData = [];
/** @type {any[]} */
export let _modelTrendsData = [];
/** @type {any[]} */
export let _modelTrendsModels = [];

/** @param {any[]} d */
export const _setHistoryTimelineData = (d) => { _historyTimelineData = d; };
/** @param {any[]} d */
export const _setHistoryBarsData = (d) => { _historyBarsData = d; };
/** @param {any[]} d */
export const _setModelTrendsData = (d) => { _modelTrendsData = d; };
/** @param {any[]} d */
export const _setModelTrendsModels = (d) => { _modelTrendsModels = d; };

// ===== SETTERS =====
/** @param {Record<string, *>|null} data */
export const setCurrentData = (data) => { currentData = data; };
/** @param {any[]} data */
export const setHistoryData = (data) => { historyData = data; };
/** @param {any[]} data */
export const setWeeklyData = (data) => { weeklyData = data; };
/** @param {any[]} data */
export const setFileHistoricalData = (data) => { fileHistoricalData = data; };
/** @param {string} col */
export const setSortCol = (col) => { sortCol = col; };
/** @param {boolean} asc */
export const setSortAsc = (asc) => { sortAsc = asc; };
/** @param {string} term */
export const setSearchTerm = (term) => { searchTerm = term; };
/** @param {*} es */
export const setEventSource = (es) => { eventSource = es; };
/** @param {boolean} stale */
export const setIsStale = (stale) => { isStale = stale; };
/** @param {string|null} model */
export const setSelectedModel = (model) => { selectedModel = model; };
/** @param {string} range */
export const setAnalyticsRange = (range) => { analyticsRange = range; };
/** @param {string} tab */
export const setAnalyticsTab = (tab) => { analyticsTab = tab; };
/** @param {string} view */
export const setCurrentView = (view) => { currentView = view; };
/** @param {string|null} type */
export const setOverviewDetailType = (type) => { overviewDetailType = type; };
/** @param {string|null} sig */
export const setLastDataSignature = (sig) => { lastDataSignature = sig; };

// ===== CACHE =====
export const loadCache = () => {
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        const version = localStorage.getItem(VERSION_KEY);
        if (version !== CACHE_VERSION) {
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(HISTORY_KEY);
            localStorage.removeItem(WEEKLY_KEY);
            localStorage.setItem(VERSION_KEY, CACHE_VERSION);
            return null;
        }
        return cached ? JSON.parse(cached) : null;
    } catch {
        return null;
    }
};

/** @param {Record<string, *>|null} data */
export const saveCache = (data) => {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(historyData));
        localStorage.setItem(WEEKLY_KEY, JSON.stringify(weeklyData));
    } catch {}
};

export const clearCache = () => {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(WEEKLY_KEY);
    historyData = [];
    weeklyData = [];

    if (
        typeof window !== 'undefined' &&
        window.location &&
        typeof window.location.reload === 'function' &&
        typeof /** @type {*} */ (globalThis).jest === 'undefined'
    ) {
        try {
            window.location.reload();
        } catch {
            // Ignore environments where reload is not implemented.
        }
    }
};

export const loadHistoryFromCache = () => {
    try {
        const h = localStorage.getItem(HISTORY_KEY);
        if (h) historyData = JSON.parse(h);
        const w = localStorage.getItem(WEEKLY_KEY);
        if (w) weeklyData = JSON.parse(w);
    } catch {}
};

// ===== DATA HELPERS =====
/** @param {Record<string, *>|null} data */
export const getDataSignature = (data) => {
    const tokensByModel = data?.tokens_by_model || {};
    return `${data?.total_tokens || 0}|${data?.total_input || 0}|${data?.total_output || 0}|${Object.keys(tokensByModel).join(',')}`;
};

export const getDataForGranularity = () => {
    if (!currentData) return { tokens_by_model: {}, total_tokens: 0 };
    return {
        tokens_by_model: currentData.tokens_by_model || {},
        total_tokens: currentData.total_tokens || 0
    };
};
