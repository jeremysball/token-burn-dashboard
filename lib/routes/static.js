/**
 * Static files route handler
 */

const path = require('path');
const { serveStatic, MIME_TYPES } = require('../utils/static');

/**
 * Handle static file serving
 */
function handleStaticRoutes(url, res, requestTimeout, rootDir) {
  // Static root mappings
  const staticMap = {
    '/': path.join(rootDir, 'dashboard/index.html'),
    '/mono-dashboard.css': path.join(rootDir, 'src/mono-dashboard.css')
  };
  
  const staticFile = staticMap[url.pathname];
  if (staticFile) {
    clearTimeout(requestTimeout);
    const ext = path.extname(staticFile);
    serveStatic(res, staticFile, MIME_TYPES[ext] || 'text/plain');
    return true;
  }
  
  // Dashboard files
  if (url.pathname.startsWith('/dashboard/')) {
    const filePath = path.join(rootDir, url.pathname);
    const ext = path.extname(filePath);
    clearTimeout(requestTimeout);
    serveStatic(res, filePath, MIME_TYPES[ext] || 'text/plain');
    return true;
  }
  
  return false; // Not a static file
}

module.exports = { handleStaticRoutes };
