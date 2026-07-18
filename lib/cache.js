/**
 * Centralized Data Cache & Poller
 */

const path = require('path');
const { Worker } = require('worker_threads');
const { extractHistoricalData } = require('./historical-data');
const { SSE_UPDATE_INTERVAL, HISTORICAL_UPDATE_INTERVAL } = require('./config');

const cache = {
  tokensData: null,
  historicalData: null,
  tokensDataPromise: null,
  historicalDataPromise: null
};

const defer = task => new Promise((resolve, reject) => {
  setTimeout(() => Promise.resolve().then(task).then(resolve, reject), 0);
});

const runTokenBurnInWorker = () => new Promise((resolve, reject) => {
  const worker = new Worker(path.join(__dirname, 'token-burn-worker.js'));

  worker.once('message', ({ data, error }) => {
    if (error) reject(new Error(error));
    else resolve(data);
  });
  worker.once('error', reject);
  worker.once('exit', code => {
    if (code !== 0) reject(new Error(`Token burn worker exited with code ${code}`));
  });
});

/**
 * Start background cache refresh
 */
function startBackgroundUpdater() {
  console.log('Starting background data warmup...');
  
  cache.historicalDataPromise = defer(extractHistoricalData).then(data => {
    cache.historicalData = data;
    console.log('✅ Historical data warmup complete');
    return data;
  }).catch(err => {
    console.error('❌ Historical data warmup failed:', err.message);
  });

  const updateTokens = async () => {
    try {
      cache.tokensData = await runTokenBurnInWorker();
    } catch (err) {
      console.error('Background token update failed:', err.message);
    }
  };

  cache.tokensDataPromise = defer(updateTokens).then(() => {
    console.log('✅ Current tokens warmup complete');
  });

  setInterval(updateTokens, SSE_UPDATE_INTERVAL);
  
  setInterval(async () => {
    try {
      cache.historicalData = await extractHistoricalData();
    } catch (e) {
      console.error('Background historical update failed:', e.message);
    }
  }, HISTORICAL_UPDATE_INTERVAL);
}

/**
 * Get current token data, initiating a request if none exists
 */
async function getTokensData() {
  if (cache.tokensData) return cache.tokensData;
  if (cache.tokensDataPromise) {
    await cache.tokensDataPromise;
    return cache.tokensData;
  }
  return await runTokenBurnInWorker();
}

/**
 * Get historical data, initiating a request if none exists
 */
async function getHistoricalData() {
  if (cache.historicalData) return cache.historicalData;
  if (cache.historicalDataPromise) {
    await cache.historicalDataPromise;
    return cache.historicalData;
  }
  return await extractHistoricalData();
}

module.exports = {
  startBackgroundUpdater,
  getTokensData,
  getHistoricalData
};
