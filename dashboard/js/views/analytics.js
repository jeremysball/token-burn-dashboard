import { CHART_COLORS, getPricing } from './config.js';
import {
    lookupModelsDevPrice,
    calculateCostWithPricing,
    fetchModelsDevCatalog,
    getCatalog,
    isCatalogFailed,
    clearCatalogCache
} from './modelsdev-pricing.js';
import { fmtNum, fmtInt, fmtCur, fmtMultiple, getPlotlyLayout, notify, splitModelKey, displayModel } from './utils.js';
import { currentData, historyData, fileHistoricalData, analyticsRange, setAnalyticsRange, setAnalyticsTab, sortCol, sortAsc, setSortCol, setSortAsc, searchTerm, setSearchTerm } from './state.js';
import {
    cacheDiscountRatioFromPricing
} from './views/analytics/tabs/shared.js';

import { renderModelsTab } from './views/analytics/tabs/models.js';
import { renderCompareTab } from './views/analytics/tabs/compare.js';
import { renderTimelineTab } from './views/analytics/tabs/timeline.js';
import { renderCalendarTab } from './views/analytics/tabs/calendar.js';
import { renderDistributionTab } from './views/analytics/tabs/distribution.js';
import {
    renderDeepInsightsTab,
    generateDeepInsights,
    calculateDeepInsights,
    generateLLMInsights,
    renderInsightsCards
} from './views/analytics/tabs/insights.js';
import { renderScaleTab } from './views/analytics/tabs/scale.js';
import { renderCodeStatsTab } from './views/analytics/tabs/code.js';
import {
    renderHeatmapsTab,
    setHeatmapMetric,
    retryModelsDevPricing
} from './views/analytics/tabs/heatmaps.js';
import {
    renderGitBlameTab,
    loadGitBlame,
    renderGitBlameData,
    showCommitDetails,
    renderCommitDetails,
    toggleSessionMessages,
    closeCommitDetails
} from './views/analytics/tabs/git.js';
import {
    renderSpikeDetectiveTab,
    investigateSpike,
    closeInvestigation,
    toggleSpikeSession,
    spikeRatioLevel,
    computeSeriesStats,
    computeZScore,
    renderSpikesList,
    renderInvestigation
} from './views/analytics/tabs/spikes.js';

export const renderAnalytics = () => {
    if (!currentData) return;

    const tab = document.querySelector('.subnav-btn.active')?.dataset.tab || 'models';

    switch (tab) {
        case 'models':
            renderModelsTab(document.getElementById('models-tbody'));
            break;
        case 'compare':
            renderCompareTab(document.getElementById('compare-chart-container'));
            break;
        case 'timeline':
            renderTimelineTab(document.getElementById('timeline-chart-container'));
            break;
        case 'calendar':
            renderCalendarTab(document.getElementById('calendar-container'));
            break;
        case 'distribution':
            renderDistributionTab(document.getElementById('distribution-chart-container'));
            break;
        case 'insights':
            renderDeepInsightsTab();
            break;
        case 'scale':
            renderScaleTab(document.getElementById('scale-comparisons'));
            break;
        case 'code':
            renderCodeStatsTab();
            break;
        case 'heatmaps':
            renderHeatmapsTab(document.getElementById('heatmaps-container'));
            break;
        case 'git':
            renderGitBlameTab();
            break;
        case 'spikes':
            renderSpikeDetectiveTab();
            break;
    }
};

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

    renderAnalytics();
};

export const setAnalyticsRangeHandler = (range) => {
    setAnalyticsRange(range);

    // Update buttons
    document.querySelectorAll('.range-selector button').forEach(el => {
        el.classList.toggle('active', el.textContent.toLowerCase() === range.toLowerCase());
    });

    renderAnalytics();
};

export const handleSearch = (val) => {
    setSearchTerm(val);
    renderAnalytics();
};

export const sortBy = (col) => {
    if (sortCol === col) {
        setSortAsc(!sortAsc);
    } else {
        setSortCol(col);
        setSortAsc(false);
    }
    renderAnalytics();
};

export const updateHeatmap = () => renderHeatmapsTab();

export {
    cacheDiscountRatioFromPricing,
    generateDeepInsights,
    calculateDeepInsights,
    generateLLMInsights,
    loadGitBlame,
    investigateSpike,
    closeInvestigation,
    showCommitDetails,
    toggleSessionMessages,
    closeCommitDetails,
    toggleSpikeSession,
    spikeRatioLevel,
    computeSeriesStats,
    computeZScore,
    renderSpikesList,
    renderInvestigation,
    renderInsightsCards,
    renderGitBlameData,
    renderCommitDetails,
    renderModelHeatmap,
    renderModelsTab,
    setHeatmapMetric,
    retryModelsDevPricing
};

// Back-compat: re-export heatmap helpers from the heatmaps module for tests
export { renderHeatmapsTab } from './views/analytics/tabs/heatmaps.js';
