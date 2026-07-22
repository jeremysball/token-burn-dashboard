const { parentPort, workerData } = require('worker_threads');
const { computeGitBlameRouteData } = require('./git-blame');

const { days, cwd } = workerData;

if (!parentPort) throw new Error('parentPort is required in worker thread');

try {
  const data = computeGitBlameRouteData(days, cwd);
  parentPort.postMessage({ data });
} catch (error) {
  parentPort.postMessage({ error: /** @type {Error} */ (error).message || 'Unknown worker error' });
}
