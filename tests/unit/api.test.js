/**
 * @jest-environment jsdom
 */

import { fetchTokens, fetchHistorical, refreshData, updateData, connectSSE, disconnectSSE } from '../../dashboard/js/api.js';
import { setCurrentData, setHistoryData, setFileHistoricalData, setEventSource, historyData } from '../../dashboard/js/state.js';

describe('API Module', () => {
  beforeEach(() => {
    fetch.mockClear();
    setCurrentData(null);
    setHistoryData([]);
    setFileHistoricalData([]);
    setEventSource(null);
  });

  describe('fetchTokens', () => {
    it('fetches and returns token data', async () => {
      const mockData = { total_tokens: 1000 };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await fetchTokens();
      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith('/api/tokens');
    });

    it('throws on error response', async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      await expect(fetchTokens()).rejects.toThrow('Failed to fetch tokens');
    });
  });

  describe('fetchHistorical', () => {
    it('fetches and returns historical data', async () => {
      const mockData = [{ time: 123, total: 100 }];
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockData)
      });

      const result = await fetchHistorical();
      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith('/api/tokens/historical');
    });

    it('throws on error response', async () => {
      fetch.mockResolvedValueOnce({
        ok: false
      });

      await expect(fetchHistorical()).rejects.toThrow('Failed to fetch historical');
    });
  });

  describe('refreshData', () => {
    it('fetches and updates both tokens and historical data', async () => {
      const tokensData = { total_tokens: 1000 };
      const historicalData = [{ time: 123, total: 100, input: 50, output: 50, cache_read: 0, tokens_by_model: {} }];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(tokensData)
      }).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(historicalData)
      });

      await refreshData();
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('shows error notification on failure', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      await refreshData();
      // Should not throw, error is handled
    });
  });

  describe('updateData', () => {
    it('updates current data and generates history point', () => {
      const initialData = {
        total_tokens: 1000,
        total_input: 500,
        total_output: 500,
        total_cache_read: 100,
        tokens_by_model: { 'gpt-4': { total: 1000 } }
      };

      setCurrentData(initialData);

      const newData = {
        total_tokens: 1500,
        total_input: 700,
        total_output: 700,
        total_cache_read: 100,
        tokens_by_model: { 'gpt-4': { total: 1500 } }
      };

      updateData(newData);

      // Data should be updated
      expect(historyData.length).toBeGreaterThan(0);
    });

    it('handles first data load correctly', () => {
      const newData = {
        total_tokens: 1000,
        total_input: 500,
        total_output: 500,
        total_cache_read: 0,
        tokens_by_model: {}
      };

      updateData(newData);
      // Should initialize history with zero point
      expect(historyData.length).toBeGreaterThan(0);
    });
  });

  describe('connectSSE', () => {
    it('creates EventSource connection', () => {
      connectSSE();
      expect(EventSource).toHaveBeenCalledWith('/api/tokens/stream');
    });

    it('closes existing connection before creating new one', () => {
      const mockClose = jest.fn();
      setEventSource({ close: mockClose });

      connectSSE();
      expect(mockClose).toHaveBeenCalled();
    });

    it('handles connection errors with reconnection', () => {
      jest.useFakeTimers();
      connectSSE();

      const esInstance = EventSource.mock.results[0].value;
      esInstance.onerror();

      // Should set timeout for reconnection
      jest.advanceTimersByTime(5000);
      expect(EventSource).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('processes incoming messages', () => {
      connectSSE();

      const esInstance = EventSource.mock.results[0].value;
      const messageData = { total_tokens: 2000 };

      esInstance.onmessage({ data: JSON.stringify(messageData) });
      // Data should be processed
    });
  });

  describe('disconnectSSE', () => {
    it('closes existing connection', () => {
      const mockClose = jest.fn();
      setEventSource({ close: mockClose });

      disconnectSSE();
      expect(mockClose).toHaveBeenCalled();
    });

    it('handles null event source gracefully', () => {
      setEventSource(null);
      expect(() => disconnectSSE()).not.toThrow();
    });
  });
});
