import { CHART_COLORS, getPricing } from '../config.js';
import { fmtNum, fmtInt, fmtCur, getPlotlyLayout, notify } from '../utils.js';
import { currentData, historyData, fileHistoricalData, analyticsRange, setAnalyticsRange, setAnalyticsTab, sortCol, sortAsc, setSortCol, setSortAsc, searchTerm, setSearchTerm } from '../state.js';

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

// ===== ANALYTICS VIEW WITH TABS =====

export const renderAnalytics = () => {
    if (!currentData) return;

    const tab = document.querySelector('.subnav-btn.active')?.dataset.tab || 'models';

    switch (tab) {
        case 'models':
            renderModelsTab();
            break;
        case 'compare':
            renderCompareTab();
            break;
        case 'timeline':
            renderTimelineTab();
            break;
        case 'calendar':
            renderCalendarTab();
            break;
        case 'distribution':
            renderDistributionTab();
            break;
        case 'insights':
            renderDeepInsightsTab();
            break;
        case 'scale':
            renderScaleTab();
            break;
        case 'code':
            renderCodeStatsTab();
            break;
        case 'heatmaps':
            renderHeatmapsTab();
            break;
        case 'git':
            renderGitBlameTab();
            break;
        case 'spikes':
            renderSpikeDetectiveTab();
            break;
    }
};

// ===== MODELS TAB =====
const renderModelsTab = () => {
    const tbody = document.getElementById('models-tbody');
    if (!tbody) return;

    const { tokens_by_model, costs_by_model } = currentData;

    let models = Object.entries(tokens_by_model);

    // Filter
    if (searchTerm) {
        const term = searchTerm.toLowerCase();
        models = models.filter(([name]) => name.toLowerCase().includes(term));
    }

    // Sort
    models.sort((a, b) => {
        let va, vb;
        switch (sortCol) {
            case 'name': va = a[0]; vb = b[0]; break;
            case 'tokens': va = a[1].total; vb = b[1].total; break;
            case 'cost':
                va = costs_by_model?.[a[0]]?.total || 0;
                vb = costs_by_model?.[b[0]]?.total || 0;
                break;
            case 'cache': va = a[1].cache_read; vb = b[1].cache_read; break;
            default: va = a[1].total; vb = b[1].total;
        }
        return sortAsc ? va - vb : vb - va;
    });

    tbody.innerHTML = models.map(([name, stats], index) => {
        const cost = costs_by_model?.[name]?.total || 0;
        const color = CHART_COLORS[index % CHART_COLORS.length];
        const sparkData = historyData.slice(-20).map(h => (h.models?.[name]) || 0);
        const pricing = getPricingForModel(name);
        const priceSummary = formatModelPrice(pricing);
        const priceTitle = `${formatModelPriceDetails(pricing)} · ${pricing.source === 'openrouter' ? 'OpenRouter' : 'local fallback'}`;
        const sourceMeta = getPricingSourceMeta(pricing);

        return `
            <tr style="animation-delay: ${index * 0.05}s">
                <td>
                    <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color}; flex: 0 0 auto;"></span>
                        <div style="display: flex; flex-direction: column; min-width: 0;">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name.split('/').pop()}</span>
                            <div style="display: flex; align-items: center; gap: 6px; min-width: 0; margin-top: 2px;">
                                <span class="pricing-source-badge ${sourceMeta.source}" title="${sourceMeta.title}">${sourceMeta.label}</span>
                                <span class="model-price" title="${priceTitle}" style="font-size: 0.72rem; color: var(--mono-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${priceSummary}
                                </span>
                            </div>
                        </div>
                    </div>
                </td>
                <td>${createSparkline(sparkData, 80, 25)}</td>
                <td class="num">${fmtNum(stats.total)}</td>
                <td class="num">$${cost.toFixed(2)}</td>
                <td class="num">${fmtNum(stats.cache_read)}</td>
            </tr>
        `;
    }).join('');
};

// ===== COMPARE TAB =====
const renderCompareTab = () => {
    const container = document.getElementById('compare-chart-container');
    if (!container || typeof Plotly === 'undefined') return;

    const { tokens_by_model } = currentData;
    const models = Object.entries(tokens_by_model)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 8);

    // Clear any skeleton/loading content
    container.innerHTML = '';

    if (models.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--mono-text-muted);">No data available</div>';
        return;
    }

    const mobile = isCompactViewport();
    const maxTokens = Math.max(...models.map(m => m[1].total));
    const yLabels = models.map(m => m[0].split('/').pop());
    const data = [{
        type: 'bar',
        y: yLabels,
        x: models.map(m => m[1].total),
        orientation: 'h',
        marker: {
            color: models.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
            line: { color: 'rgba(255,255,255,0.1)', width: 1 }
        },
        text: models.map(m => fmtNum(m[1].total)),
        textposition: mobile ? 'inside' : 'outside',
        insidetextanchor: 'end',
        cliponaxis: false,
        textfont: { color: mobile ? '#ffffff' : undefined, size: mobile ? 10 : 11 }
    }];

    Plotly.newPlot('compare-chart-container', data, {
        ...getPlotlyLayout(),
        margin: mobile ? { t: 12, r: 28, b: 40, l: 112 } : { t: 20, r: 96, b: 40, l: 220 },
        xaxis: { 
            title: 'Tokens', 
            range: [0, maxTokens * (mobile ? 1.28 : 1.15)],
            fixedrange: true,
            automargin: true
        },
        yaxis: { 
            autorange: 'reversed',
            fixedrange: true,
            tickfont: { size: mobile ? 10 : 11 },
            automargin: true
        },
        bargap: 0.3,
        dragmode: false
    }, { 
        displayModeBar: false,
        staticPlot: true
    });
};

