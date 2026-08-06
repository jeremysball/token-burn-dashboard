import { beforeEach, describe, expect, it, mock } from 'bun:test';

const { startBackgroundUpdater, getHistoricalData } = require('../../../lib/cache');
const mockWorker = { once: mock() };
const mockWorkerConstructor = mock(() => mockWorker);

describe('background cache warmup', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    mockWorker.once.mockClear();
  });

  // Runs first, deliberately, before any other test in this file resolves
  // cache.historicalData to a truthy value: cache.js keeps that data in a
  // module-level singleton with no reset hook, so once it's populated,
  // getHistoricalData()'s early-return short-circuits past the warmup-failure
  // path this test exercises.
  it('getHistoricalData rejects instead of resolving null when initial warmup fails (#53)', async () => {
    startBackgroundUpdater({
      WorkerImpl: mockWorkerConstructor,
      extractHistoricalDataImpl: mock(() => Promise.reject(new Error('boom'))),
      getOpenRouterPricingSnapshotImpl: mock(() => ({}))
    });

    await expect(getHistoricalData()).rejects.toThrow(/warmup failed/);
  });

  it('defers essential scans without prewarming Git Blame', async () => {
    const extractHistoricalDataImpl = mock(() => Promise.resolve([]));
    const getOpenRouterPricingSnapshotImpl = mock(() => ({}));

    startBackgroundUpdater({
      WorkerImpl: mockWorkerConstructor,
      extractHistoricalDataImpl,
      getOpenRouterPricingSnapshotImpl
    });

    expect(extractHistoricalDataImpl).not.toHaveBeenCalled();
    expect(mockWorkerConstructor).not.toHaveBeenCalled();

    await Bun.sleep(1);

    expect(extractHistoricalDataImpl).toHaveBeenCalledTimes(1);
    expect(mockWorkerConstructor).toHaveBeenCalledTimes(1);
  });
});
