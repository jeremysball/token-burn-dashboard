import { fmtNum, notify } from './utils.js';
import { setCurrentView, loadCache, loadHistoryFromCache } from './state.js';
import { connectSSE, updateData, refreshData } from './api.js';
import { renderDashboard, updateDashboardCharts } from './views/dashboard.js';
import { renderAnalytics, setAnalyticsTabHandler, setAnalyticsRangeHandler } from './views/analytics.js';

// ===== ANIMATED NUMBER COUNTER =====

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

const saveShownAchievements = (achievements) => {
    try {
        localStorage.setItem('tokenBurnAchievements', JSON.stringify([...achievements]));
    } catch {
        // Ignore localStorage errors
    }
};

const shownAchievements = getShownAchievements();

const checkThresholds = (totalTokens, totalCost) => {
    let newAchievement = false;
    
    // Token milestones (billions)
    const tokenBillions = Math.floor(totalTokens / 1000000000);
    const tokenKey = `tokens_${tokenBillions}B`;
    if (tokenBillions >= 1 && !shownAchievements.has(tokenKey)) {
        shownAchievements.add(tokenKey);
        newAchievement = true;
        notify(`🎉 Milestone Reached: ${tokenBillions}B Tokens!`, 'success');
        document.querySelector('.hero-section')?.classList.add('threshold-crossed');
        setTimeout(() => document.querySelector('.hero-section')?.classList.remove('threshold-crossed'), 1000);
    }
    
    // Cost milestones (every $100)
    const costHundreds = Math.floor(totalCost / 100);
    const costKey = `cost_${costHundreds}hundred`;
    if (costHundreds >= 1 && !shownAchievements.has(costKey)) {
        shownAchievements.add(costKey);
        newAchievement = true;
        notify(`💰 Milestone Reached: $${costHundreds * 100} Total Spent!`, 'success');
    }
    
    // Save to localStorage if any new achievements were shown
    if (newAchievement) {
        saveShownAchievements(shownAchievements);
    }
};

// ===== VIEW SWITCHING =====
const setView = (view) => {
    setCurrentView(view);

    // Close any open overlays when leaving analytics/dashboard views
    if (view !== 'analytics') {
        window.closeCommitDetails?.();
        window.closeInvestigation?.();
    }

    // Update nav
    document.querySelectorAll('.nav-btn').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });

    // Smooth transition between views
    const dashboard = document.getElementById('view-dashboard');
    const analytics = document.getElementById('view-analytics');
    
    if (view === 'dashboard') {
        analytics.classList.remove('active');
        setTimeout(() => {
            analytics.style.display = 'none';
            dashboard.style.display = 'block';
            requestAnimationFrame(() => dashboard.classList.add('active'));
        }, 300);
    } else {
        dashboard.classList.remove('active');
        setTimeout(() => {
            dashboard.style.display = 'none';
            analytics.style.display = 'block';
            requestAnimationFrame(() => analytics.classList.add('active'));
        }, 300);
    }

    // Render
    if (view === 'dashboard') renderDashboard(true);
    if (view === 'analytics') renderAnalytics(true);
};

// ===== THEME =====
const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tokenBurnTheme', next);
};

// ===== RENDER ALL (for data updates) =====
const renderAll = () => {
    const activeBtn = document.querySelector('.nav-btn.active');
    const view = activeBtn?.dataset.view || 'dashboard';

    if (view === 'dashboard') {
        renderDashboard(false);
        updateDashboardCharts();
    }
    if (view === 'analytics') renderAnalytics(false);
};

window.renderAll = renderAll;
window.animateNumber = animateNumber;
window.checkThresholds = checkThresholds;

// ===== EXPORTS FOR INLINE HANDLERS =====
window.setView = setView;
window.toggleTheme = toggleTheme;
window.setAnalyticsTab = setAnalyticsTabHandler;
window.setAnalyticsRange = setAnalyticsRangeHandler;
window.handleSearch = (val) => {
    import('./views/analytics.js').then(m => m.handleSearch(val));
};
window.sortBy = (col) => {
    import('./views/analytics.js').then(m => m.sortBy(col));
};
window.generateDeepInsights = () => {
    import('./views/analytics.js').then(m => m.generateDeepInsights());
};
window.generateLLMInsights = () => {
    import('./views/analytics.js').then(m => m.generateLLMInsights());
};
window.loadGitBlame = () => {
    import('./views/analytics.js').then(m => m.loadGitBlame());
};
window.investigateSpike = (timestamp) => {
    import('./views/analytics.js').then(m => m.investigateSpike(timestamp));
};
window.closeInvestigation = () => {
    import('./views/analytics.js').then(m => m.closeInvestigation());
};
window.updateHeatmap = () => {
    import('./views/analytics.js').then(m => m.updateHeatmap?.() || console.log('Heatmap update not available'));
};
window.setHeatmapMetric = (metric) => {
    import('./views/analytics.js').then(m => m.setHeatmapMetric?.(metric));
};
window.retryModelsDevPricing = () => {
    import('./views/analytics.js').then(m => m.retryModelsDevPricing?.());
};
window.showCommitDetails = (hash) => {
    import('./views/analytics.js').then(m => m.showCommitDetails(hash));
};
window.toggleSessionMessages = (idx) => {
    import('./views/analytics.js').then(m => m.toggleSessionMessages(idx));
};
window.closeCommitDetails = () => {
    import('./views/analytics.js').then(m => m.closeCommitDetails());
};
window.toggleSpikeSession = (idx) => {
    import('./views/analytics.js').then(m => m.toggleSpikeSession(idx));
};

// ===== INIT =====
const init = () => {
    // Load theme
    const savedTheme = localStorage.getItem('tokenBurnTheme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Initialize ambient particles
    initParticles();

    // Load cache
    const cached = loadCache();
    loadHistoryFromCache();
    if (cached) updateData(cached);

    // Setup nav
    document.querySelectorAll('.nav-btn').forEach(el => {
        el.addEventListener('click', () => setView(el.dataset.view));
    });

    // Initial render with animation
    document.getElementById('view-dashboard').classList.add('active');
    setView('dashboard');

    // Fetch fresh data (includes historical for charts)
    refreshData();

    // Connect SSE
    connectSSE();
};

// Start
document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();
