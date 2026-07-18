const { parentPort, workerData } = require('worker_threads');
const { runTokenBurn } = require('./token-burn');
const { setOpenRouterPricingSnapshot } = require('./openrouter');

if (workerData?.pricingSnapshot) {
  setOpenRouterPricingSnapshot(workerData.pricingSnapshot);
}

runTokenBurn()
  .then(data => parentPort.postMessage({ data }))
  .catch(error => parentPort.postMessage({ error: error.message }));
