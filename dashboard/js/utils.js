// ===== FORMATTERS =====
export const fmtNum = n => {
    const num = Number(n) || 0;
    if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
    return Math.round(num).toString();
};

export const fmtInt = n => Number(n || 0).toLocaleString();

export const fmtCur = n => {
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(3);
    return '$' + n.toFixed(4);
};

export const fmtDate = (date) => {
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

export const fmtMultiple = n => {
    const num = Number(n) || 0;
    if (num < 10) return num.toFixed(1) + '×';
    return Math.floor(num).toLocaleString() + '×';
};

// ===== MODEL KEY PARSING =====
export const splitModelKey = (key) => {
    const str = String(key || '');
    const idx = str.indexOf('/');
    if (idx === -1) return { provider: '', model: str };
    return { provider: str.slice(0, idx), model: str.slice(idx + 1) };
};

export const displayModel = (key) => {
    const { provider, model } = splitModelKey(key);
    return provider ? `${provider}/${model}` : model;
};

export const parseModelKey = (key) => {
    const routers = new Set(['openrouter', 'openpipe']);
    const { provider, model } = splitModelKey(key);
    let routingProvider = null;
    let vendor;
    let modelId;
    let canonical;

    if (routers.has(provider)) {
        routingProvider = provider;
        const secondIdx = model.indexOf('/');
        if (secondIdx !== -1) {
            vendor = model.slice(0, secondIdx);
            modelId = model.slice(secondIdx + 1);
            canonical = model;
        } else {
            vendor = '';
            modelId = model;
            canonical = model;
        }
    } else if (!provider) {
        vendor = '';
        modelId = model;
        canonical = model;
    } else {
        vendor = provider;
        modelId = model;
        canonical = `${provider}/${model}`;
        if (!model) {
            vendor = '';
            modelId = '';
            canonical = provider;
        }
    }

    return {
        routingProvider,
        vendor,
        modelId,
        canonical,
        originalKey: key,
        provider,
        model
    };
};

// ===== PRICING HELPERS (centralized) =====
export const getPricingForModel = (name, pricing_by_model) => {
    if (pricing_by_model && pricing_by_model[name]) return pricing_by_model[name];
    return null;
};

export const formatModelPrice = (pricing) => {
    if (!pricing) return 'Price unavailable';
    const input = pricing.input || 0;
    const output = pricing.output || 0;
    return `${input.toFixed(2)} in / ${output.toFixed(2)} out`;
};

export const escapeHtml = (text) => {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// ===== SPARKLINE (unified DRY) =====
export const createSparkline = (data, width = 100, height = 30, opts = { gradient: true }) => {
    if (!data || data.length < 2) return '';
    const max = Math.max(...data, 1);
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - (v / max) * height * 0.8 - height * 0.1;
        return `${x},${y}`;
    }).join(' ');

    if (opts && opts.gradient) {
        const gradientId = 'spark' + Math.random().toString(36).slice(2, 7);
        return `<svg width="${width}" height="${height}" class="sparkline"><defs><linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:var(--mono-accent);stop-opacity:0.3"/><stop offset="100%" style="stop-color:var(--mono-accent);stop-opacity:0"/></linearGradient></defs><polygon points="0,${height} ${points} ${width},${height}" fill="url(#${gradientId})"/><polyline points="${points}" fill="none" stroke="var(--mono-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    return `<svg width="${width}" height="${height}" style="opacity:0.7"><polyline points="${points}" fill="none" stroke="var(--mono-accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};

// ===== NOTIFICATIONS =====
export const notify = (msg, type = 'info') => {
    const container = document.getElementById('notifications');
    if (!container) return;
    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = msg;
    container.appendChild(notif);
    setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
};

// ===== DOM HELPERS =====
export const setText = (el, text) => {
    if (el) el.textContent = text;
};

export const hide = (el) => {
    if (el) el.style.display = 'none';
};

export const show = (el, display = 'block') => {
    if (el) el.style.display = display;
};

// ===== PLOTLY HELPERS =====
export const getPlotlyLayout = (extra = {}) => {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const bg = isDark ? '#141414' : '#ffffff';
    const gridColor = isDark ? '#1e1e1e' : '#e5e5e5';
    const textColor = isDark ? '#737373' : '#525252';
    const lineColor = isDark ? '#2a2a2a' : '#d4d4d4';
    
    return {
        paper_bgcolor: bg,
        plot_bgcolor: bg,
        font: { family: 'IBM Plex Mono, monospace', size: 11, color: textColor },
        margin: { t: 10, r: 10, b: 40, l: 50 },
        xaxis: {
            gridcolor: gridColor,
            linecolor: lineColor,
            zerolinecolor: lineColor,
            tickfont: { size: 10 },
        },
        yaxis: {
            gridcolor: gridColor,
            linecolor: lineColor,
            zerolinecolor: lineColor,
            tickfont: { size: 10 },
        },
        hovermode: 'x unified',
        showlegend: false,
        ...extra
    };
};

export const getPlotlyConfig = () => ({
    displayModeBar: false,
    responsive: true
});

// ===== PLOTLY RESIZE =====
const LIVE_PLOT_CONTAINER_IDS = [
    'dashboard-live-chart',
    'compare-chart-container',
    'timeline-chart-container',
    'calendar-container',
    'distribution-chart-container'
];

export const resizeVisiblePlots = () => {
    if (typeof Plotly === 'undefined' || !Plotly.Plots) return;
    LIVE_PLOT_CONTAINER_IDS.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.data) Plotly.Plots.resize(el);
    });
};

// ===== NOTIFICATION POSITIONING =====
export const positionNotifications = () => {
    const header = document.querySelector('.dashboard-header');
    const container = document.getElementById('notifications');
    if (!header || !container) return;

    const bottom = header.getBoundingClientRect().bottom;
    container.style.top = `${Math.round(bottom) + 12}px`;
    container.style.bottom = '';
};
