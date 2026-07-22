import {
    fmtNum, currentData, historyData, fileHistoricalData,
    getPricingForModel, cacheDiscountRatioFromPricing, escapeHtml
} from './shared.js';
import { getGitBlameCache } from './shared.js';

// ===== DEEP INSIGHTS TAB =====
/** @type {any[]|null} */
let insightsCache = null;
let insightsCacheTime = 0;

export const renderDeepInsightsTab = () => {
    const container = document.getElementById('deep-insights-container');
    if (!container) return;

    // Use cached insights if recent (5 minutes)
    if (insightsCache && Date.now() - insightsCacheTime < 5 * 60 * 1000) {
        renderInsightsCards(container, insightsCache);
        return;
    }

    generateDeepInsights();
};

export const generateDeepInsights = () => {
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

export const calculateDeepInsights = () => {
    const data = currentData;
    if (!data) return [];

    const { tokens_by_model, costs_by_model, total_tokens, total_cost, files_processed, total_lines } = data;
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
            icon: '#',
            title: 'Most Efficient Model',
            value: best.name.split('/').pop(),
            description: `Best tokens-per-dollar ratio at $${best.costPer1M.toFixed(2)} per 1M tokens`,
            detail: `Switching from ${worst.name.split('/').pop()} would save ~$${savings.toFixed(2)} per 1M tokens`,
            type: 'positive'
        });
    }

    // 2. Cache Efficiency - Calculate real savings from model pricing
    const totalCacheRead = data.total_cache_read || 0;
    const totalInput = data.total_input || 0;
    const cacheRate = totalCacheRead / (totalInput + totalCacheRead || 1);

    // Use each model's own cache discount. Applying the top model's pricing to
    // all cached tokens overstates savings when the workload mixes models.
    // Track whether any model had usable pricing, separately from the summed
    // total, so a genuinely-zero result (e.g. a free model) isn't mistaken
    // for "couldn't compute" and overridden by the fallback below.
    let perModelCacheSavings = 0;
    let perModelDiscountNumerator = 0;
    let perModelDiscountDenominator = 0;
    let perModelCoverage = false;
    for (const [name, stats] of models) {
        const cacheRead = Number(stats.cache_read ?? stats.cacheRead ?? 0);
        const pricing = getPricingForModel(name);
        const inputRate = Number(pricing?.input);
        const cacheReadRate = Number(pricing?.cacheRead);
        if (!Number.isFinite(cacheRead) || cacheRead <= 0
            || !Number.isFinite(inputRate) || !Number.isFinite(cacheReadRate)) {
            continue;
        }
        perModelCoverage = true;
        perModelCacheSavings += (cacheRead / 1e6) * Math.max(0, inputRate - cacheReadRate);
        perModelDiscountNumerator += cacheRead * cacheReadRate;
        perModelDiscountDenominator += cacheRead * inputRate;
    }

    // Top model remains a fallback only when no model had usable pricing.
    const topModel = models.length > 0
        ? models.slice().sort((a, b) =>
            (costs_by_model?.[b[0]]?.total || 0) - (costs_by_model?.[a[0]]?.total || 0))[0][0]
        : null;
    const pricing = getPricingForModel(topModel || '') || { input: 3, output: 15, cacheRead: 0.3 };

    // Real cache discount ratio derived from model pricing (cacheRead/input),
    // preferring the blended per-model ratio so the displayed discount
    // matches the dollar figure above instead of just the top model's rate.
    const cacheDiscountRatio = perModelDiscountDenominator > 0
        ? perModelDiscountNumerator / perModelDiscountDenominator
        : cacheDiscountRatioFromPricing(pricing);

    // Average input cost per token, falling back to a sensible default
    const avgInputCostPerToken = totalInput > 0 && total_cost?.input
        ? total_cost.input / totalInput
        : 0.000003;
    const avgCacheReadCostPerToken = cacheDiscountRatio * avgInputCostPerToken;

    const cacheSavings = perModelCoverage
        ? perModelCacheSavings
        : Math.max(0, totalCacheRead * (avgInputCostPerToken - avgCacheReadCostPerToken));

    insights.push({
        icon: cacheRate > 0.5 ? '▲' : '▽',
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
            icon: change >= 20 ? '»' : change >= 0 ? '▲' : change >= -20 ? '→' : '▼',
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
            icon: concentration > 0.8 ? '!' : concentration > 0.5 ? 'Δ' : '○',
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
            icon: tokensPerLine > 500 ? 'Δ' : tokensPerLine > 100 ? '·' : '▽',
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
            const hour = new Date(d.time).getUTCHours();
            hourBuckets[hour] += d.total || 0;
        });
        
        const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));
        const peakTokens = hourBuckets[peakHour];
        const totalBucketed = hourBuckets.reduce((a, b) => a + b, 0);
        const peakShare = totalBucketed > 0 ? peakTokens / totalBucketed : 0;
        
        const timeLabel = peakHour >= 5 && peakHour < 12 ? 'morning' :
                         peakHour >= 12 && peakHour < 17 ? 'afternoon' :
                         peakHour >= 17 && peakHour < 21 ? 'evening' : 'night';

        insights.push({
            icon: '·',
            title: 'Peak Hour',
            value: `${peakHour}:00`,
            description: `${(peakShare * 100).toFixed(0)}% of daily tokens used in the ${timeLabel}`,
            detail: `${fmtNum(peakTokens)} tokens at peak vs ${fmtNum(totalBucketed / 24)}/hr average`,
            type: peakShare > 0.25 ? 'warning' : 'info'
        });
    }

    // 7. Input/Output with actionable insight
    const inputRatio = data.total_input / (total_tokens || 1);
    const outputRatio = data.total_output / (total_tokens || 1);
    const ratio = outputRatio > 0 ? inputRatio / outputRatio : 0;

    insights.push({
        icon: inputRatio > 0.8 ? '←' : outputRatio > 0.5 ? '→' : '○',
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

    // 8. Engineering Efficiency - tokens per LOC changed (heuristic)
    if (data.total_tokens && getGitBlameCache() && getGitBlameCache().commits) {
        const totalLOC = getGitBlameCache().commits.reduce(
            /** @param {number} s @param {{loc?: {loc?: number}}} c */ (s, c) => s + (c.loc?.loc || 0), 0
        )
            || data.total_lines || 0;
        const tokPerLOC = totalLOC ? data.total_tokens / totalLOC : 0;
        insights.push({
            icon: '·',
            title: 'Eng Efficiency',
            value: tokPerLOC ? `${fmtNum(tokPerLOC)} tok/LOC` : 'n/a',
            description: 'Tokens per line changed - lower is more efficient. Heuristic.',
            detail: `${fmtNum(data.total_tokens)} tokens / ${fmtNum(totalLOC)} LOC (git shortstat)`,
            type: 'info'
        });
    }

    // 9. Cost per commit (heuristic)
    if (getGitBlameCache()?.commits?.length && data.total_cost?.total) {
        const avg = data.total_cost.total / getGitBlameCache().commits.length;
        insights.push({
            icon: '$',
            title: 'Cost / Commit',
            value: `$${avg.toFixed(2)}`,
            description: 'Avg spend per commit (session->commit heuristic)',
            detail: `${getGitBlameCache().commits.length} commits`,
            type: 'neutral'
        });
    }

    return insights;
};

/** @param {HTMLElement} container @param {any[]} insights */
export const renderInsightsCards = (container, insights) => {
    container.innerHTML = insights.map((insight, i) => `
        <div class="insight-card--deep" style="animation-delay: ${i * 0.1}s">
            <div class="insight-card__header">
                <div class="insight-card__icon">${escapeHtml(insight.icon)}</div>
                <div>
                    <div class="insight-card__title">${escapeHtml(insight.title)}</div>
                    <div class="insight-card__value">${escapeHtml(insight.value)}</div>
                </div>
            </div>
            <div class="insight-card__description">${escapeHtml(insight.description)}</div>
            <div class="insight-card__detail">${escapeHtml(insight.detail)}</div>
        </div>
    `).join('');
};

export const generateLLMInsights = async () => {
    const container = document.getElementById('llm-insights-content');
    const btn = /** @type {HTMLButtonElement|null} */ (document.querySelector('.llm-analyze-btn'));
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
    const cData = currentData;
    if (!cData) return;
    const { tokens_by_model, costs_by_model, total_tokens, total_cost } = cData;
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
        cacheRate: cData.total_cache_read / (cData.total_input + cData.total_cache_read || 1),
        inputOutputRatio: cData.total_input / (cData.total_output || 1)
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
        
        if (data.source === 'taskferry') {
            if (statusEl) {
                statusEl.textContent = '✓ AI Analysis';
                statusEl.className = 'analysis-status taskferry';
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
                <p>${escapeHtml(err instanceof Error ? err.message || 'Unable to connect to analysis service' : 'Unable to connect to analysis service')}</p>
                <p class="error-help">The AI analysis service may be temporarily unavailable. Try again later.</p>
                <button onclick="generateLLMInsights()" class="retry-btn">↻ Retry</button>
            </div>
        `;
    }

    btn.disabled = false;
};

/** @param {string} text @param {string|null} [warningMessage] */
export const renderLLMInsights = (text, warningMessage = null) => {
    const container = document.getElementById('llm-insights-content');
    if (!container) return;

    const safeText = escapeHtml(text);
    const paragraphs = safeText.split('\n\n').filter(p => p.trim());
    container.innerHTML = `
        ${warningMessage ? `<div class="llm-warning">${escapeHtml(warningMessage)}</div>` : ''}
        <div class="llm-analysis-text">
            ${paragraphs.map(p => `<p>${p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</p>`).join('')}
        </div>
    `;
};
