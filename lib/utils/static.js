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
 * Serve a static file
 * @param {import('http').ServerResponse} res
 * @param {string} filePath
 * @param {string} contentType
 */
function serveStatic(res, filePath, contentType) {
  // Don't cache JS files during development
  const isDev = process.env.NODE_ENV !== 'production';
  const isJS = filePath.endsWith('.js');
  const isHTML = filePath.endsWith('.html');
  const isCSS = filePath.endsWith('.css');
  
  const content = (isDev && (isJS || isCSS)) || isHTML ? fs.readFileSync(filePath) : readFileCached(filePath);
  
  if (content) {
    /** @type {Record<string, string>} */
    const headers = {
      'Content-Type': contentType
    };
    
    // HTML: never cache (entry point)
    if (isHTML) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }
    // CSS/JS: short cache in dev, long cache in prod
    else if (isDev && (isJS || isCSS)) {
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
