/**
 * Centralized Data Cache & Poller
 */

const path = require('path');
const { Worker } = require('worker_threads');
const { extractHistoricalData } = require('./historical-data');
const { SSE_UPDATE_INTERVAL, HISTORICAL_UPDATE_INTERVAL, PROJECT_ROOT } = require('./config');
const { getOpenRouterPricingSnapshot, refreshOpenRouterPricing } = require('./openrouter');
const { getModelsDevPricingSnapshot, refreshModelsDevPricing } = require('./modelsdev');
const { GIT_BLAME_CACHE_TTL, primeGitBlameRouteCache } = require('./git-blame');

/**
 * @type {{tokensData: any, historicalData: any, tokensDataPromise: Promise<any>|null, historicalDataPromise: Promise<any>|null}}
 */
const cache = {
  tokensData: null,
  historicalData: null,
  tokensDataPromise: null,
  historicalDataPromise: null
};

/**
 * @param {() => any} task
 * @returns {Promise<any>}
 */
const defer = task => new Promise((resolve, reject) => {
  setTimeout(() => Promise.resolve().then(task).then(resolve, reject), 0);
});

// Each Worker gets a fresh module cache, so lib/openrouter.js's (and
// lib/modelsdev.js's) own autofetch-on-require would otherwise re-fetch
// pricing on every scan. Seed the worker with the main thread's already-warm
// snapshots instead and suppress their autofetch via env.
const runTokenBurnInWorker = ({
  WorkerImpl = Worker,
  getOpenRouterPricingSnapshotImpl = getOpenRouterPricingSnapshot,
  getModelsDevPricingSnapshotImpl = getModelsDevPricingSnapshot
} = {}) => new Promise((resolve, reject) => {
  const worker = new WorkerImpl(path.join(__dirname, 'token-burn-worker.js'), {
    workerData: {
      pricingSnapshot: getOpenRouterPricingSnapshotImpl(),
      modelsDevSnapshot: getModelsDevPricingSnapshotImpl()
    },
    env: { ...process.env, OPENROUTER_DISABLE_AUTOFETCH: '1', MODELS_DEV_DISABLE_AUTOFETCH: '1' }
  });

  worker.once('message', ({ data, error }) => {
    if (error) reject(new Error(error));
    else resolve(data);
  });
  worker.once('error', reject);
  worker.once('exit', code => {
    if (code !== 0) reject(new Error(`Token burn worker exited with code ${code}`));
  });
});

// Git blame warmup does a synchronous git-log scan plus session-file
// parsing, which is CPU-heavy enough to stall the main event loop for
// the whole server (including health checks and SSE). Run it in a worker,
// same as the token-burn scan above.
const GIT_BLAME_WARM_DAYS = 30;
// Must match handleGitBlameRoute's default cwd (lib/routes/api.js) so the
// warmed cache key is the one the route actually requests.
const GIT_BLAME_WARM_CWD = PROJECT_ROOT;

const runGitBlameInWorker = ({
  WorkerImpl = Worker,
  getOpenRouterPricingSnapshotImpl = getOpenRouterPricingSnapshot,
  getModelsDevPricingSnapshotImpl = getModelsDevPricingSnapshot
} = {}) => new Promise((resolve, reject) => {
  const worker = new WorkerImpl(path.join(__dirname, 'git-blame-worker.js'), {
    workerData: {
      days: GIT_BLAME_WARM_DAYS,
      cwd: GIT_BLAME_WARM_CWD,
      pricingSnapshot: getOpenRouterPricingSnapshotImpl(),
      modelsDevSnapshot: getModelsDevPricingSnapshotImpl()
    },
    env: { ...process.env, OPENROUTER_DISABLE_AUTOFETCH: '1', MODELS_DEV_DISABLE_AUTOFETCH: '1' }
  });

  worker.once('message', ({ data, error }) => {
    if (error) reject(new Error(error));
    else resolve(data);
  });
  worker.once('error', reject);
  worker.once('exit', code => {
    if (code !== 0) reject(new Error(`Git blame worker exited with code ${code}`));
  });
});

/**
 * Start background cache refresh
 */
