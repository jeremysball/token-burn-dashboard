jest.mock('../../../lib/historical-data', () => ({
  extractHistoricalData: jest.fn(() => Promise.resolve([]))
}));
const mockWorker = { once: jest.fn() };
const mockWorkerConstructor = jest.fn(() => mockWorker);
jest.mock('worker_threads', () => ({ Worker: mockWorkerConstructor }));

const { extractHistoricalData } = require('../../../lib/historical-data');
const { startBackgroundUpdater } = require('../../../lib/cache');

describe('background cache warmup', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockWorker.once.mockClear();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('defers essential scans without prewarming Git Blame', async () => {
    startBackgroundUpdater();

    expect(extractHistoricalData).not.toHaveBeenCalled();
    expect(mockWorkerConstructor).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(0);

    expect(extractHistoricalData).toHaveBeenCalledTimes(1);
    expect(mockWorkerConstructor).toHaveBeenCalledTimes(1);
  });
});