// ===== TIMELINE TAB =====
const renderTimelineTab = () => {
    const container = document.getElementById('timeline-chart-container');
    if (!container || typeof Plotly === 'undefined') return;

    const cutoff = getCutoffTime();
    const sourceData = fileHistoricalData.length > 0 ? fileHistoricalData : historyData;
    const filtered = sourceData.filter(h => h.time > cutoff);

    // If 1h range has insufficient data, show message suggesting wider range
    if (filtered.length < 2) {
        const rangeLabels = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days', 'all': 'all time' };
        const currentRange = rangeLabels[analyticsRange] || analyticsRange;
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 40px; color: var(--mono-text-muted);">
                <div style="font-size: 2rem; margin-bottom: 16px;">📊</div>
                <div style="margin-bottom: 8px;">Not enough data for the last <strong>${currentRange}</strong></div>
                <div style="font-size: 0.85rem; opacity: 0.7;">Try selecting a wider time range above</div>
            </div>`;
        return;
    }

    const mobile = isCompactViewport();
    const traces = [{
        x: filtered.map(d => new Date(d.time)),
        y: filtered.map(d => d.total || 0),
        type: 'scatter',
        mode: 'lines',
        fill: 'tozeroy',
        line: { color: CHART_COLORS[0], width: 2 },
        fillcolor: 'rgba(251, 191, 36, 0.1)',
        name: 'Tokens/hour'
    }];

    Plotly.newPlot('timeline-chart-container', traces, {
        ...getPlotlyLayout(),
        margin: mobile ? { t: 16, r: 16, b: 40, l: 52 } : { t: 20, r: 20, b: 40, l: 60 },
        yaxis: { title: 'Tokens', automargin: true }
    }, { displayModeBar: false });
};

// ===== CALENDAR TAB (Horizontal Bar Chart) =====
const renderCalendarTab = () => {
    const container = document.getElementById('calendar-container');
    if (!container || typeof Plotly === 'undefined') return;

    // Use ALL available data
    const sourceData = fileHistoricalData.length > 0 ? fileHistoricalData : historyData;

    // Group by day
    const byDay = {};
    sourceData.forEach(d => {
        const day = new Date(d.time).toISOString().split('T')[0];
        if (!byDay[day]) byDay[day] = 0;
        byDay[day] += d.total || 0;
    });

    const days = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));

    if (days.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--mono-text-muted);">No data available</div>';
        return;
    }

    const labels = days.map(([day]) => {
        const d = new Date(day);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const values = days.map(([, tokens]) => tokens);
    const maxVal = Math.max(...values);

    // Calculate bar widths based on value (normalized between 0.3 and 1.0)
    const widths = values.map(v => 0.3 + (v / maxVal) * 0.7);

    const mobile = isCompactViewport();
    const data = [{
        type: 'bar',
        y: labels,
        x: values,
        orientation: 'h',
        text: values.map(v => fmtNum(v)),
        textposition: mobile ? 'inside' : 'outside',
        insidetextanchor: 'end',
        cliponaxis: false,
        marker: {
            color: values.map((v) => {
                const intensity = v / maxVal;
                return `rgba(251, 191, 36, ${0.4 + intensity * 0.6})`;
            }),
            line: {
                color: 'rgba(251, 191, 36, 0.8)',
                width: 1
            }
        },
        // Use width to vary bar thickness
        width: widths,
        hovertemplate: '<b>%{y}</b><br>%{x:,.0f} tokens<extra></extra>'
    }];

    const layout = {
        ...getPlotlyLayout(),
        margin: mobile ? { t: 16, r: 24, b: 40, l: 56 } : { t: 20, r: 96, b: 40, l: 70 },
        xaxis: {
            title: 'Tokens',
            showgrid: true,
            gridcolor: 'rgba(115,115,115,0.2)',
            fixedrange: true,
            automargin: true
        },
        yaxis: {
            automargin: true,
            tickfont: { size: mobile ? 10 : 11 },
            fixedrange: true
        },
        bargap: 0.15,
        dragmode: false
    };

    Plotly.newPlot('calendar-container', data, layout, { 
        displayModeBar: false, 
        responsive: true,
        staticPlot: false  // Keep clicks enabled for the click handler
    });

    // Bind one click handler so repeated renders don't stack notifications.
    const chartEl = document.getElementById('calendar-container');
    bindPlotlyClick(chartEl, (event) => {
        const dayIndex = event.points[0].pointNumber;
        const [fullDate, tokens] = days[dayIndex];
        const date = new Date(fullDate);
        const formattedDate = date.toLocaleDateString('en-US', { 
            weekday: 'short', 
            month: 'short', 
            day: 'numeric' 
        });

        notify(`${formattedDate}: ${fmtNum(tokens)} tokens`, 'info');
    });
};

// ===== DEEP INSIGHTS TAB =====
let insightsCache = null;
let insightsCacheTime = 0;

const renderDeepInsightsTab = () => {
    const container = document.getElementById('deep-insights-container');
    if (!container) return;

    // Use cached insights if recent (5 minutes)
    if (insightsCache && Date.now() - insightsCacheTime < 5 * 60 * 1000) {
        renderInsightsCards(container, insightsCache);
        return;
    }

    generateDeepInsights();
};

const generateDeepInsights = () => {
    const container = document.getElementById('deep-insights-container');
    if (!container) return;

    container.innerHTML = `
        <div class="insights-loading" style="grid-column: 1 / -1;">
            <div class="loading-spinner"></div>
            <p>Analyzing patterns across your data...</p>
        </div>
    `;

    const insights = calculateDeepInsights();
    insightsCache = insights;
    insightsCacheTime = Date.now();

    renderInsightsCards(container, insights);
};

const calculateDeepInsights = () => {
    const { tokens_by_model, costs_by_model, total_tokens, total_cost, files_processed, total_lines } = currentData;
    const sourceData = fileHistoricalData.length > 0 ? fileHistoricalData : historyData;
    const models = Object.entries(tokens_by_model);

    const insights = [];

    // 1. Efficiency Leader
    const efficiency = models.map(([name, stats]) => {
        const cost = costs_by_model?.[name]?.total || 0;
        const tokens = stats.total || 1;
        return { name, efficiency: tokens / (cost || 1), costPer1M: (cost / tokens) * 1e6 };
    }).sort((a, b) => b.efficiency - a.efficiency);

    if (efficiency.length > 0) {
        const best = efficiency[0];
        const worst = efficiency[efficiency.length - 1];
        const savings = (worst.costPer1M - best.costPer1M) * (best.efficiency * (best.costPer1M / 1e6)) / 1e6;
        
        insights.push({
            icon: '⚡',
            title: 'Most Efficient Model',
            value: best.name.split('/').pop(),
            description: `Best tokens-per-dollar ratio at $${best.costPer1M.toFixed(2)} per 1M tokens`,
            detail: `Switching from ${worst.name.split('/').pop()} would save ~$${savings.toFixed(2)} per 1M tokens`,
            type: 'positive'
        });
    }

    // 2. Cache Efficiency - Calculate real savings from model pricing
    const totalCacheRead = currentData.total_cache_read || 0;
    const totalInput = currentData.total_input || 0;
    const cacheRate = totalCacheRead / (totalInput + totalCacheRead || 1);

    // Top model by cost drives the cache discount ratio
    const topModel = models.length > 0
        ? models.slice().sort((a, b) =>
            (costs_by_model?.[b[0]]?.total || 0) - (costs_by_model?.[a[0]]?.total || 0))[0][0]
        : null;
    const pricing = getPricingForModel(topModel) || { input: 3, output: 15, cacheRead: 0.3 };

    // Real cache discount ratio derived from model pricing (cacheRead/input)
    const cacheDiscountRatio = cacheDiscountRatioFromPricing(pricing);

    // Average input cost per token, falling back to a sensible default
    const avgInputCostPerToken = totalInput > 0 && total_cost?.input
        ? total_cost.input / totalInput
        : 0.000003;
    const avgCacheReadCostPerToken = cacheDiscountRatio * avgInputCostPerToken;

    const cacheSavings = totalCacheRead * avgCacheReadCostPerToken;

    insights.push({
        icon: cacheRate > 0.5 ? '💾' : '📦',
        title: 'Cache Efficiency',
        value: `${(cacheRate * 100).toFixed(1)}%`,
        description: cacheRate > 0.5
            ? `Excellent! You've saved $${cacheSavings.toFixed(2)} through caching`
            : `Low cache hit rate - missing $${(totalInput * (1 - cacheDiscountRatio) * avgInputCostPerToken).toFixed(2)} potential savings`,
        detail: `${fmtNum(totalCacheRead)} cached tokens at ${((1 - cacheDiscountRatio) * 100).toFixed(0)}% discount`,
        type: cacheRate > 0.5 ? 'positive' : 'warning'
    });

    // 3. Usage Velocity with Trend
    if (sourceData.length >= 2) {
        const recent = sourceData.slice(-6);
        const avgRecent = recent.reduce((s, d) => s + (d.total || 0), 0) / recent.length;
        const older = sourceData.slice(-18, -6);
        const avgOlder = older.length > 0 ? older.reduce((s, d) => s + (d.total || 0), 0) / older.length : avgRecent;
        const change = avgOlder > 0 ? ((avgRecent - avgOlder) / avgOlder) * 100 : 0;
        
        // Project monthly cost
        const hourlyTokens = avgRecent;
        const monthlyTokens = hourlyTokens * 24 * 30;
        const monthlyCost = (monthlyTokens / 1e6) * ((total_cost?.total || 0) / (total_tokens / 1e6 || 1));

        insights.push({
            icon: change >= 20 ? '🚀' : change >= 0 ? '📈' : change >= -20 ? '➡️' : '📉',
            title: 'Usage Trend',
            value: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
            description: change >= 20 
                ? `Rapid growth detected - usage up ${change.toFixed(0)}% over last 12hrs`
                : change >= 0 
                    ? `Steady growth at ${change.toFixed(0)}%`
                    : `Declining usage - ${change.toFixed(0)}% decrease`,
            detail: `On track for ${fmtNum(monthlyTokens)} tokens ($${monthlyCost.toFixed(0)}/mo)`,
            type: change >= 50 ? 'warning' : change >= 0 ? 'positive' : 'info'
        });
    }

    // 4. Cost Concentration Risk
    if (total_cost?.total && models.length > 0) {
        const sortedByCost = models
            .map(([name, stats]) => ({
                name,
                cost: costs_by_model?.[name]?.total || 0,
                tokens: stats.total
            }))
            .sort((a, b) => b.cost - a.cost);
        
        const topModelCost = sortedByCost[0].cost;
        const concentration = topModelCost / total_cost.total;
        
        insights.push({
            icon: concentration > 0.8 ? '⚠️' : concentration > 0.5 ? '🎯' : '🌈',
            title: 'Cost Concentration',
            value: `${(concentration * 100).toFixed(0)}%`,
            description: concentration > 0.8 
                ? `High risk: ${sortedByCost[0].name.split('/').pop()} dominates spending`
                : concentration > 0.5 
                    ? 'Moderate concentration - some diversification'
                    : 'Well diversified across models',
            detail: `${sortedByCost[0].name.split('/').pop()} cost $${topModelCost.toFixed(2)} of $${total_cost.total.toFixed(2)}`,
            type: concentration > 0.8 ? 'warning' : 'neutral'
        });
    }

    // 5. Token Productivity
    if (files_processed && total_lines) {
        const tokensPerFile = total_tokens / files_processed;
        const tokensPerLine = total_tokens / total_lines;
        
        insights.push({
            icon: tokensPerLine > 500 ? '🔧' : tokensPerLine > 100 ? '⚙️' : '📝',
            title: 'Token Productivity',
            value: `${fmtNum(tokensPerLine)}/line`,
            description: tokensPerLine > 500 
                ? 'Heavy refactoring work detected - high tokens per line'
                : tokensPerLine > 100 
                    ? 'Balanced code generation and analysis'
                    : 'Light touches - mostly small edits',
            detail: `${fmtNum(tokensPerFile)} tokens across ${files_processed} files`,
            type: 'info'
        });
    }

    // 6. Peak Usage Pattern with Heatmap suggestion
    if (sourceData.length > 0) {
        const hourBuckets = new Array(24).fill(0);
        sourceData.forEach(d => {
            const hour = new Date(d.time).getHours();
            hourBuckets[hour] += d.total || 0;
        });
        
        const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));
        const peakTokens = hourBuckets[peakHour];
        const totalBucketed = hourBuckets.reduce((a, b) => a + b, 0);
        const peakShare = peakTokens / totalBucketed;
        
        const timeLabel = peakHour >= 5 && peakHour < 12 ? 'morning ☀️' :
                         peakHour >= 12 && peakHour < 17 ? 'afternoon 🌤️' :
                         peakHour >= 17 && peakHour < 21 ? 'evening 🌅' : 'night 🌙';

        insights.push({
            icon: '🕐',
            title: 'Peak Hour',
            value: `${peakHour}:00`,
            description: `${(peakShare * 100).toFixed(0)}% of daily tokens used in the ${timeLabel}`,
            detail: `${fmtNum(peakTokens)} tokens at peak vs ${fmtNum(totalBucketed / 24)}/hr average`,
            type: peakShare > 0.25 ? 'warning' : 'info'
        });
    }

    // 7. Input/Output with actionable insight
    const inputRatio = currentData.total_input / (total_tokens || 1);
    const outputRatio = currentData.total_output / (total_tokens || 1);
    const ratio = inputRatio / outputRatio;

    insights.push({
        icon: inputRatio > 0.8 ? '📥' : outputRatio > 0.5 ? '📤' : '⚖️',
        title: 'I/O Pattern',
        value: `${ratio.toFixed(1)}:1`,
        description: inputRatio > 0.8
            ? `Input-heavy (${(inputRatio * 100).toFixed(0)}%) - analysis/classification work`
            : outputRatio > 0.5
                ? `Output-heavy (${(outputRatio * 100).toFixed(0)}%) - generation work`
                : 'Balanced conversational pattern',
        detail: inputRatio > 0.8
            ? 'Consider smaller models for classification tasks'
            : outputRatio > 0.5
                ? 'Monitor output length - consider setting max_tokens'
                : 'Good balance for conversational workloads',
        type: outputRatio > 0.6 ? 'warning' : 'neutral'
    });

    return insights;
};

