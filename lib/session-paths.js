const path = require('path');
const os = require('os');

const PI_SESSION_BASES = Object.freeze([
  '/workspace/.pi/sessions',
  path.join(os.homedir(), '.pi/sessions'),
  '/workspace/.pi/agent/sessions',
  path.join(os.homedir(), '.pi/agent/sessions'),
  '/workspace/openclaw-sessions/',
  '/workspace/old-alfred-data/workspace_files/data/sessions',
  '/workspace/old-alfred-data/alfred_data/sessions',
  '/workspace/old-alfred-data/alfred_data/workspace/data/sessions'
].filter(Boolean));

module.exports = { PI_SESSION_BASES };
