import { CHART_COLORS, getEmoji, getPricingForModel } from '../config.js';
import { fmtNum, fmtCur, createSparkline, splitModelKey, displayModel, escapeHtml, parseModelKey, notify } from '../utils.js';
import { currentData, historyData, fileHistoricalData } from '../state.js';

/**
 * @typedef {{
 *   total_tokens: number,
 *   total_cost?: {total?: number},
 *   total_cache_read: number,
 *   total_input: number,
 *   pricing_by_model?: Record<string, {input?: number, output?: number, cacheRead?: number, cacheWrite?: number, source?: string}>,
 *   tokens_by_model: Record<string, {total: number}>,
 *   files_processed?: number,
 *   total_lines?: number
 * }} DashboardData
 */

// Looked up live on globalThis at call time (not cached at module load), since
// these are attached by other scripts after this module is first imported.
/** @param {string} name @returns {any} */
const getGlobal = (name) => /** @type {any} */ (globalThis)[name];

// ===== FLASHY DASHBOARD =====

/** @type {string|null} */
let liveChart = null;

export const renderDashboard = (fullRender = true) => {
    if (!currentData) return;

    // Initialize chart if we have data now (even if fullRender is false)
    const chartData = historyData.length >= 2 ? historyData.slice(-30) : [];
    const shouldInitChart = chartData.length >= 2 && !liveChart;

    const cd = /** @type {DashboardData} */ (currentData);
    const { total_tokens, total_cost, tokens_by_model, files_processed, total_lines } = cd;

    // Update hero stats with animation
    const heroTokens = document.getElementById('hero-tokens');
    if (heroTokens) {
        const currentTokens = parseInt(heroTokens.dataset.value || '0');
        if (currentTokens !== total_tokens) {
            heroTokens.dataset.value = String(total_tokens);
            getGlobal('animateNumber')(heroTokens, currentTokens, total_tokens, 800, '', '');
        }
    }

    const heroCost = document.getElementById('hero-cost');
    if (heroCost) {
        const cost = total_cost?.total || 0;
        const currentCost = parseFloat(heroCost.dataset.value || '0');
        if (Math.abs(currentCost - cost) > 0.01) {
            heroCost.dataset.value = String(cost);
            getGlobal('animateNumber')(heroCost, currentCost, cost, 800, '$', '');
        }
    }

    // Check for milestones
    const checkThresholds = getGlobal('checkThresholds');
    if (checkThresholds && total_cost?.total) {
        checkThresholds(total_tokens, total_cost.total);
    }

    // Update timestamp and footer
    const lastUpdate = document.getElementById('last-update');
    if (lastUpdate) lastUpdate.textContent = new Date().toLocaleTimeString();

    const footerStats = document.getElementById('footer-stats');
    if (footerStats) {
        const files = files_processed || 0;
        const lines = total_lines || 0;
        footerStats.textContent = `${files} files · ${fmtNum(lines)} lines`;
    }

    // Update hero sparklines (always refresh)
    updateHeroSparklines();

    // Update burn rate gauge
    updateBurnRateGauge();

    // Render top models (update in place unless full render)
    renderTopModels(tokens_by_model, fullRender);

    // Generate insights (update in place unless full render)
    generateInsights(fullRender);

    // Initialize/update live chart
    if (fullRender || shouldInitChart) {
        initLiveChart();
    }
};

const updateHeroSparklines = () => {
    // Token spark
    const tokenSpark = document.getElementById('hero-spark-tokens');
    if (tokenSpark && historyData.length > 1) {
        const data = historyData.slice(-20).map(h => h.total || 0);
        tokenSpark.innerHTML = createSparkline(data, 200, 40);
    }

    // Cost spark
    const costSpark = document.getElementById('hero-spark-cost');
    if (costSpark && historyData.length > 1) {
        const data = historyData.slice(-20).map(h => {
            // Rough cost estimate from tokens
            return (h.total || 0) * 0.000002;
        });
        costSpark.innerHTML = createSparkline(data, 200, 40);
    }
};

