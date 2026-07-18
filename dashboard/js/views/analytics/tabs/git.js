import {
    fmtNum, fmtInt, escapeHtml
} from './shared.js';
import { getGitBlameCache, setGitBlameCache, getGitBlameCwd, setGitBlameCwd } from './shared.js';

// ===== GIT BLAME TAB =====

export const renderGitBlameTab = () => {
    if (getGitBlameCache()) {
        renderGitBlameData(getGitBlameCache());
        return;
    }
    loadGitBlame();
};

export const loadGitBlame = async () => {
    const days = document.getElementById('git-days-selector')?.value || 30;
    const cwd = document.getElementById('git-directory-selector')?.value || '';
    setGitBlameCwd(cwd);
    
    // Show loading state with skeleton
    document.getElementById('git-commits-list').innerHTML = `
        <div class="git-blame-loading">
            <div class="loading-spinner"></div>
            <p>Analyzing git history...</p>
        </div>
    `;
    document.getElementById('git-files-list').innerHTML = `
        <div class="git-blame-loading">
            <div class="loading-spinner"></div>
            <p>Loading project costs...</p>
        </div>
    `;
    
    try {
        const params = new URLSearchParams({ days });
        if (cwd) params.append('cwd', cwd);
        
        const response = await fetch(`/api/git/blame?${params}`);
        if (!response.ok) throw new Error('Failed to load');
        
        const data = await response.json();
        setGitBlameCache(data);
        renderGitBlameData(data);
        
        // Update directory selector if directories are returned
        if (data.directories) {
            updateDirectorySelector(data.directories, cwd);
        }
    } catch (err) {
        document.getElementById('git-commits-list').innerHTML = `
            <div class="git-blame-empty">
                <div class="git-blame-empty-icon">⚠️</div>
                <h4>Unable to load git data</h4>
                <p>${err.message}</p>
            </div>
        `;
        document.getElementById('git-files-list').innerHTML = `
            <div class="git-blame-empty">
                <div class="git-blame-empty-icon">📁</div>
                <h4>No project data</h4>
                <p>Could not load project cost analysis</p>
            </div>
        `;
    }
};

const updateDirectorySelector = (directories, selectedCwd) => {
    const selector = document.getElementById('git-directory-selector');
    if (!selector || !directories) return;
    
    const currentValue = selector.value || selectedCwd || '';
    
    selector.innerHTML = directories.map(dir => {
        const icon = dir.isGitRepo ? '📁' : '📂';
        const selected = dir.path === currentValue ? 'selected' : '';
        return `<option value="${dir.path}" ${selected}>${icon} ${dir.name}</option>`;
    }).join('');
    
    // Restore selection if possible
    if (currentValue) {
        selector.value = currentValue;
    }
};

export const renderGitBlameData = (data) => {
    // Summary stats
    const totalCommits = data.commits.length;
    const totalCost = data.commits.reduce((sum, c) => sum + c.cost, 0);
    const totalSessions = data.commits.reduce((sum, c) => sum + c.sessions, 0);
    
    document.getElementById('git-total-commits').textContent = fmtInt(totalCommits);
    document.getElementById('git-total-cost').textContent = `$${totalCost.toFixed(2)}`;
    document.getElementById('git-total-sessions').textContent = fmtInt(totalSessions);
    
    // Commits list - now with files
    const commitsList = document.getElementById('git-commits-list');
    const visibleCommits = data.commits.slice(0, 10);
    commitsList.innerHTML = visibleCommits.map((commit, idx) => {
        const files = commit.files || [];
        const fileList = files.slice(0, 3).map(f => `<span class="commit-file">${escapeHtml(f.split('/').pop())}</span>`).join('');
        const moreFiles = files.length > 3 ? `<span class="commit-file-more">+${files.length - 3} more</span>` : '';
        
        return `
        <div class="git-commit-item" data-commit-index="${idx}" role="button" tabindex="0" style="cursor: pointer;">
            <div class="commit-main">
                <div class="commit-hash">${escapeHtml(commit.hash)}</div>
                <div class="commit-message">${escapeHtml(commit.message)}</div>
                <div class="commit-files">
                    ${fileList}${moreFiles}
                </div>
            </div>
            <div class="commit-stats">
                <span class="commit-stat cost">$${commit.cost.toFixed(2)}</span>
                <span class="commit-stat">${fmtInt(commit.tokens)} tokens</span>
                <span class="commit-stat">${fmtInt(commit.sessions)} session${commit.sessions !== 1 ? 's' : ''}</span>
            </div>
        </div>
    `}).join('');

    commitsList.querySelectorAll('.git-commit-item').forEach(item => {
        const commit = visibleCommits[Number(item.dataset.commitIndex)];
        if (!commit) return;
        const open = () => showCommitDetails(commit.hash);
        item.addEventListener('click', open);
        item.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
    });
    
    // Project list
    const projects = data.projects || data.files || [];
    const filesList = document.getElementById('git-files-list');
    filesList.innerHTML = projects.slice(0, 10).map(project => `
        <div class="git-file-item">
            <div class="file-name">${escapeHtml(project.project || project.file)}</div>
            <div class="file-cost">$${project.cost.toFixed(2)} across ${fmtInt(project.commits)} commits</div>
            ${project.files?.length ? `<div class="commit-click-hint">${project.files.map(f => escapeHtml(f.split('/').pop())).join(' · ')}</div>` : ''}
        </div>
    `).join('');
};

