const { parentPort } = require('worker_threads');
const { runTokenBurn } = require('./token-burn');

runTokenBurn()
  .then(data => parentPort.postMessage({ data }))
  .catch(error => parentPort.postMessage({ error: error.message }));
