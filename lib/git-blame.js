/**
 * Git Blame for AI - Per-commit cost attribution
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { calculateCost } = require('./pricing');
const { parseShortStat } = require('./engineering');
const { findAllSessionFiles, sessionIdForFile } = require('./session-discovery');
const { getCachedFileData } = require('./session-parser');

/**
 * Validate commit hash to prevent shell injection
 * Accepts 7-40 hex characters
 * @param {*} h
 * @returns {boolean}
 */
function isValidCommitHash(h) {
  if (typeof h !== 'string') return false;
  return /^[0-9a-f]{7,40}$/i.test(h);
}

const GIT_BLAME_CACHE_TTL = 5 * 60 * 1000;
const gitBlameCache = new Map();

/** @param {string} kind @param {number} days @param {string} cwd @param {string} [extra=''] @returns {string} */
const getCacheKey = (kind, days, cwd, extra = '') => `${kind}:${days}:${cwd}:${extra}`;

/** @param {string} key @returns {*|null} */
const getCachedValue = (key) => {
  const entry = gitBlameCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > GIT_BLAME_CACHE_TTL) {
    gitBlameCache.delete(key);
    return null;
  }
  return entry.value;
};

/** @param {string} key @param {*} value @returns {*} */
const setCachedValue = (key, value) => {
  gitBlameCache.set(key, { timestamp: Date.now(), value });
  return value;
};

/**
 * Check if a directory is a valid git repository
 * @param {string} dir
 * @returns {boolean}
 */
