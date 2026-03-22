import { CACHE_KEY, HISTORY_KEY, WEEKLY_KEY, CACHE_VERSION, VERSION_KEY } from './config.js';

// ===== STATE =====
export let currentData = null;
export let historyData = [];
export let weeklyData = [];
export let fileHistoricalData = [];
export let sortCol = 'tokens';
export let sortAsc = false;
export let searchTerm = '';
export let eventSource = null;
export let isStale = false;
export let selectedModel = null;
export let analyticsRange = '24h';
export let analyticsTab = 'summary';
export let currentView = 'overview';
export let overviewDetailType = null;
export let lastDataSignature = null;

// Plotly chart data stores
export let _historyTimelineData = [];
export let _historyBarsData = [];
export let _modelTrendsData = [];
export let _modelTrendsModels = [];

export const _setHistoryTimelineData = (d) => { _historyTimelineData = d; };
export const _setHistoryBarsData = (d) => { _historyBarsData = d; };
export const _setModelTrendsData = (d) => { _modelTrendsData = d; };
export const _setModelTrendsModels = (d) => { _modelTrendsModels = d; };

// ===== SETTERS =====
export const setCurrentData = (data) => { currentData = data; };
export const setHistoryData = (data) => { historyData = data; };
export const setWeeklyData = (data) => { weeklyData = data; };
export const setFileHistoricalData = (data) => { fileHistoricalData = data; };
export const setSortCol = (col) => { sortCol = col; };
export const setSortAsc = (asc) => { sortAsc = asc; };
export const setSearchTerm = (term) => { searchTerm = term; };
export const setEventSource = (es) => { eventSource = es; };
export const setIsStale = (stale) => { isStale = stale; };
export const setSelectedModel = (model) => { selectedModel = model; };
export const setAnalyticsRange = (range) => { analyticsRange = range; };
export const setAnalyticsTab = (tab) => { analyticsTab = tab; };
export const setCurrentView = (view) => { currentView = view; };
export const setOverviewDetailType = (type) => { overviewDetailType = type; };
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
        typeof jest === 'undefined'
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
