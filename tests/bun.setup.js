import { beforeEach, mock } from "bun:test";

const newPlot = mock(() => Promise.resolve());
const react = mock(() => Promise.resolve());
const resize = mock(() => Promise.resolve());
const eventSource = mock(function EventSource(url) {
  this.url = url;
});
const fetchMock = mock(() => Promise.resolve(new Response()));

function resetMocks() {
  newPlot.mockClear();
  newPlot.mockImplementation(() => Promise.resolve());
  react.mockClear();
  react.mockImplementation(() => Promise.resolve());
  resize.mockClear();
  resize.mockImplementation(() => Promise.resolve());
  eventSource.mockClear();
  eventSource.mockImplementation(function EventSource(url) {
    this.url = url;
  });
  fetchMock.mockClear();
  fetchMock.mockImplementation(() => Promise.resolve(new Response()));

  globalThis.Plotly = { newPlot, react, Plots: { resize } };
  globalThis.EventSource = eventSource;
  globalThis.fetch = fetchMock;
}

resetMocks();
beforeEach(resetMocks);