function isGitRepo(dir) {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get available directories (git repos or subdirs) for selection
 * @param {string} [baseDir]
 * @returns {Array<{path: string, name: string, isGitRepo: boolean}>}
 */
function getAvailableDirectories(baseDir = process.cwd()) {
  const dirs = [];
  
  // Always include current directory
  dirs.push({
    path: baseDir,
    name: path.basename(baseDir) || 'root',
    isGitRepo: isGitRepo(baseDir)
  });
  
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('node_modules')) {
        const fullPath = path.join(baseDir, entry.name);
        const gitRepo = isGitRepo(fullPath);
        
        dirs.push({
          path: fullPath,
          name: entry.name,
          isGitRepo: gitRepo
        });
      }
    }
  } catch (err) {
    console.error('Error reading directories:', err instanceof Error ? err.message : String(err));
  }
  
  // Sort: git repos first, then alphabetically
  return dirs.sort((a, b) => {
    if (a.isGitRepo && !b.isGitRepo) return -1;
    if (!a.isGitRepo && b.isGitRepo) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Get git commits with their timestamps
 * @param {string} [since]
 * @param {string} [cwd]
 * @returns {Array<{hash: string, fullHash: string, date: number, message: string, timestamp: string}>}
 */
function getGitCommits(since = '30 days ago', cwd = process.cwd()) {
  try {
    const output = execFileSync(
      'git',
      ['log', `--since=${since}`, '--pretty=format:%H|%ci|%s', '--date=iso'],
      { cwd, encoding: 'utf-8' }
    );

    return output.split('\n').filter(Boolean).map(line => {
      const [hash, date, ...messageParts] = line.split('|');
      return {
        hash: hash.substring(0, 8),
        fullHash: hash,
        date: new Date(date).getTime(),
        message: messageParts.join('|'),
        timestamp: date
      };
    });
  } catch (err) {
    console.error('Git blame error:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Get modified files per commit
 * @param {string} commitHash
 * @param {string} [cwd]
 * @returns {string[]}
 */
function getCommitFiles(commitHash, cwd = process.cwd()) {
  if (!isValidCommitHash(commitHash)) {
    throw new Error('Invalid commit hash');
  }
  try {
    const output = execFileSync(
      'git',
      ['show', '--name-only', '--pretty=format:', `${commitHash}`],
      { cwd, encoding: 'utf-8' }
    );
    return output.split('\n').filter(f => f.trim());
  } catch {
    return [];
  }
}

/**
 * Get lines-of-code changed for a commit via git shortstat.
 * Uses execFileSync with argument arrays (no shell interpolation) and a
 * validated hash to prevent injection. Returns zeroed counts on any failure
 * so callers avoid divide-by-zero.
 * @param {string} commitHash
 * @param {string} [cwd]
 * @returns {{filesChanged: number, insertions: number, deletions: number, loc: number}}
 */
function getCommitLOC(commitHash, cwd = process.cwd()) {
  if (!isValidCommitHash(commitHash)) {
    return { filesChanged: 0, insertions: 0, deletions: 0, loc: 0 };
  }
  try {
    const out = execFileSync(
      'git',
      ['show', '--shortstat', '--format=', `${commitHash}`],
      { cwd, encoding: 'utf-8' }
    );
    return parseShortStat(out);
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0, loc: 0 };
  }
}

/**
 * Read the actual session time window from usage-carrying line timestamps,
 * across both Claude and Pi session formats. Falls back to file mtime if the
 * file cannot be parsed. Thin wrapper over session-parser's cached full-file
 * parse, so repeated calls across overlapping commit windows in the same
 * report don't re-read the same session file from disk.
 * @param {string} filePath
 * @returns {{startTime: number, endTime: number, midpoint: number}}
 */
function getSessionTimeWindow(filePath) {
  const fileData = getCachedFileData(filePath, { collectEvents: false });
  if (fileData.timeWindow) return fileData.timeWindow;

  const stats = fs.statSync(filePath);
  const mtime = stats.mtime.getTime();
  return {
    startTime: mtime,
    endTime: mtime,
    midpoint: mtime
  };
}

/**
 * Group a repository file path into a higher-level project bucket.
 * @param {string} filePath
 * @returns {string}
 */
function getProjectKey(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length === 0) return 'root';
  if (parts[0] === 'examples' && parts[1]) return `examples/${parts[1]}`;
  if (parts.length === 1) return 'root';
  return parts[0];
}

/**
 * Turn file-level costs into project-level costs for the UI.
 * @param {number} [days]
 * @param {string} [cwd]
 * @returns {Array<{project: string, cost: number, commits: number, files: string[]}>}
 */
function getDetectedProjects(days = 30, cwd = process.cwd()) {
  const files = getCostByFile(days, cwd);
  const projects = new Map();

  for (const file of files) {
    const project = getProjectKey(file.file);
    if (!projects.has(project)) {
      projects.set(project, { project, cost: 0, commits: 0, files: [] });
    }

    const entry = projects.get(project);
    entry.cost += file.cost;
    entry.commits += file.commits;
    entry.files.push(file.file);
  }

  return [...projects.values()]
    .map(project => ({
      ...project,
      files: project.files.slice(0, 3)
    }))
    .sort((a, b) => b.cost - a.cost);
}

/** @param {number} [days] @param {string} [cwd] @returns {{commits: Array<*>, projects: Array<*>, files: Array<*>, directories: Array<*>}} */
function computeGitBlameRouteData(days = 30, cwd = process.cwd()) {
  const projects = getDetectedProjects(days, cwd);
  return {
    commits: generateGitBlameReport(days, cwd),
    projects,
    files: projects,
    directories: getAvailableDirectories(cwd)
  };
}

/** @param {number} [days] @param {string} [cwd] @returns {*} */
function getGitBlameRouteData(days = 30, cwd = process.cwd()) {
  const key = getCacheKey('report', days, cwd);
  const cached = getCachedValue(key);
  if (cached) return cached;

  return setCachedValue(key, computeGitBlameRouteData(days, cwd));
}

// Lets a background worker (which computes in a separate thread/module
// instance) hand its result back to prime this module's in-process cache,
// so the next same-key request in the main thread hits the cache instead of
// recomputing on the request path.
/** @param {number} days @param {string} cwd @param {*} value */
function primeGitBlameRouteCache(days, cwd, value) {
  setCachedValue(getCacheKey('report', days, cwd), value);
}

/** @param {string} commitHash @param {number} [days] @param {string} [cwd] @returns {*|null} */
function getGitBlameCommitDetails(commitHash, days = 30, cwd = process.cwd()) {
  const key = getCacheKey('details', days, cwd, commitHash);
  const cached = getCachedValue(key);
  if (cached) return cached;

  const value = getCommitSessionDetails(commitHash, cwd, days);
  return value ? setCachedValue(key, value) : null;
}

/**
 * Match session files to time windows around commits using real interval
 * overlap between the session's [startTime, endTime] and the commit window.
 * Discovers across both Claude and Pi session sources via the
 * shared session-discovery module (which already dedupes by realpath), then
 * derives each candidate's real content time window via session-parser
 * (cached, so repeated calls across overlapping commit windows in the same
 * report reuse the same parse).
 * @param {number} startTime
 * @param {number} endTime
 * @returns {Array<{id: string, file: string, path: string, mtime: number, startTime: number, endTime: number, midpoint: number}>}
 */
function getSessionFilesInRange(startTime, endTime) {
  const sessions = [];

  for (const file of findAllSessionFiles()) {
    // Content is append-only, so timestamps are always <= mtime: a file
    // untouched before the window opened cannot contain anything within it.
    if (file.mtime < startTime) continue;

    try {
      const sessionWindow = getSessionTimeWindow(file.path);
      const overlaps = sessionWindow.startTime <= endTime && sessionWindow.endTime >= startTime;

      if (overlaps) {
        sessions.push({
          id: sessionIdForFile(file),
          file: path.basename(file.path),
          path: file.path,
          mtime: sessionWindow.endTime,
          startTime: sessionWindow.startTime,
          endTime: sessionWindow.endTime,
          midpoint: sessionWindow.midpoint
        });
      }
    } catch {}
  }

  return sessions;
}

/**
 * Calculate token usage from a session file with an optional per-message
 * breakdown, across both Claude and Pi session formats. Delegates to the
 * shared cached session parser (same one token-burn/spike-detective use)
 * instead of re-implementing Pi-only line parsing, so git-blame's commit
 * cost attribution covers Claude Code sessions too.
 * @param {string} filePath
 * @param {boolean} [includeDetails=false]
 * @returns {{totalTokens: number, totalCost: number, models: Record<string, {tokens: number, cost: number, calls: number}>, details: Array<*>}}
 */
function calculateSessionTokens(filePath, includeDetails = false) {
  const fileData = getCachedFileData(filePath, {
    collectEvents: includeDetails,
    collectEventPreviews: includeDetails
  });

  /** @type {Record<string, {tokens: number, cost: number, calls: number}>} */
  const models = {};
  let totalCost = 0;

  for (const [modelKey, stats] of Object.entries(fileData.models)) {
    const costBreakdown = /** @type {{total: number}} */ (calculateCost(stats, modelKey));
    totalCost += costBreakdown.total;
    models[modelKey] = { tokens: stats.total, cost: costBreakdown.total, calls: stats.messages };
  }

  /** @type {Array<*>} */
  const details = includeDetails
    ? fileData.events.map((/** @type {any} */ event) => ({
        timestamp: event.time,
        model: event.model,
        tokens: event.total,
        cost: /** @type {{total: number}} */ (calculateCost(event, event.model)).total,
        preview: event.preview
      }))
    : [];

  return { totalTokens: fileData.total_tokens, totalCost, models, details };
}

/**
 * Get detailed session breakdown for a commit
 * @param {string} commitHash
 * @param {string} [cwd]
 * @param {number} [days]
 * @returns {object|null}
 */
function getCommitSessionDetails(commitHash, cwd = process.cwd(), days = 30) {
  const commits = getGitCommits(`${days} days ago`, cwd);
  const commit = commits.find(c => c.hash === commitHash || c.fullHash === commitHash);
  
  if (!commit) {
    return null;
  }
  
  const commitIndex = commits.findIndex(c => c.hash === commitHash || c.fullHash === commitHash);
  const nextCommit = commits[commitIndex - 1]; // Earlier commit
  
  // Time window: from this commit to next commit (or 2 hours if last)
  const startTime = commit.date;
  const endTime = nextCommit ? nextCommit.date : startTime + (2 * 60 * 60 * 1000);
  
  const sessionFiles = getSessionFilesInRange(startTime, endTime);
  const sessions = [];
  
  for (const sessionFile of sessionFiles) {
    const usage = calculateSessionTokens(sessionFile.path, true);
    sessions.push({
      id: sessionFile.id,
      file: sessionFile.file,
      mtime: sessionFile.mtime,
      tokens: usage.totalTokens,
      cost: usage.totalCost,
      models: usage.models,
      messages: usage.details || []
    });
  }
  
  // Sort by cost (highest first)
  sessions.sort((a, b) => b.cost - a.cost);
  
  return {
    commit: {
      hash: commit.hash,
      message: commit.message,
      date: commit.timestamp,
      timestamp: commit.date
    },
    sessions,
    summary: {
      totalSessions: sessions.length,
      totalTokens: sessions.reduce((sum, s) => sum + s.tokens, 0),
      totalCost: sessions.reduce((sum, s) => sum + s.cost, 0)
    }
  };
}

/**
 * Generate git blame report
 * @param {number} [days]
 * @param {string} [cwd]
 * @returns {Array<{hash: string, message: string, date: string, timestamp: number, tokens: number, cost: number, models: Record<string, {tokens: number, cost: number, calls: number}>, sessions: number, sessionIds: string[], files: string[], loc: {filesChanged: number, insertions: number, deletions: number, loc: number}}>}
 */
function generateGitBlameReport(days = 30, cwd = process.cwd()) {
  const commits = getGitCommits(`${days} days ago`, cwd);
  const report = [];
  // A session's real [startTime, endTime] can overlap more than one commit's
  // (contiguous, non-overlapping) window when it runs across several
  // commits. Track already-attributed session IDs across the whole loop so
  // each session's full cost lands in exactly one commit (the newest one it
  // overlaps, since commits iterate newest-first) instead of being summed
  // again into every commit window it touches.
  const attributedSessionIds = new Set();

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i];
    const nextCommit = commits[i - 1]; // Earlier commit

    // Time window: from this commit to next commit (or 2 hours if last)
    const startTime = commit.date;
    const endTime = nextCommit ? nextCommit.date : startTime + (2 * 60 * 60 * 1000);

    const sessions = getSessionFilesInRange(startTime, endTime)
      .filter(session => !attributedSessionIds.has(session.id));
    let commitTokens = 0;
    let commitCost = 0;
    /** @type {Record<string, {tokens: number, cost: number, calls: number}>} */
    const commitModels = {};

    // Deduplicate session IDs (multiple files in same session)
    const uniqueSessionIds = [...new Set(sessions.map(s => s.id))];
    uniqueSessionIds.forEach(id => attributedSessionIds.add(id));

    for (const session of sessions) {
      const usage = calculateSessionTokens(session.path);
      commitTokens += usage.totalTokens;
      commitCost += usage.totalCost;
      
      for (const [model, stats] of Object.entries(usage.models)) {
        if (!commitModels[model]) {
          commitModels[model] = { tokens: 0, cost: 0, calls: 0 };
        }
        commitModels[model].tokens += stats.tokens;
        commitModels[model].cost += stats.cost;
        commitModels[model].calls += stats.calls;
      }
    }
    
    // Get files edited in this commit
    const files = getCommitFiles(commit.fullHash, cwd);
    const loc = getCommitLOC(commit.fullHash, cwd);

    if (commitTokens > 0) {
      report.push({
        hash: commit.hash,
        message: commit.message,
        date: commit.timestamp,
        timestamp: commit.date,
        tokens: commitTokens,
        cost: commitCost,
        models: commitModels,
        sessions: uniqueSessionIds.length,
        sessionIds: uniqueSessionIds,
        files: files.slice(0, 10), // Limit to first 10 files
        loc // Engineering ROI: lines changed for this commit
      });
    }
  }
  
  return report;
}

/**
 * Get cost by file (which files cost the most to edit)
 * @param {number} [days]
 * @param {string} [cwd]
 * @returns {Array<{file: string, cost: number, tokens?: number, commits: number}>}
 */
function getCostByFile(days = 30, cwd = process.cwd()) {
  const commits = getGitCommits(`${days} days ago`, cwd);
  /** @type {Record<string, {cost: number, tokens: number, commits: number}>} */
  const fileCosts = {};
  // See generateGitBlameReport's identical dedup: a session's window can
  // overlap more than one commit's, so track already-attributed sessions
  // across the loop to avoid summing the same session's cost into multiple
  // commits' file distributions.
  const attributedSessionIds = new Set();

  for (const commit of commits) {
    const files = getCommitFiles(commit.fullHash, cwd);
    const commitIndex = commits.findIndex(c => c.fullHash === commit.fullHash);
    const nextCommit = commits[commitIndex - 1];
    const endTime = nextCommit ? nextCommit.date : commit.date + (2 * 60 * 60 * 1000);

    const sessions = getSessionFilesInRange(commit.date, endTime)
      .filter(session => !attributedSessionIds.has(session.id));
    sessions.forEach(session => attributedSessionIds.add(session.id));
    let sessionCost = 0;
    
    for (const session of sessions) {
      const usage = calculateSessionTokens(session.path);
      sessionCost += usage.totalCost;
    }
    
    // Distribute cost across modified files
    if (files.length > 0 && sessionCost > 0) {
      const costPerFile = sessionCost / files.length;
      for (const file of files) {
        if (!fileCosts[file]) {
          fileCosts[file] = { cost: 0, tokens: 0, commits: 0 };
        }
        fileCosts[file].cost += costPerFile;
        fileCosts[file].commits += 1;
      }
    }
  }
  
  return Object.entries(fileCosts)
    .map(([file, stats]) => ({ file, ...stats }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 50);
}

module.exports = {
  GIT_BLAME_CACHE_TTL,
  generateGitBlameReport,
  getCostByFile,
  getDetectedProjects,
  getGitBlameRouteData,
  computeGitBlameRouteData,
  primeGitBlameRouteCache,
  getGitBlameCommitDetails,
  getGitCommits,
  getCommitSessionDetails,
  isValidCommitHash,
  getCommitFiles,
  getCommitLOC,
  getSessionTimeWindow,
  getSessionFilesInRange,
  calculateSessionTokens
};
