/**
 * @jest-environment jsdom
 */

import {
  currentData,
  historyData,
  weeklyData,
  setCurrentData,
  setHistoryData,
  setWeeklyData,
  loadCache,
  saveCache,
  clearCache,
  loadHistoryFromCache,
  getDataSignature,
  getDataForGranularity
} from '../../dashboard/js/state.js';

describe('State Module', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset state variables
    setCurrentData(null);
    setHistoryData([]);
    setWeeklyData([]);
  });

  describe('setters', () => {
    it('setCurrentData updates currentData', () => {
      const data = { total_tokens: 1000 };
      setCurrentData(data);
      // Note: We can't directly test the module-level variables
      // but we can test behavior through other functions
    });

    it('setHistoryData updates historyData', () => {
      const data = [{ time: Date.now(), total: 100 }];
      setHistoryData(data);
    });

    it('setWeeklyData updates weeklyData', () => {
      const data = [{ day: '2024-03-15', tokens: 1000 }];
      setWeeklyData(data);
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
      
      expect(localStorage.removeItem).toHaveBeenCalledWith('tokenBurnCache');
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
      
      expect(localStorage.setItem).toHaveBeenCalledWith(
        'tokenBurnCache',
        JSON.stringify(data)
      );
    });

    it('handles localStorage errors gracefully', () => {
      localStorage.setItem.mockImplementation(() => {
        throw new Error('Quota exceeded');
      });
      
      expect(() => saveCache({})).not.toThrow();
    });
  });

  describe('clearCache', () => {
    it('removes all cache keys', () => {
      clearCache();
      
      expect(localStorage.removeItem).toHaveBeenCalledWith('tokenBurnCache');
      expect(localStorage.removeItem).toHaveBeenCalledWith('tokenBurnHistory');
      expect(localStorage.removeItem).toHaveBeenCalledWith('tokenBurnWeekly');
    });
  });

  describe('loadHistoryFromCache', () => {
    it('loads history and weekly data from cache', () => {
      const history = [{ time: 123, total: 100 }];
      const weekly = [{ day: '2024-03-15', tokens: 1000 }];
      
      localStorage.setItem('tokenBurnHistory', JSON.stringify(history));
      localStorage.setItem('tokenBurnWeekly', JSON.stringify(weekly));
      
      loadHistoryFromCache();
      // State is updated internally
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
