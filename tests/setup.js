// Jest setup file
global.Plotly = {
  newPlot: jest.fn(),
  react: jest.fn()
};

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

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
