// Jest setup file
const localStorageData = new Map();

const localStorageMock = {
  getItem: jest.fn((key) => (localStorageData.has(key) ? localStorageData.get(key) : null)),
  setItem: jest.fn((key, value) => {
    localStorageData.set(String(key), String(value));
  }),
  removeItem: jest.fn((key) => {
    localStorageData.delete(String(key));
  }),
  clear: jest.fn(() => {
    localStorageData.clear();
  })
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});


global.Plotly = {
  newPlot: jest.fn(),
  react: jest.fn()
};

// Mock EventSource
global.EventSource = jest.fn(() => ({
  close: jest.fn(),
  onmessage: null,
  onerror: null
}));

// Mock fetch
global.fetch = jest.fn();

// Mock requestAnimationFrame
global.requestAnimationFrame = jest.fn((cb) => setTimeout(cb, 16));

global.performance = {
  now: jest.fn(() => Date.now())
};

beforeEach(() => {
  localStorageData.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();

  // Restore the default storage behavior in case a test overrides it.
  localStorageMock.getItem.mockImplementation((key) => (localStorageData.has(key) ? localStorageData.get(key) : null));
  localStorageMock.setItem.mockImplementation((key, value) => {
    localStorageData.set(String(key), String(value));
  });
  localStorageMock.removeItem.mockImplementation((key) => {
    localStorageData.delete(String(key));
  });
  localStorageMock.clear.mockImplementation(() => {
    localStorageData.clear();
  });

  if (typeof EventSource.mockClear === 'function') {
    EventSource.mockClear();
  }
  if (typeof fetch.mockClear === 'function') {
    fetch.mockClear();
  }
});