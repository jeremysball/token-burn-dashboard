/**
 * Unified Session Discovery
 * Supports both Pi sessions and Claude sessions
 * 
 * Pi: ~/.pi/sessions, ~/.pi/agent/sessions, /workspace/.pi/sessions, etc.
 * Claude: ~/.claude/projects/  (recursive *.jsonl)
 */

const defaultFs = require('fs');
const defaultOs = require('os');
const defaultPath = require('path');
const defaultConfig = require('./config');

// NOTE: /workspace/openclaw-files contains docs/portfolio, 0 JSONL sessions,
// intentionally not included. Use EXTRA_SESSION_DIRS to add custom directories.

/**
 * Parse a ':'- or ','-delimited directory list from an env var.
 * @param {string | undefined} value
 * @returns {string[]}
 */
const splitDirList = (value) => (value || '')
  .split(/[:,]/)
  .map(s => s.trim())
  .filter(Boolean);

/**
 * The built-in Pi session bases, resolved against the injected os/path.
 * @param {typeof import('path')} path
 * @param {typeof import('os')} os
 * @returns {string[]}
 */
const defaultPiSessionBases = (path, os) => [
  path.join(os.homedir(), '.pi/sessions'),
  path.join(os.homedir(), '.pi/agent/sessions'),
  // Container layouts that mount the agent home under /workspace. These are
  // the only absolute paths left in this list; set PI_SESSION_DIRS to replace
  // the list entirely on a host laid out differently.
  '/workspace/.pi/sessions',
  '/workspace/.pi/agent/sessions',
  '/workspace/openclaw-sessions/'
];

function createSessionDiscovery({
  fsImpl = defaultFs,
  osImpl = defaultOs,
  pathImpl = defaultPath,
  env = process.env,
  config = defaultConfig
} = {}) {
  const fs = fsImpl;
  const os = osImpl;
  const path = pathImpl;
  const { MAX_FILE_BYTES, CLAUDE_MAX_DEPTH } = config;

// Base Pi session paths (same as before, deduped).
//
// PI_SESSION_DIRS replaces this default list outright, the same way
// CLAUDE_PROJECTS_DIR overrides the Claude root below. EXTRA_SESSION_DIRS
// (further down) appends to whichever list is in play. The replace/append
// split is what lets a caller scan *only* the directories it names, which
// the append-only EXTRA_SESSION_DIRS cannot express — the defaults below
// resolve against the real os.homedir(), so without an override every
// consumer picks up whatever ~/.pi sessions happen to exist on the box.
const PI_SESSION_DIRS_OVERRIDE = splitDirList(env.PI_SESSION_DIRS);

const PI_SESSION_BASES = (PI_SESSION_DIRS_OVERRIDE.length
  ? PI_SESSION_DIRS_OVERRIDE
  : defaultPiSessionBases(path, os)
).filter(Boolean);

// EXTRA_SESSION_DIRS lets operators add custom session directories,
// delimited by ':' or ','. Example:
//   EXTRA_SESSION_DIRS=/data/sessions:/mnt/other/sessions
const EXTRA_SESSION_DIRS = splitDirList(env.EXTRA_SESSION_DIRS);

PI_SESSION_BASES.push(...EXTRA_SESSION_DIRS);

// TODO: Convert to async fs.promises with mtime cache to avoid blocking the
// poller every 5m. For now sync is OK for <10k files.

// Claude session root - configurable. Explicit CLAUDE_PROJECTS_DIR wins;
// otherwise resolve the home projects root portably via os.homedir().
const CLAUDE_PROJECTS_ROOT = env.CLAUDE_PROJECTS_DIR
  || path.join(os.homedir(), '.claude/projects');

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
      /**
       * @param {import('fs').Dirent} e
       * @returns {boolean}
       */
      const isJsonl = e => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.jsonl');
      /**
       * @param {import('fs').Dirent} e
       * @returns {boolean}
       */
      const isDir = e => {
        if (e.isDirectory()) return true;
        if (e.isSymbolicLink()) {
          // Only treat symlinks that resolve to a directory as subdirs
          try {
            return fs.statSync(path.join(basePath, e.name)).isDirectory();
          } catch {
            return false;
          }
        }
        return false;
      };
      const hasJsonlFiles = entries.some(e => isJsonl(e));
      const hasSubdirs = entries.some(e => isDir(e));

      if (hasJsonlFiles && !hasSubdirs) {
        if (!seen.has(basePath)) {
          seen.add(basePath);
          sessionDirs.push({ path: basePath, source: 'pi', structure: 'flat' });
        }
      } else {
        for (const entry of entries) {
          if (isDir(entry)) {
            const full = path.join(basePath, entry.name);
            if (!seen.has(full)) {
              seen.add(full);
              sessionDirs.push({ path: full, source: 'pi', structure: 'nested' });
            }
          }
        }
      }
    } catch (err) {
      console.error(`Error reading Pi base ${basePath}:`, err instanceof Error ? err.message : String(err));
    }
  }

  return sessionDirs;
}

