// ===== FORMATTERS =====
export const fmtNum = n => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return Math.round(n).toString();
};

export const fmtCur = n => {
    if (n >= 1) return '$' + n.toFixed(2);
    if (n >= 0.01) return '$' + n.toFixed(3);
    return '$' + n.toFixed(4);
};

export const fmtDate = (date) => {
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

// ===== SPARKLINE =====
export const createSparkline = (data, width = 100, height = 30) => {
    if (!data || data.length < 2) return '';
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    
    const points = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((v - min) / range) * height * 0.8 - height * 0.1;
        return `${x},${y}`;
    }).join(' ');
    
    const gradientId = 'sparkGradient' + Math.random().toString(36).substr(2, 9);
    return `
        <svg width="${width}" height="${height}" class="sparkline">
            <defs>
                <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" style="stop-color:var(--mono-accent);stop-opacity:0.3" />
                    <stop offset="100%" style="stop-color:var(--mono-accent);stop-opacity:0" />
                </linearGradient>
            </defs>
            <polygon points="0,${height} ${points} ${width},${height}" fill="url(#${gradientId})" />
            <polyline points="${points}" fill="none" stroke="var(--mono-accent)" stroke-width="1.5" 
                      stroke-linecap="round" stroke-linejoin="round" />
        </svg>
    `;
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