export const showCommitDetails = async (commitHash) => {
    const modal = document.getElementById('commit-details-modal');
    const content = document.getElementById('commit-details-content');
    
    if (!modal || !content) return;
    
    modal.style.display = 'flex';
    content.innerHTML = `
        <div class="commit-details-loading">
            <div class="loading-spinner"></div>
            <p>Loading session details...</p>
        </div>
    `;
    
    try {
        const days = document.getElementById('git-days-selector')?.value || 30;
        const params = new URLSearchParams({ days, commit: commitHash });
        if (getGitBlameCwd()) params.append('cwd', getGitBlameCwd());
        
        const response = await fetch(`/api/git/blame?${params}`);
        if (!response.ok) throw new Error('Failed to load commit details');
        
        const data = await response.json();
        renderCommitDetails(content, data);
    } catch (err) {
        content.innerHTML = `<div class="commit-details-error">Error: ${err.message}</div>`;
    }
};

export const renderCommitDetails = (container, data) => {
    const { commit, sessions, summary } = data;
    
    container.innerHTML = `
        <div class="commit-details-header">
            <div class="commit-details-hash">${escapeHtml(commit.hash)}</div>
            <div class="commit-details-message">${escapeHtml(commit.message)}</div>
            <div class="commit-details-date">${new Date(commit.date).toLocaleString()}</div>
        </div>
        
        <div class="commit-details-summary">
            <div class="summary-item">
                <span class="summary-label">Sessions</span>
                <span class="summary-value">${summary.totalSessions}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Total Tokens</span>
                <span class="summary-value">${fmtNum(summary.totalTokens)}</span>
            </div>
            <div class="summary-item">
                <span class="summary-label">Total Cost</span>
                <span class="summary-value">$${summary.totalCost.toFixed(2)}</span>
            </div>
        </div>
        
        <div class="commit-sessions-list">
            <h4>Sessions (${sessions.length})</h4>
            ${sessions.map((session, idx) => `
                <div class="session-card">
                    <div class="session-header" data-session-toggle="${idx}" role="button" tabindex="0" style="cursor: pointer;">
                        <span class="session-id">${escapeHtml(session.id)}</span>
                        <span class="session-cost">$${session.cost.toFixed(2)}</span>
                        <span class="session-tokens">${fmtNum(session.tokens)} tokens</span>
                        <span class="session-toggle">▼</span>
                    </div>
                    <div class="session-models">
                        ${Object.entries(session.models).map(([model, stats]) => `
                            <span class="session-model-tag" title="${escapeHtml(`${model}: ${fmtNum(stats.tokens)} tokens, ${stats.calls} calls`)}">
                                ${escapeHtml(model.split('/').pop())}: $${stats.cost.toFixed(2)}
                            </span>
                        `).join('')}
                    </div>
                    <div class="session-messages" id="session-messages-${idx}" style="display: none;">
                        ${session.messages.slice(0, 5).map(msg => `
                            <div class="message-item">
                                <div class="message-meta">
                                    <span class="message-model">${escapeHtml(msg.model.split('/').pop())}</span>
                                    <span class="message-cost">$${msg.cost.toFixed(3)}</span>
                                    <span class="message-tokens">${fmtNum(msg.tokens)} tokens</span>
                                </div>
                                <div class="message-preview">${escapeHtml(msg.preview)}</div>
                            </div>
                        `).join('')}
                        ${session.messages.length > 5 ? `<div class="message-more">+${session.messages.length - 5} more messages</div>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    container.querySelectorAll('.session-header[data-session-toggle]').forEach(header => {
        const idx = Number(header.dataset.sessionToggle);
        const toggle = () => toggleSessionMessages(idx);
        header.addEventListener('click', toggle);
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle();
            }
        });
    });
};

export const toggleSessionMessages = (idx) => {
    const messagesEl = document.getElementById(`session-messages-${idx}`);
    const toggleEl = messagesEl?.previousElementSibling?.previousElementSibling?.querySelector('.session-toggle');
    
    if (messagesEl) {
        const isVisible = messagesEl.style.display !== 'none';
        messagesEl.style.display = isVisible ? 'none' : 'block';
        if (toggleEl) {
            toggleEl.textContent = isVisible ? '▼' : '▲';
        }
    }
};

export const closeCommitDetails = () => {
    const modal = document.getElementById('commit-details-modal');
    if (modal) modal.style.display = 'none';
};