/**
 * Recursively find all Claude jsonl files
 * Structure: ~/.claude/projects/-workspace-xxx/UUID.jsonl
 *           ~/.claude/projects/-workspace-xxx/UUID/subagents/*.jsonl
 * We walk up to CLAUDE_MAX_DEPTH (4) levels deep to avoid excessive recursion
 */
function findClaudeJsonlFiles(maxDepth = CLAUDE_MAX_DEPTH) {
  /** @type {Array<{path: string, source: string, project: string, mtime: number}>} */
  const files = [];
  const seenRealPaths = new Set(); // dedup via realpath if possible

  if (!fs.existsSync(CLAUDE_PROJECTS_ROOT)) {
    return files;
  }

  /**
   * @param {string} dir
   * @param {number} depth
   */
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const looksJsonl = (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.jsonl');
        if (looksJsonl) {
          // Skip deleted and huge files to avoid OOM
          if (entry.name.includes('.deleted.')) continue;
          try {
            const stat = fs.statSync(fullPath);
            // Only regular files are session files; a symlink to a directory
            // must not be emitted. Recurse only into directories below.
            if (!stat.isFile()) continue;
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
            // Inaccessible or racing file: fail closed (skip) rather than
            // returning it without size validation.
            continue;
          }
        } else if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isSymbolicLink()) {
          // A symlink that is not a .jsonl file: recurse only if it resolves
          // to a directory, so symlinked session trees are still discoverable.
          try {
            if (fs.statSync(fullPath).isDirectory()) walk(fullPath, depth + 1);
          } catch {
            // Skip broken/unreadable symlinks.
          }
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
        if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith('.jsonl')) {
          if (entry.name.includes('.deleted.')) continue;
          const fullPath = path.join(dirInfo.path, entry.name);
          try {
            const stat = fs.statSync(fullPath);
            // Only regular files are session files; a symlink to a directory
            // must not be emitted as a session file.
            if (!stat.isFile()) continue;
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
            // Inaccessible or racing file: fail closed (skip) rather than
            // returning it without size validation.
            continue;
          }
        }
      }
    } catch (err) {
      console.error(`Error reading Pi dir ${dirInfo.path}:`, err instanceof Error ? err.message : String(err));
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

return {
  PI_SESSION_BASES,
  CLAUDE_PROJECTS_ROOT,
  findPiSessionDirs,
  findPiJsonlFiles,
  findClaudeJsonlFiles,
  findAllSessionFiles,
  findAllSessionDirs
};
}

/**
 * Derive a stable, human-readable session id from a file entry returned by
 * findAllSessionFiles. Pi's nested layout uses one directory per session
 * (the directory name is the id); everything else (Pi flat, Claude) uses
 * the jsonl filename itself (Claude's is already a session UUID). Shared
 * here (rather than duplicated per consumer) so spike-detective and
 * git-blame derive the same id for the same file.
 * @param {{path: string, source: string, structure?: string}} file
 * @returns {string}
 */
function sessionIdForFile(file) {
  if (file.source === 'pi' && file.structure === 'nested') {
    return defaultPath.basename(defaultPath.dirname(file.path));
  }
  return defaultPath.basename(file.path, '.jsonl');
}

module.exports = { ...createSessionDiscovery(), createSessionDiscovery, sessionIdForFile };
