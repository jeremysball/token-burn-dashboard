import { fmtNum, notify, resizeVisiblePlots, positionNotifications } from './utils.js';
import { setCurrentView, loadCache, loadHistoryFromCache } from './state.js';
import { connectSSE, updateData, refreshData } from './api.js';
import { renderDashboard, updateDashboardCharts } from './views/dashboard.js';
import { renderAnalytics, setAnalyticsTabHandler, setAnalyticsRangeHandler, loadGitBlame, loadSpikes } from './views/analytics.js';
import { loadPricing } from './config.js';

// ===== ANIMATED NUMBER COUNTER =====

/**
 * @param {HTMLElement} element
 * @param {string|number} startValue
 * @param {string|number} endValue
 * @param {number} [duration=800]
 * @param {string} [prefix='']
 * @param {string} [suffix='']
 */
export const animateNumber = (element, startValue, endValue, duration = 800, prefix = '', suffix = '') => {
    const startTime = performance.now();
    const startNum = typeof startValue === 'string' ? parseFloat(startValue.replace(/[^0-9.-]/g, '')) : startValue;
    const endNum = typeof endValue === 'string' ? parseFloat(endValue.replace(/[^0-9.-]/g, '')) : endValue;
    const decimalMatch = typeof endValue === 'string' ? endValue.match(/\.(\d+)/) : null;
    const decimalPlaces = decimalMatch ? decimalMatch[1].length : null;

    if (isNaN(startNum) || isNaN(endNum)) {
        element.textContent = prefix + endValue + suffix;
        return;
    }

    // Add ticking animation class
    element.classList.add('ticking');

    /**
     * @param {DOMHighResTimeStamp} currentTime
     */
    const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = startNum + (endNum - startNum) * easeOut;
        const formatted = decimalPlaces === null ? fmtNum(current) : current.toFixed(decimalPlaces);
        element.textContent = prefix + formatted + suffix;
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            element.classList.remove('ticking');
            const finalValue = typeof endValue === 'string' ? endValue : fmtNum(endNum);
            element.textContent = prefix + finalValue + suffix;
        }
    };
    
    requestAnimationFrame(animate);
};

// ===== AMBIENT PARTICLES =====
const initParticles = () => {
    const container = document.getElementById('particles');
    if (!container) return;
    
    const particleCount = 15;
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 20 + 's';
        particle.style.animationDuration = (15 + Math.random() * 10) + 's';
        particle.style.width = (2 + Math.random() * 4) + 'px';
        particle.style.height = particle.style.width;
        container.appendChild(particle);
    }
    
    // Mouse interaction - particles drift toward cursor
    document.addEventListener('mousemove', () => {
        // Mouse tracking reserved for future particle interaction effects
    }, { passive: true });
};

// ===== THRESHOLD DETECTION =====
const getShownAchievements = () => {
    try {
        return new Set(JSON.parse(localStorage.getItem('tokenBurnAchievements') || '[]'));
    } catch {
        return new Set();
    }
};

/**
 * @param {Set<string>} achievements
 */
const saveShownAchievements = (achievements) => {
    try {
        localStorage.setItem('tokenBurnAchievements', JSON.stringify([...achievements]));
    } catch {
        // Ignore localStorage errors
    }
};

const shownAchievements = getShownAchievements();

/**
 * @param {number} totalTokens
 * @param {number} totalCost
 */
const checkThresholds = (totalTokens, totalCost) => {
    let newAchievement = false;
    
    // Token milestones (billions)
    const tokenBillions = Math.floor(totalTokens / 1000000000);
    const tokenKey = `tokens_${tokenBillions}B`;
    if (tokenBillions >= 1 && !shownAchievements.has(tokenKey)) {
        shownAchievements.add(tokenKey);
        newAchievement = true;
        notify(`Milestone Reached: ${tokenBillions}B Tokens!`, 'success');
        document.querySelector('.hero-section')?.classList.add('threshold-crossed');
        setTimeout(() => document.querySelector('.hero-section')?.classList.remove('threshold-crossed'), 1000);
    }
    
    // Cost milestones (every $100)
    const costHundreds = Math.floor(totalCost / 100);
    const costKey = `cost_${costHundreds}hundred`;
    if (costHundreds >= 1 && !shownAchievements.has(costKey)) {
        shownAchievements.add(costKey);
        newAchievement = true;
        notify(`Milestone Reached: $${costHundreds * 100} Total Spent!`, 'success');
    }
    
    // Save to localStorage if any new achievements were shown
    if (newAchievement) {
        saveShownAchievements(shownAchievements);
    }
};

// ===== VIEW SWITCHING =====
/**
 * @param {string} view
 */
const setView = (view) => {
    setCurrentView(view);

    // Close any open overlays when leaving analytics/dashboard views
    if (view !== 'analytics') {
        /** @type {any} */ (window).closeCommitDetails?.();
        /** @type {any} */ (window).closeInvestigation?.();
    }

    // Update nav
    document.querySelectorAll('.nav-btn').forEach(el => {
        /** @type {HTMLElement} */ (el).classList.toggle('active', /** @type {HTMLElement} */ (el).dataset.view === view);
    });

    // Smooth transition between views
    const dashboard = document.getElementById('view-dashboard');
    const analytics = document.getElementById('view-analytics');

    if (view === 'dashboard') {
        if (analytics) analytics.classList.remove('active');
        setTimeout(() => {
            if (analytics) analytics.style.display = 'none';
            if (dashboard) dashboard.style.display = 'block';
            if (dashboard) requestAnimationFrame(() => dashboard.classList.add('active'));
        }, 300);
    } else {
        if (dashboard) dashboard.classList.remove('active');
        setTimeout(() => {
            if (dashboard) dashboard.style.display = 'none';
            if (analytics) analytics.style.display = 'block';
            if (analytics) requestAnimationFrame(() => analytics.classList.add('active'));
        }, 300);
    }

    // Render
    if (view === 'dashboard') renderDashboard(true);
    if (view === 'analytics') renderAnalytics(true);
};

