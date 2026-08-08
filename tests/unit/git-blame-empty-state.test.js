import { beforeEach, describe, expect, it } from 'bun:test';
import { renderGitBlameData } from '../../dashboard/js/views/analytics';

describe('renderGitBlameData empty states (#118 finding 11)', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="git-total-commits"></div>
            <div id="git-total-cost"></div>
            <div id="git-total-sessions"></div>
            <div id="git-commits-list"></div>
            <div id="git-files-list"></div>
        `;
    });

    it('shows messaging instead of a blank box when there are no commits', () => {
        renderGitBlameData({ commits: [], projects: [] });

        const commitsList = document.getElementById('git-commits-list');
        expect(commitsList.innerHTML.trim()).not.toBe('');
        expect(commitsList.querySelector('.git-blame-empty')).not.toBeNull();
        expect(commitsList.textContent).toContain('No commits found');
    });

    it('shows messaging instead of a blank box when there is no project data', () => {
        renderGitBlameData({ commits: [], projects: [] });

        const filesList = document.getElementById('git-files-list');
        expect(filesList.innerHTML.trim()).not.toBe('');
        expect(filesList.querySelector('.git-blame-empty')).not.toBeNull();
        expect(filesList.textContent).toContain('No project data');
    });

    it('still renders real commit/project cards when data is present, not the empty state', () => {
        renderGitBlameData({
            commits: [{ hash: 'abc123', message: 'fix bug', cost: 1.5, tokens: 1000, sessions: 1, files: [] }],
            projects: [{ project: 'my-repo', cost: 1.5, commits: 1 }]
        });

        const commitsList = document.getElementById('git-commits-list');
        expect(commitsList.querySelector('.git-blame-empty')).toBeNull();
        expect(commitsList.querySelector('.git-commit-item')).not.toBeNull();

        const filesList = document.getElementById('git-files-list');
        expect(filesList.querySelector('.git-blame-empty')).toBeNull();
        expect(filesList.querySelector('.git-file-item')).not.toBeNull();
    });
});
