/**
 * Unified Session Discovery
 * Supports both Pi sessions and Claude sessions
 * 
 * Pi: ~/.pi/sessions, ~/.pi/agent/sessions, /workspace/.pi/sessions, etc.
 * Claude: ~/.claude/projects/  (recursive *.jsonl)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MAX_FILE_BYTES, CLAUDE_MAX_DEPTH } = require('./config');

// NOTE: /workspace/openclaw-files contains docs/portfolio, 0 JSONL sessions,
// intentionally not included. Use EXTRA_SESSION_DIRS to add custom directories.

// Base Pi session paths (same as before, deduped)
const PI_SESSION_BASES = [
  '/workspace/.pi/sessions',
  path.join(os.homedir(), '.pi/sessions'),
  '/workspace/.pi/agent/sessions',
  path.join(os.homedir(), '.pi/agent/sessions'),
  '/workspace/openclaw-sessions/',
  // Old Alfred data
  '/workspace/old-alfred-data/workspace_files/data/sessions',
  '/workspace/old-alfred-data/alfred_data/sessions',
  '/workspace/old-alfred-data/alfred_data/workspace/data/sessions'
].filter(Boolean);

// EXTRA_SESSION_DIRS lets operators add custom session directories,
// delimited by ':' or ','. Example:
//   EXTRA_SESSION_DIRS=/data/sessions:/mnt/other/sessions
const EXTRA_SESSION_DIRS = (process.env.EXTRA_SESSION_DIRS || '')
  .split(/[:,]/)
  .map(s => s.trim())
  .filter(Boolean);

PI_SESSION_BASES.push(...EXTRA_SESSION_DIRS);

// TODO: Convert to async fs.promises with mtime cache to avoid blocking the
// poller every 5m. For now sync is OK for <10k files.

// Claude session root - configurable
const CLAUDE_PROJECTS_ROOT = process.env.CLAUDE_PROJECTS_DIR 
  || path.join(process.env.HOME || '', '.claude/projects');

/**
 * Find all Pi-style session directories
 * Handles both flat (jsonl files directly in base) and hierarchical (subdirs)
 */
function findPiSessionDirs() {
  const sessionDirs = [];
  const seen = new Set();

  for (const basePath of PI_SESSION_BASES) {
    if (!basePath || !fs.existsSync(basePath)) continue;

    try {
      const entries = fs.readdirSync(basePath, { withFileTypes: true });
      const hasJsonlFiles = entries.some(e => e.isFile() && e.name.endsWith('.jsonl'));
      const hasSubdirs = entries.some(e => e.isDirectory());

      if (hasJsonlFiles && !hasSubdirs) {
        if (!seen.has(basePath)) {
          seen.add(basePath);
          sessionDirs.push({ path: basePath, source: 'pi', structure: 'flat' });
        }
      } else {
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const full = path.join(basePath, entry.name);
            if (!seen.has(full)) {
              seen.add(full);
              sessionDirs.push({ path: full, source: 'pi', structure: 'nested' });
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error reading Pi base ${basePath}:`, err.message);
    }
  }

  return sessionDirs;
}

/**
 * Recursively find all Claude jsonl files
 * Structure: ~/.claude/projects/-workspace-xxx/UUID.jsonl
 *           ~/.claude/projects/-workspace-xxx/UUID/subagents/*.jsonl
 * We walk up to 3 levels deep to avoid excessive recursion
 */
function findClaudeJsonlFiles(maxDepth = CLAUDE_MAX_DEPTH) {
  const files = [];
  const seenRealPaths = new Set(); // dedup via realpath if possible

  if (!fs.existsSync(CLAUDE_PROJECTS_ROOT)) {
    return files;
  }

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          // Skip deleted and huge files to avoid OOM
          if (entry.name.includes('.deleted.')) continue;
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > MAX_FILE_BYTES) {
              console.warn(`Skipping large file: ${fullPath} (${Math.round(stat.size/1024/1024)}MB)`);
              continue;
            }
            // Deduplicate by real path
            const real = fs.realpathSync(fullPath);
            if (seenRealPaths.has(real)) continue;
            seenRealPaths.add(real);

            files.push({
              path: fullPath,
              source: 'claude',
              project: path.relative(CLAUDE_PROJECTS_ROOT, path.dirname(fullPath)),
              mtime: stat.mtimeMs
            });
          } catch {
            files.push({
              path: fullPath,
              source: 'claude',
              project: path.relative(CLAUDE_PROJECTS_ROOT, path.dirname(fullPath)),
              mtime: 0
            });
          }
        } else if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  walk(CLAUDE_PROJECTS_ROOT, 0);
  return files;
}

/**
 * Find all Pi jsonl files (from Pi session dirs)
 */
function findPiJsonlFiles() {
  const dirs = findPiSessionDirs();
  const files = [];
  const seenRealPaths = new Set();

  for (const dirInfo of dirs) {
    try {
      const entries = fs.readdirSync(dirInfo.path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          if (entry.name.includes('.deleted.')) continue;
          const fullPath = path.join(dirInfo.path, entry.name);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > MAX_FILE_BYTES) {
              console.warn(`Skipping large file: ${fullPath} (${Math.round(stat.size/1024/1024)}MB)`);
              continue;
            }
            const real = fs.realpathSync(fullPath);
            if (seenRealPaths.has(real)) continue;
            seenRealPaths.add(real);
            files.push({
              path: fullPath,
              source: 'pi',
              sessionDir: dirInfo.path,
              structure: dirInfo.structure,
              mtime: stat.mtimeMs
            });
          } catch {
            files.push({
              path: fullPath,
              source: 'pi',
              sessionDir: dirInfo.path,
              structure: dirInfo.structure,
              mtime: 0
            });
          }
        }
      }
    } catch (err) {
      console.error(`Error reading Pi dir ${dirInfo.path}:`, err.message);
    }
  }

  return files;
}

/**
 * Unified finder: returns all session files across both sources
 */
function findAllSessionFiles() {
  const piFiles = findPiJsonlFiles();
  const claudeFiles = findClaudeJsonlFiles();
  
  // Deduplicate across Pi and Claude by realpath
  const all = [...piFiles, ...claudeFiles];
  const deduped = [];
  const seen = new Set();
  
  for (const f of all) {
    let key;
    try {
      key = fs.realpathSync(f.path);
    } catch {
      key = f.path;
    }
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(f);
    }
  }
  
  return deduped;
}

/**
 * Find all session dirs (legacy API) + Claude root as virtual dirs
 */
function findAllSessionDirs() {
  const piDirs = findPiSessionDirs();
  
  // For Claude, we treat each project folder as a session dir for compatibility
  // But also support direct file listing via findAllSessionFiles
  const claudeFiles = findClaudeJsonlFiles();
  const claudeDirsSet = new Set();
  for (const f of claudeFiles) {
    claudeDirsSet.add(path.dirname(f.path));
  }
  const claudeDirs = Array.from(claudeDirsSet).map(d => ({
    path: d,
    source: 'claude',
    structure: 'claude'
  }));
  
  return [...piDirs, ...claudeDirs];
}

module.exports = {
  PI_SESSION_BASES,
  CLAUDE_PROJECTS_ROOT,
  findPiSessionDirs,
  findPiJsonlFiles,
  findClaudeJsonlFiles,
  findAllSessionFiles,
  findAllSessionDirs
};
