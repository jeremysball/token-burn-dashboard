import { MAX_HISTORY_POINTS } from './config.js';
import { setIsStale, setEventSource, currentData, setCurrentData, saveCache, getDataSignature, setLastDataSignature, lastDataSignature, historyData, setHistoryData, weeklyData, setWeeklyData, setFileHistoricalData, eventSource } from './state.js';
import { notify } from './utils.js';

// ===== API =====
const API_BASE = '/api';

/**
 * @typedef {Object} TokenData
 * @property {number} total_tokens
 * @property {number} total_input
 * @property {number} total_output
 * @property {number} total_cache_read
 * @property {number} total_cache_write
 * @property {Object<string, {total: number}>} tokens_by_model
 * @property {Object<string, *>} costs_by_model
 * @property {Object<string, *>} pricing_by_model
 * @property {{total: number}} total_cost
 * @property {number} files_processed
 * @property {number} total_lines
 */

export const fetchTokens = async () => {
    const res = await fetch(`${API_BASE}/tokens`);
    if (!res.ok) throw new Error('Failed to fetch tokens');
    const data = await res.json();
    return data;
};

export const fetchHistorical = async () => {
    const res = await fetch(`${API_BASE}/tokens/historical`);
    if (!res.ok) throw new Error('Failed to fetch historical');
    const data = await res.json();
    return data;
};

/**
 * @param {*} h
 * @returns {*}
 */
const toChartItem = (h) => ({
    time: h.time,
    total: h.total || 0,
    total_input: h.input || 0,
    total_output: h.output || 0,
    total_cache_read: h.cache_read || 0,
    models: h.tokens_by_model || {}
});

export const refreshData = async () => {
    let tokens;

    try {
        tokens = await fetchTokens();
        updateData(tokens);
    } catch (err) {
        notify('Refresh failed: ' + (err instanceof Error ? err.message : String(err)), 'error');
        return;
    }

    try {
        const historical = await fetchHistorical();

        // Use historical data for chart if available
        if (historical && historical.length > 0) {
            setFileHistoricalData(historical);
            // Convert to historyData format for live chart
            const chartData = historical.map(toChartItem);
            setHistoryData(chartData);
            saveCache(tokens);

            if (typeof window !== 'undefined' && /** @type {any} */ (window).renderAll) {
                /** @type {any} */ (window).renderAll();
            }
        }
    } catch (err) {
        console.warn('Historical refresh failed:', err instanceof Error ? err.message : String(err));
    }
};

/**
 * @param {*} data
 */
export const updateData = (data) => {
    const safeData = {
        ...data,
        total_tokens: data?.total_tokens || 0,
        total_input: data?.total_input || 0,
        total_output: data?.total_output || 0,
        total_cache_read: data?.total_cache_read || 0,
        total_cache_write: data?.total_cache_write || 0,
        tokens_by_model: data?.tokens_by_model || {},
        costs_by_model: data?.costs_by_model || {},
        pricing_by_model: data?.pricing_by_model || {},
        total_cost: data?.total_cost || { total: 0 },
        files_processed: data?.files_processed || 0,
        total_lines: data?.total_lines || 0
    };

    const now = Date.now();
    
    const newSignature = getDataSignature(safeData);
    const hasChanged = newSignature !== lastDataSignature;
    setLastDataSignature(newSignature);
    
    // Generate delta if we have previous data
    const prev = /** @type {TokenData|null} */ (currentData);
    if (prev) {
        const dTotal = Math.max(0, safeData.total_tokens - prev.total_tokens);
        const dInput = Math.max(0, safeData.total_input - prev.total_input);
        const dOutput = Math.max(0, safeData.total_output - prev.total_output);
        const dCache = Math.max(0, safeData.total_cache_read - prev.total_cache_read);
        
        /** @type {Record<string, number>} */
        const dModels = {};
        Object.entries(safeData.tokens_by_model).forEach(([k, v]) => {
            const prevTotal = prev.tokens_by_model?.[k] ? prev.tokens_by_model[k].total : 0;
            const diff = Math.max(0, v.total - prevTotal);
            if (diff > 0) dModels[k] = diff;
        });
        
        if (dTotal > 0 || hasChanged) {
            const historyPoint = {
                time: now,
                total: dTotal,
                total_input: dInput,
                total_output: dOutput,
                total_cache_read: dCache,
                models: dModels
            };
            
            const newHistory = [...historyData, historyPoint];
            if (newHistory.length > MAX_HISTORY_POINTS) {
                setHistoryData(newHistory.slice(-MAX_HISTORY_POINTS));
            } else {
                setHistoryData(newHistory);
            }
        }
    } else if (historyData.length === 0) {
        setHistoryData([{
            time: now,
            total: 0,
            total_input: 0,
            total_output: 0,
            total_cache_read: 0,
            models: {}
        }]);
    }
    
    // Update weekly data
    const dayKey = new Date().toISOString().split('T')[0];
    const existingDay = weeklyData.find(d => d.day === dayKey);
    
    if (existingDay) {
        if (safeData.total_tokens > existingDay.tokens) {
            existingDay.tokens = safeData.total_tokens;
            existingDay.models = safeData.tokens_by_model;
        }
    } else {
        weeklyData.push({
            day: dayKey,
            tokens: safeData.total_tokens,
            models: safeData.tokens_by_model
        });
        if (weeklyData.length > 7) {
            setWeeklyData(weeklyData.slice(-7));
        }
    }
    
    setCurrentData(safeData);
    saveCache(safeData);
    
    // Trigger render
    if (typeof window !== 'undefined' && /** @type {any} */ (window).renderAll) {
        /** @type {any} */ (window).renderAll();
    }
};

// ===== SSE =====
export const connectSSE = () => {
    const prevEs = /** @type {EventSource|null} */ (eventSource);
    if (prevEs) prevEs.close();
    
    const es = new EventSource(`${API_BASE}/tokens/stream`);
    
    es.onmessage = (e) => {
        try {
            setIsStale(false);
            const data = JSON.parse(e.data);
            updateData(data);
        } catch {}
    };
    
    es.onerror = () => {
        setIsStale(true);
        setTimeout(() => connectSSE(), 5000);
    };
    
    setEventSource(es);
};

export const disconnectSSE = () => {
    const prevEs = /** @type {EventSource|null} */ (eventSource);
    if (prevEs) {
        prevEs.close();
        setEventSource(null);
    }
};
