import { beforeEach, describe, expect, it, mock } from 'bun:test';

const { startBackgroundUpdater } = require('../../../lib/cache');
const mockWorker = { once: mock() };
const mockWorkerConstructor = mock(() => mockWorker);

describe('background cache warmup', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    mockWorker.once.mockClear();
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
