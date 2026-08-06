/**
 * Security helpers: CORS origin allowlisting, bearer-token auth, and path containment
 */

const path = require('path');
const crypto = require('crypto');

/** @param {string} requestOrigin @param {string[]} allowedOrigins @returns {string|null} */
function resolveCorsOrigin(requestOrigin, allowedOrigins) {
  if (!requestOrigin || !allowedOrigins || allowedOrigins.length === 0) return null;
  return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
}

/**
 * Constant-time string comparison to avoid leaking how many leading
 * characters of a guessed token are correct via response timing.
 * @param {string} a @param {string} b @returns {boolean}
 */
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch rather than returning
  // false, so a length mismatch has to be handled separately — but
  // returning immediately would resolve measurably faster than a
  // same-length miss, leaking the correct token's length via timing.
  // Compare bufA against itself (result intentionally discarded) purely
  // to burn the same O(length) cost before returning false.
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** @param {*} req @param {string|undefined} authToken @returns {boolean} */
function isAuthorized(req, authToken) {
  if (!authToken) return true;
  const header = req.headers['authorization'] || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return !!match && timingSafeStringEqual(match[1], authToken);
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
