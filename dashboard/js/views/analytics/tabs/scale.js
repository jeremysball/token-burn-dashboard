import { fmtNum, fmtInt, fmtMultiple, currentData } from './shared.js';

const SCALE_COMPARISONS = [
    { name: 'Tweet', tokens: 280, icon: '🐦', desc: 'A single tweet' },
    { name: 'Paragraph', tokens: 200, icon: '📄', desc: 'Average paragraph' },
    { name: 'Page', tokens: 500, icon: '📃', desc: 'Single typed page' },
    { name: 'Short Story', tokens: 7500, icon: '📖', desc: 'Short story (15 pages)' },
    { name: 'Novel Chapter', tokens: 25000, icon: '📚', desc: 'One book chapter' },
    { name: 'Novel', tokens: 100000, icon: '📕', desc: 'Full novel (200 pages)' },
    { name: 'Shakespeare Play', tokens: 300000, icon: '🎭', desc: 'Complete Shakespeare play' },
    { name: 'Bible', tokens: 4000000, icon: '✝️', desc: 'The entire Bible' },
    { name: 'Encyclopedia', tokens: 40000000, icon: '📚', desc: 'Full encyclopedia set' },
    { name: 'Codebase', tokens: 100000000, icon: '💻', desc: 'Large software codebase' }
];

export function renderScaleTab(container) {
    if (!container || !currentData) return;

    const totalTokens = currentData.total_tokens || 0;

    // Find the largest comparison we exceed
    const exceeded = SCALE_COMPARISONS.filter(c => totalTokens >= c.tokens);
    const nextMilestone = SCALE_COMPARISONS.find(c => totalTokens < c.tokens);

    container.innerHTML = `
        <div class="scale-hero">
            <div class="scale-total">
                <span class="scale-number" title="${fmtInt(totalTokens)}">${fmtNum(totalTokens)}</span>
                <span class="scale-label">total tokens</span>
            </div>
            <div class="scale-equivalent">
                ${exceeded.length > 0 ? `
                    <span class="scale-eq-label">Equivalent to</span>
                    <span class="scale-eq-value">${(totalTokens / exceeded[exceeded.length - 1].tokens).toFixed(1)} ${exceeded[exceeded.length - 1].name}s</span>
                ` : ''}
            </div>
        </div>
        <div class="scale-progress-section">
            ${nextMilestone ? `
                <div class="scale-next">
                    <span class="scale-next-label">Next milestone: ${nextMilestone.name}</span>
                    <div class="scale-progress-bar">
                        <div class="scale-progress-fill" style="width: ${Math.min((totalTokens / nextMilestone.tokens) * 100, 100)}%"></div>
                    </div>
                    <span class="scale-next-remaining">${fmtInt(nextMilestone.tokens - totalTokens)} tokens to go</span>
                </div>
            ` : '<div class="scale-achieved">🎉 All milestones achieved!</div>'}
        </div>
        <div class="scale-grid">
            ${SCALE_COMPARISONS.map(comp => {
                const achieved = totalTokens >= comp.tokens;
                return `
                    <div class="scale-card ${achieved ? 'achieved' : ''}">
                        <div class="scale-icon">${comp.icon}</div>
                        <div class="scale-name">${comp.name}</div>
                        <div class="scale-desc">${comp.desc}</div>
                        <div class="scale-tokens">${fmtInt(comp.tokens)} tokens</div>
                        ${achieved ? `<div class="scale-multiple">${fmtMultiple(comp.tokens ? totalTokens / comp.tokens : 0)}</div>` : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}