// ===== BURN RATE CALCULATION =====
const calculateBurnRate = () => {
    if (historyData.length < 2) return { rate: 0, level: 'low' };
    
    // Get last 5 data points for recent burn rate
    const recent = historyData.slice(-5);
    const totalTokens = recent.reduce((sum, h) => sum + (h.total || 0), 0);
    
    // Calculate time span in minutes
    const firstTime = recent[0].time;
    const lastTime = recent[recent.length - 1].time;
    const timeSpanMinutes = (lastTime - firstTime) / (1000 * 60);
    
    if (timeSpanMinutes < 0.1) return { rate: 0, level: 'low' };
    
    // Calculate tokens per minute
    const rate = Math.round(totalTokens / timeSpanMinutes);
    
    // Determine level for styling
    let level = 'low';
    if (rate > 1000) level = 'high';
    else if (rate > 100) level = 'medium';
    
    return { rate, level };
};

// ===== BURN RATE HEATMAP =====
const calculateBurnRateHistory = () => {
    if (historyData.length < 2) return [];
    
    const rates = [];
    for (let i = 1; i < historyData.length; i++) {
        const prev = historyData[i - 1];
        const curr = historyData[i];
        const tokens = curr.total || 0;
        const timeDiffMinutes = (curr.time - prev.time) / (1000 * 60);
        if (timeDiffMinutes > 0) {
            rates.push(Math.round(tokens / timeDiffMinutes));
        }
    }
    return rates;
};

/**
 * @param {number} rate
 * @param {number} maxRate
 */
const getHeatmapColor = (rate, maxRate) => {
    if (maxRate === 0) return 'var(--mono-border)';
    const intensity = rate / maxRate;
    
    // Color scale: low (green) -> medium (yellow) -> high (red)
    if (intensity < 0.33) {
        // Green scale
        const green = Math.round(100 + (intensity * 3) * 100);
        return `rgba(34, ${green}, 94, ${0.4 + intensity * 0.6})`;
    } else if (intensity < 0.66) {
        // Yellow scale
        return `rgba(251, 191, 36, ${0.5 + intensity * 0.5})`;
    } else {
        // Red scale
        return `rgba(239, 68, 68, ${0.5 + intensity * 0.5})`;
    }
};

const renderBurnRateHeatmap = () => {
    const container = document.getElementById('burn-rate-heatmap');
    if (!container) return;
    
    const rates = calculateBurnRateHistory();
    if (rates.length === 0) {
        container.innerHTML = '<div class="heatmap-empty">Collecting data...</div>';
        return;
    }
    
    // Show last 12 data points
    const recentRates = rates.slice(-12);
    const maxRate = Math.max(...recentRates, 1);
    
    const heatmapHTML = recentRates.map((rate) => {
        const color = getHeatmapColor(rate, maxRate);
        const height = Math.max((rate / maxRate) * 100, 15);
        const tooltip = `${fmtNum(rate)}/min`;
        return `<button type="button" class="heatmap-cell" style="background: ${color}; height: ${height}%" title="${tooltip}" aria-label="${fmtNum(rate)} tokens per minute" data-rate="${rate}"></button>`;
    }).join('');
    
    container.innerHTML = heatmapHTML;
    container.querySelectorAll('.heatmap-cell').forEach(cell => {
        const heatCell = /** @type {HTMLElement} */ (cell);
        heatCell.addEventListener('click', () => notify(`${fmtNum(Number(heatCell.dataset.rate))} tokens/min`, 'info'));
    });
};

const updateBurnRateGauge = () => {
    const burnRateEl = document.getElementById('burn-rate');
    const burnRateBadge = document.getElementById('burn-rate-badge');
    
    if (!burnRateEl) return;
    
    const { rate, level } = calculateBurnRate();
    
    // Update text
    burnRateEl.textContent = `${fmtNum(rate)}/min`;
    
    // Update badge color
    if (burnRateBadge) {
        burnRateBadge.className = `burn-rate-badge ${level}`;
    }
    
    // Update heatmap
    renderBurnRateHeatmap();
};

