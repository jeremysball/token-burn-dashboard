import { currentData, setAnalyticsRange, setAnalyticsTab, sortCol, sortAsc, setSortCol, setSortAsc, setSearchTerm } from '../state.js';
import { cacheDiscountRatioFromPricing } from './analytics/tabs/shared.js';

import { renderModelsTab } from './analytics/tabs/models.js';
import { renderCompareTab } from './analytics/tabs/compare.js';
import { renderTimelineTab } from './analytics/tabs/timeline.js';
import { renderCalendarTab } from './analytics/tabs/calendar.js';
import { renderDistributionTab } from './analytics/tabs/distribution.js';
import {
    renderDeepInsightsTab,
    generateDeepInsights,
    calculateDeepInsights,
    generateLLMInsights,
    renderLLMInsights,
    renderInsightsCards
} from './analytics/tabs/insights.js';
import { renderScaleTab } from './analytics/tabs/scale.js';
import { renderCodeStatsTab } from './analytics/tabs/code.js';
import {
    renderHeatmapsTab,
    renderModelHeatmap,
    setHeatmapMetric,
    retryModelsDevPricing
} from './analytics/tabs/heatmaps.js';
import {
    renderGitBlameTab,
    loadGitBlame,
    renderGitBlameData,
    showCommitDetails,
    renderCommitDetails,
    toggleSessionMessages,
    closeCommitDetails
} from './analytics/tabs/git.js';
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
} from './analytics/tabs/spikes.js';

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
    renderLLMInsights,
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
