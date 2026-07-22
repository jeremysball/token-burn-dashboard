/**
 * Security helpers: CORS origin allowlisting and bearer-token auth
 */

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

module.exports = { resolveCorsOrigin, isAuthorized };