/**
 * @param {Record<string, {total: number}>} tokens_by_model
 * @param {boolean} [fullRender]
 */
const renderTopModels = (tokens_by_model, fullRender = true) => {
    const container = document.getElementById('top-models-grid');
    if (!container) return;

    const models = Object.entries(tokens_by_model)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 4);

    // On full render or if count changed, rebuild everything
    const existingCards = container.querySelectorAll('.top-model-card');
    const cardKeysMatch = models.every(([name], i) => /** @type {HTMLElement} */ (existingCards[i])?.dataset.modelKey === name);
    if (fullRender || existingCards.length !== models.length || !cardKeysMatch) {
        container.innerHTML = models.map(([name, stats], i) => createTopModelCard(name, stats, i)).join('');
        return;
    }

    // Otherwise, update values in place
    models.forEach(([name, stats], i) => {
        const card = existingCards[i];
        if (!card) return;
        
        const valueEl = /** @type {HTMLElement|null} */ (card.querySelector('.top-model-value'));
        const priceEl = /** @type {HTMLElement|null} */ (card.querySelector('.top-model-price'));
        const sourceEl = /** @type {HTMLElement|null} */ (card.querySelector('.pricing-source-badge'));
        const providerEl = /** @type {HTMLElement|null} */ (card.querySelector('.provider-badge'));
        const sparkEl = /** @type {HTMLElement|null} */ (card.querySelector('.top-model-spark'));
        const modelNameEl = /** @type {HTMLElement|null} */ (card.querySelector('.top-model-name'));
        const pricing = getPricingForModel(name, /** @type {DashboardData} */ (currentData)?.pricing_by_model);
        const priceSummary = `${fmtCur(pricing.input || 0)} in / ${fmtCur(pricing.output || 0)} out`;
        const priceDetails = `${priceSummary} · cache ${fmtCur(pricing.cacheRead || 0)} read / ${fmtCur(pricing.cacheWrite || 0)} write · ${pricing.source === 'openrouter' ? 'OpenRouter' : 'local fallback'}`;
        const sourceLabel = pricing.source === 'openrouter' ? 'OpenRouter' : 'Local';
        const sourceTitle = pricing.source === 'openrouter'
            ? 'Pricing sourced from OpenRouter'
            : 'Using local fallback pricing';
        const sourceClass = pricing.source === 'openrouter' ? 'openrouter' : 'local';
        const { model } = splitModelKey(name);
        const parsed = parseModelKey(name);
        const providerLabel = parsed.routingProvider ? (parsed.vendor || parsed.routingProvider) : parsed.provider;

        if (valueEl && valueEl.textContent !== fmtNum(stats.total)) {
            valueEl.textContent = fmtNum(stats.total);
            valueEl.classList.add('value-updated');
            setTimeout(() => valueEl.classList.remove('value-updated'), 300);
        }
        
        if (priceEl) {
            if (priceEl.textContent.trim() !== priceSummary) {
                priceEl.textContent = priceSummary;
            }
            priceEl.title = priceDetails;
        }

        if (sourceEl) {
            if (sourceEl.textContent !== sourceLabel || !sourceEl.classList.contains(sourceClass)) {
                sourceEl.textContent = sourceLabel;
                sourceEl.className = `pricing-source-badge ${sourceClass}`;
            }
            sourceEl.title = sourceTitle;
        }

        if (providerEl && providerEl.textContent !== providerLabel) {
            providerEl.textContent = providerLabel;
        }

        if (modelNameEl) {
            const display = model;
            if (modelNameEl.textContent !== model) {
                modelNameEl.textContent = display;
                modelNameEl.title = displayModel(name);
            }
        }
        
        if (sparkEl) {
            const sparkData = historyData.slice(-15).map(h => (h.models && h.models[name]) || 0);
            sparkEl.innerHTML = createSparkline(sparkData, 120, 30, { gradient: true });
        }
    });
};

/**
 * @param {string} name
 * @param {{total: number}} stats
 * @param {number} i
 */
