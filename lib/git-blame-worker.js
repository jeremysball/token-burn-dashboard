const { parentPort, workerData } = require('worker_threads');
const { computeGitBlameRouteData } = require('./git-blame');
const { setOpenRouterPricingSnapshot } = require('./openrouter');
const { setModelsDevPricingSnapshot } = require('./modelsdev');

const { days, cwd, pricingSnapshot, modelsDevSnapshot } = workerData;

if (pricingSnapshot) {
  setOpenRouterPricingSnapshot(pricingSnapshot);
}

if (modelsDevSnapshot) {
  setModelsDevPricingSnapshot(modelsDevSnapshot);
}

if (!parentPort) throw new Error('parentPort is required in worker thread');

try {
  const data = computeGitBlameRouteData(days, cwd);
  parentPort.postMessage({ data });
} catch (error) {
  parentPort.postMessage({ error: /** @type {Error} */ (error).message || 'Unknown worker error' });
}