const renderInsightsCards = (container, insights) => {
    container.innerHTML = insights.map((insight, i) => `
        <div class="insight-card--deep" style="animation-delay: ${i * 0.1}s">
            <div class="insight-card__header">
                <div class="insight-card__icon">${insight.icon}</div>
                <div>
                    <div class="insight-card__title">${insight.title}</div>
                    <div class="insight-card__value">${insight.value}</div>
                </div>
            </div>
            <div class="insight-card__description">${insight.description}</div>
            <div class="insight-card__detail">${insight.detail}</div>
        </div>
    `).join('');
};

const generateLLMInsights = async () => {
    const container = document.getElementById('llm-insights-content');
    const btn = document.querySelector('.llm-analyze-btn');
    const statusEl = document.getElementById('analysis-status');

    if (!container || !btn) return;

    btn.disabled = true;
    if (statusEl) {
        statusEl.textContent = 'Connecting...';
        statusEl.className = 'analysis-status';
    }
    container.innerHTML = `
        <div class="llm-loading">
            <div class="loading-spinner" style="width: 24px; height: 24px;"></div>
            <span>Connecting to AI analysis service...</span>
        </div>
    `;

    // Build summary for LLM
    const { tokens_by_model, costs_by_model, total_tokens, total_cost } = currentData;
    const models = Object.entries(tokens_by_model)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 5);

    const summary = {
        totalTokens: total_tokens,
        totalCost: total_cost?.total || 0,
        modelCount: Object.keys(tokens_by_model).length,
        topModels: models.map(([name, stats]) => ({
            name: name.split('/').pop(),
            tokens: stats.total,
            cost: costs_by_model?.[name]?.total || 0,
            cacheRate: stats.cache_read / (stats.input + stats.cache_read || 1)
        })),
        cacheRate: currentData.total_cache_read / (currentData.total_input + currentData.total_cache_read || 1),
        inputOutputRatio: currentData.total_input / (currentData.total_output || 1)
    };

    // Try to get insights from API - DO NOT silently fallback
    try {
        const response = await fetch('/api/insights/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(summary)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.source === 'kimi') {
            if (statusEl) {
                statusEl.textContent = '✓ Kimi K2.5';
                statusEl.className = 'analysis-status kimi';
            }
            renderLLMInsights(data.insights);
        } else if (data.source === 'local') {
            // Server fell back to local - show warning that AI wasn't available
            if (statusEl) {
                statusEl.textContent = '⚠ AI Unavailable';
                statusEl.className = 'analysis-status warning';
            }
            renderLLMInsights(data.insights, 'AI analysis service unavailable. Showing local analysis instead.');
        } else {
            renderLLMInsights(data.insights);
        }
    } catch (err) {
        // Show error - do NOT silently fallback
        if (statusEl) {
            statusEl.textContent = '✗ Failed';
            statusEl.className = 'analysis-status error';
        }
        container.innerHTML = `
            <div class="llm-error">
                <p><strong>AI Analysis Failed</strong></p>
                <p>${err.message || 'Unable to connect to analysis service'}</p>
                <p class="error-help">Check your KIMI_API_KEY configuration or try again later.</p>
                <button onclick="generateLLMInsights()" class="retry-btn">↻ Retry</button>
            </div>
        `;
    }

    btn.disabled = false;
};