// ===== THEME =====
const THEME_GLYPHS = { dark: '☾', light: '☀' };

/**
 * @param {string} theme
 */
const updateThemeToggleGlyph = (theme) => {
    const toggle = document.querySelector('.theme-toggle');
    if (toggle) toggle.textContent = /** @type {Record<string, string>} */ (THEME_GLYPHS)[theme] || THEME_GLYPHS.dark;
};

const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tokenBurnTheme', next);
    updateThemeToggleGlyph(next);
    resizeVisiblePlots();
};

// ===== RENDER ALL (for data updates) =====
const renderAll = () => {
    const activeBtn = document.querySelector('.nav-btn.active');
    const view = /** @type {HTMLElement} */ (activeBtn)?.dataset.view || 'dashboard';

    if (view === 'dashboard') {
        renderDashboard(false);
        updateDashboardCharts();
    }
    if (view === 'analytics') renderAnalytics(false);
};

/** @type {any} */ (window).renderAll = renderAll;
/** @type {any} */ (window).animateNumber = animateNumber;
/** @type {any} */ (window).checkThresholds = checkThresholds;

// ===== EXPORTS FOR INLINE HANDLERS =====
/** @type {any} */ (window).setView = setView;
/** @type {any} */ (window).toggleTheme = toggleTheme;
/** @type {any} */ (window).setAnalyticsTab = setAnalyticsTabHandler;
/** @type {any} */ (window).setAnalyticsRange = setAnalyticsRangeHandler;
/** @type {any} */ (window).handleSearch = (/** @type {string} */ val) => {
    import('./views/analytics.js').then(m => m.handleSearch(val));
};
/** @type {any} */ (window).sortBy = (/** @type {string} */ col) => {
    import('./views/analytics.js').then(m => m.sortBy(col));
};
/** @type {any} */ (window).generateDeepInsights = () => {
    import('./views/analytics.js').then(m => m.generateDeepInsights());
};
/** @type {any} */ (window).generateLLMInsights = () => {
    import('./views/analytics.js').then(m => m.generateLLMInsights());
};
/** @type {any} */ (window).loadGitBlame = () => {
    import('./views/analytics.js').then(m => m.loadGitBlame());
};
/** @type {any} */ (window).investigateSpike = (/** @type {number} */ timestamp) => {
    import('./views/analytics.js').then(m => m.investigateSpike(timestamp));
};
/** @type {any} */ (window).closeInvestigation = () => {
    import('./views/analytics.js').then(m => m.closeInvestigation());
};
/** @type {any} */ (window).updateHeatmap = () => {
    import('./views/analytics.js').then(m => {
        if (m.updateHeatmap) m.updateHeatmap();
        else console.log('Heatmap update not available');
    });
};
/** @type {any} */ (window).setHeatmapMetric = (/** @type {string} */ metric) => {
    import('./views/analytics.js').then(m => m.setHeatmapMetric?.(metric));
};
/** @type {any} */ (window).retryModelsDevPricing = () => {
    import('./views/analytics.js').then(m => m.retryModelsDevPricing?.());
};
/** @type {any} */ (window).showCommitDetails = (/** @type {string} */ hash) => {
    import('./views/analytics.js').then(m => m.showCommitDetails(hash));
};
/** @type {any} */ (window).toggleSessionMessages = (/** @type {number} */ idx) => {
    import('./views/analytics.js').then(m => m.toggleSessionMessages(idx));
};
/** @type {any} */ (window).closeCommitDetails = () => {
    import('./views/analytics.js').then(m => m.closeCommitDetails());
};
/** @type {any} */ (window).toggleSpikeSession = (/** @type {number} */ idx) => {
    import('./views/analytics.js').then(m => m.toggleSpikeSession(idx));
};

// ===== INIT =====
export const getSavedTheme = () => {
    try {
        return localStorage.getItem('tokenBurnTheme') || 'dark';
    } catch {
        return 'dark';
    }
};

const init = async () => {
    // Load theme
    const savedTheme = getSavedTheme();
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeToggleGlyph(savedTheme);

    // Initialize ambient particles
    initParticles();

    // Position notifications below the header
    positionNotifications();
    window.addEventListener('resize', positionNotifications);

    // Load cache
    const cached = loadCache();
    loadHistoryFromCache();
    if (cached) updateData(cached);

    // Setup nav
    document.querySelectorAll('.nav-btn').forEach(el => {
        el.addEventListener('click', () => setView(/** @type {HTMLElement} */ (el).dataset.view ?? 'dashboard'));
    });

    // Load pricing table before the first render so the dashboard doesn't
    // flash default pricing while the fetch is in flight.
    await loadPricing();

    // Initial render with animation
    const viewDashboard = document.getElementById('view-dashboard');
    if (viewDashboard) viewDashboard.classList.add('active');
    setView('dashboard');

    // Fetch fresh data (includes historical for charts)
    refreshData();

    // Connect SSE
    connectSSE();

    // Prefetch Git and Spike Detective data in the background so those tabs
    // are already populated on first visit instead of showing a loading
    // skeleton every time.
    loadGitBlame();
    loadSpikes();
};

// Start
document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
