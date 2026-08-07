const { parentPort, workerData } = require('worker_threads');
const { runTokenBurn } = require('./token-burn');
const { setOpenRouterPricingSnapshot } = require('./openrouter');
const { setModelsDevPricingSnapshot } = require('./modelsdev');

if (workerData?.pricingSnapshot) {
  setOpenRouterPricingSnapshot(workerData.pricingSnapshot);
}

if (workerData?.modelsDevSnapshot) {
  setModelsDevPricingSnapshot(workerData.modelsDevSnapshot);
}

if (!parentPort) {
  throw new Error('token-burn-worker requires parentPort');
}

const port = parentPort;

runTokenBurn()
  .then(data => port.postMessage({ data }))
  .catch(error => port.postMessage({ error: error.message }));
