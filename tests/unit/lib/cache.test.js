import { beforeEach, describe, expect, it, mock } from 'bun:test';

const { startBackgroundUpdater, getHistoricalData, __resetForTesting } = require('../../../lib/cache');
const mockWorker = { once: mock() };
const mockWorkerConstructor = mock(() => mockWorker);

describe('background cache warmup', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    mockWorker.once.mockClear();
    // cache.js keeps its data in a module-level singleton shared across
    // every test in this file; reset it so no test's success can leave
    // cache.historicalData truthy and short-circuit a later test's warmup
    // path via getHistoricalData()'s early return.
    __resetForTesting();
  });

  it('getHistoricalData rejects instead of resolving null when initial warmup fails (#53)', async () => {
    startBackgroundUpdater({
      WorkerImpl: mockWorkerConstructor,
      extractHistoricalDataImpl: mock(() => Promise.reject(new Error('boom'))),
      getOpenRouterPricingSnapshotImpl: mock(() => ({})),
      refreshOpenRouterPricingImpl: mock(() => Promise.resolve({})),
      refreshModelsDevPricingImpl: mock(() => Promise.resolve({}))
    });

    await expect(getHistoricalData()).rejects.toThrow(/warmup failed/);
  });

  it('defers essential scans without prewarming Git Blame', async () => {
    const extractHistoricalDataImpl = mock(() => Promise.resolve([]));
    const getOpenRouterPricingSnapshotImpl = mock(() => ({}));

    startBackgroundUpdater({
      WorkerImpl: mockWorkerConstructor,
      extractHistoricalDataImpl,
      getOpenRouterPricingSnapshotImpl,
      refreshOpenRouterPricingImpl: mock(() => Promise.resolve({})),
      refreshModelsDevPricingImpl: mock(() => Promise.resolve({}))
    });

    expect(extractHistoricalDataImpl).not.toHaveBeenCalled();
    expect(mockWorkerConstructor).not.toHaveBeenCalled();

    await Bun.sleep(1);

    expect(extractHistoricalDataImpl).toHaveBeenCalledTimes(1);
    expect(mockWorkerConstructor).toHaveBeenCalledTimes(1);
  });
});
