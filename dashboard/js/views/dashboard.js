import { CHART_COLORS, getEmoji } from '../config.js';
import { fmtNum, createSparkline } from '../utils.js';
import { currentData, historyData, fileHistoricalData } from '../state.js';

// ===== FLASHY DASHBOARD =====

let liveChart = null;

export const renderDashboard = (fullRender = true) => {
    if (!currentData) return;

    // Initialize chart if we have data now (even if fullRender is false)
    const chartData = historyData.length >= 2 ? historyData.slice(-30) : [];
    const shouldInitChart = chartData.length >= 2 && !liveChart;

    const { total_tokens, total_cost, tokens_by_model, files_processed, total_lines } = currentData;

    // Update hero stats with animation
    const heroTokens = document.getElementById('hero-tokens');
    if (heroTokens) {
        const currentTokens = parseInt(heroTokens.dataset.value || '0');
        if (currentTokens !== total_tokens) {
            heroTokens.dataset.value = total_tokens;
            window.animateNumber(heroTokens, currentTokens, total_tokens, 800, '', '');
        }
    }

    const heroCost = document.getElementById('hero-cost');
    if (heroCost) {
        const cost = total_cost?.total || 0;
        const currentCost = parseFloat(heroCost.dataset.value || '0');
        if (Math.abs(currentCost - cost) > 0.01) {
            heroCost.dataset.value = cost;
            window.animateNumber(heroCost, currentCost, cost, 800, '$', '');
        }
    }
    
    // Check for milestones
    if (window.checkThresholds && total_cost?.total) {
        window.checkThresholds(total_tokens, total_cost.total);
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

const updateBurnRateGauge = () => {
    const burnRateEl = document.getElementById('burn-rate');
    const burnRateBar = document.getElementById('burn-rate-bar');
    const burnRateBadge = document.getElementById('burn-rate-badge');
    
    if (!burnRateEl) return;
    
    const { rate, level } = calculateBurnRate();
    
    // Update text
    burnRateEl.textContent = `${fmtNum(rate)}/min`;
    
    // Update bar width (max at 2000 tokens/min for full bar)
    if (burnRateBar) {
        const percentage = Math.min((rate / 2000) * 100, 100);
        burnRateBar.style.width = `${percentage}%`;
        burnRateBar.className = `burn-rate-bar ${level}`;
    }
    
    // Update badge color
    if (burnRateBadge) {
        burnRateBadge.className = `burn-rate-badge ${level}`;
    }
};

const renderTopModels = (tokens_by_model, fullRender = true) => {
    const container = document.getElementById('top-models-grid');
    if (!container) return;

    const models = Object.entries(tokens_by_model)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 4);

    // On full render or if count changed, rebuild everything
    const existingCards = container.querySelectorAll('.top-model-card');
    if (fullRender || existingCards.length !== models.length) {
        container.innerHTML = models.map(([name, stats], i) => createTopModelCard(name, stats, i)).join('');
        return;
    }

    // Otherwise, update values in place
    models.forEach(([name, stats], i) => {
        const card = existingCards[i];
        if (!card) return;
        
        const valueEl = card.querySelector('.top-model-value');
        const sparkEl = card.querySelector('.top-model-spark');
        
        if (valueEl && valueEl.textContent !== fmtNum(stats.total)) {
            valueEl.textContent = fmtNum(stats.total);
            valueEl.classList.add('value-updated');
            setTimeout(() => valueEl.classList.remove('value-updated'), 300);
        }
        
        if (sparkEl) {
            const sparkData = historyData.slice(-15).map(h => (h.models && h.models[name]) || 0);
            sparkEl.innerHTML = createSparkline(sparkData, 120, 30);
        }
    });
};

const createTopModelCard = (name, stats, i) => {
    const sparkData = historyData.slice(-15).map(h => (h.models && h.models[name]) || 0);
    const color = CHART_COLORS[i % CHART_COLORS.length];

    return `
        <div class="top-model-card" style="--card-color: ${color}">
            <div class="top-model-header">
                <span class="top-model-emoji">${getEmoji(name)}</span>
                <span class="top-model-name">${name.split('/').pop()}</span>
            </div>
            <div class="top-model-value" style="color: ${color}">
                ${fmtNum(stats.total)}
            </div>
            <div class="top-model-spark">
                ${createSparkline(sparkData, 120, 30)}
            </div>
        </div>
    `;
};

const generateInsights = (fullRender = true) => {
    const container = document.getElementById('insights-grid');
    if (!container || !currentData) return;

    const insights = [];
    const { tokens_by_model, total_tokens, total_cost } = currentData;
    const models = Object.entries(tokens_by_model);

    // Top model insight
    if (models.length > 0) {
        const top = models.sort((a, b) => b[1].total - a[1].total)[0];
        const pct = ((top[1].total / total_tokens) * 100).toFixed(1);
        insights.push({
            icon: '🏆',
            title: 'Top Model',
            value: `${top[0].split('/').pop()}`,
            detail: `${pct}% of total usage`
        });
    }

    // Cache efficiency
    const cacheRate = currentData.total_cache_read / (currentData.total_input + currentData.total_cache_read || 1);
    insights.push({
        icon: cacheRate > 0.5 ? '⚡' : '💾',
        title: 'Cache Efficiency',
        value: `${(cacheRate * 100).toFixed(1)}%`,
        detail: cacheRate > 0.5 ? 'Great cache hit rate!' : 'Consider more caching'
    });

    // Cost insight
    const cost = total_cost?.total || 0;
    if (cost > 0) {
        insights.push({
            icon: '💰',
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
            icon: '📈',
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

const createInsightCard = (insight) => `
    <div class="insight-card">
        <div class="insight-icon">${insight.icon}</div>
        <div class="insight-content">
            <div class="insight-title">${insight.title}</div>
            <div class="insight-value">${insight.value}</div>
            <div class="insight-detail">${insight.detail}</div>
        </div>
    </div>
`;

const initLiveChart = () => {
    const container = document.getElementById('dashboard-live-chart');
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
