import { fetchTokens, fetchHistorical, refreshData, updateData, connectSSE, disconnectSSE } from '../../dashboard/js/api.js';
import { loadCache, setCurrentData, setHistoryData, setFileHistoricalData, setEventSource, historyData, setDataRevision, setDataSource, dataRevision, dataSource, currentData } from '../../dashboard/js/state.js';
import { renderLiveEventFeed, resetLiveEventFeedForTest } from '../../dashboard/js/live-event-feed.js';

import { beforeEach, describe, expect, it, mock } from 'bun:test';

describe('API Module', () => {
  beforeEach(() => {
    global.fetch = mock();
    global.EventSource = mock(function () {
      return { close: mock(), onmessage: null, onerror: null };
    });
    setCurrentData(null);
    setHistoryData([]);
    setFileHistoricalData([]);
    setEventSource(null);
    setDataRevision(0);
    setDataSource(null);
    resetLiveEventFeedForTest();
    localStorage.clear();
    window.renderAll = undefined;
    document.body.innerHTML = '<section id="live-feed-section"></section>';
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
      expect(historyData.length).toBeGreaterThan(0);
    });

    it('increments dataRevision on each call', () => {
      expect(dataRevision).toBe(0);
      updateData({ total_tokens: 100 });
      expect(dataRevision).toBe(1);
      updateData({ total_tokens: 200 });
      expect(dataRevision).toBe(2);
    });

    it('sets dataSource to fresh-http by default', () => {
      updateData({ total_tokens: 100 });
      expect(dataSource).toBe('fresh-http');
    });

    it('accepts cache source', () => {
      updateData({ total_tokens: 100 }, { source: 'cache' });
      expect(dataSource).toBe('cache');
    });

    it('accepts live-sse source', () => {
      updateData({ total_tokens: 100 }, { source: 'live-sse' });
      expect(dataSource).toBe('live-sse');
    });

    it('normalizes total_reasoning and per-model reasoning', () => {
      updateData({
        total_tokens: 1000,
        total_reasoning: 50,
        tokens_by_model: {
          'gpt-4': { total: 1000, reasoning: 50 },
          'claude-3': { total: 500 },
        }
      });
      expect(currentData?.total_reasoning).toBe(50);
      expect(currentData?.tokens_by_model['gpt-4'].reasoning).toBe(50);
      expect(currentData?.tokens_by_model['claude-3'].reasoning).toBe(0);
    });

    it('does not put orchestration metadata into the persisted API payload', () => {
      updateData({ total_tokens: 100 }, { source: 'cache' });
      expect(currentData?.source).toBeUndefined();
      expect(currentData?.revision).toBeUndefined();
    });

    it('processes cache, fresh HTTP, and SSE snapshots through the API/render path', async () => {
      const container = /** @type {HTMLElement} */ (document.getElementById('live-feed-section'));
      window.renderAll = () => renderLiveEventFeed(container, currentData, {
        source: dataSource ?? undefined,
        revision: dataRevision,
      });

      const snapshotA = {
        total_tokens: 100,
        tokens_by_model: { 'a/model-1': { total: 100, input: 50, cache_read: 50 } },
      };
      localStorage.setItem('tokenBurnCacheVersion', 'v2');
      localStorage.setItem('tokenBurnCache', JSON.stringify(snapshotA));
      const cached = loadCache();
      updateData(cached, { source: 'cache' });
      expect(dataSource).toBe('cache');
      expect(container.querySelector('#latestPillText').textContent).toMatch(/waiting/i);

      const snapshotB = {
        total_tokens: 200,
        tokens_by_model: { 'a/model-1': { total: 200, input: 100, cache_read: 100 } },
      };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(snapshotB),
      }).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });
      await refreshData();
      expect(dataSource).toBe('fresh-http');
      expect(container.querySelector('#latestPillText').textContent).toMatch(/waiting/i);

      const snapshotC = {
        total_tokens: 350,
        pricing_by_model: { 'a/model-1': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, reasoning: 0.05 } },
        tokens_by_model: { 'a/model-1': { total: 350, input: 150, cache_read: 150 } },
      };
      connectSSE();
      const esInstance = EventSource.mock.results[0].value;
      esInstance.onmessage({ data: JSON.stringify(snapshotC) });
      const eventText = container.querySelector('#latestPillText').textContent;
      expect(dataSource).toBe('live-sse');
      expect(eventText).toContain('model-1');
      expect(eventText).toMatch(/150 tokens/i);

      window.renderAll();
      expect(container.querySelector('#latestPillText').textContent).toBe(eventText);
    });
  });

  describe('connectSSE', () => {
    it('creates EventSource connection', () => {
      connectSSE();
      expect(EventSource).toHaveBeenCalledWith('/api/tokens/stream');
    });

    it('closes existing connection before creating new one', () => {
      const mockClose = mock();
      setEventSource({ close: mockClose });

      connectSSE();
      expect(mockClose).toHaveBeenCalled();
    });

    it('handles connection errors with reconnection', async () => {
      connectSSE();

      const esInstance = EventSource.mock.results[0].value;
      esInstance.onerror();

      const deadline = Date.now() + 7000;
      while (EventSource.mock.calls.length < 2 && Date.now() < deadline) {
        await Bun.sleep(100);
      }
      expect(EventSource).toHaveBeenCalledTimes(2);
    }, { timeout: 10000 });

    it('processes incoming messages with live-sse source', () => {
      connectSSE();

      const esInstance = EventSource.mock.results[0].value;
      const messageData = { total_tokens: 2000 };

      esInstance.onmessage({ data: JSON.stringify(messageData) });
      expect(dataSource).toBe('live-sse');
    });
  });

  describe('disconnectSSE', () => {
    it('closes existing connection', () => {
      const mockClose = mock();
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
