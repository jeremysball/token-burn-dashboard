/**
 * Unified Session Discovery
 * Supports both Pi sessions and Claude sessions
 * 
 * Pi: ~/.pi/sessions, ~/.pi/agent/sessions, /workspace/.pi/sessions, etc.
 * Claude: ~/.claude/projects/  (recursive *.jsonl)
 */

const fs = require('fs');
const path = require('path');

// Base Pi session paths (same as before, deduped)
const PI_SESSION_BASES = [
  '/workspace/.pi/sessions',
  path.join(process.env.HOME || '', '.pi/sessions'),
  '/workspace/.pi/agent/sessions',
  path.join(process.env.HOME || '', '.pi/agent/sessions'),
  '/workspace/openclaw-sessions/',
  // Old Alfred data
  '/workspace/old-alfred-data/workspace_files/data/sessions',
  '/workspace/old-alfred-data/alfred_data/sessions',
  '/workspace/old-alfred-data/alfred_data/workspace/data/sessions'
].filter(Boolean);

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
function findClaudeJsonlFiles(maxDepth = 4) {
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
          // Skip huge files > 100MB to avoid OOM
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 100 * 1024 * 1024) {
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
          const fullPath = path.join(dirInfo.path, entry.name);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 100 * 1024 * 1024) continue;
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
    if (!seen.has(f.path)) {
      seen.add(f.path);
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
