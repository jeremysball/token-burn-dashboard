/**
 * Centralized Data Cache & Poller
 */

const { runTokenBurn } = require('./token-burn');
const { extractHistoricalData } = require('./historical-data');
const { getGitBlameRouteData } = require('./git-blame');
const { SSE_UPDATE_INTERVAL, HISTORICAL_UPDATE_INTERVAL } = require('./config');

const cache = {
  tokensData: null,
  historicalData: null,
  tokensDataPromise: null,
  historicalDataPromise: null
};

/**
 * Start background cache refresh
 */
function startBackgroundUpdater() {
  console.log('Starting background data warmup...');
  
  cache.historicalDataPromise = extractHistoricalData().then(data => {
    cache.historicalData = data;
    console.log('✅ Historical data warmup complete');
    return data;
  }).catch(err => {
    console.error('❌ Historical data warmup failed:', err.message);
  });

  const updateTokens = async () => {
    try {
      cache.tokensData = await runTokenBurn();
    } catch (err) {
      console.error('Background token update failed:', err.message);
    }
  };

  cache.tokensDataPromise = updateTokens().then(() => {
    console.log('✅ Current tokens warmup complete');
  });

  cache.gitBlameDataPromise = Promise.resolve().then(() => {
    getGitBlameRouteData();
    console.log('✅ Git blame warmup complete');
  }).catch(err => {
    console.error('❌ Git blame warmup failed:', err.message);
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
  return await runTokenBurn();
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
