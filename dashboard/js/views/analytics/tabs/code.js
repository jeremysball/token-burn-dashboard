import { fmtNum, currentData } from './shared.js';

// ===== CODE STATS TAB =====
const CODE_STATS = {
    languages: [
        { ext: '.js', name: 'JavaScript', tokensPerLine: 8, color: '#f7df1e' },
        { ext: '.ts', name: 'TypeScript', tokensPerLine: 9, color: '#3178c6' },
        { ext: '.py', name: 'Python', tokensPerLine: 6, color: '#3776ab' },
        { ext: '.java', name: 'Java', tokensPerLine: 10, color: '#b07219' },
        { ext: '.cpp', name: 'C++', tokensPerLine: 11, color: '#f34b7d' },
        { ext: '.go', name: 'Go', tokensPerLine: 7, color: '#00add8' },
        { ext: '.rs', name: 'Rust', tokensPerLine: 8, color: '#dea584' },
        { ext: '.rb', name: 'Ruby', tokensPerLine: 6, color: '#701516' },
        { ext: '.php', name: 'PHP', tokensPerLine: 8, color: '#4f5d95' },
        { ext: '.swift', name: 'Swift', tokensPerLine: 9, color: '#ffac45' }
    ]
};

export const renderCodeStatsTab = () => {
    const summaryContainer = document.getElementById('code-summary');
    const breakdownContainer = document.getElementById('code-breakdown');
    if (!summaryContainer || !breakdownContainer || !currentData) return;

    const totalTokens = currentData.total_tokens || 0;
    const totalLines = currentData.total_lines || 0;
    const filesProcessed = currentData.files_processed || 0;

    // Calculate equivalent lines in different languages
    const langStats = CODE_STATS.languages.map(lang => ({
        ...lang,
        equivalentLines: Math.round(totalTokens / lang.tokensPerLine)
    }));

    summaryContainer.innerHTML = `
        <div class="code-summary-grid">
            <div class="code-stat-card primary">
                <div class="code-stat-value">${fmtNum(totalLines)}</div>
                <div class="code-stat-label">Lines of Code Processed</div>
            </div>
            <div class="code-stat-card">
                <div class="code-stat-value">${fmtNum(filesProcessed)}</div>
                <div class="code-stat-label">Files Analyzed</div>
            </div>
            <div class="code-stat-card">
                <div class="code-stat-value">${fmtNum(totalTokens / (filesProcessed || 1))}</div>
                <div class="code-stat-label">Avg Tokens per File</div>
            </div>
            <div class="code-stat-card">
                <div class="code-stat-value">${fmtNum(totalTokens / (totalLines || 1))}</div>
                <div class="code-stat-label">Avg Tokens per Line</div>
            </div>
        </div>
    `;

    breakdownContainer.innerHTML = `
        <h4>Equivalent Code Volume by Language</h4>
        <p class="code-explanation">Your ${fmtNum(totalTokens)} tokens could represent this many lines of code:</p>
        <div class="code-lang-grid">
            ${langStats.map(lang => `
                <div class="code-lang-card">
                    <div class="code-lang-color" style="background: ${lang.color}"></div>
                    <div class="code-lang-info">
                        <div class="code-lang-name">${lang.name}</div>
                        <div class="code-lang-tokens">~${lang.tokensPerLine} tokens/line</div>
                    </div>
                    <div class="code-lang-lines">${fmtNum(lang.equivalentLines)}</div>
                </div>
            `).join('')}
        </div>
        <div class="code-project-comparison">
            <h4>Project Scale Comparison</h4>
            <div class="project-comparisons">
                <div class="project-comp">
                    <span class="project-name">Linux Kernel</span>
                    <span class="project-bar">
                        <span class="project-fill" style="width: ${Math.min((totalLines / 30000000) * 100, 100)}%"></span>
                    </span>
                    <span class="project-pct">${(totalLines / 30000000 * 100).toFixed(3)}%</span>
                </div>
                <div class="project-comp">
                    <span class="project-name">VS Code</span>
                    <span class="project-bar">
                        <span class="project-fill" style="width: ${Math.min((totalLines / 15000000) * 100, 100)}%"></span>
                    </span>
                    <span class="project-pct">${(totalLines / 15000000 * 100).toFixed(3)}%</span>
                </div>
                <div class="project-comp">
                    <span class="project-name">React</span>
                    <span class="project-bar">
                        <span class="project-fill" style="width: ${Math.min((totalLines / 150000) * 100, 100)}%"></span>
                    </span>
                    <span class="project-pct">${(totalLines / 150000 * 100).toFixed(1)}%</span>
                </div>
            </div>
        </div>
    `;
};

