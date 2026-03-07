import { CHART_COLORS } from '../config.js';
import { fmtNum, getPlotlyLayout } from '../utils.js';
import { currentData, historyData, fileHistoricalData, analyticsRange, setAnalyticsRange, setAnalyticsTab, sortCol, sortAsc, setSortCol, setSortAsc, searchTerm, setSearchTerm } from '../state.js';

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

        return `
            <tr style="animation-delay: ${index * 0.05}s">
                <td>
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color}; margin-right: 8px;"></span>
                    ${name.split('/').pop()}
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

    if (models.length === 0) return;

    const data = [{
        type: 'bar',
        y: models.map(m => m[0].split('/').pop()),
        x: models.map(m => m[1].total),
        orientation: 'h',
        marker: {
            color: models.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
            line: { color: 'rgba(255,255,255,0.1)', width: 1 }
        },
        text: models.map(m => fmtNum(m[1].total)),
        textposition: 'outside'
    }];

    Plotly.newPlot('compare-chart-container', data, {
        ...getPlotlyLayout(),
        margin: { t: 20, r: 80, b: 40, l: 100 },
        xaxis: { title: 'Tokens' },
        yaxis: { autorange: 'reversed' }
    }, { displayModeBar: false });
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
        margin: { t: 20, r: 20, b: 40, l: 60 },
        yaxis: { title: 'Tokens' }
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

    const labels = days.map(([day]) => day.slice(5)); // MM-DD
    const values = days.map(([, tokens]) => tokens);
    const maxVal = Math.max(...values);

    // Calculate bar widths based on value (normalized between 0.3 and 1.0)
    const widths = values.map(v => 0.3 + (v / maxVal) * 0.7);

    const data = [{
        type: 'bar',
        y: labels,
        x: values,
        orientation: 'h',
        text: values.map(v => fmtNum(v)),
        textposition: 'outside',
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
        margin: { t: 20, r: 80, b: 40, l: 70 },
        xaxis: {
            title: 'Tokens',
            showgrid: true,
            gridcolor: 'rgba(115,115,115,0.2)'
        },
        yaxis: {
            automargin: true,
            tickfont: { size: 11 }
        },
        bargap: 0.15
    };

    Plotly.newPlot('calendar-container', data, layout, { displayModeBar: false, responsive: true });
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
    const { tokens_by_model, costs_by_model, total_tokens, total_cost } = currentData;
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
        insights.push({
            icon: '⚡',
            title: 'Most Efficient Model',
            value: best.name.split('/').pop(),
            description: `Best tokens-per-dollar ratio at $${best.costPer1M.toFixed(2)} per 1M tokens`,
            detail: `${efficiency.length > 1 ? `2x better than ${efficiency[efficiency.length - 1].name.split('/').pop()}` : 'Most cost-effective choice'}`,
            type: 'positive'
        });
    }

    // 2. Cache Champion
    const cacheLeaders = models
        .map(([name, stats]) => ({ name, rate: stats.cache_read / (stats.input + stats.cache_read || 1) }))
        .sort((a, b) => b.rate - a.rate);

    if (cacheLeaders.length > 0 && cacheLeaders[0].rate > 0.1) {
        const leader = cacheLeaders[0];
        insights.push({
            icon: '💾',
            title: 'Cache Champion',
            value: `${(leader.rate * 100).toFixed(1)}%`,
            description: `${leader.name.split('/').pop()} has the highest cache hit rate`,
            detail: `Saving ~$${((currentData.total_cache_read || 0) * 0.00015).toFixed(2)} in cache hits`,
            type: 'positive'
        });
    }

    // 3. Usage Velocity
    if (sourceData.length >= 2) {
        const recent = sourceData.slice(-6);
        const avgRecent = recent.reduce((s, d) => s + (d.total || 0), 0) / recent.length;
        const older = sourceData.slice(-12, -6);
        const avgOlder = older.length > 0 ? older.reduce((s, d) => s + (d.total || 0), 0) / older.length : avgRecent;
        const change = avgOlder > 0 ? ((avgRecent - avgOlder) / avgOlder) * 100 : 0;

        insights.push({
            icon: change >= 0 ? '📈' : '📉',
            title: 'Usage Velocity',
            value: `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
            description: change >= 20 ? 'Token usage is accelerating significantly' :
                         change >= 0 ? 'Token usage is steady or growing' :
                         'Token usage has decreased recently',
            detail: `Avg ${fmtNum(avgRecent)}/hr recently vs ${fmtNum(avgOlder)}/hr before`,
            type: change >= 0 ? 'neutral' : 'info'
        });
    }

    // 4. Model Diversity
    const diversity = models.length;
    const topModelShare = models.length > 0 ?
        Math.max(...models.map(m => m[1].total)) / (total_tokens || 1) : 0;

    insights.push({
        icon: diversity > 5 ? '🌈' : diversity > 2 ? '🎨' : '🎯',
        title: 'Model Diversity',
        value: `${diversity} models`,
        description: diversity > 8 ? 'You are exploring many different models' :
                     diversity > 4 ? 'Good variety of models in use' :
                     'Focused on a few key models',
        detail: topModelShare > 0.7 ? `Heavily weighted toward ${models[0][0].split('/').pop()}` :
               topModelShare > 0.4 ? `Balanced usage across models` :
               'Evenly distributed usage',
        type: 'neutral'
    });

    // 5. Cost Accumulation Pattern
    if (total_cost?.total) {
        const hourlyRate = total_cost.total / (sourceData.length || 1);
        const projectedDaily = hourlyRate * 24;

        insights.push({
            icon: '💰',
            title: 'Cost Trajectory',
            value: `$${total_cost.total.toFixed(2)}`,
            description: `Spending at ~$${hourlyRate.toFixed(2)}/hour`,
            detail: projectedDaily > 100 ? `On track for $${projectedDaily.toFixed(0)}/day` :
                   `Projected $${projectedDaily.toFixed(2)}/day at current rate`,
            type: projectedDaily > 500 ? 'warning' : 'neutral'
        });
    }

    // 6. Peak Usage Pattern
    if (sourceData.length > 0) {
        const peak = sourceData.reduce((max, d) => d.total > max.total ? d : max, sourceData[0]);
        const peakHour = new Date(peak.time).getHours();
        const timeLabel = peakHour >= 5 && peakHour < 12 ? 'morning' :
                         peakHour >= 12 && peakHour < 17 ? 'afternoon' :
                         peakHour >= 17 && peakHour < 21 ? 'evening' : 'night';

        insights.push({
            icon: '🔥',
            title: 'Peak Activity',
            value: fmtNum(peak.total),
            description: `Highest usage was ${timeLabel}`,
            detail: `At ${new Date(peak.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            type: 'info'
        });
    }

    // 7. Input/Output Balance
    const inputRatio = currentData.total_input / (total_tokens || 1);
    const outputRatio = currentData.total_output / (total_tokens || 1);

    insights.push({
        icon: inputRatio > 0.7 ? '📥' : outputRatio > 0.3 ? '📤' : '⚖️',
        title: 'Token Flow Balance',
        value: `${(inputRatio * 100).toFixed(0)}% in`,
        description: inputRatio > 0.8 ? 'Heavy prompt/analysis workload' :
                     outputRatio > 0.4 ? 'Generative output heavy' :
                     'Balanced input/output ratio',
        detail: `${fmtNum(currentData.total_input)} in / ${fmtNum(currentData.total_output)} out`,
        type: 'neutral'
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

    if (!container || !btn) return;

    btn.disabled = true;
    container.innerHTML = `
        <div class="llm-loading">
            <div class="loading-spinner" style="width: 24px; height: 24px;"></div>
            <span>AI is analyzing your usage patterns...</span>
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

    // Try to get LLM insights from API, fallback to local generation
    try {
        const response = await fetch('/api/insights/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(summary)
        });

        if (response.ok) {
            const data = await response.json();
            renderLLMInsights(data.insights);
        } else {
            throw new Error('API failed');
        }
    } catch {
        // Fallback to local insight generation
        const localInsights = generateLocalLLMInsights(summary);
        renderLLMInsights(localInsights);
    }

    btn.disabled = false;
};

const generateLocalLLMInsights = (summary) => {
    const insights = [];

    // Cost efficiency insight
    const avgCostPer1M = (summary.totalCost / summary.totalTokens) * 1e6;
    if (avgCostPer1M < 0.50) {
        insights.push(`Your average cost of $${avgCostPer1M.toFixed(2)} per 1M tokens is excellent. You're effectively leveraging caching and cost-effective models.`);
    } else if (avgCostPer1M > 2.0) {
        insights.push(`Your cost of $${avgCostPer1M.toFixed(2)} per 1M tokens suggests heavy use of premium models. Consider if all tasks require high-end models or if some could use more cost-effective alternatives.`);
    }

    // Model concentration insight
    const topModelShare = summary.topModels[0]?.tokens / summary.totalTokens;
    if (topModelShare > 0.8) {
        insights.push(`You're heavily reliant on ${summary.topModels[0].name}. While specialization is good, consider A/B testing alternatives to ensure optimal cost-performance.`);
    } else if (summary.modelCount > 8) {
        insights.push(`You're using ${summary.modelCount} different models, showing good experimentation. Consider consolidating to your top 3-4 performers for simpler cost management.`);
    }

    // Cache utilization insight
    if (summary.cacheRate > 0.6) {
        insights.push(`Excellent cache utilization at ${(summary.cacheRate * 100).toFixed(1)}%! This is saving you significant costs. Keep reusing similar prompts to maintain this efficiency.`);
    } else if (summary.cacheRate < 0.2) {
        insights.push(`Your cache hit rate is only ${(summary.cacheRate * 100).toFixed(1)}%. Look for opportunities to reuse similar prompts or structure your requests more consistently.`);
    }

    // Input/output pattern
    if (summary.inputOutputRatio > 5) {
        insights.push(`Your workload is heavily input-biased (${summary.inputOutputRatio.toFixed(1)}:1 ratio). This suggests analysis/classification tasks. Consider batching inputs to maximize efficiency.`);
    } else if (summary.inputOutputRatio < 1) {
        insights.push(`You're generating more output than input, indicating creative/generative workloads. Monitor output costs carefully as they can escalate quickly.`);
    }

    return insights.join('\n\n') || 'No specific patterns detected yet. Continue using the system to generate more insights.';
};

const renderLLMInsights = (text) => {
    const container = document.getElementById('llm-insights-content');
    if (!container) return;

    const paragraphs = text.split('\n\n').filter(p => p.trim());
    container.innerHTML = `
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

    const data = [{
        values: models.map(m => m[1].total),
        labels: models.map(m => m[0].split('/').pop()),
        type: 'pie',
        hole: 0.5,
        marker: { colors: CHART_COLORS },
        textinfo: 'label+percent',
        textposition: 'outside'
    }];

    Plotly.newPlot('distribution-chart-container', data, {
        ...getPlotlyLayout({ showlegend: false }),
        margin: { t: 20, r: 20, b: 20, l: 20 }
    }, { displayModeBar: false });
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

    // Update buttons
    document.querySelectorAll('.subnav-btn').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === tab);
    });

    // Show/hide content
    ['models', 'compare', 'timeline', 'calendar', 'distribution', 'insights'].forEach(t => {
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

// Export insight functions for window access
export { generateDeepInsights, generateLLMInsights };
