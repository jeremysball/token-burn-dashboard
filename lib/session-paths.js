/**
 * Shared Pi-session root paths for git-blame.js and spike-detective.js,
 * which both scan these directories directly (unlike session-discovery.js's
 * broader PI_SESSION_BASES, used by the main token-burn/historical-data
 * pipeline).
 */

const path = require('path');

const SESSIONS_PATHS = process.env.HOME ? [
  path.join(process.env.HOME, '.pi/sessions'),
  path.join(process.env.HOME, '.pi/agent/sessions')
] : [];

module.exports = { SESSIONS_PATHS };