const renderLLMInsights = (text, warningMessage = null) => {
    const container = document.getElementById('llm-insights-content');
    if (!container) return;

    const paragraphs = text.split('\n\n').filter(p => p.trim());
    container.innerHTML = `
        ${warningMessage ? `<div class="llm-warning">${warningMessage}</div>` : ''}
        <div class="llm-analysis-text">
            ${paragraphs.map(p => `<p>${p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`).join('')}
        </div>
    `;
};

// ===== DISTRIBUTION TAB =====
const renderDistributionTab = () => {
    const container = document.getElementById('distribution-chart-container');
    if (!container || typeof Plotly === 'undefined') return;

    const { tokens_by_model } = currentData;
    const models = Object.entries(tokens_by_model)
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10);

    if (models.length === 0) return;

    const mobile = isCompactViewport();
    const data = [{
        values: models.map(m => m[1].total),
        labels: models.map(m => m[0].split('/').pop()),
        type: 'pie',
        hole: 0.5,
        marker: { colors: CHART_COLORS },
        textinfo: 'label+percent',
        textposition: mobile ? 'inside' : 'outside',
        insidetextorientation: 'radial'
    }];

    Plotly.newPlot('distribution-chart-container', data, {
        ...getPlotlyLayout({ showlegend: false }),
        margin: mobile ? { t: 20, r: 16, b: 40, l: 16 } : { t: 40, r: 40, b: 80, l: 40 }
    }, { 
        displayModeBar: false,
        responsive: true
    });
};

// ===== HELPERS =====
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

// ===== HANDLERS =====
export const setAnalyticsTabHandler = (tab) => {
    setAnalyticsTab(tab);

    // Close any open overlays when switching tabs so they don't block navigation
    closeCommitDetails();
    closeInvestigation();

    // Update buttons
    document.querySelectorAll('.subnav-btn').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });

    // Show/hide content
    ['models', 'compare', 'timeline', 'calendar', 'distribution', 'insights', 'scale', 'code', 'heatmaps', 'git', 'spikes'].forEach(t => {
        const el = document.getElementById(`analytics-tab-${t}`);
        if (el) el.style.display = t === tab ? 'block' : 'none';
    });

    renderAnalytics(true);
};

export const setAnalyticsRangeHandler = (range) => {
    setAnalyticsRange(range);

    // Update buttons
    document.querySelectorAll('.range-selector button').forEach(el => {
        el.classList.toggle('active', el.textContent.toLowerCase() === range.toLowerCase());
    });

    renderAnalytics(true);
};

export const handleSearch = (val) => {
    setSearchTerm(val);
    renderAnalytics(true);
};

export const sortBy = (col) => {
    if (sortCol === col) {
        setSortAsc(!sortAsc);
    } else {
        setSortCol(col);
        setSortAsc(false);
    }
    renderAnalytics(true);
};

// Simple sparkline for tables
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

// ===== GIT BLAME TAB =====
let gitBlameCache = null;
let gitBlameCwd = '';

const renderGitBlameTab = () => {
    if (gitBlameCache) {
        renderGitBlameData(gitBlameCache);
        return;
    }
    loadGitBlame();
};

const loadGitBlame = async () => {
    const days = document.getElementById('git-days-selector')?.value || 30;
    const cwd = document.getElementById('git-directory-selector')?.value || '';
    gitBlameCwd = cwd;
    
    // Show loading state with skeleton
    document.getElementById('git-commits-list').innerHTML = `
        <div class="git-blame-loading">
            <div class="loading-spinner"></div>
            <p>Analyzing git history...</p>
        </div>
    `;
    document.getElementById('git-files-list').innerHTML = `
        <div class="git-blame-loading">
            <div class="loading-spinner"></div>
            <p>Loading project costs...</p>
        </div>
    `;
    
    try {
        const params = new URLSearchParams({ days });
        if (cwd) params.append('cwd', cwd);
        
        const response = await fetch(`/api/git/blame?${params}`);
        if (!response.ok) throw new Error('Failed to load');
        
        const data = await response.json();
        gitBlameCache = data;
        renderGitBlameData(data);
        
        // Update directory selector if directories are returned
        if (data.directories) {
            updateDirectorySelector(data.directories, cwd);
        }
    } catch (err) {
        document.getElementById('git-commits-list').innerHTML = `
            <div class="git-blame-empty">
                <div class="git-blame-empty-icon">⚠️</div>
                <h4>Unable to load git data</h4>
                <p>${err.message}</p>
            </div>
        `;
        document.getElementById('git-files-list').innerHTML = `
            <div class="git-blame-empty">
                <div class="git-blame-empty-icon">📁</div>
                <h4>No project data</h4>
                <p>Could not load project cost analysis</p>
            </div>
        `;
    }
};