const createTopModelCard = (name, stats, i) => {
    const sparkData = historyData.slice(-15).map(h => (h.models && h.models[name]) || 0);
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const pricing = getPricingForModel(name, /** @type {DashboardData} */ (currentData)?.pricing_by_model);
    const priceSummary = `${fmtCur(pricing.input || 0)} in / ${fmtCur(pricing.output || 0)} out`;
    const priceDetails = `${priceSummary} · cache ${fmtCur(pricing.cacheRead || 0)} read / ${fmtCur(pricing.cacheWrite || 0)} write · ${pricing.source === 'openrouter' ? 'OpenRouter' : 'local fallback'}`;
    const sourceLabel = pricing.source === 'openrouter' ? 'OpenRouter' : 'Local';
    const sourceClass = pricing.source === 'openrouter' ? 'openrouter' : 'local';
    const sourceTitle = pricing.source === 'openrouter'
        ? 'Pricing sourced from OpenRouter'
        : 'Using local fallback pricing';
    const { model } = splitModelKey(name);
    const parsed = parseModelKey(name);
    const providerLabel = parsed.routingProvider ? (parsed.vendor || parsed.routingProvider) : parsed.provider;
    const providerTitle = parsed.routingProvider
        ? `Provider: ${escapeHtml(providerLabel)} · Routed via: ${escapeHtml(parsed.routingProvider)}`
        : `Provider: ${escapeHtml(providerLabel)}`;
    const providerBadge = providerLabel
        ? `<span class="provider-badge" title="${providerTitle}">${escapeHtml(providerLabel)}</span>`
        : '';
    const modelDisplay = escapeHtml(model);
    const fullTitle = escapeHtml(displayModel(name));

    return `
        <div class="top-model-card" data-model-key="${escapeHtml(name)}" style="--card-color: ${color}">
            <div class="top-model-header">
                <span class="top-model-emoji">${getEmoji(name)}</span>
                <span class="top-model-name" title="${fullTitle}">${modelDisplay}</span>
                ${providerBadge}
                <span class="pricing-source-badge ${sourceClass}" title="${sourceTitle}">${sourceLabel}</span>
            </div>
            <div class="top-model-price" title="${priceDetails}" style="font-size: 0.72rem; color: var(--mono-text-muted); margin-top: 2px;">
                ${priceSummary}
            </div>
            <div class="top-model-value" style="color: ${color}">
                ${fmtNum(stats.total)}
            </div>
            <div class="top-model-spark">
                ${createSparkline(sparkData, 120, 30, { gradient: true })}
            </div>
        </div>
    `;
};

const generateInsights = (fullRender = true) => {
    const container = document.getElementById('insights-grid');
    if (!container || !currentData) return;

    const cd = /** @type {DashboardData} */ (currentData);
    const { tokens_by_model, total_tokens, total_cost } = cd;
    const models = Object.entries(tokens_by_model);
    const insights = [];

    // Top model insight
    if (models.length > 0) {
        const top = models.sort((a, b) => b[1].total - a[1].total)[0];
        const pct = ((top[1].total / total_tokens) * 100).toFixed(1);
        insights.push({
            icon: '#',
            title: 'Top Model',
            value: `${top[0].split('/').pop()}`,
            detail: `${pct}% of total usage`
        });
    }

    // Cache efficiency
    const cacheRate = cd.total_cache_read / (cd.total_input + cd.total_cache_read || 1);
    insights.push({
        icon: cacheRate > 0.5 ? '▲' : '▽',
        title: 'Cache Efficiency',
        value: `${(cacheRate * 100).toFixed(1)}%`,
        detail: cacheRate > 0.5 ? 'Great cache hit rate!' : 'Consider more caching'
    });

    // Cost insight
    const cost = total_cost?.total || 0;
    if (cost > 0) {
        insights.push({
            icon: '$',
            title: 'Lifetime Cost',
            value: `$${cost.toFixed(2)}`,
            detail: `${(cost / (total_tokens / 1e6)).toFixed(2)} per 1M tokens`
        });
    }

    // Velocity insight
    if (historyData.length >= 2) {
        const recent = historyData.slice(-5);
        const avg = recent.reduce((s, h) => s + (h.total || 0), 0) / recent.length;
        insights.push({
            icon: 'Δ',
            title: 'Current Velocity',
            value: `${fmtNum(avg)}/hr`,
            detail: 'Average over last 5 data points'
        });
    }

    // On full render, rebuild everything
    const existingCards = container.querySelectorAll('.insight-card');
    if (fullRender || existingCards.length !== insights.length) {
        container.innerHTML = insights.map(insight => createInsightCard(insight)).join('');
        return;
    }

    // Otherwise update values in place
    insights.forEach((insight, i) => {
        const card = existingCards[i];
        if (!card) return;

        const valueEl = card.querySelector('.insight-value');
        const detailEl = card.querySelector('.insight-detail');

        if (valueEl && valueEl.textContent !== insight.value) {
            valueEl.textContent = insight.value;
            valueEl.classList.add('value-updated');
            setTimeout(() => valueEl.classList.remove('value-updated'), 300);
        }

        if (detailEl && detailEl.textContent !== insight.detail) {
            detailEl.textContent = insight.detail;
        }
    });
};

