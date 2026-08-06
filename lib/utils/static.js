/**
 * Static file serving utilities
 */

const fs = require('fs');
const { MIME_TYPES } = require('../config');

// Cache for static files
const staticCache = new Map();

/**
 * @param {string} filePath
 * @returns {Buffer|null}
 */
function readFileCached(filePath) {
  if (staticCache.has(filePath)) {
    return staticCache.get(filePath);
  }
  try {
    const content = fs.readFileSync(filePath);
    staticCache.set(filePath, content);
    return content;
  } catch {
    return null;
  }
}

/**
 * @param {string} filePath
 * @returns {Buffer|null}
 */
function readFileDirect(filePath) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    const error = /** @type {NodeJS.ErrnoException} */ (err);
    // Only return null for "file not found" (ENOENT).
    // Other errors (EACCES, EISDIR, EMFILE, ELOOP, etc.) indicate
    // misconfiguration and should propagate so ops can diagnose.
    if (error.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Serve a static file
 * @param {import('http').ServerResponse} res
 * @param {string} filePath
 * @param {string} contentType
 */
function serveStatic(res, filePath, contentType) {
  // In dev: never cache (read fresh from disk every time)
  // In prod: cache all files except HTML (entry point always fresh)
  const isDev = process.env.NODE_ENV !== 'production';
  const isHTML = filePath.endsWith('.html');

  const content = isDev || isHTML ? readFileDirect(filePath) : readFileCached(filePath);
  
  if (content) {
    /** @type {Record<string, string>} */
    const headers = {
      'Content-Type': contentType
    };
    
    // HTML: never cache (entry point always fresh)
    if (isHTML) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }
    // Dev: no-cache everything (read fresh on every request)
    // Prod: cache for 1 hour
    else if (isDev) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else {
      headers['Cache-Control'] = 'public, max-age=3600';
    }
    
    res.writeHead(200, headers);
    res.end(content);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

/**
 * Clear the static file cache
 */
function clearCache() {
  staticCache.clear();
}

module.exports = {
  readFileCached,
  serveStatic,
  clearCache,
  MIME_TYPES
};