const updateDirectorySelector = (directories, selectedCwd) => {
    const selector = document.getElementById('git-directory-selector');
    if (!selector || !directories) return;
    
    const currentValue = selector.value || selectedCwd || '';
    
    selector.innerHTML = directories.map(dir => {
        const icon = dir.isGitRepo ? '📁' : '📂';
        const selected = dir.path === currentValue ? 'selected' : '';
        return `<option value="${dir.path}" ${selected}>${icon} ${dir.name}</option>`;
    }).join('');
    
    // Restore selection if possible
    if (currentValue) {
        selector.value = currentValue;
    }
};

const renderGitBlameData = (data) => {
    // Summary stats
    const totalCommits = data.commits.length;
    const totalCost = data.commits.reduce((sum, c) => sum + c.cost, 0);
    const totalSessions = data.commits.reduce((sum, c) => sum + c.sessions, 0);
    
    document.getElementById('git-total-commits').textContent = fmtInt(totalCommits);
    document.getElementById('git-total-cost').textContent = `$${totalCost.toFixed(2)}`;
    document.getElementById('git-total-sessions').textContent = fmtInt(totalSessions);
    
    // Commits list - now with files
    const commitsList = document.getElementById('git-commits-list');
    commitsList.innerHTML = data.commits.slice(0, 10).map(commit => {
        const files = commit.files || [];
        const fileList = files.slice(0, 3).map(f => `<span class="commit-file">${escapeHtml(f.split('/').pop())}</span>`).join('');
        const moreFiles = files.length > 3 ? `<span class="commit-file-more">+${files.length - 3} more</span>` : '';
        
        return `
        <div class="git-commit-item" onclick="showCommitDetails('${commit.hash}')" style="cursor: pointer;">
            <div class="commit-main">
                <div class="commit-hash">${commit.hash}</div>
                <div class="commit-message">${escapeHtml(commit.message)}</div>
                <div class="commit-files">
                    ${fileList}${moreFiles}
                </div>
            </div>
            <div class="commit-stats">
                <span class="commit-stat cost">$${commit.cost.toFixed(2)}</span>
                <span class="commit-stat">${fmtInt(commit.tokens)} tokens</span>
                <span class="commit-stat">${fmtInt(commit.sessions)} session${commit.sessions !== 1 ? 's' : ''}</span>
            </div>
        </div>
    `}).join('');
    
    // Project list
    const projects = data.projects || data.files || [];
    const filesList = document.getElementById('git-files-list');
    filesList.innerHTML = projects.slice(0, 10).map(project => `
        <div class="git-file-item">
            <div class="file-name">${escapeHtml(project.project || project.file)}</div>
            <div class="file-cost">$${project.cost.toFixed(2)} across ${fmtInt(project.commits)} commits</div>
            ${project.files?.length ? `<div class="commit-click-hint">${project.files.map(f => escapeHtml(f.split('/').pop())).join(' · ')}</div>` : ''}
        </div>
    `).join('');
};

const showCommitDetails = async (commitHash) => {
    const modal = document.getElementById('commit-details-modal');
    const content = document.getElementById('commit-details-content');
    
    if (!modal || !content) return;
    
    modal.style.display = 'flex';
    content.innerHTML = `
        <div class="commit-details-loading">
            <div class="loading-spinner"></div>
            <p>Loading session details...</p>
        </div>
    `;
    
    try {
        const days = document.getElementById('git-days-selector')?.value || 30;
        const params = new URLSearchParams({ days, commit: commitHash });
        if (gitBlameCwd) params.append('cwd', gitBlameCwd);
        
        const response = await fetch(`/api/git/blame?${params}`);
        if (!response.ok) throw new Error('Failed to load commit details');
        
        const data = await response.json();
        renderCommitDetails(content, data);
    } catch (err) {
        content.innerHTML = `<div class="commit-details-error">Error: ${err.message}</div>`;
    }
};

