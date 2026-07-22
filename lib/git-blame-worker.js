const { parentPort, workerData } = require('worker_threads');
const { computeGitBlameRouteData } = require('./git-blame');

const { days, cwd } = workerData;

try {
  const data = computeGitBlameRouteData(days, cwd);
  parentPort.postMessage({ data });
} catch (error) {
  parentPort.postMessage({ error: error.message });
}
