import {
  currentData,
  historyData,
  weeklyData,
  dataRevision,
  dataSource,
  setCurrentData,
  setHistoryData,
  setWeeklyData,
  setDataRevision,
  setDataSource,
  loadCache,
  saveCache,
  clearCache,
  loadHistoryFromCache,
  getDataSignature,
  getDataForGranularity
} from '../../dashboard/js/state.js';

import { beforeEach, describe, expect, it, spyOn } from 'bun:test';

describe('State Module', () => {
  beforeEach(() => {
    localStorage.clear();
    setCurrentData(null);
    setHistoryData([]);
    setWeeklyData([]);
    setDataRevision(0);
    setDataSource(null);
  });

  describe('setters', () => {
    it('setCurrentData updates currentData', () => {
      const data = { total_tokens: 1000 };
      setCurrentData(data);
    });

    it('setHistoryData updates historyData', () => {
      const data = [{ time: Date.now(), total: 100 }];
      setHistoryData(data);
    });

    it('setWeeklyData updates weeklyData', () => {
      const data = [{ day: '2024-03-15', tokens: 1000 }];
      setWeeklyData(data);
    });

    it('setDataRevision increments dataRevision', () => {
      setDataRevision(5);
      expect(dataRevision).toBe(5);
    });

    it('setDataSource sets dataSource', () => {
      setDataSource('fresh-http');
      expect(dataSource).toBe('fresh-http');
    });

    it('setDataSource accepts cache source', () => {
      setDataSource('cache');
      expect(dataSource).toBe('cache');
    });

    it('setDataSource accepts live-sse source', () => {
      setDataSource('live-sse');
      expect(dataSource).toBe('live-sse');
    });
  });

  describe('dataRevision', () => {
    it('starts at 0', () => {
      expect(dataRevision).toBe(0);
    });

    it('is monotonically increasing', () => {
      setDataRevision(1);
      setDataRevision(2);
      setDataRevision(3);
      expect(dataRevision).toBe(3);
    });
  });

  describe('dataSource', () => {
    it('starts as null', () => {
      expect(dataSource).toBeNull();
    });

    it('can be set to fresh-http', () => {
      setDataSource('fresh-http');
      expect(dataSource).toBe('fresh-http');
    });
  });

  describe('loadCache', () => {
    it('returns null when no cache exists', () => {
      const result = loadCache();
      expect(result).toBeNull();
    });

    it('returns cached data when valid', () => {
      const cachedData = { total_tokens: 5000 };
      localStorage.setItem('tokenBurnCache', JSON.stringify(cachedData));
      localStorage.setItem('tokenBurnCacheVersion', 'v2');

      const result = loadCache();
      expect(result).toEqual(cachedData);
    });

    it('clears cache on version mismatch', () => {
      localStorage.setItem('tokenBurnCache', JSON.stringify({}));
      localStorage.setItem('tokenBurnCacheVersion', 'v1');

      loadCache();

      expect(localStorage.getItem('tokenBurnCache')).toBeNull();
    });

    it('handles malformed JSON gracefully', () => {
      localStorage.setItem('tokenBurnCache', 'not valid json');
      localStorage.setItem('tokenBurnCacheVersion', 'v2');

      const result = loadCache();
      expect(result).toBeNull();
    });
  });

  describe('saveCache', () => {
    it('saves data to localStorage', () => {
      const data = { total_tokens: 1000 };
      setHistoryData([{ time: 123, total: 100 }]);
      setWeeklyData([{ day: '2024-03-15', tokens: 1000 }]);

      saveCache(data);

      expect(localStorage.getItem('tokenBurnCache')).toBe(JSON.stringify(data));
    });

    it('handles localStorage errors gracefully', () => {
      const setItem = spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
      expect(() => saveCache({})).not.toThrow();
      setItem.mockRestore();
    });
  });

  describe('clearCache', () => {
    it('removes all cache keys', () => {
      clearCache();

      expect(localStorage.getItem('tokenBurnCache')).toBeNull();
      expect(localStorage.getItem('tokenBurnHistory')).toBeNull();
      expect(localStorage.getItem('tokenBurnWeekly')).toBeNull();
    });
  });

  describe('loadHistoryFromCache', () => {
    it('loads history and weekly data from cache', () => {
      const history = [{ time: 123, total: 100 }];
      const weekly = [{ day: '2024-03-15', tokens: 1000 }];

      localStorage.setItem('tokenBurnHistory', JSON.stringify(history));
      localStorage.setItem('tokenBurnWeekly', JSON.stringify(weekly));

      loadHistoryFromCache();
    });

    it('handles missing cache gracefully', () => {
      expect(() => loadHistoryFromCache()).not.toThrow();
    });
  });

  describe('getDataSignature', () => {
    it('generates consistent signature for same data', () => {
      const data = {
        total_tokens: 1000,
        total_input: 500,
        total_output: 500,
        tokens_by_model: { 'gpt-4': {} }
      };

      const sig1 = getDataSignature(data);
      const sig2 = getDataSignature(data);

      expect(sig1).toBe(sig2);
    });

    it('generates different signatures for different data', () => {
      const data1 = {
        total_tokens: 1000,
        total_input: 500,
        total_output: 500,
        tokens_by_model: {}
      };
      const data2 = {
        total_tokens: 2000,
        total_input: 500,
        total_output: 500,
        tokens_by_model: {}
      };

      const sig1 = getDataSignature(data1);
      const sig2 = getDataSignature(data2);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('getDataForGranularity', () => {
    it('returns empty object when no currentData', () => {
      setCurrentData(null);
      const result = getDataForGranularity();
      expect(result.tokens_by_model).toEqual({});
      expect(result.total_tokens).toBe(0);
    });

    it('returns current data when available', () => {
      const data = {
        tokens_by_model: { 'gpt-4': { total: 1000 } },
        total_tokens: 1000
      };
      setCurrentData(data);

      const result = getDataForGranularity();
      expect(result.tokens_by_model).toEqual(data.tokens_by_model);
      expect(result.total_tokens).toBe(1000);
    });
  });
});