const renderCommitDetails = (container, data) => {
    const { commit, sessions, summary } = data;
    
    container.innerHTML = `
        <div class="commit-details-header">
            <div class="commit-details-hash">${commit.hash}</div>
            <div class="commit-details-message">${escapeHtml(commit.message)}</div>
            <div class="commit-details-date">${new Date(commit.date).toLocaleString()}</div>
        </div>
        
        <div class="commit-details-summary">
            <div class="summary-item">
                <span class="summary-label">Sessions</span>
                <span class="summary-value">${summary.totalSessions}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Total Tokens</span>
                <span class="summary-value">${fmtNum(summary.totalTokens)}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Total Cost</span>
                <span class="summary-value">$${summary.totalCost.toFixed(2)}</span>
            </div>
        </div>
        
        <div class="commit-sessions-list">
            <h4>Sessions (${sessions.length})</h4>
            ${sessions.map((session, idx) => `
                <div class="session-card">
                    <div class="session-header" onclick="toggleSessionMessages(${idx})">
                        <span class="session-id">${session.id}</span>
                        <span class="session-cost">$${session.cost.toFixed(2)}</span>
                        <span class="session-tokens">${fmtNum(session.tokens)} tokens</span>
                        <span class="session-toggle">▼</span>
                    </div>
                    <div class="session-models">
                        ${Object.entries(session.models).map(([model, stats]) => `
                            <span class="session-model-tag" title="${model}: ${fmtNum(stats.tokens)} tokens, ${stats.calls} calls">
                                ${model.split('/').pop()}: $${stats.cost.toFixed(2)}
                            </span>
                        `).join('')}
                    </div>
                    <div class="session-messages" id="session-messages-${idx}" style="display: none;">
                        ${session.messages.slice(0, 5).map(msg => `
                            <div class="message-item">
                                <div class="message-meta">
                                    <span class="message-model">${msg.model.split('/').pop()}</span>
                                    <span class="message-cost">$${msg.cost.toFixed(3)}</span>
                                    <span class="message-tokens">${fmtNum(msg.tokens)} tokens</span>
                                </div>
                                <div class="message-preview">${escapeHtml(msg.preview)}</div>
                            </div>
                        `).join('')}
                        ${session.messages.length > 5 ? `<div class="message-more">+${session.messages.length - 5} more messages</div>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
};

const toggleSessionMessages = (idx) => {
    const messagesEl = document.getElementById(`session-messages-${idx}`);
    const toggleEl = messagesEl?.previousElementSibling?.previousElementSibling?.querySelector('.session-toggle');
    
    if (messagesEl) {
        const isVisible = messagesEl.style.display !== 'none';
        messagesEl.style.display = isVisible ? 'none' : 'block';
        if (toggleEl) {
            toggleEl.textContent = isVisible ? '▼' : '▲';
        }
    }
};

const closeCommitDetails = () => {
    const modal = document.getElementById('commit-details-modal');
    if (modal) modal.style.display = 'none';
};

// ===== SPIKE DETECTIVE TAB =====
let spikesCache = null;

const renderSpikeDetectiveTab = () => {
    if (spikesCache) {
        renderSpikesList(spikesCache);
        return;
    }
    loadSpikes();
};

const loadSpikes = async () => {
    const listEl = document.getElementById('spikes-list');
    listEl.innerHTML = '<div class="loading-placeholder">Analyzing for spikes...</div>';
    
    try {
        const response = await fetch('/api/spikes');
        if (!response.ok) throw new Error('Failed to load');
        
        const data = await response.json();
        spikesCache = data.spikes;
        renderSpikesList(spikesCache);
    } catch (err) {
        listEl.innerHTML = `<div class="loading-placeholder">Error: ${err.message}</div>`;
    }
};

const renderSpikesList = (spikes) => {
    const listEl = document.getElementById('spikes-list');
    
    if (spikes.length === 0) {
        listEl.innerHTML = '<div class="loading-placeholder">No significant spikes detected</div>';
        return;
    }
    
    listEl.innerHTML = spikes.map(spike => {
        const date = new Date(spike.time);
        const timeStr = date.toLocaleString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        return `
            <div class="spike-item" onclick="investigateSpike(${spike.time})">
                <div class="spike-indicator"></div>
                <div class="spike-info">
                    <div class="spike-time">${timeStr}</div>
                    <div class="spike-details-small">${fmtNum(spike.previousAvg)} → ${fmtNum(spike.tokens)} tokens</div>
                </div>
                <div class="spike-tokens">${fmtNum(spike.tokens)}</div>
                <div class="spike-ratio">${spike.ratio}x</div>
            </div>
        `;
    }).join('');
};

const investigateSpike = async (timestamp) => {
    const investigationEl = document.getElementById('spike-investigation');
    const detailsEl = document.getElementById('spike-details');
    const sessionsEl = document.getElementById('spike-sessions');
    
    investigationEl.style.display = 'block';
    detailsEl.innerHTML = '<div class="loading-placeholder">Investigating...</div>';
    sessionsEl.innerHTML = '';
    
    // Scroll to investigation
    investigationEl.scrollIntoView({ behavior: 'smooth' });
    
    try {
        const response = await fetch(`/api/spikes/investigate?timestamp=${timestamp}&window=30`);
        if (!response.ok) throw new Error('Failed to investigate');
        
        const data = await response.json();
        renderInvestigation(data);
    } catch (err) {
        detailsEl.innerHTML = `<div class="loading-placeholder">Error: ${err.message}</div>`;
    }
};

const renderInvestigation = (data) => {
    const detailsEl = document.getElementById('spike-details');
    const sessionsEl = document.getElementById('spike-sessions');
    
    detailsEl.innerHTML = `
        <div class="detail-item">
            <div class="detail-label">Total Sessions</div>
            <div class="detail-value">${data.summary.totalSessions}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Total Tokens</div>
            <div class="detail-value">${fmtNum(data.summary.totalTokens)}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Total Cost</div>
            <div class="detail-value">$${data.summary.totalCost.toFixed(2)}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Top Model</div>
            <div class="detail-value">${data.summary.topModel.split('/').pop()}</div>
        </div>
    `;
    
    sessionsEl.innerHTML = `
        <h5>Top Contributing Sessions</h5>
        ${data.sessions.map(session => `
            <div class="session-item">
                <div class="session-header">
                    <span class="session-id">${session.id}</span>
                    <span class="session-cost">$${session.cost.toFixed(2)}</span>
                </div>
                <div class="session-previews">
                    ${session.previews.map((preview, i) => `
                        <div class="session-preview-item">
                            <div class="preview-label">Message ${i + 1}</div>
                            <div>${escapeHtml(preview)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('')}
    `;
};

const closeInvestigation = () => {
    document.getElementById('spike-investigation').style.display = 'none';
};

// Utility
const escapeHtml = (text) => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
};

// ===== SCALE TAB =====
const SCALE_COMPARISONS = [
    { name: 'Tweet', tokens: 280, icon: '🐦', desc: 'A single tweet' },
    { name: 'Paragraph', tokens: 200, icon: '📄', desc: 'Average paragraph' },
    { name: 'Page', tokens: 500, icon: '📃', desc: 'Single typed page' },
    { name: 'Short Story', tokens: 7500, icon: '📖', desc: 'Short story (15 pages)' },
    { name: 'Novel Chapter', tokens: 25000, icon: '📚', desc: 'One book chapter' },
    { name: 'Novel', tokens: 100000, icon: '📕', desc: 'Full novel (200 pages)' },
    { name: 'Shakespeare Play', tokens: 300000, icon: '🎭', desc: 'Complete Shakespeare play' },
    { name: 'Bible', tokens: 4000000, icon: '✝️', desc: 'The entire Bible' },
    { name: 'Encyclopedia', tokens: 40000000, icon: '📚', desc: 'Full encyclopedia set' },
    { name: 'Codebase', tokens: 100000000, icon: '💻', desc: 'Large software codebase' }
];

const renderScaleTab = () => {
    const container = document.getElementById('scale-comparisons');
    if (!container || !currentData) return;

    const totalTokens = currentData.total_tokens || 0;

    // Find the largest comparison we exceed
    const exceeded = SCALE_COMPARISONS.filter(c => totalTokens >= c.tokens);
    const nextMilestone = SCALE_COMPARISONS.find(c => totalTokens < c.tokens);
    
    container.innerHTML = `
        <div class="scale-hero">
            <div class="scale-total">
                <span class="scale-number">${fmtInt(totalTokens)}</span>
                <span class="scale-label">total tokens</span>
            </div>
            <div class="scale-equivalent">
                ${exceeded.length > 0 ? `
                    <span class="scale-eq-label">Equivalent to</span>
                    <span class="scale-eq-value">${(totalTokens / exceeded[exceeded.length - 1].tokens).toFixed(1)} ${exceeded[exceeded.length - 1].name}s</span>
                ` : ''}
            </div>
        </div>
        <div class="scale-progress-section">
            ${nextMilestone ? `
                <div class="scale-next">
                    <span class="scale-next-label">Next milestone: ${nextMilestone.name}</span>
                    <div class="scale-progress-bar">
                        <div class="scale-progress-fill" style="width: ${Math.min((totalTokens / nextMilestone.tokens) * 100, 100)}%"></div>
                    </div>
                    <span class="scale-next-remaining">${fmtInt(nextMilestone.tokens - totalTokens)} tokens to go</span>
                </div>
            ` : '<div class="scale-achieved">🎉 All milestones achieved!</div>'}
        </div>
        <div class="scale-grid">
            ${SCALE_COMPARISONS.map(comp => {
                const achieved = totalTokens >= comp.tokens;
                const multiple = achieved ? (totalTokens / comp.tokens).toFixed(1) : null;
                return `
                    <div class="scale-card ${achieved ? 'achieved' : ''}">
                        <div class="scale-icon">${comp.icon}</div>
                        <div class="scale-name">${comp.name}</div>
                        <div class="scale-desc">${comp.desc}</div>
                        <div class="scale-tokens">${fmtInt(comp.tokens)} tokens</div>
                        ${achieved ? `<div class="scale-multiple">${multiple}×</div>` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
};

// ===== CODE STATS TAB =====
const CODE_STATS = {
    languages: [
        { ext: '.js', name: 'JavaScript', tokensPerLine: 8, color: '#f7df1e' },
        { ext: '.ts', name: 'TypeScript', tokensPerLine: 9, color: '#3178c6' },
        { ext: '.py', name: 'Python', tokensPerLine: 6, color: '#3776ab' },
        { ext: '.java', name: 'Java', tokensPerLine: 10, color: '#b07219' },
        { ext: '.cpp', name: 'C++', tokensPerLine: 11, color: '#f34b7d' },
        { ext: '.go', name: 'Go', tokensPerLine: 7, color: '#00add8' },
        { ext: '.rs', name: 'Rust', tokensPerLine: 8, color: '#dea584' },
        { ext: '.rb', name: 'Ruby', tokensPerLine: 6, color: '#701516' },
        { ext: '.php', name: 'PHP', tokensPerLine: 8, color: '#4f5d95' },
        { ext: '.swift', name: 'Swift', tokensPerLine: 9, color: '#ffac45' }
    ]
};

const renderCodeStatsTab = () => {
    const summaryContainer = document.getElementById('code-summary');
    const breakdownContainer = document.getElementById('code-breakdown');
    if (!summaryContainer || !breakdownContainer || !currentData) return;

    const totalTokens = currentData.total_tokens || 0;
    const totalLines = currentData.total_lines || 0;
    const filesProcessed = currentData.files_processed || 0;

    // Calculate equivalent lines in different languages
    const langStats = CODE_STATS.languages.map(lang => ({
        ...lang,
        equivalentLines: Math.round(totalTokens / lang.tokensPerLine)
    }));

    summaryContainer.innerHTML = `
        <div class="code-summary-grid">
            <div class="code-stat-card primary">
                <div class="code-stat-icon">📄</div>
                <div class="code-stat-value">${fmtNum(totalLines)}</div>
                <div class="code-stat-label">Lines of Code Processed</div>
            </div>
            <div class="code-stat-card">
                <div class="code-stat-icon">📁</div>
                <div class="code-stat-value">${fmtNum(filesProcessed)}</div>
                <div class="code-stat-label">Files Analyzed</div>
            </div>
            <div class="code-stat-card">
                <div class="code-stat-icon">📊</div>
                <div class="code-stat-value">${fmtNum(totalTokens / (filesProcessed || 1))}</div>
                <div class="code-stat-label">Avg Tokens per File</div>
            </div>
            <div class="code-stat-card">
                <div class="code-stat-icon">⚡</div>
                <div class="code-stat-value">${fmtNum(totalTokens / (totalLines || 1))}</div>
                <div class="code-stat-label">Avg Tokens per Line</div>
            </div>
        </div>
    `;

    breakdownContainer.innerHTML = `
        <h4>📊 Equivalent Code Volume by Language</h4>
        <p class="code-explanation">Your ${fmtNum(totalTokens)} tokens could represent this many lines of code:</p>
        <div class="code-lang-grid">
            ${langStats.map(lang => `
                <div class="code-lang-card">
                    <div class="code-lang-color" style="background: ${lang.color}"></div>
                    <div class="code-lang-info">
                        <div class="code-lang-name">${lang.name}</div>
                        <div class="code-lang-tokens">~${lang.tokensPerLine} tokens/line</div>
                    </div>
                    <div class="code-lang-lines">${fmtNum(lang.equivalentLines)}</div>
                </div>
            `).join('')}
        </div>
        <div class="code-project-comparison">
            <h4>🏢 Project Scale Comparison</h4>
            <div class="project-comparisons">
                <div class="project-comp">
                    <span class="project-name">Linux Kernel</span>
                    <span class="project-bar">
                        <span class="project-fill" style="width: ${Math.min((totalLines / 30000000) * 100, 100)}%"></span>
                    </span>
                    <span class="project-pct">${(totalLines / 30000000 * 100).toFixed(3)}%</span>
                </div>
                <div class="project-comp">
                    <span class="project-name">VS Code</span>
                    <span class="project-bar">
                        <span class="project-fill" style="width: ${Math.min((totalLines / 15000000) * 100, 100)}%"></span>
                    </span>
                    <span class="project-pct">${(totalLines / 15000000 * 100).toFixed(3)}%</span>
                </div>
                <div class="project-comp">
                    <span class="project-name">React</span>
                    <span class="project-bar">
                        <span class="project-fill" style="width: ${Math.min((totalLines / 150000) * 100, 100)}%"></span>
                    </span>
                    <span class="project-pct">${(totalLines / 150000 * 100).toFixed(1)}%</span>
                </div>
            </div>
        </div>
    `;
};

// ===== HEATMAPS TAB =====
const renderHeatmapsTab = () => {
    const container = document.getElementById('heatmaps-container');
    if (!container) return;

    const heatmapType = document.getElementById('heatmap-type')?.value || 'hourly';
    const sourceData = fileHistoricalData.length > 0 ? fileHistoricalData : historyData;

    if (sourceData.length === 0) {
        container.innerHTML = '<div class="loading-placeholder">No data available for heatmap</div>';
        return;
    }

    switch (heatmapType) {
        case 'hourly':
            renderHourlyHeatmap(container, sourceData);
            break;
        case 'daily':
            renderDailyHeatmap(container, sourceData);
            break;
        case 'model':
            renderModelHeatmap(container, sourceData);
            break;
        case 'cost':
            renderCostHeatmap(container, sourceData);
            break;
    }
};

const renderHourlyHeatmap = (container, data) => {
    // Create 7 days x 24 hours matrix
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const matrix = Array(7).fill(null).map(() => Array(24).fill(0));
    
    data.forEach(d => {
        const date = new Date(d.time);
        const day = date.getDay();
        const hour = date.getHours();
        matrix[day][hour] += d.total || 0;
    });

    const maxVal = Math.max(...matrix.flat(), 1);

    container.innerHTML = `
        <div class="heatmap-title">Hourly Usage Patterns (Last 7 Days)</div>
        <div class="heatmap-wrapper">
            <div class="heatmap-y-labels">
                ${days.map(d => `<div class="heatmap-y-label">${d}</div>`).join('')}
            </div>
            <div class="heatmap-grid hourly">
                <div class="heatmap-x-labels">
                    ${Array(24).fill(0).map((_, i) => `<div class="heatmap-x-label">${i}</div>`).join('')}
                </div>
                <div class="heatmap-cells">
                    ${matrix.map((day, dayIdx) => `
                        <div class="heatmap-row">
                            ${day.map((val, hour) => {
                                const intensity = val / maxVal;
                                const opacity = 0.1 + (intensity * 0.9);
                                return `
                                    <button type="button" class="heatmap-cell-full" 
                                         data-heatmap-cell="true"
                                         data-type="info"
                                         data-label="${days[dayIdx]} ${hour}:00"
                                         data-value="${fmtInt(val)}"
                                         data-suffix="tokens"
                                         data-detail="hourly usage"
                                         aria-label="${days[dayIdx]} ${hour}:00 - ${fmtInt(val)} tokens"
                                         style="background: rgba(251, 191, 36, ${opacity})"
                                         title="${days[dayIdx]} ${hour}:00 - ${fmtInt(val)} tokens">
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        <div class="heatmap-legend">
            <span>Low</span>
            <div class="heatmap-gradient"></div>
            <span>High (${fmtNum(maxVal)} tokens)</span>
        </div>
    `;

    bindHeatmapInteractions(container);
};

const renderDailyHeatmap = (container, data) => {
    // Group by date
    const byDate = {};
    data.forEach(d => {
        const date = new Date(d.time).toISOString().split('T')[0];
        if (!byDate[date]) byDate[date] = 0;
        byDate[date] += d.total || 0;
    });

    const dates = Object.keys(byDate).sort();
    const maxVal = Math.max(...Object.values(byDate), 1);

    // Group into weeks for display
    const weeks = [];
    for (let i = 0; i < dates.length; i += 7) {
        weeks.push(dates.slice(i, i + 7));
    }

    container.innerHTML = `
        <div class="heatmap-title">Daily Usage Over Time</div>
        <div class="daily-heatmap">
            ${weeks.map(week => `
                <div class="heatmap-week">
                    ${week.map(date => {
                        const val = byDate[date];
                        const intensity = val / maxVal;
                        const dayName = new Date(date).toLocaleDateString('en', { weekday: 'short' });
                        return `
                            <button type="button" class="daily-heatmap-cell" 
                                 data-heatmap-cell="true"
                                 data-type="info"
                                 data-label="${date}"
                                 data-value="${fmtInt(val)}"
                                 data-suffix="tokens"
                                 data-detail="daily total"
                                 aria-label="${date} - ${fmtInt(val)} tokens"
                                 style="background: rgba(251, 191, 36, ${0.1 + intensity * 0.9})"
                                 title="${date} - ${fmtInt(val)} tokens">
                                <span class="daily-heatmap-day">${dayName}</span>
                                <span class="daily-heatmap-val">${fmtInt(val)}</span>
                            </button>
                        `;
                    }).join('')}
                </div>
            `).join('')}
        </div>
        <div class="heatmap-legend">
            <span>Low</span>
            <div class="heatmap-gradient"></div>
            <span>High (${fmtNum(maxVal)} tokens)</span>
        </div>
    `;

    bindHeatmapInteractions(container);
};

const renderModelHeatmap = (container, data) => {
    // Get model usage over time
    const modelUsage = {};
    const timeSlots = [];
    
    data.forEach(d => {
        const timeKey = new Date(d.time).toISOString().slice(0, 13); // Hourly buckets
        if (!timeSlots.includes(timeKey)) timeSlots.push(timeKey);
        
        const models = d.tokens_by_model || d.models || {};
        Object.entries(models).forEach(([model, tokens]) => {
            if (!modelUsage[model]) modelUsage[model] = {};
            if (!modelUsage[model][timeKey]) modelUsage[model][timeKey] = 0;
            modelUsage[model][timeKey] += tokens || 0;
        });
    });

    const sortedModels = Object.entries(modelUsage)
        .sort((a, b) => Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0))
        .slice(0, 8);

    const maxVal = Math.max(...sortedModels.flatMap(m => Object.values(m[1])), 1);
    const timeLabels = timeSlots.slice(-24);

    container.innerHTML = `
        <div class="heatmap-title">Model Usage Intensity</div>
        <div class="heatmap-wrapper">
            <div class="heatmap-y-labels">
                ${sortedModels.map(([model]) => {
                    const shortName = model.split('/').pop();
                    return `<div class="heatmap-y-label" title="${model}">${shortName}</div>`;
                }).join('')}
            </div>
            <div class="heatmap-grid hourly">
                <div class="heatmap-x-labels">
                    ${timeLabels.map((_, i) => `<div class="heatmap-x-label">${i}</div>`).join('')}
                </div>
                <div class="heatmap-cells">
                    ${sortedModels.map(([model, usage]) => `
                        <div class="heatmap-row">
                            ${timeLabels.map(time => {
                                const val = usage[time] || 0;
                                const intensity = val / maxVal;
                                const opacity = 0.1 + (intensity * 0.9);
                                return `
                                    <button type="button" class="heatmap-cell-full model" 
                                         data-heatmap-cell="true"
                                         data-type="info"
                                         data-label="${model.split('/').pop()} @ ${time}"
                                         data-value="${fmtInt(val)}"
                                         data-suffix="tokens"
                                         data-detail="model usage"
                                         aria-label="${model} @ ${time} - ${fmtInt(val)} tokens"
                                         style="background: rgba(251, 191, 36, ${opacity})"
                                         title="${model} @ ${time} - ${fmtInt(val)} tokens">
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        <div class="heatmap-legend">
            <span>Low</span>
            <div class="heatmap-gradient"></div>
            <span>High (${fmtNum(maxVal)} tokens)</span>
        </div>
    `;

    bindHeatmapInteractions(container);
};

const renderCostHeatmap = (container, data) => {
    // Cost by hour and day
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const costMatrix = Array(7).fill(null).map(() => Array(24).fill(0));
    
    data.forEach(d => {
        const date = new Date(d.time);
        const day = date.getDay();
        const hour = date.getHours();
        // Estimate cost at $2 per 1M tokens
        const cost = (d.total || 0) * 0.000002;
        costMatrix[day][hour] += cost;
    });

    const maxCost = Math.max(...costMatrix.flat(), 0.01);

    container.innerHTML = `
        <div class="heatmap-title">Cost Intensity by Hour ($${(data.reduce((s, d) => s + (d.total || 0), 0) * 0.000002).toFixed(2)} total)</div>
        <div class="heatmap-wrapper">
            <div class="heatmap-y-labels">
                ${days.map(d => `<div class="heatmap-y-label">${d}</div>`).join('')}
            </div>
            <div class="heatmap-grid hourly">
                <div class="heatmap-x-labels">
                    ${Array(24).fill(0).map((_, i) => `<div class="heatmap-x-label">${i}</div>`).join('')}
                </div>
                <div class="heatmap-cells">
                    ${costMatrix.map((day, dayIdx) => `
                        <div class="heatmap-row">
                            ${day.map((cost, hour) => {
                                const intensity = cost / maxCost;
                                const opacity = 0.1 + (intensity * 0.9);
                                return `
                                    <button type="button" class="heatmap-cell-full cost" 
                                         data-heatmap-cell="true"
                                         data-type="info"
                                         data-label="${days[dayIdx]} ${hour}:00"
                                         data-value="$${cost.toFixed(3)}"
                                         data-suffix=""
                                         data-detail="hourly cost"
                                         aria-label="${days[dayIdx]} ${hour}:00 - $${cost.toFixed(3)}"
                                         style="background: rgba(239, 68, 68, ${opacity})"
                                         title="${days[dayIdx]} ${hour}:00 - $${cost.toFixed(3)}">
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
        <div class="heatmap-legend">
            <span>Low</span>
            <div class="heatmap-gradient cost"></div>
            <span>High ($${maxCost.toFixed(2)}/hr)</span>
        </div>
    `;

    bindHeatmapInteractions(container);
};

const updateHeatmap = () => {
    renderHeatmapsTab();
};

// Export functions for window access
export { 
    generateDeepInsights,
    generateLLMInsights, 
    loadGitBlame, 
    investigateSpike, 
    closeInvestigation, 
    updateHeatmap,
    showCommitDetails,
    toggleSessionMessages,
    closeCommitDetails
};
