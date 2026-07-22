/**
 * Security helpers: CORS origin allowlisting, bearer-token auth, and path containment
 */

const path = require('path');

function resolveCorsOrigin(requestOrigin, allowedOrigins) {
  if (!requestOrigin || !allowedOrigins || allowedOrigins.length === 0) return null;
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

function isAuthorized(req, authToken) {
  if (!authToken) return true;
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return !!match && match[1] === authToken;
}

function isPathWithinRoot(candidatePath, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(resolvedRoot, candidatePath || '.');
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

module.exports = { resolveCorsOrigin, isAuthorized, isPathWithinRoot };
