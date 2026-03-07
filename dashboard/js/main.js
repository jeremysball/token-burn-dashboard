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
    
    if (isNaN(startNum) || isNaN(endNum)) {
        element.textContent = prefix + endValue + suffix;
        return;
    }
    
    // Add ticking animation class
    element.classList.add('ticking');
    
    const animate = (currentTime) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Easing function (ease-out-cubic)
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const current = startNum + (endNum - startNum) * easeOut;
        
        // Format based on magnitude
        let formatted;
        if (endNum >= 1000000) {
            formatted = (current / 1000000).toFixed(2) + 'M';
        } else if (endNum >= 1000) {
            formatted = (current / 1000).toFixed(1) + 'k';
        } else if (endNum % 1 !== 0) {
            formatted = current.toFixed(2);
        } else {
            formatted = Math.round(current).toLocaleString();
        }
        
        element.textContent = prefix + formatted + suffix;
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            element.classList.remove('ticking');
            // Final formatted value
            element.textContent = prefix + (typeof endValue === 'number' ? fmtNum(endValue) : endValue) + suffix;
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
let lastTokenMilestone = 0;
let lastCostMilestone = 0;

const checkThresholds = (totalTokens, totalCost) => {
    // Token milestones (billions)
    const tokenBillions = Math.floor(totalTokens / 1000000000);
    if (tokenBillions > lastTokenMilestone && tokenBillions >= 1) {
        lastTokenMilestone = tokenBillions;
        notify(`🎉 Milestone Reached: ${tokenBillions}B Tokens!`, 'success');
        document.querySelector('.hero-section')?.classList.add('threshold-crossed');
        setTimeout(() => document.querySelector('.hero-section')?.classList.remove('threshold-crossed'), 1000);
    }
    
    // Cost milestones (every $100)
    const costHundreds = Math.floor(totalCost / 100);
    if (costHundreds > lastCostMilestone && costHundreds >= 1) {
        lastCostMilestone = costHundreds;
        notify(`💰 Milestone Reached: $${costHundreds * 100} Total Spent!`, 'success');
    }
};

// ===== VIEW SWITCHING =====
const setView = (view) => {
    setCurrentView(view);

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