function startBackgroundUpdater({
  WorkerImpl = Worker,
  extractHistoricalDataImpl = extractHistoricalData,
  getOpenRouterPricingSnapshotImpl = getOpenRouterPricingSnapshot,
  getModelsDevPricingSnapshotImpl = getModelsDevPricingSnapshot,
  refreshOpenRouterPricingImpl = refreshOpenRouterPricing,
  refreshModelsDevPricingImpl = refreshModelsDevPricing
} = {}) {
  console.log('Starting background data warmup...');
  
  cache.historicalDataPromise = defer(extractHistoricalDataImpl).then(data => {
    cache.historicalData = data;
    console.log('✅ Historical data warmup complete');
    return data;
  }).catch(err => {
    console.error('❌ Historical data warmup failed:', /** @type {Error} */ (err).message);
  });

  // Guard against overlapping workers: a scan slower than SSE_UPDATE_INTERVAL
  // would otherwise spawn a new worker on top of one still running.
  let tokenUpdateInFlight = false;
  const updateTokens = async () => {
    if (tokenUpdateInFlight) return;
    tokenUpdateInFlight = true;
    try {
      // Wait for the OpenRouter/Models.dev background autofetch to settle
      // before seeding the worker. On the very first scan this closes a
      // startup race: the fire-and-forget autofetch kicked off at module
      // load can still be in flight when this deferred first tick runs,
      // which would otherwise seed the worker with an empty catalog. Once
      // a source is fresh this is a no-op fast path (see isFresh()), so it
      // costs nothing on the steady-state 5s ticks after the first.
      await Promise.all([refreshOpenRouterPricingImpl(), refreshModelsDevPricingImpl()]);
      cache.tokensData = await runTokenBurnInWorker({ WorkerImpl, getOpenRouterPricingSnapshotImpl, getModelsDevPricingSnapshotImpl });
    } catch (err) {
      console.error('Background token update failed:', /** @type {Error} */ (err).message);
    } finally {
      tokenUpdateInFlight = false;
    }
  };

  cache.tokensDataPromise = defer(updateTokens).then(() => {
    console.log('✅ Current tokens warmup complete');
  });

  setInterval(updateTokens, SSE_UPDATE_INTERVAL);

  setInterval(async () => {
    try {
      cache.historicalData = await extractHistoricalDataImpl();
    } catch (e) {
      console.error('Background historical update failed:', /** @type {Error} */ (e).message);
    }
  }, HISTORICAL_UPDATE_INTERVAL);

  // Git blame and spike detection are otherwise only computed on first tab
  // visit, leaving those tabs empty/loading on every fresh session. Warm
  // their caches at startup and keep refreshing them so a request never has
  // to pay the (slow) git-log scan cost inline.
  let gitBlameWarmInFlight = false;
  const warmGitBlame = async () => {
    if (gitBlameWarmInFlight) return;
    gitBlameWarmInFlight = true;
    try {
      const data = await runGitBlameInWorker({ WorkerImpl, getOpenRouterPricingSnapshotImpl, getModelsDevPricingSnapshotImpl });
      primeGitBlameRouteCache(GIT_BLAME_WARM_DAYS, GIT_BLAME_WARM_CWD, data);
      console.log('✅ Git blame warmup complete');
    } catch (err) {
      console.error('❌ Git blame warmup failed:', /** @type {Error} */ (err).message);
    } finally {
      gitBlameWarmInFlight = false;
    }
  };
  // Chained after the tokens warmup settles rather than deferred on its own
  // tick, so it never competes with the essential scans for a worker slot.
  if (cache.tokensDataPromise) {
    cache.tokensDataPromise.then(warmGitBlame);
  }
  setInterval(warmGitBlame, GIT_BLAME_CACHE_TTL);
}

/**
 * Get current token data, initiating a request if none exists
 */
async function getTokensData() {
  if (cache.tokensData) return cache.tokensData;
  if (cache.tokensDataPromise) {
    await cache.tokensDataPromise;
    if (cache.tokensData) return cache.tokensData;
    throw new Error('Token data warmup failed and no cached data is available');
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
    if (cache.historicalData) return cache.historicalData;
    throw new Error('Historical data warmup failed and no cached data is available');
  }
  return await extractHistoricalData();
}

/**
 * Reset the module-level cache singleton. Test-only escape hatch: `cache`
 * has no other way to be cleared between tests, since it's a module-level
 * singleton shared across every test in the process rather than a
 * per-instance object.
 */
function __resetForTesting() {
  cache.tokensData = null;
  cache.historicalData = null;
  cache.tokensDataPromise = null;
  cache.historicalDataPromise = null;
}

module.exports = {
  startBackgroundUpdater,
  getTokensData,
  getHistoricalData,
  __resetForTesting,
  GIT_BLAME_WARM_CWD
};
