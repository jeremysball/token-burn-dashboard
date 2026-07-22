/**
 * Security helpers: CORS origin allowlisting, bearer-token auth, and path containment
 */

const path = require('path');

/** @param {string} requestOrigin @param {string[]} allowedOrigins @returns {string|null} */
function resolveCorsOrigin(requestOrigin, allowedOrigins) {
  if (!requestOrigin || !allowedOrigins || allowedOrigins.length === 0) return null;
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

/** @param {*} req @param {string|undefined} authToken @returns {boolean} */
function isAuthorized(req, authToken) {
  if (!authToken) return true;
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return !!match && match[1] === authToken;
}

/** @param {string} candidatePath @param {string} rootPath @returns {boolean} */
function isPathWithinRoot(candidatePath, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  // path.resolve(resolvedRoot, absolutePath) discards resolvedRoot and returns absolutePath unchanged,
  // so an absolute candidatePath outside rootPath inherently fails the containment check below.
  const resolvedCandidate = path.resolve(resolvedRoot, candidatePath || '.');
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

module.exports = { resolveCorsOrigin, isAuthorized, isPathWithinRoot };