/**
 * @param {{icon: string, title: string, value: string, detail: string}} insight
 */
const createInsightCard = (insight) => `
    <div class="insight-card">
        <div class="insight-icon">${escapeHtml(insight.icon)}</div>
        <div class="insight-content">
            <div class="insight-title">${escapeHtml(insight.title)}</div>
            <div class="insight-value">${escapeHtml(insight.value)}</div>
            <div class="insight-detail">${escapeHtml(insight.detail)}</div>
        </div>
    </div>
`;

const initLiveChart = () => {
    const container = document.getElementById('dashboard-live-chart');
    const Plotly = getGlobal('Plotly');
    if (!container || typeof Plotly === 'undefined') {
        console.log('Live chart: container or Plotly not available');
        return;
    }

    // Get last 30 data points - use fileHistoricalData if historyData is empty
    let data = historyData.slice(-30);
    if (data.length < 2 && fileHistoricalData.length > 0) {
        data = fileHistoricalData.slice(-30).map(h => ({
            time: h.time,
            total: h.total || 0,
            total_input: h.input || 0,
            total_output: h.output || 0,
            total_cache_read: h.cache_read || 0,
            models: h.tokens_by_model || {}
        }));
    }
    
    // Clear container first
    container.innerHTML = '';
    
    if (data.length < 2) {
        container.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; color: var(--mono-text-muted);">Collecting data...</div>';
        return;
    }

    const traces = [{
        x: data.map(d => new Date(d.time)),
        y: data.map(d => d.total || 0),
        type: 'scatter',
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: CHART_COLORS[0], width: 2 },
        fillcolor: 'rgba(251, 191, 36, 0.1)'
    }];

    Plotly.newPlot('dashboard-live-chart', traces, chartLayout, { displayModeBar: false, responsive: true });

    liveChart = 'dashboard-live-chart';
};

const chartLayout = {
    margin: { t: 10, r: 10, b: 30, l: 50 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: 'JetBrains Mono, monospace', size: 10, color: '#737373' },
    xaxis: { 
        showgrid: false, 
        tickfont: { size: 10, color: '#737373' }
    },
    yaxis: { 
        showgrid: true, 
        gridcolor: 'rgba(115,115,115,0.2)', 
        tickfont: { size: 10, color: '#737373' },
        title: { text: 'Tokens/hr', font: { size: 10, color: '#737373' } }
    }
};

export const updateDashboardCharts = () => {
    const Plotly = getGlobal('Plotly');
    if (!liveChart || typeof Plotly === 'undefined') return;

    const data = historyData.slice(-30);
    if (data.length < 2) return;

    Plotly.react('dashboard-live-chart', [{
        x: data.map(d => new Date(d.time)),
        y: data.map(d => d.total || 0),
        type: 'scatter',
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: CHART_COLORS[0], width: 2 },
        fillcolor: 'rgba(251, 191, 36, 0.1)'
    }], chartLayout, { displayModeBar: false, responsive: true });
};
