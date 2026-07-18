import { fmtNum, CHART_COLORS, currentData, historyData, searchTerm, sortCol, sortAsc, getPricingForModel, formatModelPrice, formatModelPriceDetails, getPricingSourceMeta, createSparkline, escapeHtml } from './shared.js';

export function renderModelsTab(tbody) {
    if (!tbody) tbody = document.getElementById('models-tbody');
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
        const displayName = name.split('/').pop();

        return `
            <tr style="animation-delay: ${index * 0.05}s">
                <td>
                    <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color}; flex: 0 0 auto;"></span>
                        <div style="display: flex; flex-direction: column; min-width: 0;">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(displayName)}</span>
                            <div style="display: flex; align-items: center; gap: 6px; min-width: 0; margin-top: 2px;">
                                <span class="pricing-source-badge ${sourceMeta.source}" title="${escapeHtml(sourceMeta.title)}">${escapeHtml(sourceMeta.label)}</span>
                                <span class="model-price" title="${escapeHtml(priceTitle)}" style="font-size: 0.72rem; color: var(--mono-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${escapeHtml(priceSummary)}
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
}
