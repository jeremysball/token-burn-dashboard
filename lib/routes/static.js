/**
 * Static files route handler
 */

const path = require('path');
const { serveStatic, MIME_TYPES } = require('../utils/static');

/**
 * Resolve urlPath safely within rootDir, preventing traversal
 * Returns absolute path if safe, null if traversal detected
 */
/** @param {string} rootDir @param {string} urlPath @returns {string|null} */
function safeStaticPath(rootDir, urlPath) {
  try {
    const resolvedRoot = path.resolve(rootDir);
    // Decode URI component safely; throw on malformed encoding handled below
    const decoded = decodeURIComponent(urlPath);
    // Resolve the joined path and ensure it stays within root
    const resolved = path.resolve(path.join(resolvedRoot, decoded));
    // Strict check: must be root itself or inside root with separator
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Handle static file serving
 */
/** @param {{ pathname: string }} url @param {*} res @param {NodeJS.Timeout | undefined} requestTimeout @param {string} rootDir */
function handleStaticRoutes(url, res, requestTimeout, rootDir) {
  // Static root mappings
  /** @type {Record<string, string>} */
  const staticMap = {
    '/': path.join(rootDir, 'dashboard/index.html'),
    '/mono-dashboard.css': path.join(rootDir, 'src/mono-dashboard.css')
  };
  
  const staticFile = staticMap[url.pathname];
  if (staticFile) {
    clearTimeout(requestTimeout);
    const ext = /** @type {keyof typeof MIME_TYPES} */ (path.extname(staticFile));
    serveStatic(res, staticFile, MIME_TYPES[ext] || 'text/plain');
    return true;
  }
  
  // Dashboard files
  if (url.pathname.startsWith('/dashboard/')) {
    // Guard against path traversal: resolve the request relative to the
    // dashboard/ directory, not the repository root, so encoded sequences
    // such as %2e%2e%2f cannot climb above dashboard/.
    const dashboardRoot = path.join(rootDir, 'dashboard');
    const relativePath = url.pathname.slice('/dashboard'.length);
    const filePath = safeStaticPath(dashboardRoot, relativePath);
    if (!filePath) {
      clearTimeout(requestTimeout);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return true;
    }
    const ext = /** @type {keyof typeof MIME_TYPES} */ (path.extname(filePath));
    clearTimeout(requestTimeout);
    serveStatic(res, filePath, MIME_TYPES[ext] || 'text/plain');
    return true;
  }
  
  return false; // Not a static file
}

module.exports = { handleStaticRoutes, safeStaticPath };
